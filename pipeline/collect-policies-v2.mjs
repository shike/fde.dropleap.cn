#!/usr/bin/env node
/**
 * 政策采集器 v2：大规模查询矩阵（城市×模板 + 国家级 + 区县 + 认证主题）→
 * cn.bing / DDG 双引擎检索 → 抓目标页（含 GB18030 解码）→ 相关性①AI主体②政策文种验证 →
 * region/level(五选一)/日期/摘要抽取 → 去重入库 policies。
 *
 * 跑法（后台长跑）：
 *   nohup node pipeline/collect-policies-v2.mjs > pipeline/collect-policies-v2.log 2>&1 &
 * 冒烟测试：
 *   SMOKE=1 node pipeline/collect-policies-v2.mjs
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import { fileURLToPath } from "node:url";

const runRaw = promisify(execFile);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const db = new DatabaseSync(path.join(ROOT, "data", "fde.db"));
db.exec(`
CREATE TABLE IF NOT EXISTS policies (
  id INTEGER PRIMARY KEY,
  title TEXT, region TEXT, level TEXT, date TEXT,
  summary TEXT, url TEXT, source TEXT,
  status TEXT DEFAULT 'candidate', collected_at TEXT
);
`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const nowIso = () => new Date().toISOString();
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";
const START = Date.now();
const MAX_MS = Number(process.env.MAX_MINUTES ?? 260) * 60_000; // ~4.3h
const TARGET_TOTAL = Number(process.env.TARGET ?? 105);
const SMOKE = !!process.env.SMOKE;

// ---------------- 查询矩阵 ----------------
const CITIES = [
  "北京", "上海", "深圳", "杭州", "广州", "苏州", "成都", "南京", "武汉", "西安",
  "合肥", "长沙", "重庆", "天津", "郑州", "青岛", "厦门", "宁波", "无锡", "济南",
  "沈阳", "贵阳", "海口", "乌鲁木齐", "福州", "昆明", "南昌", "石家庄", "太原", "长春",
  "哈尔滨", "大连", "兰州", "西宁", "银川", "南宁", "呼和浩特", "温州", "绍兴", "嘉兴",
  "金华", "珠海", "东莞", "佛山", "惠州", "常州", "徐州", "南通", "烟台", "洛阳",
  "襄阳", "宜昌", "绵阳",
];
const CITY_TEMPLATES = [
  (c) => `${c} 人工智能 政策 2026`,
  (c) => `${c} 大模型 政策 措施`,
  (c) => `${c} AI 人才 政策`,
  (c) => `${c} 智能体 产业 行动方案`,
  (c) => `${c} 人工智能 实施方案 通知`,
];
const NATIONAL_QUERIES = [
  "工信部 人工智能 政策", "工信部 大模型 政策 措施", "人工智能 产业政策 2026",
  "大模型 产业 政策", "AI+行动 意见", "人工智能+ 行动 意见 国务院",
  "国务院 人工智能 政策 措施", "国家数据局 人工智能 政策", "科技部 人工智能 政策",
  "发改委 人工智能 政策", "中央网信办 生成式人工智能", "算力 政策 2026",
  "数据要素 政策 2026", "AI 开源 政策", "具身智能 政策 2026", "人形机器人 政策",
  "人工智能 标准体系 指南", "人工智能 综合标准化体系", "未来产业 人工智能 政策",
  "人工智能 人才 部委 政策", "工信部 人工智能 进企业", "人工智能 先导区 政策",
];
const CERT_QUERIES = [
  "AI 认证 评价体系 发布", "人工智能 训练师 认证 标准", "提示词工程师 认证",
  "大模型 工程师 认证 评价", "人工智能 职业标准 发布", "FDE 认证 体系",
  "前沿部署工程师 认证 政策", "前置部署工程师 培训 工程", "人工智能 职称 评价",
  "人工智能 人才 培训 工程 启动", "工信部人才交流中心 人工智能 证书", "人工智能 岗位 能力 标准",
];
const DISTRICT_QUERIES = [
  "光谷 人工智能 政策", "东湖高新区 AI 政策", "张江 人工智能 政策", "前海 AI 政策",
  "南山区 人工智能 政策", "余杭区 AI 政策", "滨海新区 人工智能 政策", "海淀区 人工智能 政策",
  "中关村 人工智能 政策", "浦东新区 大模型 政策", "雄安新区 人工智能 政策", "贵安新区 算力 政策",
  "两江新区 人工智能 政策", "天府新区 AI 政策", "郑东新区 人工智能 政策", "经开区 人工智能 政策 措施",
  "高新区 大模型 政策 措施",
];

function buildQueries() {
  const qs = [];
  qs.push(...NATIONAL_QUERIES);
  for (const c of CITIES) qs.push(CITY_TEMPLATES[0](c));
  qs.push(...CERT_QUERIES);
  qs.push(...DISTRICT_QUERIES);
  for (let i = 1; i < CITY_TEMPLATES.length; i++)
    for (const c of CITIES) qs.push(CITY_TEMPLATES[i](c));
  return [...new Set(qs)];
}

// ---------------- 抓取（Buffer + 字符集解码） ----------------
async function fetchBuf(url) {
  try {
    const { stdout } = await runRaw(
      "curl", ["-sL", "-m", "15", "--compressed", "-A", UA, "-H", "Accept-Language: zh-CN,zh;q=0.9", url],
      { timeout: 20_000, maxBuffer: 12 * 1024 * 1024, encoding: "buffer" }
    );
    return stdout ?? null;
  } catch {
    return null;
  }
}
function decodeBuf(buf) {
  const head = buf.subarray(0, 4000).toString("latin1");
  const cs = head.match(/charset\s*=\s*["']?([\w-]+)/i)?.[1]?.toLowerCase() ?? "";
  const utf8 = buf.toString("utf8");
  const bad = (utf8.match(/\uFFFD/g) ?? []).length;
  if ((/gb/.test(cs) && !/utf/.test(cs)) || bad > 30) {
    try {
      const g = new TextDecoder("gb18030").decode(buf);
      if ((g.match(/\uFFFD/g) ?? []).length <= bad) return g;
    } catch {}
  }
  return utf8;
}

// ---------------- 解析 ----------------
// 清理实体/反斜杠/弯引号/控制字符（全部用 u 转义写法，避免源码混入字面控制符）
const CTRL_RE = new RegExp("[\\u0000-\\u0008\\u000b\\u000c\\u000e-\\u001f\\u007f]", "g");
const CURLY_RE = new RegExp("[\\u201c\\u201d\\u2018\\u2019]", "g");
const dec = (s) => (s ?? "")
  .replace(/&nbsp;/gi, " ")
  .replace(/&amp;/g, "&")
  .replace(/&lt;/g, "<")
  .replace(/&gt;/g, ">")
  .replace(/&quot;/g, '"')
  .replace(/&#39;/g, "'")
  .replace(/\\+/g, "")
  .replace(CTRL_RE, " ")
  .replace(CURLY_RE, '"')
  .replace(/\s+/g, " ")
  .trim();

const JUNK_TITLE = /(40[34]|50[03]|无法访问|页面不存在|找不到|请输入验证码|异常访问|just a moment|access denied|forbidden|安全验证|人机验证|哔哩哔哩|bilibili|b23\.tv|MG动画|\.docx|\.pptx?|_文库|报告下载|视频合集|番剧)/i;

function extractTitle(html) {
  const t = dec(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]);
  const og = dec(html.match(/<meta[^>]+property="og:title"[^>]+content="([^"]*)"/i)?.[1]);
  const h1 = dec(html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1]?.replace(/<[^>]+>/g, " "));
  const ok = (s) => s && s.length >= 8 && !JUNK_TITLE.test(s);
  if (ok(t)) return t;
  if (ok(og)) return og;
  if (ok(h1)) return h1;
  return "";
}
function extractDesc(html) {
  const m =
    html.match(/<meta[^>]+name="description"[^>]+content="([^"]*)"/i) ||
    html.match(/<meta[^>]+content="([^"]*)"[^>]+name="description"/i) ||
    html.match(/<meta[^>]+property="og:description"[^>]+content="([^"]*)"/i);
  return m ? dec(m[1]).slice(0, 200) : "";
}
function bodyText(html) {
  return html
    .replace(/<(script|style|noscript|svg|iframe)[^>]*>[\s\S]*?<\/\1>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#x?[0-9a-f]+;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}
function validDate(s) {
  if (!s) return null;
  const m = String(s).match(/(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (!m) return null;
  const y = +m[1], mo = +m[2], d = +m[3];
  if (y < 2020 || y > 2027 || mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  return `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}
function extractDate(html, body) {
  const metas = [
    /<meta[^>]+property="article:published_time"[^>]+content="([^"]+)"/i,
    /<meta[^>]+name="publishdate"[^>]+content="([^"]+)"/i,
    /<meta[^>]+name="publish_date"[^>]+content="([^"]+)"/i,
    /<meta[^>]+name="pubdate"[^>]+content="([^"]+)"/i,
    /<meta[^>]+name="publish"[^>]+content="([^"]+)"/i,
    /<meta[^>]+property="article:modified_time"[^>]+content="([^"]+)"/i,
    /"publishTime"[:"]\s*"?(\d{4}-\d{2}-\d{2})/,
    /"datePublished"[:"]\s*"?(\d{4}-\d{2}-\d{2})/,
  ];
  for (const m of metas) {
    const d = validDate(html.match(m)?.[1]);
    if (d) return d;
  }
  const scan = (body ?? bodyText(html)).slice(0, 5000);
  const raw = scan.match(/(20[2-6]\d)[-年/\.](\d{1,2})[-月/\.](\d{1,2})/)?.[0];
  if (!raw) return null;
  return validDate(raw.replace(/[年月]/g, "-").replace(/[日\.]/g, "-"));
}

// ---------------- 相关性 / 地域 / 级别 ----------------
const KW1 = /(人工智能|\bai\b|大模型|智能体|fde|前置部署|前沿部署|前线部署|生成式)/i;
const KW2 = /(政策|方案|措施|行动|计划|意见|培训|工程|认证|人才|补贴|专项|培育|通知|申报|征集|条例|办法|指南|规划|职称|标准|体系|白皮书)/i;

const DISTRICT_MAP = [
  ["光谷", "武汉"], ["东湖高新", "武汉"], ["东湖新技术", "武汉"],
  ["张江", "上海"], ["浦东新区", "上海"], ["前海", "深圳"],
  ["南山区", "深圳"], ["深圳南山", "深圳"], ["余杭", "杭州"],
  ["滨海新区", "天津"], ["中关村", "北京"], ["海淀区", "北京"],
  ["北京海淀", "北京"], ["雄安新区", "雄安"], ["贵安新区", "贵阳"],
  ["两江新区", "重庆"], ["天府新区", "成都"], ["郑东新区", "郑州"], ["西咸新区", "西安"],
];
const PROVINCES = [
  "河北", "山西", "辽宁", "吉林", "黑龙江", "江苏", "浙江", "安徽", "福建", "江西",
  "山东", "河南", "湖北", "湖南", "广东", "海南", "四川", "贵州", "云南", "陕西",
  "甘肃", "青海", "内蒙古", "广西", "西藏", "宁夏", "新疆",
];
const NATIONAL_WORDS = [
  "工业和信息化部", "工信部", "国务院", "国家发展改革委", "国家发改委", "发展改革委",
  "发改委", "科技部", "财政部", "教育部", "人力资源社会保障部", "人社部", "国家数据局",
  "中央网信办", "网信办", "国家能源局", "市场监管总局", "市监总局", "中办", "国办", "中共中央",
  "中国人民银行", "央行", "金融监管总局", "商务部", "民政部", "交通运输部", "文化和旅游部",
  "农业农村部", "广电总局", "知识产权局", "统计局", "民航局", "药监局", "卫生健康委", "卫健委",
  "中国人民银行等", "共青团中央", "全国总工会", "中科院", "工程院",
];

function regionFromText(text) {
  for (const [d, city] of DISTRICT_MAP) if (text.includes(d)) return { region: city, district: true };
  for (const c of CITIES) if (text.includes(c)) return { region: c, district: false };
  for (const p of PROVINCES) if (text.includes(p)) return { region: p, district: false };
  if (NATIONAL_WORDS.some((w) => text.includes(w)) || text.includes("全国"))
    return { region: "全国", district: false };
  return null;
}
function regionFromBody(body) {
  // 国家发文优先（新闻正文常带城市电头，避免误判）
  if (NATIONAL_WORDS.some((w) => body.includes(w))) return { region: "全国", district: false };
  return regionFromText(body);
}
// gov.cn 子域名 → 地域（标题提不到地域时的兜底，早于正文扫描）
const HOST_HINTS = [
  [/beijing|bjgov/, "北京"], [/shanghai|shgov/, "上海"], [/shenzhen|szft|szgov/, "深圳"],
  [/hangzhou|xiaoshan|yuhang/, "杭州"], [/suzhou/, "苏州"], [/guangzhou|gz\.gov/, "广州"],
  [/wuhan|wehdz/, "武汉"], [/chengdu/, "成都"], [/jinan/, "济南"], [/nanjing/, "南京"],
  [/xian|shaanxi/, "西安"], [/hefei/, "合肥"], [/changsha/, "长沙"], [/zhengzhou/, "郑州"],
  [/chongqing/, "重庆"], [/tianjin/, "天津"], [/qingdao/, "青岛"], [/xiamen/, "厦门"],
  [/ningbo/, "宁波"], [/wuxi/, "无锡"], [/changzhou/, "常州"], [/wenzhou/, "温州"],
  [/nanchang/, "南昌"], [/kunming/, "昆明"], [/fuzhou/, "福州"], [/haikou/, "海口"],
  [/shenyang/, "沈阳"], [/dalian/, "大连"], [/guiyang|guizhou/, "贵阳"], [/nanning|guangxi/, "南宁"],
  [/zhuhai/, "珠海"], [/dongguan/, "东莞"], [/foshan/, "佛山"], [/nantong/, "南通"],
  [/yantai/, "烟台"], [/luoyang/, "洛阳"], [/xiangyang/, "襄阳"], [/yichang/, "宜昌"],
  [/mianyang/, "绵阳"], [/hubei/, "湖北"], [/hunan/, "湖南"], [/anhui/, "安徽"], [/shandong/, "山东"],
];
function regionFromHost(host) {
  for (const [re, region] of HOST_HINTS) if (re.test(host)) return { region, district: false };
  return null;
}
const NATIONAL_RE = new RegExp(NATIONAL_WORDS.join("|"));
const CERT_RE = /(认证|证书|评价体系|评价证书|职业技能|职业标准|等级认定|职称|标准体系|行业标准|团体标准|培训体系|能力标准)/;
const COMPANY_RE = /(腾讯|阿里|华为|百度|字节|抖音|京东|美团|蚂蚁|商汤|科大讯飞|讯飞|火山引擎|阿里云|腾讯云|华为云|金山|用友|金蝶|浪潮|小米|中兴|360|昆仑万维|智谱|月之暗面|深度求索)/;

function pickLevel(region, district, title, body, host) {
  if (region !== "全国") return district ? "区县政策" : "城市政策";
  const hay = title + " " + body.slice(0, 600);
  const nationalIssuer = NATIONAL_RE.test(title) || NATIONAL_RE.test(body.slice(0, 800)) || /\.gov\.cn$/i.test(host);
  const certish = CERT_RE.test(hay);
  const companyish = COMPANY_RE.test(hay);
  if (certish && companyish) return "企业标准";
  if (certish && !nationalIssuer) return "行业标准";
  return "国家部委";
}

// ---------------- 检索引擎 ----------------
const BAD_HOST = /(bing\.|microsoft|msn\.|go\.micro|beian|baike\.baidu|baidu\.com|zhidao|zhihu|zhuanlan|tieba|weibo\.com|sogou|so\.com|toutiao|ixigua|douyin|kuaishou|openfde|wenku|docin|book118|taobao|tmall|jd\.com|aliyun\.com\/ask|hanyu|chazidian|zdic|guoxue|dict|cidian|hydcd|zi\.tools|dancihu|hao86|gushici|shici|360\.|html5\.qq|yuanbao|360kan|bilibili|b23\.tv|renrendoc|doc88|renshihu)/i;
function okUrl(u) {
  return (
    /^https?:\/\//.test(u) &&
    u.length <= 320 &&
    !BAD_HOST.test(u) &&
    !/\.(png|jpe?g|gif|css|js|ico|svg|pdf|zip|rar|7z|docx?|xlsx?|pptx?|apk|exe)([?#]|$)/i.test(u)
  );
}
// bing 风控降级时返回与查询无关的词典页：检索结果不含查询关键词即视为降级
function queryTokens(q) {
  return q.split(/\s+/).map((w) => w.trim()).filter((w) => /[\u4e00-\u9fff]{2,}/.test(w));
}
async function searchSo(q) {
  // 360 搜索：结果锚点带 data-mdurl 直链（质量好、对 curl 友好）
  const buf = await fetchBuf(`https://www.so.com/s?q=${encodeURIComponent(q)}`);
  if (!buf) return [];
  const html = decodeBuf(buf);
  return [...new Set([...html.matchAll(/data-mdurl="(https?:\/\/[^"]+)"/g)].map((m) => m[1].replace(/&amp;/g, "&")))].filter(okUrl);
}
async function searchBing(q) {
  const buf = await fetchBuf(`https://cn.bing.com/search?q=${encodeURIComponent(q)}&count=15&setlang=zh-hans&mkt=zh-CN`);
  if (!buf) return [];
  const html = decodeBuf(buf);
  const results = [...html.matchAll(/<h2[^>]*><a[^>]+href="(https?:\/\/[^"]+)"[^>]*>([\s\S]*?)<\/a>/gi)]
    .map((m) => ({ url: m[1], text: m[2].replace(/<[^>]+>/g, " ") }));
  const toks = queryTokens(q);
  // bing 风控降级时返回与查询无关的词典页：所有结果锚文本都不含查询词 → 视为降级
  if (results.length && toks.length && !results.some((r) => toks.some((w) => r.text.includes(w)))) return [];
  return [...new Set(results.map((r) => r.url).concat([...html.matchAll(/href="(https?:\/\/[^"]+)"/g)].map((m) => m[1])))].filter(okUrl);
}
async function searchDdg(q) {
  const buf = await fetchBuf(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(q)}`);
  if (!buf) return [];
  const html = decodeBuf(buf);
  const urls = [...html.matchAll(/uddg=([^&"']+)/g)]
    .map((m) => { try { return decodeURIComponent(m[1]); } catch { return ""; } })
    .filter(Boolean);
  return [...new Set(urls)].filter(okUrl);
}

// ---------------- 入库 ----------------
const seenUrls = new Set(db.prepare("SELECT url FROM policies WHERE url IS NOT NULL").all().map((r) => r.url));
const seenTitles = new Set(db.prepare("SELECT title FROM policies").all().map((r) => (r.title ?? "").slice(0, 25)));
const insert = db.prepare(
  `INSERT INTO policies (title, region, level, date, summary, url, source, status, collected_at)
   VALUES (?, ?, ?, ?, ?, ?, ?, 'candidate', ?)`
);
const dbTotal = () => db.prepare("SELECT COUNT(*) n FROM policies").get().n;
const sources = new Set();

let idx = 0, added = 0, lastAddedAt = Date.now(), consecutiveEmpty = 0;
const queries = buildQueries();
if (SMOKE) queries.length = 3;
const SKIP = Number(process.env.SKIP_QUERIES ?? 0);
idx = SKIP; // 断点续跑：跳过前 N 组已做过的查询
console.log(`== 政策采集 v2 == 查询 ${queries.length} 组（从 #${SKIP + 1} 起）| 库内 ${dbTotal()} | 目标 ${TARGET_TOTAL} | ${SMOKE ? "SMOKE" : "FULL"}`);

while (idx < queries.length) {
  const q = queries[idx];
  idx++;
  const total = dbTotal();
  if (total >= TARGET_TOTAL) { console.log(`已达目标 ${TARGET_TOTAL}（当前 ${total}），停止`); break; }
  if (Date.now() - START > MAX_MS) { console.log("时间预算耗尽，停止"); break; }

  // 25 分钟无新增 → 打乱剩余查询空间
  if (Date.now() - lastAddedAt > 25 * 60_000 && idx < queries.length) {
    const rest = queries.splice(idx);
    for (let i = rest.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [rest[i], rest[j]] = [rest[j], rest[i]];
    }
    queries.push(...rest);
    lastAddedAt = Date.now();
    console.log(`!! 25 分钟无新增，已打乱剩余 ${rest.length} 组查询`);
  }

  let urls = await searchSo(q);
  let engine = "so360";
  if (!urls.length) { urls = await searchBing(q); engine = "bing"; }
  if (!urls.length) { urls = await searchDdg(q); engine = "ddg"; }
  if (!urls.length) {
    consecutiveEmpty++;
    console.log(`[#${idx}] "${q}" 无结果（连续 ${consecutiveEmpty}）`);
    if (consecutiveEmpty >= 4) { await sleep(40_000); consecutiveEmpty = 0; }
    continue;
  }
  consecutiveEmpty = 0;

  let newHere = 0;
  for (const u of urls.slice(0, 7)) {
    if (seenUrls.has(u)) continue;
    const buf = await fetchBuf(u);
    if (!buf) continue;
    const html = decodeBuf(buf);
    if (html.length < 600) continue;
    const title = extractTitle(html);
    if (!title) { if (SMOKE) console.log(`    skip(无标题): ${u.slice(0, 90)}`); continue; }
    const tkey = title.slice(0, 25);
    if (seenTitles.has(tkey)) continue;

    const desc = extractDesc(html);
    const body = bodyText(html);
    let summary = desc.length >= 20 ? desc : body.slice(0, 160);
    const hay = title + " " + summary;
    if (!(KW1.test(hay) && KW2.test(hay))) {
      if (SMOKE) console.log(`    skip(不相关): ${title.slice(0, 60)}`);
      continue;
    }
    // 标题必须至少命中一类关键词，挡掉政府/门户首页（标题如「XX市经济和信息化委员会」）
    if (!(KW1.test(title) || KW2.test(title))) {
      if (SMOKE) console.log(`    skip(标题无关): ${title.slice(0, 60)}`);
      continue;
    }
    let loc = regionFromText(title);
    let host = "";
    try { host = new URL(u).hostname.replace(/^www\./, ""); } catch {}
    if (!loc) loc = regionFromHost(host);
    if (!loc) loc = regionFromBody(body.slice(0, 4000));
    if (!loc) { if (SMOKE) console.log(`    skip(无地域): ${title.slice(0, 60)}`); continue; }

    const level = pickLevel(loc.region, loc.district, title, body, host);
    const date = extractDate(html, body);
    if (summary.length > 200) summary = summary.slice(0, 200);

    seenUrls.add(u);
    seenTitles.add(tkey);
    sources.add(host);
    insert.run(title.slice(0, 160), loc.region, level, date, summary, u, host, nowIso());
    added++; newHere++; lastAddedAt = Date.now();
    console.log(`  ✓ [#${idx}|${engine}] [${loc.region}/${level}] ${title.slice(0, 52)} | ${host} | ${date ?? "无日期"}`);
    await sleep(250 + Math.floor(Math.random() * 250));
  }
  console.log(`[#${idx}] "${q}" 引擎=${engine} 候选=${Math.min(urls.length, 7)} 新增=${newHere} 总数=${dbTotal()}`);
  await sleep(1500 + Math.floor(Math.random() * 600));
}

console.log(`== done == 本次新增 ${added}，政策库共 ${dbTotal()} 条，用时 ${Math.round((Date.now() - START) / 60000)} 分钟`);
console.log(`== 来源站点 ${sources.size} 个：${[...sources].join(", ")}`);
