import { execFileSync } from "node:child_process";
import { writeFileSync, mkdirSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(ROOT, "web", "public", "data");
mkdirSync(OUT, { recursive: true });
const db = new DatabaseSync(path.join(ROOT, "data", "fde.db"));

const j = (file, data) => {
  writeFileSync(path.join(OUT, file), JSON.stringify(data));
  console.log(`${file}: ${(JSON.stringify(data).length / 1024).toFixed(0)}KB`);
};

const persons = db
  .prepare(
    `SELECT login, name, bio, company, location, city, html_url, avatar_file, blog,
      followers, stars_total, layer, platform, tags, top_repos_json, active_2026
     FROM persons WHERE status IN ('candidate','approved')`
  )
  .all()
  .map((p) => ({
    ...p,
    top: (() => {
      try {
        const repos = JSON.parse(p.top_repos_json ?? "[]");
        return repos.sort((a, b) => (b.stars ?? 0) - (a.stars ?? 0))[0] ?? null;
      } catch {
        return null;
      }
    })(),
    top_repos_json: undefined,
  }));
j("persons.json", persons);

j(
  "cases.json",
  db
    .prepare(
      "SELECT slug, title, type, summary, content, published_at, url, collected_at FROM cases WHERE status != 'offline' ORDER BY collected_at DESC"
    )
    .all()
    .map((c) => ({ ...c, content: (c.content ?? "").slice(0, 4000) }))
);

j(
  "companies.json",
  db
    .prepare("SELECT name, slug, website, region, type, notes FROM companies ORDER BY name")
    .all()
);

j(
  "policies.json",
  db
    .prepare("SELECT title, region, level, date, summary, url, source FROM policies ORDER BY date DESC")
    .all()
);

const stats = {
  persons: persons.length,
  cases: db.prepare("SELECT COUNT(*) n FROM cases WHERE status != 'offline'").get().n,
  companies: db.prepare("SELECT COUNT(*) n FROM companies").get().n,
  policies: db.prepare("SELECT COUNT(*) n FROM policies").get().n,
  lastRun: db.prepare("SELECT value FROM meta WHERE key='last_pipeline_run'").get()?.value ?? null,
};
j("stats.json", stats);
console.log("站点数据导出完成");
