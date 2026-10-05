#!/usr/bin/env node
/** 案例 slug 关键词化：标题英文关键词 + 短哈希。幂等（已是新格式跳过）。跑法：node pipeline/reslug-cases.mjs */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const db = new DatabaseSync(path.join(ROOT, "data", "fde.db"));

const STOP = new Set(["the", "of", "and", "to", "a", "an", "in", "is", "what", "how", "for", "on", "with"]);
function slugify(title, oldSlug) {
  const words = (title.match(/[a-zA-Z]{2,}/g) ?? [])
    .map((w) => w.toLowerCase())
    .filter((w) => !STOP.has(w))
    .slice(0, 3);
  const base = words.length ? words.join("-") : "fde";
  return `${base}-${oldSlug.slice(0, 8)}`;
}

const rows = db.prepare("SELECT id, title, slug FROM cases").all();
const upd = db.prepare("UPDATE cases SET slug=? WHERE id=?");
const seen = new Set(db.prepare("SELECT slug FROM cases").all().map((r) => r.slug));
let n = 0;
for (const r of rows) {
  const fresh = slugify(r.title, r.slug);
  if (fresh === r.slug || seen.has(fresh)) continue;
  seen.add(fresh);
  upd.run(fresh, r.id);
  n++;
  if (n <= 5) console.log(`  ${r.slug} → ${fresh} | ${r.title.slice(0, 36)}`);
}
console.log(`== done == 重写 ${n}/${rows.length} 条 slug`);
