import Database from "better-sqlite3";
import path from "node:path";
import fs from "node:fs";

// ─────────────────────────────────────────────────────────────
// 合规红线（SPEC.md §6）：
// 1. 本模块及其下游【永不读取】person_contacts / nominations.email 等
//    联络字段。联系方式只供 pipeline 离线使用，任何 .select() 不得涉及。
// 2. 页面展示层永不输出邮箱、社交私信等联系方式。
// ─────────────────────────────────────────────────────────────

function resolveDbPath(): string {
  if (process.env.FDE_DB) return process.env.FDE_DB;
  const candidates = [
    path.resolve(process.cwd(), "..", "data", "fde.db"),
    path.resolve(process.cwd(), "data", "fde.db"),
  ];
  for (const p of candidates) if (fs.existsSync(/* turbopackIgnore: true */ p)) return p;
  return candidates[0];
}

// 注意：不要缓存长驻只读连接——实测只读连接会一直持有首次读取的 WAL 快照，
// 采集管道持续写入时 Web 侧永远读到旧数据。每次查询短连接打开，代价可忽略。
export function getDb(): Database.Database {
  return new Database(resolveDbPath(), { readonly: true, fileMustExist: false });
}

// 渲染前消毒（SPEC §6 前端零联系方式）：人物公开简介里自带的邮箱/手机/微信号/QQ 一律打码；
// 公众号名称属公开品牌标识保留。结构化联系方式（person_contacts）本就不被本模块读取。
export function sanitizeBio(bio: string | null): string | null {
  if (!bio) return bio;
  return bio
    .replace(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, "［邮箱见其原主页］")
    .replace(/1[3-9]\d{9}/g, "［手机号已隐藏］")
    .replace(/(微信|加微|weixin|wechat|vx|VX|WX|wx)\s*[:：?？]?\s*[a-zA-Z0-9_-]{5,24}/g, "$1：***")
    .replace(/(qq|QQ|扣扣)\s*[:：]?\s*\d{5,12}/g, "$1：***");
}

export type PersonRow = {
  id: number;
  login: string;
  name: string | null;
  bio: string | null;
  company: string | null;
  location: string | null;
  html_url: string | null;
  avatar_url: string | null;
  blog: string | null;
  followers: number;
  public_repos: number;
  stars_total: number;
  active_2026: number;
  fde_evidence: string | null;
  china_signal: string | null;
  top_repos_json: string | null;
  score: number;
  tier: string;
  status: string;
  layer: string | null;
  platform: string | null;
  avatar_file: string | null;
  city: string | null;
  tags: string | null;
};

const SHOW_PENDING = true; // 上线前审核完成后改为 false，仅展示 approved

export function listPersons(opts: {
  city?: string;
  q?: string;
  layer?: string;
  limit?: number;
  offset?: number;
}) {
  const db = getDb();
  const where: string[] = ["status IN ('candidate','approved')"];
  const params: unknown[] = [];
  // 分层：fde=严口径核心（含推断级证据待审者）｜edge=同类岗位延伸｜practitioner=AI 从业者
  if (opts.layer === "fde") {
    where.push("(layer IS NULL OR layer = 'core')");
  } else if (opts.layer === "edge") {
    where.push("layer = 'edge'");
  } else if (opts.layer === "practitioner") {
    where.push("layer = 'practitioner'");
  }
  if (opts.city) {
    where.push("city = ?");
    params.push(opts.city);
  }
  if (opts.q) {
    where.push("(login LIKE ? OR name LIKE ? OR company LIKE ? OR bio LIKE ?)");
    const like = `%${opts.q}%`;
    params.push(like, like, like, like);
  }
  const whereSql = where.join(" AND ");
  const rows = db
    .prepare(
      `SELECT * FROM persons WHERE ${whereSql} ORDER BY score DESC, followers DESC LIMIT ? OFFSET ?`
    )
    .all(...params, opts.limit ?? 60, opts.offset ?? 0) as PersonRow[];
  for (const r of rows) r.bio = sanitizeBio(r.bio);
  // 主理人固定展示在第 4 位：第一屏可见，又不喧宾夺主
  const founderIdx = rows.findIndex((r) => r.login === "shike");
  if (founderIdx > -1 && founderIdx !== 3) {
    const [founder] = rows.splice(founderIdx, 1);
    rows.splice(Math.min(3, rows.length), 0, founder);
  }
  const total = (
    db.prepare(`SELECT COUNT(*) n FROM persons WHERE ${whereSql}`).get(...params) as { n: number }
  ).n;
  return { rows, total };
}

export function layerCounts() {
  const db = getDb();
  const one = (sql: string) => (db.prepare(sql).get() as { n: number }).n;
  return {
    all: one(
      "SELECT COUNT(*) n FROM persons WHERE status IN ('candidate','approved')"
    ),
    fde: one(
      "SELECT COUNT(*) n FROM persons WHERE status IN ('candidate','approved') AND (layer IS NULL OR layer = 'core')"
    ),
    edge: one(
      "SELECT COUNT(*) n FROM persons WHERE status IN ('candidate','approved') AND layer = 'edge'"
    ),
    practitioner: one(
      "SELECT COUNT(*) n FROM persons WHERE status IN ('candidate','approved') AND layer = 'practitioner'"
    ),
  };
}

export function getPerson(login: string): PersonRow | null {
  const row = getDb()
    .prepare("SELECT * FROM persons WHERE login = ? AND status IN ('candidate','approved')")
    .get(login) as PersonRow | undefined;
  if (!row) return null;
  row.bio = sanitizeBio(row.bio);
  return row;
}

export function edgeCount() {
  return (
    getDb()
      .prepare(
        "SELECT COUNT(*) n FROM persons WHERE status='candidate' AND layer='edge'"
      )
      .get() as { n: number }
  ).n;
}

export function siteStats() {
  const db = getDb();
  const persons = (
    db
      .prepare(
        "SELECT COUNT(*) n FROM persons WHERE status IN ('candidate','approved')"
      )
      .get() as { n: number }
  ).n;
  const cases = (
    db.prepare("SELECT COUNT(*) n FROM cases WHERE status != 'offline'").get() as { n: number }
  ).n;
  const companies = (db.prepare("SELECT COUNT(*) n FROM companies").get() as { n: number }).n;
  const lastRun = (
    db.prepare("SELECT value FROM meta WHERE key = 'last_pipeline_run'").get() as
      | { value: string }
      | undefined
  )?.value;
  const tierCounts = db
    .prepare(
      "SELECT tier, COUNT(*) n FROM persons WHERE status IN ('candidate','approved') AND tier != '' GROUP BY tier"
    )
    .all() as { tier: string; n: number }[];
  return { persons, cases, companies, lastRun, tierCounts };
}


export function listCompanies() {
  return getDb()
    .prepare(
      "SELECT id, name, slug, website, fde_team_known, jd_count, notes, region FROM companies ORDER BY name"
    )
    .all() as {
    id: number;
    name: string;
    slug: string;
    website: string;
    fde_team_known: number;
    jd_count: number;
    notes: string | null;
    region: string | null;
  }[];
}

export function listCases() {
  return getDb()
    .prepare("SELECT * FROM cases WHERE status != 'offline' ORDER BY collected_at DESC LIMIT 500")
    .all() as {
    id: number;
    title: string;
    slug: string;
    type: string;
    url: string;
    summary: string | null;
    published_at: string | null;
    collected_at: string;
    status: string;
    content: string | null;
  }[];
}

export function topRepos(p: PersonRow): { name: string; url: string; stars: number; desc: string | null }[] {
  try {
    return p.top_repos_json ? JSON.parse(p.top_repos_json) : [];
  } catch {
    return [];
  }
}

export function cityCounts() {
  return getDb()
    .prepare(
      "SELECT city, COUNT(*) n FROM persons WHERE status IN ('candidate','approved') GROUP BY city ORDER BY n DESC"
    )
    .all() as { city: string; n: number }[];
}

export function recentPersons(limit = 8) {
  const rows = getDb()
    .prepare(
      "SELECT * FROM persons WHERE status IN ('candidate','approved') ORDER BY created_at DESC, id DESC LIMIT ?"
    )
    .all(limit) as PersonRow[];
  for (const r of rows) r.bio = sanitizeBio(r.bio);
  return rows;
}

export function caseTypeCounts() {
  return getDb()
    .prepare("SELECT type, COUNT(*) n FROM cases WHERE status != 'offline' GROUP BY type ORDER BY n DESC")
    .all() as { type: string; n: number }[];
}
export function listCasesPaged(type: string | undefined, limit: number, offset: number) {
  const db = getDb();
  const where = type ? "status != 'offline' AND type = ?" : "status != 'offline'";
  const rows = db
    .prepare(`SELECT * FROM cases WHERE ${where} ORDER BY collected_at DESC LIMIT ? OFFSET ?`)
    .all(...(type ? [type] : []), limit, offset) as {
    id: number; title: string; slug: string; type: string; url: string | null;
    summary: string | null; content: string | null; published_at: string | null;
    collected_at: string; status: string;
  }[];
  const total = (db.prepare(`SELECT COUNT(*) n FROM cases WHERE ${where}`).get(...(type ? [type] : [])) as { n: number }).n;
  return { rows, total };
}
export function companyRegionCounts() {
  return getDb()
    .prepare("SELECT COALESCE(region, '中国') region, COUNT(*) n FROM companies GROUP BY region ORDER BY n DESC")
    .all() as { region: string; n: number }[];
}
export function listCompaniesPaged(
  type: string | undefined,
  region: string | undefined,
  limit: number,
  offset: number
) {
  const db = getDb();
  const conds: string[] = [];
  const params: unknown[] = [];
  if (type) { conds.push("type = ?"); params.push(type); }
  if (region) { conds.push("COALESCE(region, '中国') = ?"); params.push(region); }
  const where = conds.length ? conds.join(" AND ") : "1=1";
  const rows = db
    .prepare(`SELECT id, name, slug, website, fde_team_known, jd_count, notes, region, type FROM companies WHERE ${where} ORDER BY name LIMIT ? OFFSET ?`)
    .all(...params, limit, offset) as {
    id: number; name: string; slug: string; website: string; fde_team_known: number;
    jd_count: number; notes: string | null; region: string | null; type: string | null;
  }[];
  const total = (db.prepare(`SELECT COUNT(*) n FROM companies WHERE ${where}`).get(...params) as { n: number }).n;
  return { rows, total };
}
export function companyTypeCounts() {
  return getDb()
    .prepare("SELECT type, COUNT(*) n FROM companies GROUP BY type ORDER BY n DESC")
    .all() as { type: string; n: number }[];
}
export function policyLevelCounts() {
  return getDb()
    .prepare("SELECT level, COUNT(*) n FROM policies GROUP BY level ORDER BY n DESC")
    .all() as { level: string; n: number }[];
}
export function listPoliciesPaged(level: string | undefined, limit: number, offset: number) {
  const db = getDb();
  const where = level ? "level = ?" : "1=1";
  const rows = db
    .prepare(`SELECT id, title, region, level, date, summary, url, source FROM policies WHERE ${where} ORDER BY date DESC LIMIT ? OFFSET ?`)
    .all(...(level ? [level] : []), limit, offset) as {
    id: number; title: string; region: string; level: string; date: string | null;
    summary: string | null; url: string | null; source: string | null;
  }[];
  const total = (db.prepare(`SELECT COUNT(*) n FROM policies WHERE ${where}`).get(...(level ? [level] : [])) as { n: number }).n;
  return { rows, total };
}