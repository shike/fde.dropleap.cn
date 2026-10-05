#!/usr/bin/env node
/**
 * 政策采集器：cn.bing 抓各地 FDE 政策/人才工程/认证动态 → 抓页面真实标题验证 → 入库。
 * 跑法：node pipeline/collect-policies.mjs
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { DatabaseSync } from "node:sqlite";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

const run = promisify(execFile);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const db = new DatabaseSync(path.join(ROOT, "data", "fde.db"));
db.exec(`
CREATE TABLE IF NOT EXISTS policies (
  id INTEGER PRIMARY KEY,
  title TEXT, region TEXT, level TEXT, date TEXT,
  summary TEXT, url TEXT, source TEXT,
  status TEXT DEFAULT 'candidate', collected_at TEXT
);
`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

const QUERIES = [
  "FDE 人才 政策 培育",
  "前置部署工程师 政策 文件",
  "前沿部署工程师 培训 工程 城市",
  "FDE 认证 评价体系 发布",
  "人工智能 落地 FDE 岗位 方案",
  "FDE 人才高地 培育 千名",
];

const REGION_RE =
  /(北京|上海|深圳|杭州|广州|苏州|成都|南京|武汉|西安|合肥|长沙|重庆|天津|郑州|青岛|厦门|宁波|无锡|东莞|佛山|光谷|湖北|浙江|江苏|广东)/;

async function curl(url) {
  try {
    const { stdout } = await run("curl", ["-sL", "-m", "15", "-A", UA, url], { timeout: 20_000, maxBuffer: 8 * 1024 * 1024 });
    return stdout ?? "";
  } catch {
    return "";
  }
}

const seen = new Set(db.prepare("SELECT url FROM policies WHERE url IS NOT NULL").all().map((r) => r.url));
const titleSeen = new Set(db.prepare("SELECT title FROM policies").all().map((r) => r.title));
const slug = (t) => createHash("md5").update(t).digest("hex").slice(0, 12);
const insert = db.prepare(
  `INSERT INTO policies (title, region, level, date, summary, url, source, status, collected_at)
   VALUES (?, ?, ?, NULL, ?, ?, ?, 'candidate', ?)`
);

let added = 0;
for (const q of QUERIES) {
  const html = await curl(`https://cn.bing.com/search?q=${encodeURIComponent(q)}&count=15`);
  const urls = [...new Set([...html.matchAll(/href="(https?:\/\/[^"]+)"/g)].map((m) => m[1]))]
    .filter((u) => !/bing|microsoft|msn|go\.microsoft|beian|miit|baike\.baidu|openfde\.net/.test(u))
    .filter((u) => !/\.(png|jpe?g|css|js|ico|svg)$/i.test(u))
    .slice(0, 8);
  for (const u of urls) {
    if (seen.has(u)) continue;
    const page = await curl(u);
    if (!page) continue;
    const title = page.match(/<title>([^<]*)<\/title>/i)?.[1]?.trim() ?? "";
    if (!/(fde|前置部署|前线部署|前沿部署|forward deployed)/i.test(title)) continue;
    if (!/(政策|培训|认证|人才|方案|培育|工程|发布|体系)/i.test(title)) continue;
    if (titleSeen.has(title.slice(0, 40))) continue;
    seen.add(u);
    titleSeen.add(title.slice(0, 40));
    const desc = page.match(/<meta[^>]+name="description"[^>]+content="([^"]*)"/i)?.[1]?.replace(/\s+/g, " ").slice(0, 180) ?? null;
    const region = title.match(REGION_RE)?.[1] ?? "全国";
    const level = region === "全国" ? "行业动态" : "城市政策";
    const host = new URL(u).hostname.replace(/^www\./, "");
    insert.run(title.slice(0, 120), region, level, desc, u, host, new Date().toISOString());
    added++;
    console.log(`  ✓ [${region}] ${title.slice(0, 46)} | ${host}`);
    await sleep(300);
  }
  await sleep(1500);
}
console.log(`== done == 新增政策 ${added}，政策库共 ${db.prepare("SELECT COUNT(*) n FROM policies").get().n} 条`);
