#!/usr/bin/env node
/**
 * 召回补丁①：二次挖掘"无中国大陆信号"拒绝者中 location 空白的人。
 * 信号源（逐级加深）：仓库描述 → 置顶仓库 README（raw 直抓）→ github.io 个人站。
 * 挖到中国信号者升级为 candidate；挖不到的保持 rejected（不做无据推断，SPEC §2.2）。
 * 跑法：node pipeline/re-mine-rejects.mjs [--max-readme N]
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import { fileURLToPath } from "node:url";

const run = promisify(execFile);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MAX_README = (() => {
  const i = process.argv.indexOf("--max-readme");
  return i > -1 ? parseInt(process.argv[i + 1], 10) || 350 : 350;
})();
const db = new DatabaseSync(path.join(ROOT, "data", "fde.db"));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const now = () => new Date().toISOString();

const FDE_RE = /\b(fde|forward[- ]?deploy(ed|ment)?)\b|(前置|前沿|前进)部署/i;
const CN_RE =
  /china|chinese|beijing|shanghai|shenzhen|hangzhou|guangzhou|chengdu|nanjing|wuhan|xi[' ]?an|suzhou|hefei|changsha|chongqing|tianjin|北京|上海|深圳|杭州|广州|成都|南京|武汉|西安|苏州|合肥|长沙|重庆|天津|中国|大陆|国内/i;
const CJK_RE = /[\u4e00-\u9fff]/;

// 强中文信号（2026-10-04 收紧：单个 "China" 词不算，防欧美开发者误捞）：
//   短文本（仓库描述）：≥6 个汉字，或出现具体城市/中国（不含孤立的 china/chinese 词）
//   长文本（README/个人站）：≥30 个汉字，或「坐标/常驻/based in + 地点」，或中文联系块（微信/公众号）
const cjkCount = (s) => (s.match(/[\u4e00-\u9fff]/g) ?? []).length;
const CITY_ONLY_RE =
  /beijing|shanghai|shenzhen|hangzhou|guangzhou|chengdu|nanjing|wuhan|xi[' ]?an|suzhou|hefei|changsha|chongqing|tianjin|北京|上海|深圳|杭州|广州|成都|南京|武汉|西安|苏州|合肥|长沙|重庆|天津|中国|大陆/i;
const BASED_RE =
  /(?:坐标|常驻|所在|base[d]?\s*(?:in|out\s*of)|located\s*in)\s*[:：]?\s*(?:[\u4e00-\u9fff]{2,8}|beijing|shanghai|shenzhen|hangzhou|guangzhou|chengdu|suzhou|nanjing|wuhan)/i;
const CN_CONTACT_RE = /(?:微信|公众号|加微|vx)[:：]?\s*[\u4e00-\u9fa5a-zA-Z0-9_-]{3,}/i;
function strongCnShort(text) {
  if (!text) return false;
  if (cjkCount(text) >= 6) return true;
  return CITY_ONLY_RE.test(text);
}
function strongCnLong(text) {
  if (!text) return null;
  if (cjkCount(text) >= 30) return "中文文本密度达标";
  if (BASED_RE.test(text)) return "坐标/所在地表述";
  if (CN_CONTACT_RE.test(text)) return "中文联系块（微信/公众号）";
  return null;
}

const targets = db
  .prepare(
    `SELECT id, login, name, bio, company, followers, fde_evidence, sources_json FROM persons
     WHERE status='rejected' AND (reject_reason LIKE '无中国大陆信号%'
        OR reject_reason LIKE '仅 README/站点级弱中文信号%')
       AND (location IS NULL OR location='')`
  )
  .all();
console.log(`待二次挖掘：${targets.length} 人`);

async function ghApi(endpoint) {
  const { stdout } = await run("gh", ["api", endpoint], { maxBuffer: 16 * 1024 * 1024, timeout: 30_000 });
  return JSON.parse(stdout);
}

async function graphRepos(logins) {
  const out = new Map();
  const BATCH = 35;
  for (let i = 0; i < logins.length; i += BATCH) {
    const batch = logins.slice(i, i + BATCH);
    const query = `query { ${batch
      .map(
        (l, j) =>
          `u${j}: user(login: ${JSON.stringify(l)}) { login topRepos: repositories(first: 8, orderBy: {field: STARGAZERS, direction: DESC}) { nodes { name description stargazerCount pushedAt } } }`
      )
      .join(" ")} }`;
    try {
      const { stdout } = await run("gh", ["api", "graphql", "-f", `query=${query}`], { maxBuffer: 32 * 1024 * 1024 });
      const data = JSON.parse(stdout)?.data ?? {};
      for (let j = 0; j < batch.length; j++) if (data[`u${j}`]) out.set(batch[j], data[`u${j}`].topRepos?.nodes ?? []);
    } catch (e) {
      if (e.stdout) {
        try {
          const partial = JSON.parse(e.stdout);
          if (partial?.data)
            for (let j = 0; j < batch.length; j++)
              if (partial.data[`u${j}`]) out.set(batch[j], partial.data[`u${j}`].topRepos?.nodes ?? []);
        } catch {}
      }
    }
    await sleep(1300);
    if ((i / BATCH) % 4 === 0) console.log(`  repos ...${Math.min(i + BATCH, logins.length)}/${logins.length}`);
  }
  return out;
}

async function curlText(url) {
  try {
    const { stdout } = await run("curl", ["-sL", "-m", "10", "-A", "Mozilla/5.0", url], { timeout: 12_000, maxBuffer: 8 * 1024 * 1024 });
    return stdout;
  } catch {
    return "";
  }
}

const repoMap = await graphRepos(targets.map((t) => t.login));
const updStmt = db.prepare(
  `UPDATE persons SET status='candidate', china_signal=?, score=?, tier=?, reject_reason=NULL,
     sources_json=?, updated_at=? WHERE id=?`
);
const contactNote = db.prepare(
  `INSERT INTO person_contacts (person_id, other_json) VALUES (?, ?)
   ON CONFLICT(person_id) DO UPDATE SET other_json=excluded.other_json`
);

let kept = 0, readmeChecked = 0, scanned = 0;
for (const t of targets) {
  scanned++;
  // 一级：仓库描述（强标准）
  const repos = repoMap.get(t.login) ?? [];
  const signals = [];
  let readmeCandidates = [];
  for (const r of repos) {
    if (strongCnShort(r.description ?? "")) {
      signals.push(`仓库描述中文信号（${r.name}）`);
      readmeCandidates.push(r);
    }
  }
  // 二级：置顶仓库 README（只查前 2 个，控制量）
  if (signals.length === 0 && readmeChecked < MAX_README) {
    for (const r of repos.slice(0, 2)) {
      if (readmeChecked >= MAX_README) break;
      readmeChecked++;
      const md = await curlText(`https://raw.githubusercontent.com/${t.login}/${r.name}/HEAD/README.md`);
      const why = strongCnLong(md?.slice(0, 6000) ?? "");
      if (why) {
        signals.push(`README 中文信号-${why}（${r.name}）`);
        break;
      }
      await sleep(250);
    }
  }
  // 三级：github.io 个人站
  if (signals.length === 0) {
    const site = await curlText(`https://${t.login}.github.io/`);
    if (site.length > 200) {
      const why = strongCnLong(site.replace(/<[^>]+>/g, " ").slice(0, 6000));
      if (why) signals.push(`个人主页中文信号-${why}（${t.login}.github.io）`);
    }
    await sleep(200);
  }
  if (signals.length === 0) continue;

  kept++;
  const followers = t.followers ?? 0;
  const score =
    (FDE_RE.test(`${t.bio ?? ""} ${t.name ?? ""} ${t.company ?? ""}`) ? 15 : 12) +
    (followers < 10 ? 2 : followers < 50 ? 5 : followers < 200 ? 8 : followers < 1000 ? 12 : 15) +
    5;
  const tier = score >= 35 ? "S" : score >= 22 ? "A" : score >= 10 ? "B" : "";
  const sources = JSON.parse(t.sources_json ?? "[]");
  sources.push({ type: "repo-signal", note: signals.join("；"), collected_at: now() });
  updStmt.run(signals.join(","), score, tier, JSON.stringify(sources), now(), t.id);
  contactNote.run(t.id, JSON.stringify({ rechecked_at: now() }));
  if (kept % 10 === 0) console.log(`  已捞回 ${kept} 人（扫描 ${scanned}）`);
}
console.log(`== done == 捞回 ${kept}/${targets.length}（README 检查 ${readmeChecked} 次）`);
