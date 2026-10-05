#!/usr/bin/env node
/**
 * 头像本地化：GitHub 头像批量下载到 web/public/avatars/（国内访客不走 GitHub CDN），
 * 抖音头像由浏览器流程预先落盘（douyin-{sec24}.jpg），本脚本只回填 DB 路径。
 * 跑法：node pipeline/fetch-avatars.mjs
 */
import { execFileSync } from "node:child_process";
import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const AVATAR_DIR = path.join(ROOT, "web", "public", "avatars");
const db = new DatabaseSync(path.join(ROOT, "data", "fde.db"));
try {
  db.exec("ALTER TABLE persons ADD COLUMN avatar_file TEXT");
} catch {}

const rows = db
  .prepare(
    `SELECT id, login, avatar_url FROM persons
     WHERE platform='github' AND status IN ('candidate','approved') AND avatar_url IS NOT NULL AND avatar_file IS NULL`
  )
  .all();

let ok = 0;
for (const r of rows) {
  const rel = `/avatars/github-${r.login}.jpg`;
  const abs = path.join(ROOT, "web", "public", rel);
  try {
    execFileSync(
      "curl",
      ["-sL", "-m", "15", "-o", abs, "-A", "Mozilla/5.0", `${r.avatar_url}${r.avatar_url.includes("?") ? "&" : "?"}size=200`],
      { timeout: 20_000 }
    );
    const head = await import("node:fs").then((fs) => fs.readFileSync(abs).subarray(0, 4));
    const size = await import("node:fs").then((fs) => fs.statSync(abs).size);
    const isImg =
      (head[0] === 0xff && head[1] === 0xd8) ||
      head.toString("ascii").startsWith("\x89PNG") ||
      head.toString("ascii").startsWith("RIFF");
    if (isImg && size > 800) {
      db.prepare("UPDATE persons SET avatar_file=? WHERE id=?").run(rel, r.id);
      ok++;
    } else {
      await import("node:fs").then((fs) => fs.rmSync(abs, { force: true }));
    }
  } catch {
    /* 下一个 */
  }
}
console.log(`github avatars downloaded ${ok}/${rows.length}`);

// 抖音：浏览器流程已落盘，回填路径
let dy = 0;
for (const r of db.prepare("SELECT id, login FROM persons WHERE platform='douyin' AND status IN ('candidate','approved') AND avatar_file IS NULL").all()) {
  const sec = r.login.replace("douyin:", "");
  const rel = `/avatars/douyin-${sec.slice(0, 24)}.jpg`;
  try {
    await import("node:fs").then((fs) => fs.accessSync(path.join(ROOT, "web", "public", rel)));
    db.prepare("UPDATE persons SET avatar_file=? WHERE id=?").run(rel, r.id);
    dy++;
  } catch {}
}
console.log(`douyin avatars wired ${dy}`);
