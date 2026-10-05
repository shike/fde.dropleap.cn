#!/usr/bin/env node
/**
 * GitHub Pages 通道：个人站/简介仓库自述 FDE → 候选池
 *
 * 原理：GitHub 用户搜索只覆盖 bio 字段；很多人 bio 不写 FDE，但个人主页
 * （username.github.io 或 username/username 简介仓库）里写了。code search 覆盖仓库内容，
 * 正好补上这条召回。github.io 是静态托管，页面 curl 直抓，无反爬。
 *
 * 发现：GitHub code search（认证后 10 次/分钟，legacy 索引单查询 1000 上限）。
 * 精度过滤：只收「个人站仓库」命中——owner==repo 名（profile README 仓库）或 repo 名以
 * .github.io 结尾；项目 README 顺带提 FDE 的算噪声丢弃。
 * 证据：code 命中 fragment + 个人站页面原文（含标题/正文里的 FDE 自述与中文/地点信号）。
 *
 * 跑法：node pipeline/collect-githubpages.mjs [--dry]
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { writeFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import { fileURLToPath } from "node:url";

const run = promisify(execFile);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DRY = process.argv.includes("--dry");
const db = new DatabaseSync(path.join(ROOT, "data", "fde.db"));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const now = () => new Date().toISOString();

const FDE_RE = /\b(fde|forward[- ]?deploy(ed|ment)?)\b|(前置|前沿|前线|前进)部署/i;
const CN_LOC_RE =
  /china|chinese|beijing|shanghai|shenzhen|hangzhou|guangzhou|chengdu|nanjing|wuhan|xi[' ]?an|suzhou|hefei|changsha|chongqing|tianjin|北京|上海|深圳|杭州|广州|成都|南京|武汉|西安|苏州|合肥|长沙|重庆|天津|中国/i;
const CJK_RE = /[\u4e00-\u9fff]/;

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

// ---------- 1. code search 发现 ----------
// 个人自述型查询；legacy code search 不支持 OR/stars:/created:，单查询 1000 上限，
// html 大集用 size:（字节）分区破千；两大分区仍超千的再细分
const QUERIES = [
  `"forward deployed engineer" filename:README.md`,
  `"forward-deployed engineer" filename:README.md`,
  `"forward deployed engineer" extension:html size:<8000`,
  `"forward deployed engineer" extension:html size:8000..15000`,
  `"forward deployed engineer" extension:html size:15000..22000`,
  `"forward deployed engineer" extension:html size:22000..30000`,
  `"forward deployed engineer" extension:html size:30000..60000`,
  `"forward deployed engineer" extension:html size:60000..120000`,
  `"forward deployed engineer" extension:html size:>120000`,
  `"我是FDE"`,
  `"我是 FDE" filename:README.md`,
  `"FDE" "岗位" filename:README.md language:markdown`,
  `"FDE" "前置部署"`,
  `"AI落地" extension:html "FDE"`,
  `"FDE" "驻场" filename:README.md`,
  `"FDE" "交付" filename:README.md language:markdown`,
  `"大模型" "FDE" filename:README.md`,
  // 大厂配对：在职者 bio 不写但简介仓库写的最高质量 segment
  `"FDE" "字节" filename:README.md`,
  `"FDE" "阿里" filename:README.md`,
  `"FDE" "腾讯" filename:README.md`,
  `"FDE" "讯飞"`,
  `"FDE" "智谱"`,
  `"FDE" "百度" filename:README.md`,
  `"FDE" "美团" filename:README.md`,
  `"FDE" "月之暗面"`,
  `"FDE" "DeepSeek"`,
  `"FDE" "快手" filename:README.md`,
  `"FDE" "华为" filename:README.md`,
  `"FDE" "MiniMax"`,
  `"FDE" "蚂蚁"`,
  // 短语与文件名变体穷举
  `"forward deployment engineer"`,
  `"forward-deployment engineer"`,
  `"FDE工程师"`,
  `"FDE 工程师" filename:README.md`,
  `"前置部署工程师"`,
  `"前线部署工程师"`,
  `"前沿部署工程师"`,
  `"AI交付工程师"`,
  `"落地工程师" filename:README.md`,
  `filename:about.md "FDE"`,
  `filename:bio.md "FDE"`,
  `filename:intro.md "FDE"`,
  `filename:profile.md "FDE"`,
];

async function discover() {
  const hits = new Map(); // login -> {login, repo, fragment, url}
  for (const q of QUERIES) {
    const enc = encodeURIComponent(q).replace(/%3A/g, ":");
    let total = 0;
    for (let page = 1; page <= 10; page++) {
      let res;
      try {
        res = await ghApi(`/search/code?q=${enc}&per_page=100&page=${page}`);
      } catch (e) {
        console.error(`  [search fail] ${q}: ${e.message.slice(0, 100)}`);
        break;
      }
      total = res.total_count ?? 0;
      for (const item of res.items ?? []) {
        const owner = item.repository?.owner?.login;
        const repoName = item.repository?.name ?? "";
        const filePath = item.path ?? "";
        if (!owner) continue;
        // 精度过滤：个人站仓库，或「仓库根目录 README」自述（个人简介最常见的落点）
        const isProfileRepo = owner.toLowerCase() === repoName.toLowerCase();
        const isPagesRepo = repoName.toLowerCase().endsWith(".github.io");
        const isRootReadme = /\/?readme\.md$/i.test(filePath) && filePath.split("/").length === 1;
        if (!isProfileRepo && !isPagesRepo && !isRootReadme) continue;
        if (!hits.has(owner)) {
          hits.set(owner, {
            login: owner,
            repo: `${item.repository.full_name}`,
            file: `${filePath}`,
            url: `https://github.com/${item.repository.full_name}/blob/HEAD/${filePath}`,
          });
        }
      }
      if ((res.items ?? []).length < 100 || page * 100 >= Math.min(total, 1000)) break;
      await sleep(7000); // code search 10/min
    }
    console.log(`  ${total}\t${q}`);
    await sleep(7000);
  }
  return hits;
}

// ---------- 2. 个人站页面抓取（静态 HTML，直连） ----------
async function fetchSite(login) {
  for (const url of [`https://${login}.github.io/`, `https://${login.toLowerCase()}.github.io/`]) {
    try {
      const { stdout } = await run("curl", ["-sL", "-m", "12", "-A", "Mozilla/5.0", url], { timeout: 15_000 });
      if (stdout && stdout.length > 200) {
        const text = stdout
          .replace(/<script[\s\S]*?<\/script>/gi, " ")
          .replace(/<style[\s\S]*?<\/style>/gi, " ")
          .replace(/<[^>]+>/g, " ")
          .replace(/\s+/g, " ");
        return { url, text: text.slice(0, 8000) };
      }
    } catch {
      /* 试下一个小写变体 */
    }
  }
  return null;
}

// ---------- 3. GraphQL 档案批量 ----------
const USER_FIELDS = `login name bio company location twitterUsername websiteUrl url avatarUrl
  followers { totalCount } repositories { totalCount }`;

async function ghGraphql(query, { retries = 3 } = {}) {
  for (let i = 0; i <= retries; i++) {
    try {
      const { stdout } = await run("gh", ["api", "graphql", "-f", `query=${query}`], { maxBuffer: 32 * 1024 * 1024 });
      return JSON.parse(stdout);
    } catch (e) {
      // gh 对带 errors 的 GraphQL 响应按非零退出处理，但 data 里仍有解析成功的别名——抢救回来
      if (e.stdout) {
        try {
          const partial = JSON.parse(e.stdout);
          if (partial?.data && Object.keys(partial.data).length > 0) return partial;
        } catch {
          /* stdout 不是 JSON，走重试 */
        }
      }
      const msg = String(e.stderr || e.message || "");
      if (/rate limit/i.test(msg) && i < retries) {
        await sleep(65_000);
        continue;
      }
      if (i < retries) {
        await sleep(2000 * (i + 1));
        continue;
      }
      throw new Error(`graphql failed: ${msg.slice(0, 200)}`);
    }
  }
}

async function profiles(logins) {
  const out = [];
  const BATCH = 35;
  for (let i = 0; i < logins.length; i += BATCH) {
    const batch = logins.slice(i, i + BATCH);
    const query = `query { ${batch
      .map((l, j) => `u${j}: user(login: ${JSON.stringify(l)}) { ${USER_FIELDS} }`)
      .join(" ")} }`;
    try {
      const data = (await ghGraphql(query))?.data ?? {};
      for (let j = 0; j < batch.length; j++) if (data[`u${j}`]) out.push(data[`u${j}`]);
    } catch (e) {
      console.error(`  [profile batch fail @${i}] ${e.message.slice(0, 100)}`);
    }
    await sleep(1500);
  }
  return out;
}

// ---------- 主流程 ----------
const hits = await discover();
console.log(`个人站命中：${hits.size} 个账号`);
const logins = [...hits.keys()];
// 跳过库里已有的
const fresh = logins.filter((l) => !db.prepare("SELECT 1 FROM persons WHERE login=?").get(l));
console.log(`其中新账号：${fresh.length}`);
if (DRY) {
  for (const l of fresh) console.log(`  - ${l} (${hits.get(l).repo})`);
  process.exit(0);
}

const profilesList = await profiles(fresh);
const insertStmt = db.prepare(
  `INSERT INTO persons (login,name,bio,company,location,html_url,avatar_url,blog,
    followers,public_repos,stars_total,active_2026,fde_evidence,china_signal,top_repos_json,
    score,tier,status,reject_reason,sources_json,created_at,updated_at,layer,platform)
   VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?, 'core','github')
   ON CONFLICT(login) DO NOTHING`
);
const contactStmt = db.prepare(
  `INSERT INTO person_contacts (person_id,blog,twitter) VALUES (?,?,?)
   ON CONFLICT(person_id) DO UPDATE SET blog=excluded.blog, twitter=excluded.twitter`
);

let kept = 0, rejected = 0;
for (const u of profilesList) {
  const hit = hits.get(u.login);
  const site = await fetchSite(u.login);
  const siteText = site?.text ?? "";
  const siteHasFde = FDE_RE.test(siteText);
  const blob = `${u.bio ?? ""} ${u.name ?? ""} ${u.company ?? ""}`;
  const bioFde = FDE_RE.test(blob);
  const evidenceBits = [
    hit ? `个人仓库自述（${hit.repo}/${hit.file}）` : null,
    siteHasFde && site ? `个人主页自述（${site.url}）` : null,
    bioFde ? "GitHub bio 自述" : null,
  ].filter(Boolean);
  if (evidenceBits.length === 0) {
    rejected++;
    insertStmt.run(u.login, u.name, u.bio, u.company, u.location, u.url, u.avatarUrl, u.websiteUrl,
      u.followers?.totalCount ?? 0, u.repositories?.totalCount ?? 0, 0, 0, null, "", "[]", 0, "",
      "rejected", "仓库/主页/bio 均无可核验 FDE 自述",
      JSON.stringify([{ type: "github", url: u.url, collected_at: now() }]), now(), now());
    continue;
  }
  // 中国信号：GitHub 档案三件套 + 个人站正文里的地点/中文
  const siteCn = CN_LOC_RE.test(siteText) ? "site-location" : null;
  const siteCjk = CJK_RE.test(siteText) ? "site-CJK" : null;
  const cnSignals = [
    CN_LOC_RE.test(u.location ?? "") && "location",
    /bytedance|alibaba|tencent|zhipu|moonshot|minimax|stepfun|deepseek|baidu|meituan|huawei|xiaomi|ant group|蚂蚁|智谱|月之暗面|豆包|通义/i.test(u.company ?? "") && "company",
    CJK_RE.test(u.bio ?? "") && "bio-CJK",
    siteCn,
    siteCjk,
  ].filter(Boolean);
  if (cnSignals.length === 0) {
    rejected++;
    insertStmt.run(u.login, u.name, u.bio, u.company, u.location, u.url, u.avatarUrl, u.websiteUrl,
      u.followers?.totalCount ?? 0, u.repositories?.totalCount ?? 0, 0, 0, evidenceBits.join("；"), "", "[]", 0, "",
      "rejected", "无中国大陆信号（档案与个人站均不可判）",
      JSON.stringify([{ type: "github", url: u.url, collected_at: now() }]), now(), now());
    continue;
  }
  const followers = u.followers?.totalCount ?? 0;
  const stars = 0; // 站点通道暂不计 stars，作品维度后补
  // 质量线（SPEC §2.2 提及≠自述）：唯一证据是仓库 code 命中、档案/站点均无自述 → 先降级，
  // 交给 selfid.mjs 做第一人称句式检测后自动升级
  const codeOnly = evidenceBits.every((e) => e.startsWith("个人仓库自述") && !siteHasFde && !bioFde);
  const isSelfid = evidenceBits.some((e) => e.includes("GitHub bio 自述") || e.includes("个人主页自述"));
  const status = codeOnly && !isSelfid ? "rejected" : "candidate";
  const rejectReason = status === "rejected" ? "仓库内容提及 FDE 但档案无自述（提及≠自述，待自述检测）" : null;
  const score = 12 + (followers < 10 ? 2 : followers < 50 ? 5 : followers < 200 ? 8 : followers < 1000 ? 12 : 15) + (cnSignals.length >= 2 ? 3 : 0);
  const tier = status === "candidate" ? (score >= 35 ? "S" : score >= 22 ? "A" : score >= 10 ? "B" : "") : "";
  const sources = [
    { type: "github", url: u.url, collected_at: now() },
    hit && { type: "github-code", url: hit.url, collected_at: now() },
    site && { type: "github-pages", url: site.url, collected_at: now() },
  ].filter(Boolean);
  const info = insertStmt.run(u.login, u.name, u.bio, u.company, u.location, u.url, u.avatarUrl, u.websiteUrl,
    followers, u.repositories?.totalCount ?? 0, stars, 0, evidenceBits.join("；"), cnSignals.join(","), "[]",
    score, tier, status, rejectReason, JSON.stringify(sources), now(), now());
  if (info.changes > 0) {
    kept++;
    const row = db.prepare("SELECT id FROM persons WHERE login=?").get(u.login);
    contactStmt.run(row.id, u.websiteUrl ?? null, u.twitterUsername ?? null);
  }
}
console.log(`== done == kept=${kept} rejected=${rejected}`);
