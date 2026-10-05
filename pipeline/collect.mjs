#!/usr/bin/env node
/**
 * A线采集管道：GitHub 自述 FDE → 候选池（全量，无截断，分层）
 *
 * 层级（SPEC.md §2）：
 *   core — 严口径 FDE 自述（GitHub 主源），上站展示
 *   edge — 边缘岗位关键词（SA/交付/实施顾问等），只入库不混入核心名录（创始人 Q4 决策）
 *   douyin — 抖音渠道，见 collect-douyin.mjs
 *
 * 全量策略：GitHub 搜索 API 单查询上限 1000 条，超限按 created: 年→月分区拼全量。
 * 档案拉取走 GraphQL 别名批查（REST 上限 5000 次/小时撑不住全量）。
 * search_hits 持久化 → `--resume` 只补缺失账号；`--edge` 只跑边缘层。
 *
 * 合规（SPEC.md §6）：联系方式只写 person_contacts，Web 层永不读取。
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdirSync, writeFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import { fileURLToPath } from "node:url";

const run = promisify(execFile);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DB_PATH = path.join(ROOT, "data", "fde.db");
mkdirSync(path.dirname(DB_PATH), { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- 模式 ----------
const RESUME = process.argv.includes("--resume");
const EDGE_ONLY = process.argv.includes("--edge");

// ---------- GitHub API（经 gh CLI，走本地已登录凭证） ----------
async function ghApi(endpoint, { retries = 3 } = {}) {
  for (let i = 0; i <= retries; i++) {
    try {
      const { stdout } = await run("gh", ["api", endpoint], {
        maxBuffer: 32 * 1024 * 1024,
        timeout: 30_000,
      });
      return JSON.parse(stdout);
    } catch (e) {
      const msg = String(e.stderr || e.message || "");
      if (/rate limit/i.test(msg) && i < retries) {
        await sleep(65_000);
        continue;
      }
      if (i < retries) {
        await sleep(1500 * (i + 1));
        continue;
      }
      throw new Error(`gh api ${endpoint} failed: ${msg.slice(0, 300)}`);
    }
  }
}

async function ghGraphql(query, { retries = 3 } = {}) {
  for (let i = 0; i <= retries; i++) {
    try {
      const { stdout } = await run("gh", ["api", "graphql", "-f", `query=${query}`], {
        maxBuffer: 64 * 1024 * 1024,
        timeout: 60_000,
      });
      return JSON.parse(stdout);
    } catch (e) {
      const msg = String(e.stderr || e.message || "");
      // gh 对带 errors 的 GraphQL 响应按非零退出处理，但 data 里仍有解析成功的别名——抢救回来
      if (e.stdout) {
        try {
          const partial = JSON.parse(e.stdout);
          if (partial?.data && Object.keys(partial.data).length > 0) {
            for (const err of partial.errors ?? [])
              console.error(`  [graphql partial] ${err.message?.slice(0, 100)}`);
            return partial;
          }
        } catch {
          /* stdout 不是 JSON，走重试逻辑 */
        }
      }
      if (/rate limit/i.test(msg) && i < retries) {
        await sleep(65_000);
        continue;
      }
      if (/502|couldn't respond|timed? ?out/i.test(msg) && i < retries) {
        await sleep(12_000 * (i + 1)); // GitHub 服务端抖动，拉长退避
        continue;
      }
      if (i < retries) {
        await sleep(1500 * (i + 1));
        continue;
      }
      throw new Error(`graphql failed: ${msg.slice(0, 300)}`);
    }
  }
}

// ---------- 关键词 ----------
// core：严口径 FDE 自述
const CORE_KEYWORDS = ["FDE", '"forward deployed"', '"forward deploy"', "前置部署", "前沿部署"];
// edge：同类不同名的边缘岗位（只入库，不混入核心名录）
const EDGE_KEYWORDS = [
  "solution architect",
  "solutions architect",
  "AI 交付",
  "交付工程师",
  "实施顾问",
  "AI 落地",
  "售前工程师",
  "AI 应用工程师",
];
// location 限定：全国 + 主要城市（中英文）
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

const FDE_RE = /\b(fde|forward[- ]?deploy(ed|ment)?)\b|(前置|前沿|前进)部署/i;
const EDGE_RE =
  /solution?s?[- ]?architect|交付工程师|实施顾问|售前|AI[ 交付落地应用]|人工智能落地/i;
const CN_LOC_RE =
  /china|chinese|beijing|shanghai|shenzhen|hangzhou|guangzhou|chengdu|nanjing|wuhan|xi[' ]?an|xian|suzhou|hefei|changsha|chongqing|tianjin|北京|上海|深圳|杭州|广州|成都|南京|武汉|西安|苏州|合肥|长沙|重庆|天津|中国/i;
const CN_COMPANY_RE =
  /bytedance|byte[- ]?dance|tiktok|doubao|alibaba|alipay|ant group|蚂蚁|taobao|tencent|腾讯|zhipu|智谱|moonshot|月之暗面|kimi|minimax|stepfun|阶跃|deepseek|深度求索|baidu|百度|meituan|美团|jd\.com|京东|huawei|华为|xiaomi|小米|vivo|oppo|honor|荣耀|dji|大疆|manycore|群核|shengshu|生数|baichuan|百川|01[.\- ]?ai|零一万物|modelbest|面壁|qwen|通义|豆包|快手|kuaishou|pinduoduo|拼多多|netease|网易|trip\.com|携程|理想|li auto|nio|蔚来|xpeng|小鹏|地平线|horizon|inclusionai|iflytek|讯飞|sensetime|商汤|megvii|旷视|4paradigm|范式/i;
const CJK_RE = /[\u4e00-\u9fff]/;

// GitHub 搜索限定符的冒号不能编码为 %3A，否则整串被当普通文本 → 恒 0 命中
const encSearchQ = (q) => encodeURIComponent(q).replace(/%3A/g, ":");

async function searchTotal(q) {
  const res = await ghApi(`/search/users?q=${encSearchQ(q)}&per_page=1&page=1`);
  return res.total_count ?? 0;
}

async function searchAllPages(q, expectTotal) {
  const items = [];
  const pages = Math.min(10, Math.max(1, Math.ceil(expectTotal / 100)));
  for (let page = 1; page <= pages; page++) {
    const res = await ghApi(`/search/users?q=${encSearchQ(q)}&per_page=100&page=${page}`);
    items.push(...(res.items ?? []));
    if ((res.items ?? []).length < 100) break;
    await sleep(2300); // search 限流 30/min
  }
  return items;
}

/** 全量检索：命中 >1000 时按 created: 年→月 分区（每块 ≤1000，突破 API 截断上限） */
async function searchFull(q) {
  const total = await searchTotal(q);
  if (total <= 1000) {
    const items = await searchAllPages(q, total);
    return { total, items, partitions: 0 };
  }
  const items = [];
  let partitions = 0;
  for (let year = 2008; year <= 2026; year++) {
    const qy = `${q} created:${year}-01-01..${year}-12-31`;
    const ty = await searchTotal(qy);
    if (ty === 0) continue;
    if (ty <= 1000) {
      items.push(...(await searchAllPages(qy, ty)));
      partitions++;
      console.log(`  ${ty}\t${qy}`);
      await sleep(2300);
      continue;
    }
    for (let m = 1; m <= 12; m++) {
      const mm = String(m).padStart(2, "0");
      const lastDay = new Date(Date.UTC(year, m, 0)).getUTCDate();
      const qm = `${q} created:${year}-${mm}-01..${year}-${mm}-${lastDay}`;
      const tm = await searchTotal(qm);
      if (tm === 0) continue;
      if (tm > 1000) console.error(`  [!] 月分区仍超 1000（${tm}），该块将截断：${qm}`);
      items.push(...(await searchAllPages(qm, Math.min(tm, 1000))));
      partitions++;
      console.log(`  ${tm}\t${qm}`);
      await sleep(2300);
    }
  }
  return { total, items, partitions };
}

// ---------- DB ----------
const db = new DatabaseSync(DB_PATH);
db.exec(`
PRAGMA journal_mode = WAL;
CREATE TABLE IF NOT EXISTS persons (
  id INTEGER PRIMARY KEY,
  login TEXT UNIQUE, name TEXT, bio TEXT, company TEXT, location TEXT,
  html_url TEXT, avatar_url TEXT, blog TEXT,
  followers INTEGER DEFAULT 0, public_repos INTEGER DEFAULT 0,
  stars_total INTEGER DEFAULT 0, active_2026 INTEGER DEFAULT 0,
  fde_evidence TEXT, china_signal TEXT, top_repos_json TEXT,
  score REAL DEFAULT 0, tier TEXT DEFAULT '',
  status TEXT DEFAULT 'candidate', reject_reason TEXT,
  sources_json TEXT, created_at TEXT, updated_at TEXT
);
CREATE TABLE IF NOT EXISTS person_contacts (
  person_id INTEGER PRIMARY KEY REFERENCES persons(id),
  email TEXT, blog TEXT, twitter TEXT, douyin TEXT, other_json TEXT
);
CREATE TABLE IF NOT EXISTS companies (
  id INTEGER PRIMARY KEY, name TEXT, slug TEXT UNIQUE, website TEXT,
  fde_team_known INTEGER DEFAULT 0, jd_count INTEGER DEFAULT 0,
  notes TEXT, created_at TEXT
);
CREATE TABLE IF NOT EXISTS cases (
  id INTEGER PRIMARY KEY, title TEXT, slug TEXT UNIQUE, type TEXT,
  url TEXT, person_id INTEGER, company_id INTEGER, summary TEXT,
  published_at TEXT, source_url TEXT, status TEXT DEFAULT 'candidate',
  collected_at TEXT
);
CREATE TABLE IF NOT EXISTS nominations (
  id INTEGER PRIMARY KEY, name TEXT, github TEXT, douyin TEXT,
  title TEXT, evidence TEXT, links TEXT, email TEXT,
  status TEXT DEFAULT 'pending', created_at TEXT
);
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT);
CREATE TABLE IF NOT EXISTS search_hits (
  login TEXT, keyword TEXT, layer TEXT DEFAULT 'core', PRIMARY KEY (login, keyword)
);
CREATE INDEX IF NOT EXISTS idx_persons_status ON persons(status);
CREATE INDEX IF NOT EXISTS idx_persons_tier ON persons(tier);
`);
// 增量迁移：layer / platform 列
try {
  db.exec("ALTER TABLE persons ADD COLUMN layer TEXT DEFAULT 'core'");
} catch {
  /* 已存在 */
}
try {
  db.exec("ALTER TABLE persons ADD COLUMN platform TEXT DEFAULT 'github'");
} catch {
  /* 已存在 */
}
try {
  db.exec("ALTER TABLE search_hits ADD COLUMN layer TEXT DEFAULT 'core'");
} catch {
  /* 已存在 */
}
db.exec("CREATE INDEX IF NOT EXISTS idx_persons_layer ON persons(layer)");

if (!RESUME && !EDGE_ONLY) {
  db.exec("DELETE FROM person_contacts; DELETE FROM persons;"); // 全量重建（companies/cases/nominations 不动）
}
const now = () => new Date().toISOString();

const insertStmt = db.prepare(
  `INSERT INTO persons (login,name,bio,company,location,html_url,avatar_url,blog,
    followers,public_repos,stars_total,active_2026,fde_evidence,china_signal,
    top_repos_json,score,tier,status,reject_reason,sources_json,created_at,updated_at,layer,platform)
   VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
   ON CONFLICT(login) DO NOTHING`
);
const contactStmt = db.prepare(
  `INSERT INTO person_contacts (person_id,email,blog,twitter,douyin) VALUES (?,?,?,?,?)
   ON CONFLICT(person_id) DO UPDATE SET email=excluded.email, blog=excluded.blog,
   twitter=excluded.twitter, douyin=COALESCE(excluded.douyin, person_contacts.douyin)`
);

function insertPerson(p) {
  const t = now();
  const info = insertStmt.run(
    p.login, p.name, p.bio, p.company, p.location, p.html_url, p.avatar_url, p.blog,
    p.followers, p.public_repos, p.stars_total, p.active_2026, p.fde_evidence, p.china_signal,
    p.top_repos_json, p.score, p.tier, p.status, p.reject_reason, p.sources_json, t, t,
    p.layer ?? "core", p.platform ?? "github"
  );
  if (info.changes > 0) {
    contactStmt.run(info.lastInsertRowid, p.email ?? null, p.blog ?? null, p.twitter ?? null, p.douyin ?? null);
  }
  return info.changes > 0;
}

// ---------- 评分（GitHub 维度临时分，抖音/作品维度接入后全量重校准） ----------
function scorePerson(p) {
  let s = 0;
  const blob = `${p.bio ?? ""} ${p.name ?? ""} ${p.company ?? ""}`;
  const strong = p.layer === "edge" ? EDGE_RE.test(blob) : /\bFDE\b/i.test(blob);
  if (strong) s += 15;
  else if ((p.layer === "edge" ? EDGE_RE : FDE_RE).test(blob)) s += 12;
  s += p.followers < 10 ? 2 : p.followers < 50 ? 5 : p.followers < 200 ? 8 : p.followers < 1000 ? 12 : 15;
  s += p.stars_total < 50 ? 2 : p.stars_total < 500 ? 5 : p.stars_total < 2000 ? 8 : 10;
  s += p.public_repos < 5 ? 1 : p.public_repos < 20 ? 3 : 5;
  if (p.active_2026) s += 5;
  return s;
}
const tierOf = (s) => (s >= 35 ? "S" : s >= 22 ? "A" : s >= 10 ? "B" : "");

// ---------- 搜索阶段 ----------
async function searchPhase(keywords, layer) {
  const matrix = [];
  const hitStmt = db.prepare("INSERT OR IGNORE INTO search_hits (login, keyword, layer) VALUES (?, ?, ?)");
  const recordHits = (items, kw) => {
    for (const it of items) hitStmt.run(it.login, kw, layer);
  };
  for (const kw of keywords) {
    // core 层：全局无 location 的大查询 → created 分区全量；
    // edge 层只关心中国区，跳过全局分区（solution architect 等全球命中数万，分区跑不划算）
    if (layer === "core") {
      const globalQ = `${kw} in:bio`;
      const { total, items, partitions } = await searchFull(globalQ);
      recordHits(items, kw);
      matrix.push({ q: globalQ, total, fetched: items.length, truncated: total - items.length });
      console.log(`  [global ${layer}] ${total} → 实取 ${items.length}（分区 ${partitions} 块）\t${globalQ}`);
    }
    for (const loc of LOCATIONS) {
      const q = `${kw} in:bio location:${loc}`;
      const t = await searchTotal(q);
      if (t === 0) {
        matrix.push({ q, total: 0, fetched: 0 });
        continue;
      }
      const its = await searchAllPages(q, t);
      recordHits(its, kw);
      matrix.push({ q, total: t, fetched: its.length, truncated: t - its.length });
      console.log(`  ${t}\t${q}`);
      await sleep(2300);
    }
    await sleep(2300);
  }
  // 兜底：name/company 自述补捞（仅 core 层需要）
  if (layer === "core") {
    for (const [field, kw] of [["name", '"forward deployed"'], ["company", "FDE"]]) {
      const q = `${kw} in:${field} location:china`;
      const t = await searchTotal(q);
      const its = t > 0 ? await searchAllPages(q, t) : [];
      recordHits(its, kw);
      matrix.push({ q, total: t, fetched: its.length, truncated: t - its.length });
      console.log(`  ${t}\t${q}`);
      await sleep(2300);
    }
  }
  return matrix;
}

// ---------- 档案阶段（GraphQL 批量） ----------
const USER_FIELDS = `login name bio company location twitterUsername websiteUrl url avatarUrl
  followers { totalCount }
  repositories { totalCount }
  lastPush: repositories(first: 1, orderBy: {field: PUSHED_AT, direction: DESC}) { nodes { pushedAt } }
  topRepos: repositories(first: 30, orderBy: {field: STARGAZERS, direction: DESC}) {
    nodes { name url stargazerCount description }
  }`;

async function profilePhase(allLogins, layer, evidenceOf) {
  const BATCH = 35;
  const stats = { total: 0, kept: 0, china: 0, rejected: 0 };
  db.exec("BEGIN");
  for (let i = 0; i < allLogins.length; i += BATCH) {
    const batch = allLogins.slice(i, i + BATCH);
    const query = `query { ${batch
      .map((login, j) => `u${j}: user(login: ${JSON.stringify(login)}) { ${USER_FIELDS} }`)
      .join(" ")} }`;
    let res;
    try {
      res = await ghGraphql(query);
    } catch (e) {
      console.error(`  [batch fail @${i}] ${e.message.slice(0, 150)}`);
      continue;
    }
    await sleep(1200);
    const data = res?.data ?? {};
    for (let j = 0; j < batch.length; j++) {
      const u = data[`u${j}`];
      if (!u) continue; // 组织账号/已注销，收尾对账统一落库
      stats.total++;
      const blob = `${u.bio ?? ""} ${u.name ?? ""} ${u.company ?? ""}`;
      const fdeEvidence = evidenceOf(batch[j], blob);
      const locCn = CN_LOC_RE.test(`${u.location ?? ""}`);
      const compCn = CN_COMPANY_RE.test(u.company ?? "");
      const bioCn = CJK_RE.test(u.bio ?? "");
      const cnSignals = [locCn && "location", compCn && "company", bioCn && "bio-CJK"].filter(Boolean);
      const lastPushedAt = u.lastPush?.nodes?.[0]?.pushedAt ?? "";
      const topRepos = (u.topRepos?.nodes ?? []).map((r) => ({
        name: r.name,
        url: r.url,
        stars: r.stargazerCount,
        desc: r.description,
      }));
      const base = {
        login: u.login,
        name: u.name,
        bio: u.bio,
        company: u.company,
        location: u.location,
        html_url: u.url,
        avatar_url: u.avatarUrl,
        blog: u.websiteUrl ?? null,
        email: null,
        twitter: u.twitterUsername,
        followers: u.followers?.totalCount ?? 0,
        public_repos: u.repositories?.totalCount ?? 0,
        stars_total: topRepos.reduce((a, r) => a + (r.stars ?? 0), 0),
        active_2026: lastPushedAt >= "2026" ? 1 : 0,
        fde_evidence: fdeEvidence,
        china_signal: cnSignals.join(","),
        top_repos_json: JSON.stringify(topRepos.slice(0, 5)),
        sources_json: JSON.stringify([{ type: "github", url: u.url, collected_at: now() }]),
        layer,
      };
      if (!fdeEvidence) {
        stats.rejected++;
        insertPerson({ ...base, score: 0, tier: "", status: "rejected", reject_reason: "bio 无目标岗位自述（搜索命中来自 name/company 噪声）" });
        continue;
      }
      if (cnSignals.length === 0) {
        stats.rejected++;
        insertPerson({ ...base, score: 0, tier: "", status: "rejected", reject_reason: "无中国大陆信号（location/company/bio 均不可判）" });
        continue;
      }
      stats.china++;
      stats.kept++;
      const score = scorePerson(base);
      insertPerson({ ...base, score, tier: tierOf(score), status: "candidate", reject_reason: null });
    }
    if ((i / BATCH) % 10 === 0) console.log(`  [${layer}] ...${Math.min(i + BATCH, allLogins.length)}/${allLogins.length}`);
  }
  // 收尾对账：无法以 user 解析的命中（组织账号/已注销）落库为 rejected，确保 search_hits 全部有归属
  const unresolved = db
    .prepare(
      `SELECT DISTINCT sh.login FROM search_hits sh
       LEFT JOIN persons p ON p.login = sh.login
       WHERE sh.layer = ? AND p.login IS NULL`
    )
    .all(layer);
  const unresolvedStmt = db.prepare(
    "INSERT INTO persons (login,status,reject_reason,sources_json,created_at,updated_at,layer,platform) VALUES (?,?,?,?,?,?,?, 'github')"
  );
  for (const r of unresolved) {
    const t = now();
    const info = unresolvedStmt.run(
      r.login, "rejected", "组织账号或已注销（GraphQL 无法以 user 解析，非个人）",
      JSON.stringify([{ type: "github", url: `https://github.com/${r.login}`, collected_at: t }]), t, t, layer
    );
    contactStmt.run(info.lastInsertRowid, null, null, null, null);
  }
  if (unresolved.length) console.log(`  对账：${unresolved.length} 个组织/注销账号落库为 rejected`);
  db.exec("COMMIT");
  return stats;
}

// ---------- 主流程 ----------
async function main() {
  // 待处理集合：search_hits（指定层）中尚未在 persons 有行的账号
  const pendingOf = (layer) =>
    db
      .prepare(
        `SELECT DISTINCT sh.login, sh.layer FROM search_hits sh
         LEFT JOIN persons p ON p.login = sh.login
         WHERE sh.layer = ? AND p.login IS NULL`
      )
      .all(layer)
      .map((r) => r.login);

  let layersToRun;
  if (EDGE_ONLY) {
    layersToRun = ["edge"];
  } else if (RESUME) {
    // resume：哪层有缺补哪层（core 优先）
    layersToRun = [];
    if (db.prepare("SELECT COUNT(*) n FROM search_hits WHERE layer='core'").get().n > 0) layersToRun.push("core");
    if (db.prepare("SELECT COUNT(*) n FROM search_hits WHERE layer='edge'").get().n > 0) layersToRun.push("edge");
    if (layersToRun.length === 0) layersToRun = ["core"];
  } else {
    layersToRun = ["core", "edge"];
  }

  const allMatrix = [];
  for (const layer of layersToRun) {
    const keywords = layer === "core" ? CORE_KEYWORDS : EDGE_KEYWORDS;
    const hasHits = db.prepare("SELECT COUNT(*) n FROM search_hits WHERE layer=?").get(layer).n > 0;
    if ((RESUME || EDGE_ONLY) && hasHits) {
      console.log(`== [${layer}] 跳过搜索（search_hits 已有 ${hasHits} 条命中）==`);
    } else {
      console.log(`== Phase 1 [${layer}]: search（created 分区全量，无 1000 截断）==`);
      const matrix = await searchPhase(keywords, layer);
      allMatrix.push(...matrix);
      db.prepare(
        "INSERT INTO meta (key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value"
      ).run(`last_search_matrix_${layer}`, JSON.stringify(matrix));
    }
    const pending = pendingOf(layer);
    console.log(`== Phase 2 [${layer}]: 待处理 ${pending.length} 账号 ==`);
    const evidenceOf =
      layer === "core"
        ? (login, blob) => {
            const blobMatch = FDE_RE.test(blob) ? "bio" : null;
            const kws = db.prepare("SELECT keyword FROM search_hits WHERE login=? AND layer='core'").all(login).map((r) => r.keyword);
            return blobMatch ? kws.join(",") : null;
          }
        : (login, blob) => {
            if (!EDGE_RE.test(blob)) return null;
            return db.prepare("SELECT keyword FROM search_hits WHERE login=? AND layer='edge'").all(login).map((r) => r.keyword).join(",");
          };
    const stats = await profilePhase(pending, layer, evidenceOf);
    console.log(`== [${layer}] done: ${JSON.stringify(stats)} ==`);
  }

  db.prepare(
    "INSERT INTO meta (key,value) VALUES ('last_pipeline_run',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value"
  ).run(now());

  // ---------- 报告（漏斗一律从库里算；矩阵优先内存、退回 meta 持久化） ----------
  let matrix = allMatrix;
  if (matrix.length === 0) {
    for (const layer of layersToRun) {
      try {
        const saved = db.prepare("SELECT value FROM meta WHERE key=?").get(`last_search_matrix_${layer}`);
        if (saved) matrix.push(...JSON.parse(saved.value));
      } catch {
        /* 忽略 */
      }
    }
  }
  const candidates = db.prepare("SELECT COUNT(*) n FROM persons WHERE status='candidate'").get().n;
  const coreCount = db.prepare("SELECT COUNT(*) n FROM persons WHERE status='candidate' AND layer='core'").get().n;
  const edgeCount = db.prepare("SELECT COUNT(*) n FROM persons WHERE status='candidate' AND layer='edge'").get().n;
  const byTier = db
    .prepare("SELECT layer, tier, COUNT(*) n FROM persons WHERE status='candidate' GROUP BY layer, tier")
    .all();
  const top = db
    .prepare(
      "SELECT login,name,company,location,followers,stars_total,active_2026,score,tier,layer FROM persons WHERE status='candidate' AND layer='core' ORDER BY score DESC LIMIT 15"
    )
    .all();
  const truncatedQ = matrix.filter((m) => (m.truncated ?? 0) > 0);
  const date = now().slice(0, 10);
  const report = `# A线 池子规模报告（${date}，全量无截断版）

## 结论
- 检索矩阵：${matrix.length} 组查询，唯一账号 **${db.prepare("SELECT COUNT(*) n FROM persons").get().n}**（全量落库，含拒绝条目）
- 核心名录（严口径 FDE，core 层）：**${coreCount} 人**
- 边缘层（SA/交付/实施顾问等，edge 层，不上站）：**${edgeCount} 人**
- 分档：${byTier.map((r) => `${r.layer}/${r.tier || "未分档"} ${r.n}人`).join("，") || "无"}
${truncatedQ.length ? `- ⚠️ 仍有截断的查询：${truncatedQ.map((m) => `\`${m.q}\`（缺 ${m.truncated}）`).join("，")}` : "- ✅ 所有查询均无截断"}

## 过滤漏斗
| 阶段 | 数量 |
|---|---|
| 搜索命中唯一账号（全量落库） | ${db.prepare("SELECT COUNT(*) n FROM persons").get().n} |
| 有目标岗位自述证据 | ${db.prepare("SELECT COUNT(*) n FROM persons WHERE fde_evidence IS NOT NULL").get().n} |
| 候选池（core+edge，中国大陆信号） | ${candidates} |
| 拒绝（无证据/无地域信号/组织账号） | ${db.prepare("SELECT COUNT(*) n FROM persons WHERE status='rejected'").get().n} |

## 检索矩阵明细（仅列命中 >0 或有截断的查询）
| 查询 | 命中 | 实取 |
|---|---|---|
${matrix
  .filter((m) => m.total > 0 || (m.truncated ?? 0) > 0)
  .map((m) => `| \`${m.q}\` | ${m.total} | ${m.fetched} |`)
  .join("\n")}

## 核心候选池 TOP 15（按临时评分）
| 登录名 | 公司 | 位置 | followers | stars | 2026活跃 | 分 | 档 |
|---|---|---|---|---|---|---|---|
${top
  .map(
    (t) =>
      `| [${t.login}](https://github.com/${t.login}) | ${t.company ?? "-"} | ${t.location ?? "-"} | ${t.followers} | ${t.stars_total} | ${t.active_2026 ? "✓" : "✗"} | ${t.score} | ${t.tier} |`
  )
  .join("\n")}

## 对 500 人首版目标的判断
- GitHub 两条腿全量跑完后，core ${coreCount} + edge ${edgeCount}；500 人目标仍依赖抖音渠道与自荐通道（SPEC §9 预案）
- 本评分仅含 GitHub 维度（上限约 52 分），S/A 档为临时档，接入抖音与作品维度后全量重算。
`;
  writeFileSync(path.join(ROOT, "reports", `pool-size-${date}.md`), report);
  console.log("== done ==");
  console.log(`candidates=${candidates} (core ${coreCount} / edge ${edgeCount}) report=reports/pool-size-${date}.md`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
