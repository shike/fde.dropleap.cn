#!/usr/bin/env node
/** 城市问询第二轮收获：3 位播客具名人物 + 2 条政策案例（offline 待寻链）。跑法：node pipeline/add-round2.mjs */
import { DatabaseSync } from "node:sqlite";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const db = new DatabaseSync(path.join(ROOT, "data", "fde.db"));
const now = new Date().toISOString();
const slug = (t) => createHash("md5").update(t).digest("hex").slice(0, 12);

const addPerson = (p) => {
  const info = db
    .prepare(
      `INSERT INTO persons (login, name, bio, company, location, html_url, avatar_url, blog,
        followers, public_repos, stars_total, active_2026, fde_evidence, china_signal,
        top_repos_json, score, tier, status, reject_reason, sources_json, created_at, updated_at,
        layer, platform)
       VALUES (?, ?, ?, ?, ?, NULL, NULL, NULL, 0, 0, 0, 1, ?, 'web-source', '[]', ?, ?, 'candidate', NULL, ?, ?, ?, ?, 'web')
       ON CONFLICT(login) DO NOTHING`
    )
    .run(
      p.login, p.name, p.bio, p.company ?? null, p.location ?? "中国", p.evidence,
      p.score ?? 20, p.tier ?? "", JSON.stringify(p.sources), now, now, p.layer ?? "core"
    );
  console.log((info.changes > 0 ? "OK " : "重复 ") + p.name);
};

addPerson({
  login: "web:pengxinyu",
  name: "朋新宇",
  company: "阿里瓴羊",
  bio: "阿里瓴羊负责人，硅谷101 播客 E248 对谈嘉宾：讲透「中国式 FDE」——一个催发货 AI 要跑通 260 步的交付实践。",
  evidence: "硅谷101 播客 E248《一个催发货 AI 要跑通 260 步，和阿里瓴羊朋新宇聊聊中国式 FDE》（2026-08）",
  sources: [{ type: "podcast", url: "https://castbox.fm", note: "硅谷101 E248 对谈", collected_at: now }],
  score: 25,
  tier: "A",
});

addPerson({
  login: "web:shenyue",
  name: "申悦",
  bio: "前互联网大厂产品经理、AI 培训讲师与企业咨询顾问，「What's Next 科技早知道」播客 FDE 专题嘉宾（《FDE 为什么突然火了？》）。",
  evidence: "科技早知道播客 FDE 专题嘉宾（2026）",
  sources: [{ type: "podcast", url: "https://feeds.fireside.fm", note: "What's Next 科技早知道 FDE 专题", collected_at: now }],
  score: 20,
  tier: "B",
});

addPerson({
  login: "web:lianggongjun",
  name: "梁公军",
  company: "海纳 AI",
  bio: "海纳 AI 创始人（十字路口播客专访嘉宾）：用 AI 面试产品服务顺丰、沃尔玛、瑞幸等企业，2024 年面试量约 850 万人次——AI 企业级交付一线实践者。",
  evidence: "「十字路口」播客专访（2026）：海纳 AI 的企业级 AI 交付实践",
  sources: [{ type: "podcast", url: "https://podtail.com", note: "十字路口 Crossing 专访", collected_at: now }],
  score: 25,
  tier: "A",
  layer: "practitioner",
});

const addCase = (title, summary, date) => {
  db.prepare(
    `INSERT INTO cases (title, slug, type, url, summary, published_at, source_url, status, collected_at)
     VALUES (?, ?, 'media', 'https://news.ifeng.com', ?, ?, ?, 'offline', ?)
     ON CONFLICT(slug) DO NOTHING`
  ).run(title, slug(title), summary, date, now);
};

addCase(
  "光谷启动首个 FDE+智能体培训工程（凤凰网）",
  "武汉东湖高新区 2026-08-28 发布湖北省首个体系化 FDE+智能体培训工程：1+N+X 人才梯队、初中高三级培养、企业真实项目交付作为考核",
  "2026-08-28"
);
addCase(
  "工信部专项文件首次将前沿部署工程师（FDE）岗位纳入官方政策体系",
  "工信部文件鼓励企业搭建 FDE 专业团队、扎根产业一线保障 AI 场景落地（光谷发布会披露）",
  "2026-08"
);
console.log("OK 人物 3 + 政策案例 2（待寻链）");
