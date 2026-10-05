#!/usr/bin/env node
/**
 * 分城市问询采集：cn.bing 直连，城市 × 关键词矩阵，从结果标题抓具名人物线索。
 * 产出：reports/people-leads-<date>.md（人名 | 标题 | 链接 | 城市），供人工复核后入库。
 * 跑法：node pipeline/harvest-people.mjs
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const run = promisify(execFile);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

const CITIES = [
  "北京", "上海", "深圳", "杭州", "广州", "苏州", "成都", "南京", "武汉", "西安",
  "合肥", "长沙", "重庆", "天津", "郑州", "青岛", "厦门", "宁波", "无锡", "东莞", "佛山",
];
const QUERIES = [
  (c) => `${c} 前置部署工程师`,
  (c) => `${c} FDE 工程师 专访 OR 对话 OR 嘉宾`,
  (c) => `${c} AI落地 顾问 专家 分享`,
];

async function curl(url) {
  try {
    const { stdout } = await run("curl", ["-sL", "-m", "15", "-A", UA, url], { timeout: 20_000, maxBuffer: 8 * 1024 * 1024 });
    return stdout ?? "";
  } catch {
    return "";
  }
}

// cn.bing 结果标题：<h2><a href="URL" ...>TITLE</a>
function extractResults(html) {
  const out = [];
  for (const m of html.matchAll(/<h2[^>]*><a[^>]*href="(https?:\/\/[^"]+)"[^>]*>([\s\S]*?)<\/a>/g)) {
    const title = m[2].replace(/<[^>]+>/g, "").trim();
    if (title) out.push({ url: m[1].split("#")[0], title });
  }
  return out;
}

const RELEVANT = /(FDE|前置部署|前线部署|前沿部署|AI落地|大模型落地|AI交付|智能体落地|AI 解决方案)/i;
// 人名线索模式
const NAME_PATTERNS = [
  /(?:专访|对话|访谈|对谈)[:：\s]*([\u4e00-\u9fa5A-Za-z·]{2,8})/,
  /([\u4e00-\u9fa5A-Za-z·]{2,8})[:：]\s*(?:一位|一个)?(?:FDE|前置部署|AI落地|大模型)/,
  /(?:嘉宾|分享嘉宾)[:：\s]*([\u4e00-\u9fa5A-Za-z·]{2,8})/,
];

const leads = [];
const seenTitle = new Set();
for (const city of CITIES) {
  for (const qf of QUERIES) {
    const q = qf(city);
    const html = await curl(`https://cn.bing.com/search?q=${encodeURIComponent(q)}&count=15`);
    for (const r of extractResults(html)) {
      if (!RELEVANT.test(r.title)) continue;
      if (/^(FDE|前置部署|前线部署)（?(是什么|是指|岗位|工程师)?（?(知乎|CSDN|百科|腾讯云)/.test(r.title)) continue;
      const key = r.title.slice(0, 30);
      if (seenTitle.has(key)) continue;
      seenTitle.add(key);
      let name = null;
      for (const p of NAME_PATTERNS) {
        const m = r.title.match(p);
        if (m) { name = m[1].trim(); break; }
      }
      leads.push({ city, name, title: r.title.slice(0, 80), url: r.url });
    }
    await sleep(1600);
  }
  console.log(`  [${city}] 累计线索 ${leads.length}`);
}

const date = new Date().toISOString().slice(0, 10);
const md = `# 分城市问询 · 人物线索（${date}）

> 由 cn.bing 城市×关键词矩阵自动采集，供人工复核后入库。name 非空者为优先。

| 城市 | 人名? | 标题 | 链接 |
|---|---|---|---|
${leads.map((l) => `| ${l.city} | ${l.name ?? ""} | ${l.title.replace(/\|/g, "／")} | ${l.url} |`).join("\n")}
`;
writeFileSync(path.join(ROOT, "reports", `people-leads-${date}.md`), md);
console.log(`== done == 线索 ${leads.length} 条 → reports/people-leads-${date}.md`);
