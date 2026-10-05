#!/usr/bin/env node
/**
 * 城市深挖：对 city='未填写' 的人物，抓 简介README / 个人站 / 仓库描述，用强坐标表述提取城市。
 * 强表述：坐标/常驻/所在/base in/located in + 城市，或 +86 手机号归属（不做号段归属，仅提取城市词）。
 * 跑法：node pipeline/mine-cities.mjs
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
const UA = "Mozilla/5.0";

const CITY_PATTERNS = [
  [/坐标[:：\s]*(北京|上海|深圳|广州|杭州|成都|南京|武汉|西安|苏州|合肥|长沙|重庆|天津|郑州|青岛|厦门|宁波|无锡|济南|沈阳|大连|福州|昆明|香港)/i, 1],
  [/常驻[:：\s]*(北京|上海|深圳|广州|杭州|成都|南京|武汉|西安|苏州|合肥|长沙|重庆|天津)/i, 1],
  [/(?:based|located)\s+in\s+(?:shenzhen|beijing|shanghai|hangzhou|guangzhou|chengdu|suzhou|nanjing|wuhan|xi[' ]?an|hefei|changsha)/i, 0],
  [/(北京|上海|深圳|广州|杭州|成都|南京|武汉|西安|苏州|合肥|长沙|重庆|天津)[\s·]*[|｜,，]?\s*(?:中国)?\s*$/im, 1],
];

function mineCity(text) {
  if (!text) return null;
  for (const [re, gi] of CITY_PATTERNS) {
    const m = text.match(re);
    if (m) {
      const hit = m[gi] ?? m[0];
      const city = String(hit).replace(/[^一-龥a-zA-Z ]/g, "").trim();
      if (city) return city.charAt(0).toUpperCase() + city.slice(1).replace(/^(Beijing|Shanghai|Shenzhen|Guangzhou|Hangzhou|Chengdu|Suzhou|Nanjing|Wuhan|Hefei|Changsha)$/i, (w) => ({ beijing: "北京", shanghai: "上海", shenzhen: "深圳", guangzhou: "广州", hangzhou: "杭州", chengdu: "成都", suzhou: "苏州", nanjing: "南京", wuhan: "武汉", hefei: "合肥", changsha: "长沙" }[w.toLowerCase()] ?? w));
    }
  }
  return null;
}

async function curl(url) {
  try {
    const { stdout } = await run("curl", ["-sL", "-m", "10", "-A", UA, url], { timeout: 12_000, maxBuffer: 6 * 1024 * 1024 });
    return stdout ?? "";
  } catch {
    return "";
  }
}

const targets = db
  .prepare("SELECT id, login FROM persons WHERE city = '未填写' AND platform = 'github'")
  .all();
console.log(`待深挖城市：${targets.length} 人`);
const upd = db.prepare("UPDATE persons SET city=?, updated_at=datetime('now') WHERE id=?");
let filled = 0;

for (const t of targets) {
  // 1. 简介仓库 README
  let text = await curl(`https://raw.githubusercontent.com/${t.login}/${t.login}/HEAD/README.md`);
  // 2. 个人站
  if (!text) text = await curl(`https://${t.login}.github.io/`);
  if (!text) { await sleep(250); continue; }
  const plain = text.replace(/<[^>]+>/g, " ").slice(0, 6000);
  const city = mineCity(plain);
  if (city) {
    upd.run(city, t.id);
    filled++;
    if (filled % 10 === 0) console.log(`  已补 ${filled}（${city}…）`);
  }
  await sleep(300);
}
console.log(`== done == 补上城市 ${filled}/${targets.length}`);
