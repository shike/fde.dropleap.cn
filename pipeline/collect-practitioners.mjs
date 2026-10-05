#!/usr/bin/env node
/**
 * AI 从业者层采集：中国 AI 从业者（非严口径 FDE，相邻人群，layer='practitioner'）
 * 关键词 × 地区限定检索（location 限定免分区，命中即中国信号）→ GraphQL 批量档案 → 入库。
 * 跑法：node pipeline/collect-practitioners.mjs
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import { fileURLToPath } from "node:url";

const run = promisify(execFile);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const db = new DatabaseSync(path.join(ROOT, "data", "fde.db"));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const now = () => new Date().toISOString();

const KEYWORDS = [
  '"AI engineer"',
  '"LLM engineer"',
  '"GenAI"',
  '"AIGC"',
  '"AI Agent"',
  '"machine learning"',
  '"applied AI"',
  '"AI solution"',
  "AI工程师",
  "人工智能",
  "大模型",
  "算法工程师",
  "AI落地",
  "智能体",
  "AI产品经理",
  "数字化",
  "AI应用",
  "全栈工程师",
  "技术顾问",
  "解决方案",
];
const LOCATIONS = [
  "china",
  "beijing",
  "shanghai",
  "shenzhen",
  "hangzhou",
  "guangzhou",
  "chengdu",
  "nanjing",
  "wuhan",
  "xian",
  "suzhou",
  "hefei",
  "changsha",
  "chongqing",
  "北京",
  "上海",
  "深圳",
  "杭州",
  "广州",
  "成都",
];

const encSearchQ = (q) => encodeURIComponent(q).replace(/%3A/g, ":");

async function ghApi(endpoint, { retries = 3 } = {}) {
  for (let i = 0; i <= retries; i++) {
    try {
      const { stdout } = await run("gh", ["api", endpoint], { maxBuffer: 32 * 1024 * 1024, timeout: 30_000 });
      return JSON.parse(stdout);
    } catch (e) {
      const msg = String(e.stderr || e.message || "");
      if (/rate limit/i.test(msg) && i < retries) {
        await sleep(65_000);
        continue;
      }
      if (i < retries) {
        await sleep(2000 * (i + 1));
        continue;
      }
      throw new Error(`gh api failed: ${msg.slice(0, 200)}`);
    }
  }
}

async function searchTotal(q) {
  const res = await ghApi(`/search/users?q=${encSearchQ(q)}&per_page=1&page=1`);
  return res?.total_count ?? 0;
}

async function searchAllPages(q, expectTotal) {
  const items = [];
  const pages = Math.min(10, Math.max(1, Math.ceil(expectTotal / 100)));
  for (let page = 1; page <= pages; page++) {
    const res = await ghApi(`/search/users?q=${encSearchQ(q)}&per_page=100&page=${page}`);
    items.push(...(res.items ?? []));
    if ((res.items ?? []).length < 100) break;
    await sleep(2300);
  }
  return items;
}

const USER_FIELDS = `login name bio company location twitterUsername websiteUrl url avatarUrl
  followers { totalCount }
  repositories { totalCount }
  lastPush: repositories(first: 1, orderBy: {field: PUSHED_AT, direction: DESC}) { nodes { pushedAt } }
  topRepos: repositories(first: 30, orderBy: {field: STARGAZERS, direction: DESC}) {
    nodes { name url stargazerCount description }
  }`;

async function ghGraphql(query) {
  for (let i = 0; i < 3; i++) {
    try {
      const { stdout } = await run("gh", ["api", "graphql", "-f", `query=${query}`], { maxBuffer: 64 * 1024 * 1024 });
      return JSON.parse(stdout);
    } catch (e) {
      if (e.stdout) {
        try {
          const partial = JSON.parse(e.stdout);
          if (partial?.data && Object.keys(partial.data).length > 0) return partial;
        } catch {}
      }
      await sleep(12_000 * (i + 1));
    }
  }
  return { data: {} };
}

const insertStmt = db.prepare(
  `INSERT INTO persons (login, name, bio, company, location, html_url, avatar_url, blog,
     followers, public_repos, stars_total, active_2026, fde_evidence, china_signal,
     top_repos_json, score, tier, status, reject_reason, sources_json, created_at, updated_at,
     layer, platform)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, 'location', ?, ?, '', 'candidate', NULL, ?, ?, ?, 'practitioner', 'github')
   ON CONFLICT(login) DO NOTHING`
);
const contactStmt = db.prepare(
  `INSERT INTO person_contacts (person_id, email, blog, twitter) VALUES (?, NULL, ?, ?)
   ON CONFLICT(person_id) DO UPDATE SET blog=COALESCE(excluded.blog, person_contacts.blog),
   twitter=COALESCE(excluded.twitter, person_contacts.twitter)`
);

async function main() {
  console.log(`== 从业者层采集：${KEYWORDS.length} 关键词 × ${LOCATIONS.length} 地区 ==`);
  const logins = new Set();
  let queries = 0;
  for (const kw of KEYWORDS) {
    for (const loc of LOCATIONS) {
      const q = `${kw} in:bio location:${loc}`;
      const t = await searchTotal(q);
      queries++;
      if (t === 0) continue;
      const items = await searchAllPages(q, t);
      for (const it of items) logins.add(it.login);
      console.log(`  ${t}\t${q}`);
      await sleep(2300);
    }
  }
  console.log(`== 检索完成：${queries} 组查询，命中唯一账号 ${logins.size} ==`);

  // 跳过库里已有的
  const fresh = [...logins].filter((l) => !db.prepare("SELECT 1 FROM persons WHERE login=?").get(l));
  console.log(`新账号：${fresh.length}`);
  const BATCH = 35;
  let kept = 0;
  for (let i = 0; i < fresh.length; i += BATCH) {
    const batch = fresh.slice(i, i + BATCH);
    const query = `query { ${batch
      .map((l, j) => `u${j}: user(login: ${JSON.stringify(l)}) { ${USER_FIELDS} }`)
      .join(" ")} }`;
    const data = (await ghGraphql(query))?.data ?? {};
    await sleep(1300);
    for (let j = 0; j < batch.length; j++) {
      const u = data[`u${j}`];
      if (!u) continue; // 组织/注销
      const topRepos = (u.topRepos?.nodes ?? []).map((r) => ({
        name: r.name, url: r.url, stars: r.stargazerCount, desc: r.description,
      }));
      const followers = u.followers?.totalCount ?? 0;
      const active2026 = (u.lastPush?.nodes?.[0]?.pushedAt ?? "") >= "2026" ? 1 : 0;
      const score =
        (followers < 10 ? 2 : followers < 50 ? 5 : followers < 200 ? 8 : followers < 1000 ? 12 : 15) +
        (active2026 ? 5 : 0);
      const info = insertStmt.run(
        u.login, u.name, u.bio, u.company, u.location, u.url, u.avatarUrl, u.websiteUrl ?? null,
        followers, u.repositories?.totalCount ?? 0,
        topRepos.reduce((a, r) => a + (r.stars ?? 0), 0),
        active2026,
        JSON.stringify(topRepos.slice(0, 5)),
        score,
        JSON.stringify([{ type: "github", url: u.url, collected_at: now() }]),
        now(), now()
      );
      if (info.changes > 0) {
        kept++;
        const row = db.prepare("SELECT id FROM persons WHERE login=?").get(u.login);
        contactStmt.run(row.id, u.websiteUrl ?? null, u.twitterUsername ?? null);
      }
    }
    if ((i / BATCH) % 10 === 0) console.log(`  ...${Math.min(i + BATCH, fresh.length)}/${fresh.length}`);
  }
  console.log(`== done == 入库 ${kept} 位从业者`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
