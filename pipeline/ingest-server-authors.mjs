#!/usr/bin/env node
/** 服务器收割作者入库（严口径）。数据格式：aweme/detail author 对象。跑法：node pipeline/ingest-server-authors.mjs */
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const db = new DatabaseSync(path.join(ROOT, "data", "fde.db"));
const now = new Date().toISOString();

const FDE_RE = /\b(fde|forward[- ]?deploy(ed|ment)?)\b|(前置|前沿|前线|前进)部署/i;
const ENGINEERING_RE =
  /工程师|开发者|开发|写代码|代码|交付|实施|架构|算法|大模型|Agent|智能体|程序员|技术|CTO|全栈|后端|前端|odoo|二开|GPT|Claude|Cursor|Coze|Dify|n8n|RPA|数据科学|运维|创业|CEO|创始人|董事长|咨询|培训师|产品经理|aigc|AIGC/i;
const MARKETING_RE = /落地班|训练营|培训班|商学院|课程|招生|获客|引流|加盟|招商|变现|副业|私董|陪跑|起号|孵化/i;

const lines = readFileSync(path.join(ROOT, "pipeline", "douyin-server-authors.jsonl"), "utf8")
  .trim()
  .split("\n");

let kept = 0, kicked = 0, dup = 0;
for (const line of lines) {
  let a;
  try {
    a = JSON.parse(line);
  } catch {
    continue;
  }
  if (!a.sec_uid) continue;
  const login = `douyin:${a.sec_uid}`;
  if (db.prepare("SELECT 1 FROM persons WHERE login=?").get(login)) { dup++; continue; }

  const blob = `${a.nickname ?? ""} ${a.signature ?? ""}`;
  const isFde = FDE_RE.test(blob);
  const hasEng = ENGINEERING_RE.test(blob);
  if (!isFde && !hasEng) { kicked++; continue; }
  if (MARKETING_RE.test(blob) && !hasEng) { kicked++; continue; }

  const fc = a.follower_count ?? 0;
  const favorited = a.total_favorited ?? 0;
  const followerScore = fc >= 100000 ? 15 : fc >= 10000 ? 12 : fc >= 1000 ? 8 : fc >= 100 ? 5 : 2;
  const score = (isFde ? 15 : 10) + followerScore + (favorited >= 10000 ? 3 : 0);
  const tier = score >= 35 ? "S" : score >= 22 ? "A" : score >= 10 ? "B" : "";

  const info = db.prepare(
    `INSERT INTO persons (login, name, bio, location, html_url, followers, active_2026,
       fde_evidence, china_signal, top_repos_json, score, tier, status, reject_reason,
       sources_json, created_at, updated_at, layer, platform)
     VALUES (?, ?, ?, ?, ?, ?, 1, ?, 'douyin', ?, ?, ?, 'candidate', NULL, ?, ?, ?, 'core', 'douyin')
     ON CONFLICT(login) DO NOTHING`
  ).run(
    login,
    a.nickname ?? null,
    a.signature ?? null,
    a.province || a.city || "中国",
    `https://www.douyin.com/user/${a.sec_uid}`,
    fc,
    isFde ? "抖音简介自述 FDE 相关" : "关联发现（视频作者，工程实战信号）",
    JSON.stringify([
      { name: a.unique_id || a.nickname, stars: favorited, desc: `获赞 ${favorited.toLocaleString()}`, url: `https://www.douyin.com/user/${a.sec_uid}` },
    ]),
    score,
    tier,
    JSON.stringify([
      { type: "douyin", url: `https://www.douyin.com/user/${a.sec_uid}`, collected_at: now },
      { type: "douyin-server-harvest", unique_id: a.unique_id ?? "", collected_at: now },
    ]),
    now,
    now
  );
  if (info.changes > 0) {
    kept++;
    const row = db.prepare("SELECT id FROM persons WHERE login=?").get(login);
    db.prepare(
      `INSERT INTO person_contacts (person_id, douyin) VALUES (?, ?)
       ON CONFLICT(person_id) DO UPDATE SET douyin=excluded.douyin`
    ).run(row.id, a.unique_id ?? null);
  }
}
console.log(`入库 ${kept}，拒收 ${kicked}，重复 ${dup}`);
