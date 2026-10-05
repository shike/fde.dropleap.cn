#!/usr/bin/env node
/**
 * 把 content-studio 生产库拉下来的种子转成 ingest-douyin 格式（只读来源，不回写）。
 * 输入：/tmp/watch_accounts.json、/tmp/watch_candidates.json（sqlite3 -json 导出）
 * 输出：pipeline/douyin-profiles.jsonl
 */
import { writeFileSync, readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const secFromUrl = (url = "") => {
  const m = url.match(/(?:share\/user|douyin\.com\/user)\/([A-Za-z0-9_-]+)/);
  return m ? m[1] : "";
};

const out = [];
const seen = new Set();
const push = (p) => {
  const sec = p.sec_uid || secFromUrl(p.url);
  if (!sec || seen.has(sec)) return;
  seen.add(sec);
  out.push({
    url: p.url || `https://www.iesdouyin.com/share/user/${sec}`,
    nickname: p.nickname ?? p.name ?? "",
    signature: p.signature ?? "",
    follower_count: p.follower_count ?? 0,
    sec_uid: sec,
    unique_id: "",
    works: 0,
    _source: p._source ?? "content-studio",
  });
};

const accPath = "/tmp/watch_accounts.json";
if (existsSync(accPath)) {
  for (const a of JSON.parse(readFileSync(accPath, "utf8"))) push({ ...a, _source: "content-studio:watch_accounts" });
}
const candPath = "/tmp/watch_candidates.json";
if (existsSync(candPath)) {
  for (const c of JSON.parse(readFileSync(candPath, "utf8"))) push({ ...c, _source: "content-studio:watch_candidates" });
}

writeFileSync(path.join(ROOT, "pipeline", "douyin-profiles.jsonl"), out.map((o) => JSON.stringify(o)).join("\n") + "\n");
console.log(`converted ${out.length} unique douyin seeds`);
