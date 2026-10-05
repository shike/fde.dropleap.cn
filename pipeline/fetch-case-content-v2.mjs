#!/usr/bin/env node
/**
 * 案例正文抓取 v2：按站点适配正文容器，抓全文不截断（上限 60KB）。
 * 跑法：node pipeline/fetch-case-content-v2.mjs [--all]
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import { fileURLToPath } from "node:url";

const run = promisify(execFile);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const db = new DatabaseSync(path.join(ROOT, "data", "fde.db"));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

const ALL = process.argv.includes("--all");
const rows = ALL
  ? db.prepare("SELECT id, url FROM cases WHERE url IS NOT NULL AND url != ''").all()
  : db.prepare("SELECT id, url FROM cases WHERE url IS NOT NULL AND url != '' AND (content IS NULL OR length(content) < 2000)").all();

// 各站点正文容器（按主机匹配），fallback 到 <article> 再到全文
const HOST_SELECTORS = [
  { host: "blog.csdn.net", sel: /<div[^>]*id="content_views"[^>]*>([\s\S]*?)<\/div>\s*(?:<div|<section|<footer)/i },
  { host: "juejin.cn", sel: /<article[^>]*>([\s\S]*?)<\/article>/i },
  { host: "cloud.tencent.com", sel: /<div[^>]*class="[^"]*J-articleContent[^"]*"[^>]*>([\s\S]*?)<\/div>\s*<div/i },
  { host: "news.qq.com", sel: /<div[^>]*class="[^"]*content-article[^"]*"[^>]*>([\s\S]*?)<\/div>/i },
  { host: "cnblogs.com", sel: /<div[^>]*id="cnblogs_post_body"[^>]*>([\s\S]*?)<\/div>\s*<div id="MySignature"|<div[^>]*id="cnblogs_post_body"[^>]*>([\s\S]*?)<div id="blog_post_info_block"/i },
  { host: "developer.aliyun.com", sel: /<div[^>]*class="[^"]*markdown-body[^"]*"[^>]*>([\s\S]*?)<\/div>\s*<div/i },
  { host: "github.io", sel: /<article[^>]*>([\s\S]*?)<\/article>/i },
];

async function curl(url) {
  try {
    const { stdout } = await run("curl", ["-sL", "-m", "20", "-A", UA, url], { timeout: 25_000, maxBuffer: 16 * 1024 * 1024 });
    return stdout ?? "";
  } catch {
    return "";
  }
}

function cleanText(fragment) {
  return fragment
    .replace(/<(script|style|svg)[^>]*>[\s\S]*?<\/\1>/gi, " ")
    .replace(/<\/(p|div|li|h[1-6]|pre|blockquote|tr|section)>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#x?[0-9a-f]+;/gi, " ")
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 1)
    .filter((l) => !/^(登录|注册|首页|下载安装|扫码|分享|上一篇|下一篇|相关文章|推荐阅读|广告|版权声明|©|Copyright)/i.test(l))
    .join("\n")
    .slice(0, 60_000);
}

function extractBody(html, url) {
  let host = "";
  try { host = new URL(url).hostname.replace(/^www\./, ""); } catch {}
  for (const { host: h, sel } of HOST_SELECTORS) {
    if (!host.endsWith(h)) continue;
    const m = html.match(sel);
    if (m) {
      const frag = m[1] ?? m[2] ?? "";
      const text = cleanText(frag);
      if (text.length > 300) return text;
    }
  }
  const art = html.match(/<article[^>]*>([\s\S]*?)<\/article>/i);
  if (art) {
    const text = cleanText(art[1]);
    if (text.length > 300) return text;
  }
  return cleanText(html.replace(/<(script|style|nav|header|footer)[^>]*>[\s\S]*?(<\/\1>|$)/gi, " ")).slice(0, 30_000);
}

console.log(`待抓全文：${rows.length} 条`);
let ok = 0;
for (const r of rows) {
  const html = await curl(r.url);
  if (!html) { console.log(`  ✗ 抓取失败 ${r.url.slice(0, 55)}`); continue; }
  const body = extractBody(html, r.url);
  if (body.length < 300) { console.log(`  ✗ 正文过短 ${r.url.slice(0, 55)}`); continue; }
  db.prepare("UPDATE cases SET content=? WHERE id=?").run(body, r.id);
  ok++;
  console.log(`  ✓ ${body.length} 字 | ${r.url.slice(0, 60)}`);
  await sleep(500);
}
console.log(`== done == ${ok}/${rows.length}`);
