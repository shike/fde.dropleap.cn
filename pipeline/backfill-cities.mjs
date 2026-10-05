#!/usr/bin/env node
/** 人物城市归一：location 字段 → 标准城市分类，写入 persons.city。可重复执行（只补空）。跑法：node pipeline/backfill-cities.mjs */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import { fileURLToPath } from "node:url";

const run = promisify(execFile);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const db = new DatabaseSync(path.join(ROOT, "data", "fde.db"));
try {
  db.exec("ALTER TABLE persons ADD COLUMN city TEXT");
} catch {}

const CITY_RULES = [
  ["北京", /beijing|北京/i], ["上海", /shanghai|上海/i], ["深圳", /shenzhen|深圳/i],
  ["杭州", /hangzhou|杭州/i], ["广州", /guangzhou|广州/i], ["苏州", /suzhou|苏州/i],
  ["成都", /chengdu|成都/i], ["南京", /nanjing|南京/i], ["武汉", /wuhan|武汉|光谷/i],
  ["西安", /xi[' ]?an|西安/i], ["合肥", /hefei|合肥/i], ["长沙", /changsha|长沙/i],
  ["重庆", /chongqing|重庆/i], ["天津", /tianjin|天津/i], ["郑州", /zhengzhou|郑州/i],
  ["青岛", /qingdao|青岛/i], ["厦门", /xiamen|厦门/i], ["宁波", /ningbo|宁波/i],
  ["无锡", /wuxi|无锡/i], ["济南", /jinan|济南/i], ["沈阳", /shenyang|沈阳/i],
  ["大连", /dalian|大连/i], ["福州", /fuzhou|福州/i], ["昆明", /kunming|昆明/i],
  ["香港", /hong ?kong|香港/i], ["台湾", /taiwan|台湾/i],
];
const PROVINCE_RULES = [
  ["杭州", /浙江|zhejiang/i], ["南京", /江苏|jiangsu/i], ["深圳", /广东|guangdong/i],
  ["成都", /四川|sichuan/i], ["武汉", /湖北|hubei/i], ["西安", /陕西|shaanxi/i],
  ["合肥", /安徽|anhui/i], ["长沙", /湖南|hunan/i], ["济南", /山东|shandong/i],
  ["郑州", /河南|henan/i],
];
const OVERSEAS_RE =
  /seattle|san francisco|new york|singapore|malaysia|tokyo|japan|korea|london|berlin|vancouver|toronto|sydney|los angeles|bay area|usa|u\.s|united states|germany|france|australia|canada|india|amsterdam|dubai|西雅图|新加坡|马来西亚|日本|首尔|伦敦|德国|法国|悉尼|多伦多|温哥华|海外|remote/i;
const CJK_RE = /[\u4e00-\u9fff]/;

function normalizeCity(location) {
  if (!location || !location.trim()) return "未填写";
  const loc = location.trim();
  for (const [city, re] of CITY_RULES) if (re.test(loc)) return city;
  for (const [city, re] of PROVINCE_RULES) if (re.test(loc)) return city;
  if (/china|chinese|中国大陆|中国|国内/i.test(loc) && !OVERSEAS_RE.test(loc)) return "未填写";
  if (OVERSEAS_RE.test(loc)) return "海外";
  if (CJK_RE.test(loc)) return "未填写";
  return "海外";
}

try {
  db.exec("CREATE INDEX IF NOT EXISTS idx_persons_city ON persons(city)");
} catch {}

const rows = db.prepare("SELECT id, location FROM persons WHERE city IS NULL OR city = ''").all();
const upd = db.prepare("UPDATE persons SET city=? WHERE id=?");
const counts = {};
for (const r of rows) {
  const city = normalizeCity(r.location);
  upd.run(city, r.id);
  counts[city] = (counts[city] ?? 0) + 1;
}
console.log(
  `归一完成 ${rows.length} 条：`,
  Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 12).map(([c, n]) => `${c} ${n}`).join("，")
);
