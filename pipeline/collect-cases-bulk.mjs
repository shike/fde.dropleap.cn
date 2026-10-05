#!/usr/bin/env node
/**
 * 案例批量采集（供子 agent 长跑使用）：
 * - 自动生成 关键词矩阵（角色×主题×城市）
 * - cn.bing 检索 → 候选 URL → 抓页面：验证 FDE 标题 + 抽发布/更新日期 + 抓全文
 * - 无日期不入库（用户要求：每篇必须有更新日期）
 * - 可断点续跑（URL/标题去重基于库内已有数据）
 * 用法：node pipeline/collect-cases-bulk.mjs [轮次数，默认 999]
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { DatabaseSync } from "node:sqlite";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

const run = promisify(execFile);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const db = new DatabaseSync(path.join(ROOT, "data", "fde.db"));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

db.exec(`
CREATE TABLE IF NOT EXISTS cases (
  id INTEGER PRIMARY KEY,
  title TEXT, slug TEXT UNIQUE, type TEXT,
  url TEXT, person_id INTEGER, company_id INTEGER, summary TEXT,
  content TEXT, published_at TEXT, source_url TEXT,
  status TEXT DEFAULT 'candidate', collected_at TEXT
);
`);

const ROLES = ["FDE", "前置部署工程师", "前线部署工程师", "前沿部署工程师", "Forward Deployed Engineer"];
const TOPICS = [
  "落地", "实战", "复盘", "方法论", "案例", "转型", "面试", "薪资", "岗位", "认证",
  "培训", "成长", "技能", "工具", "知识库", "Agent", "大模型", "驻场", "交付", "客户现场",
  "一线", "指南", "详解", "踩坑", "经验", "趋势", "报告", "入门", "职责", "日常",
  "工作内容", "能力模型", "职业发展", "学习路线", "需要什么", "怎么成为",
  // —— 新增细分主题 ——
  "Skill", "MCP", "工作流", "RAG", "数字人", "智能体", "合同", "医疗", "教育", "金融",
  "工业", "制造", "零售", "电商", "政企", "出海", "提示词", "Copilot", "编程助手",
  "白皮书", "图谱", "全景", "避坑", "真相", "伪需求", "招聘", "跳槽", "升职", "求职",
  "简历", "offer", "大厂", "字节", "腾讯", "阿里", "百度", "华为", "讯飞", "Palantir",
  "Cursor", "Coze", "扣子", "Dify", "n8n", "大会", "实战营", "组织", "售前", "咨询",
];
const CITIES = ["北京", "上海", "深圳", "杭州", "广州", "苏州", "成都", "南京", "武汉", "西安", "合肥", "光谷"];
// 站点垂直检索：各站有独立结果池，命中率远高于泛搜
const VERTICALS = [
  "blog.csdn.net", "cloud.tencent.com", "developer.aliyun.com", "juejin.cn",
  "bbs.csdn.net", "infoq.cn", "blog.51cto.com", "www.sohu.com", "www.163.com",
  "www.eastmoney.com", "www.cnblogs.com", "segmentfault.com", "oschina.net",
  "developer.qq.com", "www.woshipm.com", "36kr.com",
  // —— 新增垂直 ——
  "www.53ai.com", "zhidx.com", "www.qbitai.com", "www.jiqizhixin.com", "www.leiphone.com",
  "www.huxiu.com", "www.tmtpost.com", "www.ifanr.com", "tech.sina.com.cn",
  "finance.sina.com.cn", "www.thepaper.cn", "www.yicai.com", "www.21jingji.com",
  "www.stcn.com", "news.qq.com", "www.donews.com", "www.ifeng.com", "www.indigox.me",
  "www.hubwiz.com", "www.zdnet.com.cn", "www.eet-china.com", "www.elecfans.com",
  "www.gongkong.com", "m.36kr.com", "www.jiemian.com",
];

function* queryMatrix() {
  // 1. 站点垂直 × 角色/主题
  for (const v of VERTICALS) {
    yield `site:${v} FDE`;
    yield `site:${v} 前置部署工程师`;
    yield `site:${v} 前沿部署工程师 落地`;
    yield `site:${v} 前线部署工程师`;
  }
  // 2. 角色 × 主题（泛搜补充）
  for (const role of ROLES) {
    for (const topic of TOPICS) yield `${role} ${topic}`;
  }
  // 3. 主题 × 修饰（多样性）
  for (const topic of ["落地", "转型", "实战", "交付", "驻场", "认证", "面试", "智能体", "MCP"]) {
    for (const mod of ["经验", "故事", "案例", "教程", "踩坑", "2026", "白皮书", "全景", "避坑"]) {
      yield `FDE ${topic} ${mod}`;
      yield `前置部署工程师 ${topic} ${mod}`;
    }
  }
  // 4. 城市 × 角色
  for (const role of ["FDE", "前置部署工程师", "前沿部署工程师"]) {
    for (const city of CITIES) yield `${city} ${role}`;
    yield `${role} 是什么`;
    yield `${role} 白皮书`;
    yield `${role} 年薪`;
    yield `${role} 抢人`;
  }
}

async function curl(url) {
  try {
    const { stdout } = await run("curl", ["-sL", "-m", "15", "-A", UA, url], { timeout: 20_000, maxBuffer: 8 * 1024 * 1024 });
    return stdout ?? "";
  } catch {
    return "";
  }
}

const FDE_TITLE_RE = /(fde|前置部署|前线部署|前沿部署|forward deployed)/i;
const ROLE_RE = /(前置部署|前线部署|前沿部署|forward deployed)/i;
const CRYPT_RE = /(全盘加密|文件级加密|磁盘加密|DM-?Crypt|File-?Based\s*Encryption|手机加密|加密原理|LUKS|BitLocker)/i;
const BAD_HOST = /bing|microsoft|msn|go\.microsoft|beian|miit|baike\.baidu|openfde\.net|zhihu\.com|zhuanlan/i;
const slug = (t) => createHash("md5").update(t).digest("hex").slice(0, 12);

function candidateUrls(html) {
  return [...new Set([...html.matchAll(/href="(https?:\/\/[^"]+)"/g)].map((m) => m[1]))]
    .filter((u) => !BAD_HOST.test(u))
    .filter((u) => !/\.(png|jpe?g|css|js|ico|svg|pdf)$/i.test(u))
    .slice(0, 8);
}

// 从页面抽发布/更新日期（用户要求：每篇必须有）
function extractDate(html) {
  const metas = [
    /<meta[^>]+property="article:published_time"[^>]+content="([^"]+)"/i,
    /<meta[^>]+name="publishdate"[^>]+content="([^"]+)"/i,
    /<meta[^>]+name="publish_date"[^>]+content="([^"]+)"/i,
    /<meta[^>]+name="pubdate"[^>]+content="([^"]+)"/i,
    /<meta[^>]+property="article:modified_time"[^>]+content="([^"]+)"/i,
    /<meta[^>]+name="dateUpdated"[^>]+content="([^"]+)"/i,
    /"publishTime"[:"]\s*"?(\d{4}-\d{2}-\d{2})/,
    /"datePublished"[:"]\s*"?(\d{4}-\d{2}-\d{2})/,
  ];
  for (const m of metas) {
    const v = html.match(m)?.[1];
    if (v && /20\d{2}/.test(v)) return v.slice(0, 10);
  }
  const textDate = html.match(/(20[2-6]\d)[-年/\.](\d{1,2})[-月/\.](\d{1,2})/);
  if (textDate) {
    const mm = textDate[2].padStart(2, "0");
    const dd = textDate[3].padStart(2, "0");
    return `${textDate[1]}-${mm}-${dd}`;
  }
  return null;
}

function extractTitle(html) {
  return html.match(/<title>([^<]*)<\/title>/i)?.[1]?.trim() ?? "";
}

function cleanText(fragment) {
  return fragment
    .replace(/<(script|style|svg)[^>]*>[\s\S]*?<\/\1>/gi, " ")
    .replace(/<\/(p|div|li|h[1-6]|pre|blockquote|tr|section)>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#x?[0-9a-f]+;/gi, " ")
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 1)
    .filter((l) => !/^(登录|注册|首页|下载安装|扫码|分享|上一篇|下一篇|相关文章|推荐阅读|广告|版权声明|©|Copyright)/i.test(l))
    .join("\n")
    .slice(0, 60_000);
}

const HOST_SELECTORS = [
  { host: "blog.csdn.net", sel: /<div[^>]*id="content_views"[^>]*>([\s\S]*?)<\/div>\s*(?:<div|<section|<footer)/i },
  { host: "juejin.cn", sel: /<article[^>]*>([\s\S]*?)<\/article>/i },
  { host: "cloud.tencent.com", sel: /<div[^>]*class="[^"]*J-articleContent[^"]*"[^>]*>([\s\S]*?)<\/div>\s*<div/i },
  { host: "news.qq.com", sel: /<div[^>]*class="[^"]*content-article[^"]*"[^>]*>([\s\S]*?)<\/div>/i },
  { host: "cnblogs.com", sel: /<div[^>]*id="cnblogs_post_body"[^>]*>([\s\S]*?)<div id="blog_post_info_block"/i },
  { host: "developer.aliyun.com", sel: /<div[^>]*class="[^"]*markdown-body[^"]*"[^>]*>([\s\S]*?)<\/div>\s*<div/i },
  { host: "github.io", sel: /<article[^>]*>([\s\S]*?)<\/article>/i },
];

function extractBody(html, url) {
  let host = "";
  try { host = new URL(url).hostname.replace(/^www\./, ""); } catch {}
  for (const { host: h, sel } of HOST_SELECTORS) {
    if (!host.endsWith(h)) continue;
    const m = html.match(sel);
    if (m) {
      const text = cleanText(m[1] ?? m[2] ?? "");
      if (text.length > 300) return text;
    }
  }
  const art = html.match(/<article[^>]*>([\s\S]*?)<\/article>/i);
  if (art) {
    const text = cleanText(art[1]);
    if (text.length > 300) return text;
  }
  return cleanText(html.replace(/<(script|style|nav|header|footer)[^>]*>[\s\S]*?(<\/\1>|$)/gi, " ")).slice(0, 40_000);
}

const seenUrls = new Set(db.prepare("SELECT url FROM cases WHERE url IS NOT NULL").all().map((r) => r.url));
const seenTitles = new Set(db.prepare("SELECT title FROM cases").all().map((r) => r.title.slice(0, 30)));
const insert = db.prepare(
  `INSERT INTO cases (title, slug, type, url, summary, content, published_at, source_url, status, collected_at)
   VALUES (?, ?, 'article', ?, ?, ?, ?, ?, 'candidate', ?)
   ON CONFLICT(slug) DO NOTHING`
);

let added = 0, skipped = 0;
const rounds = parseInt(process.argv[2] ?? "999", 10);
let round = 0;

for (const q of queryMatrix()) {
  round++;
  if (round > rounds) break;
  const total = db.prepare("SELECT COUNT(*) n FROM cases").get().n;
  if (total >= 500) { console.log(`已达 500+（${total}），停止`); break; }

  const candidates = [];
  for (const first of [1, 16]) { // 每查询抓 2 页结果
    const html = await curl(`https://cn.bing.com/search?q=${encodeURIComponent(q)}&count=15&first=${first}`);
    candidates.push(...[...new Set([...html.matchAll(/href="(https?:\/\/[^"]+)"/g)].map((m) => m[1]))]
      .filter((u) => !BAD_HOST.test(u))
      .filter((u) => !/\.(png|jpe?g|css|js|ico|svg|pdf)$/i.test(u))
      .slice(0, 8));
    await sleep(900);
  }
  console.log(`[r${round}] "${q}" → 候选 ${candidates.length}（库内 ${total}，本轮已加 ${added}）`);
  for (const u of candidates) {
    if (seenUrls.has(u)) continue;
    const page = await curl(u);
    if (!page) continue;
    const title = extractTitle(page);
    if (!title || !FDE_TITLE_RE.test(title)) { skipped++; continue; }
    if (!ROLE_RE.test(title) && CRYPT_RE.test(title)) { skipped++; continue; } // 排除全盘加密等同名干扰
    if (seenTitles.has(title.slice(0, 30))) { skipped++; continue; }
    const date = extractDate(page);
    if (!date) { skipped++; continue; } // 无更新日期不入库
    const body = extractBody(page, u);
    if (body.length < 400) { skipped++; continue; }
    seenUrls.add(u);
    seenTitles.add(title.slice(0, 30));
    const desc = page.match(/<meta[^>]+name="description"[^>]+content="([^"]*)"/i)?.[1]?.replace(/\s+/g, " ").slice(0, 180) ?? null;
    const info = insert.run(
      title.slice(0, 120), slug(title), u, desc, body, date, u, now()
    );
    if (info.changes > 0) {
      added++;
      console.log(`  ✓ [${date}] ${title.slice(0, 44)}（${body.length} 字）`);
    }
    await sleep(400);
  }
  await sleep(1500);
}

function now() { return new Date().toISOString(); }
const total = db.prepare("SELECT COUNT(*) n FROM cases").get().n;
console.log(`== done == 本轮新增 ${added}（跳过 ${skipped}），案例库共 ${total} 条`);
