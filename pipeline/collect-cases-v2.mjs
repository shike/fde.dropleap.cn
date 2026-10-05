#!/usr/bin/env node
/**
 * 案例库验证式采集 v2：cn.bing 搜 FDE 内容 → 抓候选页真实 <title>/描述 → 验证含 FDE 词才入库。
 * 正确性由构造保证：标题直接来自目标页面本身，杜绝"标题对链接错"。
 * 跑法：node pipeline/collect-cases-v2.mjs
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
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

const QUERIES = [
  "FDE 前置部署工程师 落地 复盘",
  "FDE 前线部署工程师 岗位 增长 招聘",
  "FDE 驻场 交付 大模型 实战",
  "前沿部署工程师 Palantir 方法论",
  "FDE 工程师 薪资 年薪",
  "FDE 知识库 技能 Agent",
  "前置部署工程师 制造业 落地 案例",
  "FDE AI Agent 客户现场 实操",
  "FDE 模式 组织 平台 研发",
  "大模型 交付 FDE 驻场工程师 区别",
  "FDE 是什么岗位",
  "FDE 岗位 爆火 出圈",
  "企业 抢 FDE 人才",
  "FDE 认证 证书 评价体系",
  "Forward Deployed Engineer 中国",
  "FDE 实战营 大会",
  "AI 落地 驻场 工程师故事",
  "FDE 白皮书 报告 2026",
  "FDE 转型 售前 交付工程师",
  "Agent 落地交付 FDE 客户",
];

const FDE_TITLE_RE = /(fde|前置部署|前线部署|前沿部署|forward deployed)/i;
const BAD_HOST = /bing|microsoft|msn|go\.microsoft|baike\.baidu|openfde\.net|csdn\.net\/weixin_|zhihu\.com/i;

async function curl(url) {
  try {
    const { stdout } = await run("curl", ["-sL", "-m", "15", "-A", UA, url], { timeout: 20_000, maxBuffer: 8 * 1024 * 1024 });
    return stdout ?? "";
  } catch {
    return "";
  }
}

function extractMeta(html) {
  const title = html.match(/<title>([^<]*)<\/title>/i)?.[1]?.trim() ?? "";
  const desc =
    html.match(/<meta[^>]+name="description"[^>]+content="([^"]*)"/i)?.[1] ??
    html.match(/<meta[^>]+content="([^"]*)"[^>]+name="description"/i)?.[1] ??
    "";
  return { title, desc: desc.replace(/\s+/g, " ").slice(0, 200) };
}

const slug = (t) => createHash("md5").update(t).digest("hex").slice(0, 12);
const seen = new Set(
  db.prepare("SELECT url FROM cases").all().map((r) => r.url)
);

const insert = db.prepare(
  `INSERT INTO cases (title, slug, type, url, summary, published_at, source_url, status, collected_at)
   VALUES (?, ?, 'article', ?, ?, NULL, ?, 'candidate', ?)
   ON CONFLICT(slug) DO NOTHING`
);

let added = 0;
for (const q of QUERIES) {
  const html = await curl(`https://cn.bing.com/search?q=${encodeURIComponent(q)}&count=20`);
  const urls = [...new Set([...html.matchAll(/href="(https?:\/\/[^"]+)"/g)].map((m) => m[1]))]
    .filter((u) => !BAD_HOST.test(u) && !/\.(png|jpe?g|css|js|ico|svg)$/i.test(u))
    .slice(0, 10);
  console.log(`[q] ${q} → 候选 ${urls.length}`);
  for (const u of urls) {
    if (seen.has(u)) continue;
    const page = await curl(u);
    if (!page) continue;
    const { title, desc } = extractMeta(page);
    if (!title || !FDE_TITLE_RE.test(title)) continue;
    if (/(招聘|下载|安装|官网|登录|注册|首页)/.test(title.slice(0, 12)) && title.length < 25) continue;
    seen.add(u);
    const info = insert.run(title.slice(0, 120), slug(title), u, desc || null, u, new Date().toISOString());
    if (info.changes > 0) {
      added++;
      console.log(`  ✓ ${title.slice(0, 50)} | ${u.slice(0, 55)}`);
    }
    await sleep(300);
  }
  await sleep(1600);
}
console.log(`== done == 新增验证案例 ${added}，案例库共 ${db.prepare("SELECT COUNT(*) n FROM cases WHERE status != 'offline'").get().n} 条`);
