#!/usr/bin/env node
/**
 * 公司库核实 + 案例库填充（公开报道驱动，2026-10-04 第一批）
 * 证据标准：公开媒体报道/公司公开资料明确提到该公司设 FDE/前置部署岗位或团队 → fde_team_known=1
 */
import { DatabaseSync } from "node:sqlite";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const db = new DatabaseSync(path.join(ROOT, "data", "fde.db"));

const slug = (t) => createHash("md5").update(t).digest("hex").slice(0, 12);
const now = new Date().toISOString();

// 公司核实（slug 对应 companies 表；source=公开报道）
const COMPANY_EVIDENCE = [
  ["bytedance", "36kr 报道：字节跳动豆包、飞书团队已开 FDE（前置部署工程师）岗位，月薪 35-70K·15 个月", "https://m.36kr.com", "2026"],
];

for (const [companySlug, note, url, date] of COMPANY_EVIDENCE) {
  db.prepare(
    `UPDATE companies SET fde_team_known=1, notes=?, jd_count=jd_count+1 WHERE slug=?`
  ).run(`${note}（来源：${url}，${date}）`, companySlug);
}

// 案例库新增
const CASES = [
  ["media", "硅谷最抢手的新岗位出现了（36kr）", "https://m.36kr.com", "FDE 岗位科普与中美对比；提到字节跳动豆包/飞书开 FDE 岗位，月薪 35-70K·15 个月", "2026"],
  ["article", "FDE：AI时代最贵的新岗位，是把工程师派进客户的“车间”（知乎专栏）", "https://zhuanlan.zhihu.com", "以李飞的转型故事讲 FDE 的日常：驻场、把 AI 塞进业务流程", "2026-07-13"],
  ["media", "FDE 岗位发布量 2025 年 1-9 月涨 800%、同比增长 1522.73%（腾讯云开发者社区/网易/凤凰科技）", "https://developer.cloud.tencent.com", "国内 FDE 招聘需求数据：增长最快的 AI 技术岗位，超过 AI 产品经理（+120.54%）", "2026"],
];

let n = 0;
for (const [type, title, url, summary, publishedAt] of CASES) {
  const info = db
    .prepare(
      `INSERT INTO cases (title, slug, type, url, summary, published_at, source_url, status, collected_at)
       VALUES (?,?,?,?,?,?,?, 'candidate', ?) ON CONFLICT(slug) DO NOTHING`
    )
    .run(title, slug(title), type, url, summary, publishedAt, url, now);
  n += info.changes;
}
console.log(`公司核实 ${COMPANY_EVIDENCE.length} 家，案例新增 ${n} 条`);
