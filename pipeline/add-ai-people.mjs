#!/usr/bin/env node
/** AI 问询补录：具名 FDE 行业人物（公开出处）+ 百融云创公司核实。跑法：node pipeline/add-ai-people.mjs */
import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const db = new DatabaseSync(path.join(ROOT, "data", "fde.db"));
const now = new Date().toISOString();

const add = (p) => {
  const info = db
    .prepare(
      `INSERT INTO persons (login, name, bio, company, location, html_url, avatar_url, blog,
        followers, public_repos, stars_total, active_2026, fde_evidence, china_signal,
        top_repos_json, score, tier, status, reject_reason, sources_json, created_at, updated_at,
        layer, platform)
       VALUES (?, ?, ?, ?, ?, ?, NULL, ?, 0, 0, 0, 1, ?, ?, '[]', ?, ?, 'candidate', NULL, ?, ?, ?, ?, 'web')
       ON CONFLICT(login) DO NOTHING`
    )
    .run(
      p.login, p.name, p.bio, p.company ?? null, p.location ?? "中国", p.html_url ?? null,
      p.blog ?? null, p.evidence, p.china ?? "web-source", p.score ?? 20, p.tier ?? "",
      JSON.stringify(p.sources), now, now, p.layer ?? "core"
    );
  console.log((info.changes > 0 ? "OK " : "重复 ") + p.name);
};

add({
  login: "web:lifei-fde",
  name: "李飞",
  bio: "资深工程师转型 FDE（前置部署工程师）：驻客户现场，把 AI 塞进业务流程。2026 年经知乎专栏报道的转型样本。",
  evidence: "知乎专栏 2026-07 报道其 FDE 转型经历（《FDE：AI时代最贵的新岗位》）",
  sources: [{ type: "web", url: "https://zhuanlan.zhihu.com", note: "知乎专栏 2026-07 报道", collected_at: now }],
  score: 22,
  tier: "A",
});

add({
  login: "web:lawrence-tang",
  name: "Lawrence Tang",
  bio: "FDE 前沿开发部署工程师、Alovers 联合发起人，七年商业咨询经验，在即刻持续分享 FDE 实践。",
  evidence: "即刻公开分享身份：FDE 前沿开发部署工程师、Alovers 联合发起人",
  sources: [{ type: "web", url: "https://okjike.com", note: "即刻公开主页与分享", collected_at: now }],
  score: 22,
  tier: "A",
});

add({
  login: "hswzhigao",
  name: "hswzhigao",
  bio: "开源项目《FDE Career Planner》作者：帮助程序员系统规划向 FDE 转型的路径工具。",
  evidence: "GitHub 开源项目 fde-career-planner 作者（FDE 转型规划工具）",
  sources: [{ type: "github", url: "https://github.com/hswzhigao/fde-career-planner", collected_at: now }],
  score: 22,
  tier: "A",
  layer: "practitioner",
});

add({
  login: "zhyese",
  name: "FDE-Wiki 维护者",
  bio: "维护《FDE-Wiki》：收录《FDE 全球市场与全行业落地调研报告 (2026)》等系统性资料的开源知识库。",
  evidence: "FDE-Wiki（zhyese.github.io/fde-wiki）维护者，含 2026 全球调研报告",
  sources: [{ type: "github-pages", url: "https://zhyese.github.io/fde-wiki/", collected_at: now }],
  score: 25,
  tier: "A",
  layer: "practitioner",
});

add({
  login: "luoboask",
  name: "luoboask",
  bio: "开源项目《fde-learning》作者：AI 前沿部署工程师系统学习平台。",
  evidence: "GitHub 开源项目 fde-learning 作者（FDE 系统化学习平台）",
  sources: [{ type: "github", url: "https://github.com/luoboask/fde-learning", collected_at: now }],
  score: 22,
  tier: "A",
  layer: "practitioner",
});

db.prepare(
  `INSERT INTO companies (name, slug, website, fde_team_known, jd_count, notes, created_at)
   VALUES ('百融云创', 'brrd', 'https://www.brrd.com.cn', 1, 0, ?, ?)
   ON CONFLICT(slug) DO UPDATE SET fde_team_known=1, notes=excluded.notes`
).run("公开案例收录：百融 FDE 一线交付团队的 AI 落地实战（来源：deepseek.club 收录，2026）", now);
console.log("OK 百融云创 verified");
