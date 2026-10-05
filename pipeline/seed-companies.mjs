#!/usr/bin/env node
/** 公司库种子：中国大陆主要 AI/大模型相关公司占位条目（fde_team_known=0 表示待考证，不做任何未证实的宣称） */
import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const db = new DatabaseSync(path.join(ROOT, "data", "fde.db"));

// 允许独立于 collect.mjs 先跑（表结构须与 collect.mjs 保持一致）
db.exec(`
CREATE TABLE IF NOT EXISTS companies (
  id INTEGER PRIMARY KEY, name TEXT, slug TEXT UNIQUE, website TEXT,
  fde_team_known INTEGER DEFAULT 0, jd_count INTEGER DEFAULT 0,
  notes TEXT, created_at TEXT
);
`);

const COMPANIES = [
  ["字节跳动", "bytedance", "bytedance.com", "豆包/Seed 等AI业务"],
  ["阿里巴巴", "alibaba", "alibaba.com", "通义千问/阿里云"],
  ["腾讯", "tencent", "tencent.com", "混元/腾讯云"],
  ["百度", "baidu", "baidu.com", "文心/百度智能云"],
  ["华为", "huawei", "huawei.com", "盘古/昇腾"],
  ["深度求索 DeepSeek", "deepseek", "deepseek.com", ""],
  ["智谱", "zhipu", "zhipuai.cn", "GLM 系列"],
  ["月之暗面", "moonshot", "moonshot.cn", "Kimi"],
  ["MiniMax", "minimax", "minimaxi.com", ""],
  ["阶跃星辰", "stepfun", "stepfun.com", ""],
  ["面壁智能", "modelbest", "modelbest.cn", ""],
  ["生数科技", "shengshu", "shengshu.ai", "Vidu"],
  ["百川智能", "baichuan", "baichuan-ai.com", ""],
  ["零一万物", "lingyiwanwu", "lingyiwanwu.com", ""],
  ["科大讯飞", "iflytek", "iflytek.com", "星火"],
  ["商汤科技", "sensetime", "sensetime.com", ""],
  ["美团", "meituan", "meituan.com", "LongCat"],
  ["京东", "jd", "jd.com", "言犀"],
  ["蚂蚁集团", "antgroup", "antgroup.com", ""],
  ["群核科技", "manycore", "manycore.cn", "酷家乐/空间智能"],
  ["快手", "kuaishou", "kuaishou.com", "可灵"],
  ["无问芯穹", "infinigence", "infinigence.ai", ""],
  ["硅基流动", "siliconflow", "siliconflow.cn", ""],
  ["潞晨科技", "luchen", "luchentech.com", ""],
];

const now = new Date().toISOString();
for (const [name, slug, domain, notes] of COMPANIES) {
  db.prepare(
    `INSERT INTO companies (name, slug, website, fde_team_known, jd_count, notes, created_at)
     VALUES (?,?,?,0,0,?,?)
     ON CONFLICT(slug) DO UPDATE SET name=excluded.name, website=excluded.website, notes=excluded.notes`
  ).run(name, slug, `https://www.${domain}`, notes, now);
}
console.log(`seeded ${COMPANIES.length} companies`);
