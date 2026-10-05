#!/usr/bin/env node
/** 抖音新发现作者入库（严口径）：工程实战信号必须；营销/培训号拒收。跑法：node pipeline/ingest-discovered.mjs */
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const db = new DatabaseSync(path.join(ROOT, "data", "fde.db"));
const now = new Date().toISOString();

const FDE_RE = /\b(fde|forward[- ]?deploy(ed|ment)?)\b|(前置|前沿|前线|前进)部署/i;
const ENGINEERING_RE =
  /工程师|开发者|开发|写代码|代码|交付|实施|架构|算法|大模型|Agent|智能体|程序员|技术|CTO|全栈|后端|前端|odoo|二开|GPT|Claude|Cursor|Coze|Dify|n8n|RPA|数据科学|data science|产品经理/i;
const MARKETING_RE = /落地班|训练营|培训班|商学院|课程|招生|获客|引流|加盟|招商|变现|副业|私董|陪跑|起号|孵化/i;

const lines = readFileSync(path.join(ROOT, "pipeline", "douyin-discovered.jsonl"), "utf8")
  .trim()
  .split("\n");

let kept = 0, kicked = 0;
for (const line of lines) {
  let p;
  try {
    p = JSON.parse(line);
  } catch {
    continue;
  }
  const sec = p.url.split("/user/")[1];
  if (!sec) continue;
  const login = `douyin:${sec}`;
  if (db.prepare("SELECT 1 FROM persons WHERE login=?").get(login)) continue; // 已在库

  const blob = `${p.nickname ?? ""} ${p.signature ?? ""}`;
  const isFde = FDE_RE.test(blob);
  const hasEng = ENGINEERING_RE.test(blob);
  if (!isFde && !hasEng) { kicked++; continue; }
  if (MARKETING_RE.test(blob) && !hasEng) { kicked++; continue; }

  const followerScore =
    p.follower_count >= 10000 ? 15 : p.follower_count >= 1000 ? 10 : p.follower_count >= 100 ? 6 : 2;
  const score = (isFde ? 15 : 10) + followerScore + (p.location && p.location !== "中国" ? 2 : 0);
  const tier = score >= 35 ? "S" : score >= 22 ? "A" : score >= 10 ? "B" : "";

  const info = db.prepare(
    `INSERT INTO persons (login, name, bio, location, html_url, followers, active_2026,
       fde_evidence, china_signal, top_repos_json, score, tier, status, reject_reason,
       sources_json, created_at, updated_at, layer, platform)
     VALUES (?, ?, ?, ?, ?, ?, 1, ?, 'douyin', '[]', ?, ?, 'candidate', NULL, ?, ?, ?, 'core', 'douyin')
     ON CONFLICT(login) DO NOTHING`
  ).run(
    login,
    p.nickname ?? null,
    p.signature ?? null,
    p.location ?? "中国",
    p.url,
    p.follower_count ?? 0,
    isFde ? "抖音简介自述 FDE 相关" : "关联发现（视频作者，工程实战信号）",
    isFde ? score : score,
    tier,
    JSON.stringify([
      { type: "douyin", url: p.url, collected_at: now },
      { type: "douyin-discovery", note: p.videoTitle ?? "", collected_at: now },
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
    ).run(row.id, p.douyinId ?? null);
  }
}
console.log(`入库 ${kept}，拒收 ${kicked}`);
