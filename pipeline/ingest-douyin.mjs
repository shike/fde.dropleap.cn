#!/usr/bin/env node
/**
 * 抖音资料入库：读取 pipeline/douyin-profiles.jsonl（由浏览器抓取流程产出，一行一条）：
 * {"url":"https://www.douyin.com/user/MS4w...","nickname":"...","signature":"...","follower_count":1234,"sec_uid":"...","unique_id":"...","works":0}
 * 跑法：node pipeline/ingest-douyin.mjs
 */
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const db = new DatabaseSync(path.join(ROOT, "data", "fde.db"));
try {
  db.exec("ALTER TABLE persons ADD COLUMN layer TEXT DEFAULT 'core'");
} catch {}
try {
  db.exec("ALTER TABLE persons ADD COLUMN platform TEXT DEFAULT 'github'");
} catch {}
try {
  db.exec("ALTER TABLE person_contacts ADD COLUMN douyin TEXT");
} catch {}

const FDE_RE = /\b(fde|forward[- ]?deploy(ed|ment)?)\b|(前置|前沿|前线|前进)部署/i;

const lines = readFileSync(path.join(ROOT, "pipeline", "douyin-profiles.jsonl"), "utf8")
  .split("\n")
  .filter((l) => l.trim() && !l.trim().startsWith("#"));

const now = new Date().toISOString();
let kept = 0;
for (const line of lines) {
  let p;
  try {
    p = JSON.parse(line);
  } catch {
    continue;
  }
  const id = p.sec_uid || p.unique_id || (p.url?.split("/user/")[1] ?? "");
  if (!id) continue;
  const login = `douyin:${id}`;
  const isFde = FDE_RE.test(`${p.signature ?? ""} ${p.nickname ?? ""}`);
  const followerScore =
    p.follower_count >= 10000 ? 15 : p.follower_count >= 1000 ? 10 : p.follower_count >= 100 ? 6 : 2;
  const score = (isFde ? 15 : 8) + followerScore;
  const tier = score >= 35 ? "S" : score >= 22 ? "A" : score >= 10 ? "B" : "";
  db.prepare(
    `INSERT INTO persons (login, name, bio, location, html_url, followers, active_2026,
       fde_evidence, china_signal, top_repos_json, score, tier, status, sources_json,
       created_at, updated_at, layer, platform)
     VALUES (?, ?, ?, '中国', ?, ?, 1, ?, 'douyin', '[]', ?, ?, 'candidate', ?, ?, ?, 'core', 'douyin')
     ON CONFLICT(login) DO UPDATE SET name=excluded.name, bio=excluded.bio,
       followers=excluded.followers, score=excluded.score, tier=excluded.tier,
       updated_at=excluded.updated_at`
  ).run(
    login,
    p.nickname ?? null,
    p.signature ?? null,
    p.url,
    p.follower_count ?? 0,
    isFde ? "抖音简介自述 FDE 相关" : "种子推荐（简介未明确自述，待人工核）",
    isFde ? score : score - 5,
    isFde ? tier : "",
    JSON.stringify([{ type: "douyin", url: p.url, collected_at: now }]),
    now,
    now
  );
  const row = db.prepare("SELECT id FROM persons WHERE login=?").get(login);
  db.prepare(
    `INSERT INTO person_contacts (person_id, douyin) VALUES (?, ?)
     ON CONFLICT(person_id) DO UPDATE SET douyin=excluded.douyin`
  ).run(row.id, p.unique_id ?? null);
  kept++;
}
console.log(`ingested ${kept}/${lines.length} douyin profiles`);
