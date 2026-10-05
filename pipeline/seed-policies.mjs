#!/usr/bin/env node
/** 政策库建表 + 首批种子（来自公开报道，已核事实）。跑法：node pipeline/seed-policies.mjs */
import { DatabaseSync } from "node:sqlite";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const db = new DatabaseSync(path.join(ROOT, "data", "fde.db"));
db.exec(`
CREATE TABLE IF NOT EXISTS policies (
  id INTEGER PRIMARY KEY,
  title TEXT, region TEXT, level TEXT, date TEXT,
  summary TEXT, url TEXT, source TEXT,
  status TEXT DEFAULT 'candidate', collected_at TEXT
);
`);
const slug = (t) => createHash("md5").update(t).digest("hex").slice(0, 12);
const now = new Date().toISOString();

// level: 国家部委 / 城市政策 / 区县政策 / 行业标准 / 企业标准
const POLICIES = [
  ["工信部专项文件首次将前沿部署工程师（FDE）岗位纳入官方政策体系", "全国", "国家部委", "2026-08",
   "工信部专项文件鼓励企业搭建 FDE 专业团队、扎根产业一线保障 AI 场景落地——FDE 岗位首次进入国家政策体系（武汉光谷发布会披露）",
   "", "光谷发布会多源报道"],
  ["武汉东湖高新区（光谷）：启动湖北省首个「FDE+智能体」培训工程", "武汉", "区县政策", "2026-08-28",
   "目标三年培育超千名 FDE 资深工程师、落地千个智能体创新场景、赋能万家企业 AI 转型；「1+N+X」人才梯队、初中高三级培养，企业真实项目交付作为考核；开源聚变人工智能研究院牵头，北大武汉AI研究院、阿里云、腾讯等参与",
   "", "凤凰网/腾讯新闻/新浪财经"],
  ["上海：将 FDE 写进先进制造业行动方案", "上海", "城市政策", "2026",
   "公开报道：上海将 FDE（前沿部署工程师）纳入先进制造业相关行动方案，岗位培养上升为城市产业政策",
   "", "行业文章多源提及（什么值得买收录）"],
  ["武汉光谷：「AI 光子计划」人才政策", "武汉", "区县政策", "2026",
   "面向大模型与 AI 基础设施、AI 智能体、计算机视觉、人形机器人、光电 AI 融合等领域的人才政策，2026 光谷 AI 人才大会发布，《中国组织人事报》刊载",
   "", "中国组织人事报"],
  ["腾讯云：推出行业首个《腾讯云 ADP 前置部署工程师（FDE）》认证体系", "全国", "企业标准", "2026-09-10",
   "腾讯云厦门峰会推出行业首个 FDE 工程师认证体系，并同步启动 FDE 合作伙伴招募——头部云厂商把 FDE 做成能力标准",
   "", "DoNews 2026-09-10"],
  ["工信部人才交流中心：FDE 评价证书", "全国", "行业标准", "2026-09",
   "FDE 岗位评价证书由工信部人才交流中心颁发，报名经授权招生机构，2688 元/次，线上考核每年 6 次",
   "", "搜狐 2026-09-26"],
  ["三维天地 × 大连理工：FDE 工程师认证/课程", "全国", "行业标准", "2026",
   "三维天地联合大连理工大学推出 FDE 工程师相关认证与课程（来源：凤凰网财经）",
   "", "凤凰网财经"],
];

let n = 0;
for (const [title, region, level, date, summary, url, source] of POLICIES) {
  const info = db
    .prepare(
      `INSERT INTO policies (title, region, level, date, summary, url, source, status, collected_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'candidate', ?)
       ON CONFLICT DO NOTHING`
    )
    .run(title, region, level, date, summary, url || null, source, now);
  n += info.changes;
}
console.log(`政策库建表完成，首批入库 ${n} 条`);
