#!/usr/bin/env node
/**
 * 案例链接核验：用 Bing（走本机代理）按标题搜真实文章 URL。
 * 找到 → 回写 url；找不到 → status='offline'（不上站，宁少毋错）。
 * 跑法：node pipeline/verify-case-urls.mjs
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
const PROXY = "http://127.0.0.1:7890";

const cases = db
  .prepare("SELECT id, title, url, source_url FROM cases WHERE status != 'offline'")
  .all();

// 标题里的来源注记（（知乎）等）去掉再搜
const cleanTitle = (t) => t.replace(/（[^）]*）/g, "").replace(/\s*—\s*[^—]*$/, "").trim();
const hostOf = (u) => { try { return new URL(u).hostname.replace(/^www\./, ""); } catch { return ""; } };

let fixed = 0, hidden = 0;
for (const c of cases) {
  const wantHost = hostOf(c.url || c.source_url); // 期望来源域
  const q = `"${cleanTitle(c.title)}"`;
  try {
    const { stdout } = await run(
      "curl",
      ["-sL", "-m", "15", "-x", PROXY, "-A", "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
       `https://www.bing.com/search?q=${encodeURIComponent(q)}&count=20&setlang=zh-hans`],
      { timeout: 20_000, maxBuffer: 4 * 1024 * 1024 }
    );
    // 解码 bing ck/a 跳转里的真实 URL
    const urls = new Set();
    for (const m of stdout.matchAll(/u=a1([A-Za-z0-9_-]+)/g)) {
      try {
        const b64 = m[1].replace(/-/g, "+").replace(/_/g, "/");
        const dec = Buffer.from(b64, "base64").toString("utf8");
        if (/^https?:\/\//.test(dec)) urls.add(dec.split("#")[0]);
      } catch {}
    }
    // 页面里也可能有直链
    for (const m of stdout.matchAll(/href="(https?:\/\/[^"]+)"/g)) {
      const u = m[1];
      if (/bing|microsoft|duckduckgo|msn\.com/.test(u)) continue;
      urls.add(u.split("#")[0]);
    }
    const all = [...urls].filter((u) => !/\.(png|jpg|css|js)$/i.test(u));
    const match = all.find((u) => wantHost && hostOf(u).endsWith(wantHost.split(".").slice(-2).join("."))) 
      ?? all.find((u) => { const h = hostOf(u); return h && ["zhihu.com","csdn.net","sohu.com","36kr.com","qq.com","163.com","ifeng.com","donews.com","53ai.com","eastmoney.com","indigox.me","hubwiz.com","jxxy.net","tencent.com"].some((d) => h.endsWith(d)); });
    if (match && match !== c.url) {
      db.prepare("UPDATE cases SET url=?, source_url=?, status='candidate' WHERE id=?").run(match, match, c.id);
      fixed++;
      console.log(`  ✓ ${cleanTitle(c.title).slice(0, 30)} → ${hostOf(match)}`);
    } else if (!match) {
      db.prepare("UPDATE cases SET status='offline' WHERE id=?").run(c.id);
      hidden++;
      console.log(`  ✗ 下线（找不到真链）: ${cleanTitle(c.title).slice(0, 30)}`);
    } else {
      console.log(`  = 未找到更优: ${cleanTitle(c.title).slice(0, 30)}`);
    }
  } catch (e) {
    console.error(`  [fail] ${cleanTitle(c.title).slice(0, 25)}: ${String(e.message).slice(0, 60)}`);
  }
  await sleep(2500);
}
console.log(`== done == 修正 ${fixed}，下线 ${hidden}`);
