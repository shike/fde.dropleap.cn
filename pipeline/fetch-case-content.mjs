#!/usr/bin/env node
/**
 * 案例内容站内化：抓取在线案例的文章页 → 提取正文 → 压缩成站内摘要存 content。
 * 版权口径：存聚合摘要（非全文转载），详情页文末标注原文出处。
 * 跑法：node pipeline/fetch-case-content.mjs
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

async function curl(url) {
  try {
    const { stdout } = await run("curl", ["-sL", "-m", "15", "-A", UA, url], { timeout: 20_000, maxBuffer: 8 * 1024 * 1024 });
    return stdout ?? "";
  } catch {
    return "";
  }
}

function extractText(html) {
  return html
    .replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, " ")
    .replace(/<[^>]+>/g, "\n")
    .replace(/&nbsp;/g, " ")
    .replace(/&[a-z]+;/gi, " ")
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 12 && !/^(登录|注册|首页|下载|关注|扫码|分享|评论|点赞|收藏|广告)/.test(l))
    .join("\n");
}

const rows = db.prepare("SELECT id, url FROM cases WHERE status != 'offline' AND (content IS NULL OR content = '')").all();
console.log(`待抓正文：${rows.length} 条`);
let ok = 0;
for (const r of rows) {
  const html = await curl(r.url);
  if (!html) continue;
  const text = extractText(html);
  if (text.length < 300) continue;
  // 摘要：取正文前 1500 字符（聚合口径，非全文转载）
  const digest = text.slice(0, 1500);
  db.prepare("UPDATE cases SET content=? WHERE id=?").run(digest, r.id);
  ok++;
  console.log(`  ✓ ${r.url.slice(0, 60)}（${digest.length} 字）`);
  await sleep(400);
}
console.log(`== done == ${ok}/${rows.length}`);
