#!/usr/bin/env node
/**
 * 第一人称自述检测：区分「自述是 FDE」与「提及 FDE」（质量线：提及≠自述，SPEC §2.2）
 *
 * 对 persons 中携带 github-code 证据但无档案自述佐证的条目：
 *   1. 从 sources_json 取 code 命中文件 → raw.githubusercontent 抓原文（README/站点源码）
 *   2. 抽取含 FDE 词的句子，用中英人称/动词模式判自述 vs 提及
 *   3. 自述 → 升级 candidate（证据=原文句摘录）；提及 → 维持 rejected
 *
 * 跑法：node pipeline/selfid.mjs            # 处理所有降级条目
 *       node pipeline/selfid.mjs --login xx # 单个试跑
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

const FDE_TOKEN_RE = /\b(fde|forward[- ]?deploy(ed|ment)?( engineer)?)\b|(前置|前线|前沿|前进)部署(工程师)?/i;

// 自述：人称/任职词与 FDE 【直接相邻】（≤10字符缓冲），避免文章标题误报
const SELFID_RE =
  /(我是|我就是|本人是|现[为任]|目前[是任]|职业[:：]|职位[:：]|岗位[:：]|担任|I\s*'?m|I\s+am|work\s+as)\s*(AI\s*|大模型|资深|高级|Senior|Lead|Staff|Senior\s|Lead\s|Staff\s|\S{0,10})?\s*(FDE|前置部署|前线部署|前沿部署)(工程师)?/i;
// 定义/转述/招聘/文章标题语境：一票否决
const MENTION_RE =
  /(是什么|是指|指的是|所谓|什么是|叫做|被称为|由来|崛起|增长|暴涨|风口|热潮|招聘|在招|岗位需求|人才缺口|全解析|介绍和入门|入门|指南|法则|认知|观察|浅析|浅谈|一文|盘点|全解|综述|hiring|what\s+is|refers\s+to|means|stands\s+for|trend|shortage|砸\s*\d|招\s*\d)/i;
// 自述后接雇主（FDE @ 字节 / FDE at 字节 / FDE｜阿里）——仅当同行出现任职第一人称词
const AT_RE = /(?:我是|现任|目前|I\s*'?m|I\s+am|work\s+as)[^\n。]{0,30}(?:FDE|前置部署|前线部署|前沿部署)(?:工程师)?\s*[@｜|/]\s*\S+/i;
// 明确的非大陆 location：直接不合格（仅中国大陆在岗）
const NON_CN_LOC_RE =
  /seattle|san francisco|new york|singapore|malaysia|taiwan|tokyo|japan|korea|london|berlin|vancouver|toronto|sydney|los angeles|bay area|usa|united states|西雅图|新加坡|马来西亚|日本|首尔|伦敦|台湾/i;

function classifySentence(sentence) {
  if (!FDE_TOKEN_RE.test(sentence)) return null;
  if (MENTION_RE.test(sentence)) return null;
  if (SELFID_RE.test(sentence) || AT_RE.test(sentence)) return "selfid";
  return null;
}

function extractSelfid(text) {
  const plain = text
    .replace(/<[^>]+>/g, " ")
    .replace(/[#*_`>~[\]()]/g, " ")
    .replace(/\s+/g, " ");
  const sentences = plain.split(/(?<=[。！？!?]|[.!?])\s+|(?:\s*[|｜·•]\s*)+/);
  for (const s of sentences) {
    const v = classifySentence(s);
    if (v) return s.trim().slice(0, 160);
  }
  return null;
}

async function fetchText(url) {
  try {
    const { stdout } = await run("curl", ["-sL", "-m", "12", "-A", "Mozilla/5.0", url], {
      timeout: 15_000,
      maxBuffer: 8 * 1024 * 1024,
    });
    return stdout ?? "";
  } catch {
    return "";
  }
}

function codeSourceUrls(sourcesJson) {
  try {
    const sources = JSON.parse(sourcesJson ?? "[]");
    return sources
      .filter((s) => s.type === "github-code" && s.url)
      .map((s) => {
        const m = s.url.match(/github\.com\/([^/]+\/[^/]+)\/blob\/HEAD\/(.+)$/);
        return m ? { repo: m[1], path: m[2], raw: `https://raw.githubusercontent.com/${m[1]}/HEAD/${m[2]}` } : null;
      })
      .filter(Boolean);
  } catch {
    return [];
  }
}

const single = process.argv.includes("--login");
const loginArg = single ? process.argv[process.argv.indexOf("--login") + 1] : null;

const targets = single
  ? db.prepare("SELECT * FROM persons WHERE login=?").all(loginArg)
  : db
      .prepare(
        `SELECT * FROM persons WHERE status='rejected'
         AND reject_reason LIKE '仓库内容提及 FDE 但档案无自述%'
         AND sources_json LIKE '%github-code%'`
      )
      .all();

console.log(`待自述检测：${targets.length} 条`);
const up = db.prepare(
  `UPDATE persons SET status='candidate', fde_evidence=?, reject_reason=NULL,
     sources_json=?, updated_at=datetime('now') WHERE id=?`
);
let rescued = 0, checked = 0;

for (const t of targets) {
  const codeUrls = codeSourceUrls(t.sources_json);
  let hit = null;
  for (const c of codeUrls.slice(0, 2)) {
    checked++;
    const raw = await fetchText(c.raw);
    if (!raw) continue;
    const sentence = extractSelfid(raw);
    if (sentence) {
      hit = { sentence, file: `${c.repo}/${c.path}` };
      break;
    }
    await sleep(250);
  }
  // 个人站原文也判一次（此前只做过关键词级）
  if (!hit) {
    const pages = codeSourceUrls(t.sources_json);
    const siteUrl = (JSON.parse(t.sources_json ?? "[]").find((s) => s.type === "github-pages") ?? {}).url;
    if (siteUrl) {
      const html = await fetchText(siteUrl);
      const sentence = html ? extractSelfid(html) : null;
      if (sentence) hit = { sentence, file: siteUrl };
    }
  }
  if (hit) {
    rescued++;
    let sources = [];
    try {
      sources = JSON.parse(t.sources_json ?? "[]");
    } catch {}
    sources.push({ type: "selfid-sentence", quote: hit.sentence, file: hit.file, collected_at: new Date().toISOString() });
    up.run(`原文自述：「${hit.sentence}」`, JSON.stringify(sources), t.id);
  }
  if (rescued % 10 === 0) console.log(`  已捞回 ${rescued}（检查 ${checked} 个文件）`);
}
console.log(`== done == 捞回 ${rescued}/${targets.length}（检查 ${checked} 个文件）`);
