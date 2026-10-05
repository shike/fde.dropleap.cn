#!/usr/bin/env node
/**
 * 抖音严选裁决：用浏览器抓到的真实简介重判 42 个种子。
 * 规则（创始人 2026-10-04 反馈：东轩这类培训/多topics博主不行）：
 *   - 有工程实战信号（工程师/开发/代码/交付/算法/架构/大模型/Agent…）→ 留 candidate
 *   - 营销培训信号（落地班/商学院/获客/招生/课程/加盟/变现…）且无任何工程信号 → rejected
 *   - FDE 自述 + 营销词并存（如"FDE落地班"招生号）→ 仍判 rejected（卖课 ≠ 一线 FDE）
 * 同时回填：bio=真实简介、location=IP属地、followers=最新值。
 * 跑法：node pipeline/reclassify-douyin.mjs
 */
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const db = new DatabaseSync(path.join(ROOT, "data", "fde.db"));

const ENGINEERING_RE =
  /工程师|开发者|开发|写代码|代码|交付|实施|架构|算法|大模型|Agent|智能体|程序员|技术总监|CTO|全栈|后端|前端|odoo|二开|GPT|Claude|Cursor|Coze|Dify|n8n|RPA/;
const FDE_RE = /\b(fde|forward[- ]?deploy(ed|ment)?)\b|(前置|前沿|前线|前进)部署/i;
const MARKETING_RE =
  /落地班|训练营|培训班|商学院|课程|招生|获客|引流|加盟|招商|变现|副业|私董|老板|圈层| Emmanuel|起号|孵化|陪跑|企业咨询|咨询顾问| marketing/i;

const lines = readFileSync(path.join(ROOT, "pipeline", "douyin-profiles-latest.jsonl"), "utf8")
  .trim()
  .split("\n");

let kept = 0, kicked = 0, unclear = 0;
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
  const row = db.prepare("SELECT id, name FROM persons WHERE login=?").get(login);
  if (!row) continue;

  const blob = `${p.nickname ?? ""} ${p.signature ?? ""}`;
  const isFde = FDE_RE.test(blob);
  const hasEngineering = ENGINEERING_RE.test(blob);
  const marketingHit = blob.match(MARKETING_RE)?.[0] ?? null;
  // 培训/招生词直接压过 FDE 字样（"FDE落地班"是卖课不是 FDE）
  const reject = MARKETING_RE.test(blob) && !hasEngineering;
  const status = reject ? "rejected" : "candidate";
  const reason = reject
    ? `营销/培训向账号${marketingHit ? `（命中「${marketingHit}」）` : ""}，非一线 FDE（严口径）`
    : null;

  db.prepare(
    `UPDATE persons SET bio=?, location=?, followers=?, status=?, reject_reason=?,
       china_signal=?, updated_at=datetime('now') WHERE id=?`
  ).run(
    p.signature || row.name + "（简介未采集到，待补）",
    p.location || "中国",
    p.followers ?? 0,
    status,
    reason,
    "douyin:" + (p.location || "中国"),
    row.id
  );
  if (reject) kicked++;
  else if (isFde || hasEngineering) kept++;
  else unclear++;
}
console.log(`严选完成：留 ${kept}，踢 ${kicked}，信号不明待审 ${unclear}`);
