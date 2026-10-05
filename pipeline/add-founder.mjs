#!/usr/bin/env node
/** 1 号人物：施可（创始人本人，官网自述，approved）+ 水滴跃动公司实锤。跑法：node pipeline/add-founder.mjs */
import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const db = new DatabaseSync(path.join(ROOT, "data", "fde.db"));
const now = new Date().toISOString();

db.prepare(
  `INSERT INTO persons (login, name, bio, company, location, html_url, avatar_url, blog,
     followers, public_repos, stars_total, active_2026, fde_evidence, china_signal,
     top_repos_json, score, tier, status, reject_reason, sources_json, created_at, updated_at,
     layer, platform, avatar_file)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'approved', NULL, ?, ?, ?, 'core', 'github', ?)
   ON CONFLICT(login) DO UPDATE SET
     bio=excluded.bio, company=excluded.company, location=excluded.location,
     status='approved', tier=excluded.tier, score=excluded.score,
     fde_evidence=excluded.fde_evidence, sources_json=excluded.sources_json,
     avatar_file=COALESCE(excluded.avatar_file, persons.avatar_file),
     updated_at=excluded.updated_at`
).run(
  "shike",
  "施可 SHI KE",
  "水滴跃动 Dropleap 创始人 · 连续创业者 · 企业级 AI 实践者。16 年技术/产品/商业经历（NCS、同程艺龙、哈啰出行、邻汇吧 COO）。2026 年创立水滴跃动，专注制造业 AI 落地驻场交付：帮工厂 2-4 周跑通第一个 AI 场景。著有《FDE：AI 的胜负不在于模型》《AI Coding：人人都是程序员》《WorkBuddy 三部曲》。",
  "水滴跃动 Dropleap",
  "江苏苏州",
  "https://github.com/shike",
  "https://avatars.githubusercontent.com/u/106862?v=4",
  "https://shike.github.io",
  0, 0, 0, 1,
  "个人官网自述企业级 AI 实践者与驻场交付业务，著有《FDE：AI 的胜负不在于模型》",
  "location,company,bio-CJK",
  JSON.stringify([{ name: "shike.github.io", url: "https://shike.github.io", stars: 0, desc: "个人官网" }]),
  48,
  "S",
  JSON.stringify([
    { type: "official-site", url: "https://shike.github.io", collected_at: now },
    { type: "github", url: "https://github.com/shike", collected_at: now },
  ]),
  now,
  now,
  "/avatars/github-shike.jpg"
);

db.prepare(
  `INSERT INTO companies (name, slug, website, fde_team_known, jd_count, notes, created_at)
   VALUES ('水滴跃动 Dropleap', 'dropleap', 'https://dropleap.cn', 1, 0, ?, ?)
   ON CONFLICT(slug) DO UPDATE SET fde_team_known=1, notes=excluded.notes`
).run(
  "创始人施可，官网公开「制造业 AI 落地驻场交付」业务：2-4 周跑通首个 AI 场景，WorkBuddy 官方代理（来源：dropleap.cn，2026）",
  now
);
console.log("施可 approved + 水滴跃动 verified");
