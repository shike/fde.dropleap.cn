#!/usr/bin/env node
/**
 * 从业者层扩量 R2：突破"必须填城市定位"的漏斗口。
 * 三路并采（全部入 layer='practitioner'）：
 *   A. 关键词 × 城市定位（补充 40 组新关键词）
 *   B. 中文关键词全局检索（不设 location，bio 含中文即可判中国）——单关键词 1000 上限内
 *   C. 中文 AI 仓库作者挖掘（repo search 拿 owner，作者即从业者）
 * 跑法：node pipeline/collect-practitioners-r2.mjs
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
const CJK_RE = /[\u4e00-\u9fff]/;

const LOCATIONS = [
  "china", "beijing", "shanghai", "shenzhen", "hangzhou", "guangzhou", "chengdu",
  "nanjing", "wuhan", "xian", "suzhou", "hefei", "changsha", "chongqing",
  "北京", "上海", "深圳", "杭州", "广州", "成都",
];
// A. 新关键词（与 R1 不重叠）
const KW_LOCATION = [
  '"NLP engineer"', '"computer vision"', '"reinforcement learning"', '"multimodal"',
  '"RAG"', '"LangChain"', '"vLLM"', '"Stable Diffusion"', '"ComfyUI"', '"prompt engineer"',
  '"机器学习"', '"深度学习"', '"计算机视觉"', '"NLP"', '"AIGC工程师"',
  '"AI创业"', '"独立开发"', '"数字人"', '"语音识别"', '"AI训练师"',
];
// B. 中文关键词全局（无 location）
const KW_GLOBAL_CN = [
  "大模型", "人工智能", "AI工程师", "算法工程师", "机器学习",
  "深度学习", "AIGC", "智能体", "AI落地", "计算机视觉",
];
// C. 中文 AI 仓库主题
const REPO_QUERIES = [
  "大模型 in:name,description,readme stars:>10",
  "AI Agent 中文 stars:>10",
  "AIGC in:name,description stars:>10",
  "知识库 RAG 中文 stars:>10",
  "AI 落地 stars:>5",
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
        console.log("  [rate] 等待重置窗口…");
        await sleep(120_000);
        continue;
      }
      if (/abuse|secondary/i.test(msg) && i < retries) {
        await sleep(30_000);
        continue;
      }
      if (i < retries) {
        await sleep(3000 * (i + 1));
        continue;
      }
      return null;
    }
  }
}

const insertStmt = db.prepare(
  `INSERT INTO persons (login, name, bio, company, location, html_url, avatar_url, blog,
     followers, public_repos, stars_total, active_2026, fde_evidence, china_signal,
     top_repos_json, score, tier, status, reject_reason, sources_json, created_at, updated_at,
     layer, platform)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, '', 'candidate', NULL, ?, ?, ?, 'practitioner', 'github')
   ON CONFLICT(login) DO NOTHING`
);
const contactStmt = db.prepare(
  `INSERT INTO person_contacts (person_id, blog, twitter) VALUES (?, ?, ?)
   ON CONFLICT(person_id) DO UPDATE SET blog=COALESCE(excluded.blog, person_contacts.blog),
   twitter=COALESCE(excluded.twitter, person_contacts.twitter)`
);

const USER_FIELDS = `login name bio company location twitterUsername websiteUrl url avatarUrl
  followers { totalCount } repositories { totalCount }
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
      await sleep(15_000 * (i + 1));
    }
  }
  return { data: {} };
}

async function processBatch(logins, chinaWhy) {
  let kept = 0;
  for (let i = 0; i < logins.length; i += 35) {
    const batch = logins.slice(i, i + 35);
    const query = `query { ${batch
      .map((l, j) => `u${j}: user(login: ${JSON.stringify(l)}) { ${USER_FIELDS} }`)
      .join(" ")} }`;
    const data = (await ghGraphql(query))?.data ?? {};
    await sleep(1300);
    for (let j = 0; j < batch.length; j++) {
      const u = data[`u${j}`];
      if (!u) continue;
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
        topRepos.reduce((a, r) => a + (r.stars ?? 0), 0), active2026,
        chinaWhy, JSON.stringify(topRepos.slice(0, 5)), score,
        JSON.stringify([{ type: "github", url: u.url, collected_at: now() }]),
        now(), now()
      );
      if (info.changes > 0) {
        kept++;
        const row = db.prepare("SELECT id FROM persons WHERE login=?").get(u.login);
        contactStmt.run(row.id, u.websiteUrl ?? null, u.twitterUsername ?? null);
      }
    }
    if ((i / 35) % 10 === 0) console.log(`  入库进度 ${Math.min(i + 35, logins.length)}/${logins.length}`);
  }
  return kept;
}

async function main() {
  // A. 新关键词 × 城市
  console.log("== A. 新关键词 × 城市 ==");
  const setA = new Set();
  for (const kw of KW_LOCATION) {
    for (const loc of LOCATIONS) {
      const q = `${kw} in:bio location:${loc}`;
      const res = await ghApi(`/search/users?q=${encSearchQ(q)}&per_page=100&page=1`);
      const items = res?.items ?? [];
      for (const it of items) setA.add(it.login);
      if ((res?.total_count ?? 0) > 0) console.log(`  ${res.total_count}\t${q}`);
      await sleep(2200);
    }
  }
  const freshA = [...setA].filter((l) => !db.prepare("SELECT 1 FROM persons WHERE login=?").get(l));
  console.log(`A 路新增：${freshA.length}`);
  console.log(`A 入库：${await processBatch(freshA, "location")}`);

  // B. 中文关键词全局（bio 中文过滤）
  console.log("== B. 中文关键词全局（无 location） ==");
  const setB = new Set();
  for (const kw of KW_GLOBAL_CN) {
    const q = `${kw} in:bio`;
    const res = await ghApi(`/search/users?q=${encSearchQ(q)}&per_page=100&page=1`);
    const items = res?.items ?? [];
    for (const it of items) setA.add(it.login), setB.add(it.login);
    console.log(`  ${res?.total_count ?? 0}（取前 100）\t${q}`);
    await sleep(2200);
  }
  const freshB = [...setB].filter((l) => !db.prepare("SELECT 1 FROM persons WHERE login=?").get(l));
  console.log(`B 路新增：${freshB.length}`);
  console.log(`B 入库：${await processBatch(freshB, "bio-CJK")}`);

  // C. 中文 AI 仓库作者
  console.log("== C. 中文 AI 仓库作者 ==");
  const setC = new Set();
  for (const q of REPO_QUERIES) {
    const res = await ghApi(`/search/repositories?q=${encSearchQ(q)}&per_page=100&sort=stars`);
    for (const r of res?.items ?? []) if (r.owner?.login && r.owner.type === "User") setC.add(r.owner.login);
    console.log(`  ${res?.total_count ?? 0}\t${q}`);
    await sleep(2200);
  }
  const freshC = [...setC].filter((l) => !db.prepare("SELECT 1 FROM persons WHERE login=?").get(l));
  console.log(`C 路新增：${freshC.length}`);
  console.log(`C 入库：${await processBatch(freshC, "repo-author")}`);

  const total = db.prepare("SELECT COUNT(*) n FROM persons WHERE status IN ('candidate','approved')").get().n;
  console.log(`== done == 全站可见人物：${total}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
