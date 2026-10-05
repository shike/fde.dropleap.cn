#!/usr/bin/env node
/**
 * 案例 MEGA 采集器（在 collect-cases-bulk.mjs 之上扩展高密度源）：
 *   Phase W  fde-wiki（zhyese.github.io/fde-wiki，~95 页，日期来自 GitHub 提交历史映射）
 *   Phase C  CSDN 搜索 JSON API（so.csdn.net/api/v3/search，深分页，create_time 兜底日期）
 *   Phase J  掘金搜索 API（api.juejin.cn，cursor 分页，ctime 兜底日期）
 *   Phase S  SegmentFault 搜索页（SSR，可直接解析）
 *   Phase B  cn.bing 扩展查询矩阵（垂直站×主题 大幅扩充，每查询 2 页）
 * 质量闸与 bulk 一致且更严：
 *   - 标题须含 FDE/前置部署/前线部署/前沿部署/Forward Deployed
 *   - 纯 "FDE" 命中时排除全盘加密等同名干扰，且正文须含角色词或 AI 语境
 *   - 日期：优先从原站页面抽取（extractDate 扩展版），页面无日期时用原站 API 返回的日期兜底；两者皆无 → 不入库
 *   - 正文 ≥400 字；URL/标题/slug 三重去重；达到 500 自动停
 * 用法：node pipeline/collect-cases-mega.mjs [目标条数，默认 500]
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { DatabaseSync } from "node:sqlite";
import { createHash } from "node:crypto";
import path from "node:path";
import os from "node:os";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const run = promisify(execFile);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const db = new DatabaseSync(path.join(ROOT, "data", "fde.db"));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";
const TARGET = parseInt(process.argv[2] ?? "500", 10);

db.exec(`
CREATE TABLE IF NOT EXISTS cases (
  id INTEGER PRIMARY KEY,
  title TEXT, slug TEXT UNIQUE, type TEXT,
  url TEXT, person_id INTEGER, company_id INTEGER, summary TEXT,
  content TEXT, published_at TEXT, source_url TEXT,
  status TEXT DEFAULT 'candidate', collected_at TEXT
);
`);

const total0 = () => db.prepare("SELECT COUNT(*) n FROM cases").get().n;

async function diskOk() {
  try {
    const { stdout } = await run("df", ["-k", "/"]);
    const availKB = parseInt(stdout.split("\n")[1].trim().split(/\s+/)[3], 10);
    if (availKB < 2 * 1024 * 1024) { console.log("!! 磁盘不足 2GB，立即停止"); return false; }
    return true;
  } catch { return true; }
}

async function curl(url, { timeout = 15, jar = null, referer = null, http1 = false } = {}) {
  try {
    const args = ["-sL", "-m", String(timeout), "-w", "\n__HTTP__%{http_code}", "-A", UA];
    if (jar) args.push("-b", jar, "-c", jar);
    if (referer) args.push("-e", referer);
    if (http1) args.push("--http1.1");
    args.push(url);
    const { stdout } = await run("curl", args, { timeout: (timeout + 5) * 1000, maxBuffer: 16 * 1024 * 1024 });
    const idx = stdout.lastIndexOf("\n__HTTP__");
    const body = idx >= 0 ? stdout.slice(0, idx) : stdout;
    const code = idx >= 0 ? parseInt(stdout.slice(idx + 9), 10) : 0;
    return { body, code };
  } catch { return { body: "", code: 0 }; }
}

// 解析搜狗 /link 中转页里的真实 URL（window.location.replace("...") 或 url += '...' 片段）
function resolveSogouLink(html) {
  const rep = html.match(/window\.location\.replace\("([^"]+)"/)?.[1];
  if (rep && /^https?:\/\//.test(rep)) return rep;
  const parts = [...html.matchAll(/url\s*\+=\s*'([^']*)'/g)].map((m) => m[1]).join("");
  if (/^https?:\/\//.test(parts)) return parts;
  return null;
}

/* ---------- 质量闸 ---------- */
const FDE_TITLE_RE = /(fde|前置部署|前线部署|前沿部署|forward deployed)/i;
const ROLE_RE = /(前置部署|前线部署|前沿部署|forward deployed)/i;
const CRYPT_RE = /(全盘加密|文件级加密|磁盘加密|DM-?Crypt|File-?Based\s*Encryption|手机加密|加密原理|LUKS|BitLocker)/i;
const AI_CONTEXT_RE = /(AI|大模型|智能体|LLM|Agent|Palantir|OpenAI|落地|交付|驻场|客户|岗位|工程师)/i;
const BAD_HOST = /bing\.com|microsoft|msn\.com|go\.micro|beian|miit\.gov|baike\.baidu|openfde\.net|zhihu\.com|zhuanlan|so\.csdn\.net|github\.com\/zhyese|githubusercontent/i;
const slug = (t) => createHash("md5").update(t).digest("hex").slice(0, 12);

function cleanUrl(u) {
  try {
    const x = new URL(u);
    // mp.weixin.qq.com 的签名参数不能去掉（去掉后页面失效）
    if (!x.hostname.endsWith("mp.weixin.qq.com")) {
      x.search = "";
      x.hash = "";
    }
    return x.toString();
  } catch { return null; }
}

function extractTitle(html) {
  const t = html.match(/<title>([^<]*)<\/title>/i)?.[1]?.replace(/\s+/g, " ").trim();
  if (t) return t;
  // 微信等页面 <title> 为空，回退 og:title / msg_title
  return html.match(/<meta[^>]+property="og:title"[^>]+content="([^"]+)"/i)?.[1]?.replace(/\s+/g, " ").trim()
    ?? html.match(/var msg_title = '([^']*)'/)?.[1]?.trim()
    ?? "";
}

function extractDesc(html) {
  return (
    html.match(/<meta[^>]+name="description"[^>]+content="([^"]*)"/i)?.[1] ??
    html.match(/<meta[^>]+property="og:description"[^>]+content="([^"]*)"/i)?.[1] ??
    ""
  ).replace(/\s+/g, " ").slice(0, 180);
}

// 日期抽取（扩展版）：meta / datetime 属性 / JSON-LD / 页面文本；apiDate 为原站 API 提供的兜底
function extractDate(html, apiDate = null) {
  const metas = [
    /<meta[^>]+property="article:published_time"[^>]+content="([^"]+)"/i,
    /<meta[^>]+name="publishdate"[^>]+content="([^"]+)"/i,
    /<meta[^>]+name="publish_date"[^>]+content="([^"]+)"/i,
    /<meta[^>]+name="pubdate"[^>]+content="([^"]+)"/i,
    /<meta[^>]+property="article:modified_time"[^>]+content="([^"]+)"/i,
    /<meta[^>]+name="dateUpdated"[^>]+content="([^"]+)"/i,
    /datetime="(\d{4}-\d{2}-\d{2})/,
    /"datePublished"\s*:\s*"?(\d{4}-\d{2}-\d{2})/,
    /"publishTime"[:"]\s*"?(\d{4}-\d{2}-\d{2})/,
    /createTime\s*=\s*'(\d{4}-\d{2}-\d{2})/, // 微信文章
  ];
  for (const m of metas) {
    const v = html.match(m)?.[1];
    if (v && /20\d{2}/.test(v)) return v.slice(0, 10);
  }
  const textDate = html.match(/(20[2-6]\d)[-年/\.](\d{1,2})[-月/\.](\d{1,2})/);
  if (textDate) {
    return `${textDate[1]}-${textDate[2].padStart(2, "0")}-${textDate[3].padStart(2, "0")}`;
  }
  if (apiDate && /^\d{4}-\d{2}-\d{2}$/.test(apiDate)) return apiDate;
  return null;
}

function cleanText(fragment) {
  return fragment
    .replace(/<(script|style|svg|noscript)[^>]*>[\s\S]*?<\/\1>/gi, " ")
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
    .filter((l) => !/^(登录|注册|首页|下载安装|扫码|分享|上一篇|下一篇|相关文章|推荐阅读|广告|版权声明|©|Copyright|目录|展开|收起|赞|收藏|评论)/i.test(l))
    .join("\n")
    .slice(0, 60_000);
}

// 平衡扫描：从 startIdx（<div 起始处）找到配对的 </div>，避免嵌套截断
function balancedDiv(html, startIdx) {
  const re = /<div\b|<\/div\s*>/gi;
  re.lastIndex = startIdx;
  let depth = 0, m;
  while ((m = re.exec(html))) {
    if (m[0][1] !== "/") depth++;
    else { depth--; if (depth === 0) return html.slice(startIdx, m.index); }
  }
  return html.slice(startIdx, startIdx + 200_000);
}

function extractByDiv(html, attrRe) {
  const m = html.match(attrRe);
  if (!m) return null;
  return balancedDiv(html, m.index);
}

// 站点适配正文抽取（balanced 版，命中不到再退 <article> 再退全页）
function extractBody(html, url) {
  let host = "";
  try { host = new URL(url).hostname.replace(/^www\./, ""); } catch {}
  const container =
    host.endsWith("blog.csdn.net") || host.endsWith("bbs.csdn.net")
      ? extractByDiv(html, /<div[^>]*id="content_views"[^>]*>/i)
      : host.endsWith("github.io")
        ? extractByDiv(html, /<div[^>]*class="[^"]*vp-doc[^"]*"[^>]*>/i) ?? html.match(/<article[^>]*>([\s\S]*?)<\/article>/i)?.[1]
        : host.endsWith("cloud.tencent.com")
          ? extractByDiv(html, /<div[^>]*class="[^"]*J-articleContent[^"]*"[^>]*>/i)
          : host.endsWith("developer.aliyun.com")
            ? extractByDiv(html, /<div[^>]*class="[^"]*markdown-body[^"]*"[^>]*>/i)
            : host.endsWith("cnblogs.com")
              ? extractByDiv(html, /<div[^>]*id="cnblogs_post_body"[^>]*>/i)
              : host.endsWith("53ai.com")
                ? extractByDiv(html, /<div[^>]*class="[^"]*(?:article-content|detail-content|news-content|content)[^"]*"[^>]*>/i)
                : host.endsWith("segmentfault.com")
                  ? html.match(/<div[^>]*class="[^"]*article__content[^"]*"[^>]*>/i) ? extractByDiv(html, /<div[^>]*class="[^"]*(?:article__content|article-content)[^"]*"[^>]*>/i) : null
                  : null;
  if (container) {
    const text = cleanText(container);
    if (text.length > 300) return text;
  }
  const art = html.match(/<article[^>]*>([\s\S]*?)<\/article>/i);
  if (art) {
    const text = cleanText(art[1]);
    if (text.length > 300) return text;
  }
  return cleanText(html.replace(/<(script|style|nav|header|footer)[^>]*>[\s\S]*?(<\/\1>|$)/gi, " ")).slice(0, 40_000);
}

/* ---------- 入库 ---------- */
const seenUrls = new Set(db.prepare("SELECT url FROM cases WHERE url IS NOT NULL").all().map((r) => r.url));
const seenTitles = new Set(db.prepare("SELECT title FROM cases").all().map((r) => (r.title ?? "").slice(0, 30)));
const insert = db.prepare(
  `INSERT INTO cases (title, slug, type, url, summary, content, published_at, source_url, status, collected_at)
   VALUES (?, ?, 'article', ?, ?, ?, ?, ?, 'candidate', ?)
   ON CONFLICT(slug) DO NOTHING`
);

let added = 0, skipped = 0, fetched = 0, lastFetchFailed = false, lastFailCode = 0, lastFailUrl = '';
const CSDN_BLOCK_RE = /(安全验证|访问过于频繁|waf|verifyuser|antispider)/i;
const parked = { csdn: 0, juejin: 0, sf: 0, bing: 0, wiki: 0, weixin: 0, sogou: 0, q360: 0 };

// 返回 true=入库成功
async function processCandidate(rawUrl, { apiDate = null, apiTitle = null, src = "?" } = {}) {
  if (total0() >= TARGET) return false;
  const url = cleanUrl(rawUrl) ?? rawUrl;
  if (!/^https?:\/\//.test(url)) return false;
  if (BAD_HOST.test(url)) { skipped++; return false; }
  if (seenUrls.has(url)) { skipped++; return false; }
  const { body: page, code } = await curl(url);
  fetched++;
  lastFetchFailed = !page || code >= 400;
  if (lastFetchFailed) {
    lastFailCode = code; lastFailUrl = url;
    skipped++; return false;
  }
  lastFailCode = 0;
  if (src === "csdn" && CSDN_BLOCK_RE.test(page.slice(0, 3000))) {
    console.log("  !! CSDN 触发安全验证，停车 180s");
    parked.csdn = Date.now() + 180_000;
    return false;
  }
  let title = (extractTitle(page) || apiTitle || "").replace(/\s*-\s*53AI[\s\S]*$/, "").trim();
  if (!title || !FDE_TITLE_RE.test(title)) { skipped++; return false; }
  // 同名干扰排除 + 相关性复核
  const body = extractBody(page, url);
  if (!ROLE_RE.test(title) && CRYPT_RE.test(title)) { skipped++; return false; }
  if (!ROLE_RE.test(title) && !(ROLE_RE.test(body) || (AI_CONTEXT_RE.test(body) && !CRYPT_RE.test(body)))) { skipped++; return false; }
  if (seenTitles.has(title.slice(0, 30))) { skipped++; return false; }
  const date = extractDate(page, apiDate);
  if (!date) { skipped++; return false; } // 无日期不入库（红线）
  if (body.length < 400) { skipped++; return false; }
  seenUrls.add(url);
  seenTitles.add(title.slice(0, 30));
  const info = insert.run(
    title.slice(0, 120), slug(title), url, extractDesc(page) || null,
    body, date, url, new Date().toISOString()
  );
  if (info.changes > 0) {
    added++;
    console.log(`  ✓ [${src}|${date}] ${title.slice(0, 46)}（${body.length}字）库=${total0()}`);
    return true;
  }
  return false;
}

/* ============ Phase W: fde-wiki（日期来自 GitHub 提交历史映射） ============ */
async function phaseWiki() {
  console.log(`\n== Phase W: fde-wiki ==`);
  const rl = await fetch("https://api.github.com/repos/zhyese/fde-wiki/commits?per_page=100", { headers: { "User-Agent": UA } })
    .then((r) => r.json()).catch(() => []);
  if (!Array.isArray(rl) || rl.length === 0) { console.log("  无法获取提交列表，跳过"); return; }
  const fileDate = {};
  for (const c of rl) {
    if (Object.keys(fileDate).length === 0) {} // noop
    const detail = await fetch(`https://api.github.com/repos/zhyese/fde-wiki/commits/${c.sha}`, { headers: { "User-Agent": UA } })
      .then((r) => (r.ok ? r.json() : null)).catch(() => null);
    if (!detail) { await sleep(2000); continue; }
    const d = (detail.commit?.committer?.date ?? "").slice(0, 10);
    for (const f of detail.files ?? []) if (f.filename.endsWith(".md")) fileDate[f.filename] = fileDate[f.filename] ?? d;
    await sleep(600);
  }
  console.log(`  提交历史映射 ${Object.keys(fileDate).length} 个文件`);
  const pages = Object.keys(fileDate)
    .filter((f) => f.startsWith("docs/") && !/docs\/(index|tags)\.md$/.test(f))
    .map((f) => ({ file: f, name: f.replace(/^docs\//, "").replace(/\.md$/, ""), date: fileDate[f] }));
  for (const p of pages) {
    if (total0() >= TARGET) return;
    if (!(await diskOk())) process.exit(1);
    const pageUrl = `https://zhyese.github.io/fde-wiki/${p.name}`;
    const { body: page } = await curl(pageUrl);
    fetched++;
    if (!page) continue;
    const title = extractTitle(page).replace(/\s*\|\s*FDE-Wiki\s*$/, "").trim();
    if (!title || !FDE_TITLE_RE.test(title)) { skipped++; continue; }
    if (seenTitles.has(title.slice(0, 30))) { skipped++; continue; }
    const body = extractBody(page, pageUrl);
    if (body.length < 400) { skipped++; continue; }
    seenUrls.add(pageUrl);
    seenTitles.add(title.slice(0, 30));
    const info = insert.run(title.slice(0, 120), slug(title), pageUrl, extractDesc(page) || null,
      body, p.date, pageUrl, new Date().toISOString());
    if (info.changes > 0) {
      added++;
      console.log(`  ✓ [wiki|${p.date}] ${title.slice(0, 46)}（${body.length}字）库=${total0()}`);
    }
    await sleep(400);
  }
}

/* ============ Phase C: CSDN 搜索 API ============ */
const CSDN_QUERIES = [
  "FDE 工程师", "前沿部署工程师", "前线部署工程师", "前置部署工程师",
  "FDE AI 落地", "FDE 大模型", "FDE 智能体", "FDE Agent", "FDE 实战",
  "FDE 方法论", "FDE 薪资", "FDE 转型", "FDE 岗位", "FDE 驻场", "FDE 交付",
  "Forward Deployed Engineer", "FDE Palantir", "FDE 客户现场", "FDE 认证",
  "FDE 知识库", "FDE 提示词", "FDE 出海", "FDE 制造", "FDE 医疗", "FDE 金融",
];
async function phaseCsdn() {
  console.log(`\n== Phase C: CSDN 搜索 API ==`);
  const slice = CSDN_QUERIES.slice(cursors.csCursor, cursors.csCursor + 4);
  cursors.csCursor += slice.length;
  saveCursors();
  for (const q of slice) {
    if (total0() >= TARGET) return;
    if (Date.now() < parked.csdn) { console.log("  CSDN 停车中，跳过本查询"); continue; }
    let got = 0, emptyStreak = 0;
    for (let p = 1; p <= 6; p++) {
      if (total0() >= TARGET) return;
      if (Date.now() < parked.csdn) break;
      const { body, code } = await curl(`https://so.csdn.net/api/v3/search?q=${encodeURIComponent(q)}&t=blog&p=${p}&pageSize=20`);
      fetched++;
      if (!body || code >= 400) emptyStreak += 2;
      let items = [];
      try {
        const d = JSON.parse(body);
        items = d.result_vos ?? [];
        if (items.length === 0) break;
      } catch { emptyStreak += 2; }
      // 连续失败 → 判定被限流，停车 20 分钟
      for (const it of items) {
        if (Date.now() < parked.csdn) break;
        const u = (it.url_location ?? "").split("?")[0];
        if (!u || seenUrls.has(u)) continue;
        const t = (it.title ?? "").replace(/<\/?em>/g, "").trim();
        const ct = it.create_time ? new Date(parseInt(it.create_time, 10)).toISOString().slice(0, 10) : null;
        const ok = await processCandidate(u, { apiDate: ct, apiTitle: t, src: "csdn" });
        if (ok) { got++; emptyStreak = 0; }
        else if (lastFetchFailed && /csdn\.net/.test(lastFailUrl) && (lastFailCode === 0 || lastFailCode === 403 || lastFailCode === 503)) {
          emptyStreak++;
          if (emptyStreak === 3) console.log(`  CSDN 失败样本: code=${lastFailCode} ${lastFailUrl.slice(0, 80)}`);
        }
        else if (lastFetchFailed) { /* 404/非博客站失败不计入 WAF 熔断 */ }
        else emptyStreak = 0;
        await sleep(3000); // CSDN 限速保护（放慢防封）
      }
      if (emptyStreak >= 8) {
        console.log("  !! CSDN 连续失败，疑似限流，停车 20 分钟");
        parked.csdn = Date.now() + 15 * 60_000;
        break;
      }
      await sleep(2000);
    }
    console.log(`[CSDN] "${q}" 本查询入库 ${got}，库=${total0()}，跳过累计=${skipped}`);
  }
}

/* ============ Phase J: 掘金搜索 API ============ */
const JUEJIN_QUERIES = [
  "前沿部署工程师", "FDE 工程师", "FDE 前沿部署", "前线部署工程师", "前置部署工程师",
  "FDE AI 落地", "FDE 智能体", "Forward Deployed Engineer",
  "FDE Coze", "FDE Palantir", "AI FDE", "FDE 转型", "FDE 驻场", "FDE 交付",
  "FDE 岗位", "FDE 大模型", "FDE 知识库", "FDE 方法论", "FDE 实战", "FDE 落地",
];
async function phaseJuejin() {
  console.log(`\n== Phase J: 掘金搜索 API ==`);
  const slice = JUEJIN_QUERIES.slice(cursors.jjCursor, cursors.jjCursor + 3);
  cursors.jjCursor += slice.length;
  saveCursors();
  for (const q of slice) {
    if (total0() >= TARGET) return;
    let cursor = 0, got = 0;
    for (let p = 0; p < 8; p++) {
      if (total0() >= TARGET) return;
      if (Date.now() < parked.juejin) break;
      const { body } = await curl(`https://api.juejin.cn/search_api/v1/search?query=${encodeURIComponent(q)}&id_type=0&limit=20&cursor=${cursor}`);
      fetched++;
      let items = [], next = null;
      try {
        const d = JSON.parse(body);
        items = (d.data ?? []).map((x) => x.result_model).filter(Boolean);
        next = d.cursor ?? null;
      } catch { break; }
      if (items.length === 0) break;
      for (const it of items) {
        const id = it.article_id ?? it.article_info?.article_id;
        const info = it.article_info ?? {};
        const title = (info.title ?? "").trim();
        if (!id || !title) continue;
        const u = `https://juejin.cn/post/${id}`;
        if (seenUrls.has(u)) continue;
        const ct = info.ctime ? new Date(parseInt(info.ctime, 10) * 1000).toISOString().slice(0, 10) : null;
        const ok = await processCandidate(u, { apiDate: ct, apiTitle: title, src: "juejin" });
        if (ok) got++;
        await sleep(800);
      }
      if (next === null || next === cursor) break;
      cursor = next;
      await sleep(1000);
    }
    console.log(`[juejin] "${q}" 本查询入库 ${got}，库=${total0()}`);
  }
}

/* ============ Phase S: SegmentFault 搜索 ============ */
const SF_QUERIES = ["FDE 工程师", "前沿部署工程师", "前线部署工程师", "前置部署工程师", "FDE AI"];
async function phaseSf() {
  console.log(`\n== Phase S: SegmentFault 搜索 ==`);
  const slice = SF_QUERIES.slice(cursors.sfCursor, cursors.sfCursor + 2);
  cursors.sfCursor += slice.length;
  saveCursors();
  for (const q of slice) {
    if (total0() >= TARGET) return;
    for (let p = 1; p <= 3; p++) {
      if (Date.now() < parked.sf) break;
      const { body } = await curl(`https://segmentfault.com/search?q=${encodeURIComponent(q)}&page=${p}`);
      fetched++;
      const links = [...new Set([...body.matchAll(/href="(\/a\/\d+[^"]*)"/g)].map((m) => `https://segmentfault.com${m[1].split("?")[0]}`))];
      console.log(`[sf] "${q}" p${p} → ${links.length} 候选`);
      for (const u of links) {
        if (total0() >= TARGET) return;
        await processCandidate(u, { src: "segmentfault" });
        await sleep(800);
      }
      await sleep(1200);
    }
  }
}

/* ============ Phase B: cn.bing 扩展矩阵 ============ */
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
  "www.hubwiz.com", "www.infoq.com", "www.zdnet.com.cn", "www.csdn.net", "www.eet-china.com",
  "www.elecfans.com", "www.gongkong.com", "m.36kr.com", "www.bbtimes.com.cn", "www.jiemian.com",
  "huaweicloud.com", "www.modb.pro", "baijiahao.baidu.com", "www.toutiao.com",
  "www.jianshu.com", "sspai.com", "www.bilibili.com", "my.oschina.net", "www.fxbaogao.com",
  "www.leadge.com", "www.pmtoo.com", "www.woshipm.com", "www.niaogebits.com", "www.citnews.com",
  "www.199it.com", "www.iheima.com", "www.cyzone.cn", "www.pedaily.cn", "www.lieyunwang.com",
  "www.caict.ac.cn", "www.ccidthinktank.com", "www.cnii.com.cn", "www.cww.net.cn", "www.miit.gov.cn",
];
function* bingMatrix() {
  // 2. 角色 × 主题（泛搜优先：垂直站结果池此前已采过，重复率高）
  for (const role of ROLES) for (const topic of TOPICS) yield `${role} ${topic}`;
  for (const topic of ["落地", "转型", "实战", "交付", "驻场", "认证", "面试", "智能体", "MCP", "医疗", "金融", "工业"]) {
    for (const mod of ["经验", "故事", "案例", "教程", "踩坑", "2026", "白皮书", "全景", "图谱", "避坑"]) {
      yield `FDE ${topic} ${mod}`;
      yield `前置部署工程师 ${topic} ${mod}`;
    }
  }
  for (const role of ["FDE", "前置部署工程师", "前沿部署工程师"]) {
    for (const city of ["北京", "上海", "深圳", "杭州", "广州", "苏州", "成都", "南京", "武汉", "西安", "合肥", "光谷"]) {
      yield `${city} ${role}`;
    }
    yield `${role} 是什么`; yield `${role} 白皮书`; yield `${role} 年薪`; yield `${role} 抢人`;
  }
  // 1. 站点垂直 × 角色/主题（放最后）
  for (const v of VERTICALS) {
    yield `site:${v} FDE`;
    yield `site:${v} 前置部署工程师`;
    yield `site:${v} 前沿部署工程师 落地`;
    yield `site:${v} 前线部署工程师`;
  }
}
async function phaseBing() {
  console.log(`\n== Phase B: cn.bing 扩展矩阵 ==`);
  let consecutiveEmpty = 0;
  for (const q of bingMatrix()) {
    if (total0() >= TARGET) return;
    if (Date.now() < parked.bing) { await sleep(60_000); continue; }
    let got = 0;
    for (const first of [1, 16]) {
      const { body } = await curl(`https://cn.bing.com/search?q=${encodeURIComponent(q)}&count=15&first=${first}`);
      fetched++;
      const candidates = [...new Set([...body.matchAll(/href="(https?:\/\/[^"]+)"/g)].map((m) => m[1]))]
        .filter((u) => !BAD_HOST.test(u))
        .filter((u) => !/\.(png|jpe?g|css|js|ico|svg|pdf|zip|docx?|xlsx?)($|\?)/i.test(u))
        .slice(0, 10);
      if (candidates.length === 0) consecutiveEmpty++; else consecutiveEmpty = 0;
      for (const u of candidates) {
        if (total0() >= TARGET) return;
        await processCandidate(u, { src: "bing" });
        await sleep(400);
      }
      await sleep(1200);
    }
    if (consecutiveEmpty >= 8) { console.log("  bing 疑似被限流，停车 10 分钟"); parked.bing = Date.now() + 600_000; consecutiveEmpty = 0; }
    console.log(`[bing] "${q}" +${got}，库=${total0()}`);
  }
}

/* ============ Phase X: 搜狗微信文章搜索（高密度：公众号 FDE 文章池） ============ */
const WX_QUERIES = [
  "FDE 前沿部署", "FDE 工程师", "前沿部署工程师", "前线部署工程师", "前置部署工程师",
  "FDE 落地", "FDE 实战", "FDE Palantir", "FDE 认证", "FDE 培训", "FDE 招聘",
  "FDE 薪资", "FDE 智能体", "FDE 大模型", "FDE 知识库", "FDE 方法论", "FDE 转型",
  "Forward Deployed Engineer", "FDE 驻场", "FDE 交付", "AI FDE", "FDE 腾讯",
  "FDE 字节", "FDE 阿里", "FDE 华为", "FDE 是什么", "FDE 岗位", "FDE 复盘",
  "FDE 案例", "FDE 白皮书",
  // —— 扩充池：行业/场景/人群 ——
  "FDE 医疗", "FDE 金融", "FDE 制造", "FDE 教育", "FDE 零售", "FDE 政企", "FDE 出海",
  "FDE 特训营", "FDE 实战营", "FDE 就业", "FDE 跳槽", "FDE 简历", "FDE 面试",
  "FDE Skill", "FDE MCP", "FDE Agent", "FDE 提示词", "FDE RAG", "FDE 工作流",
  "FDE 合同", "FDE 客户成功", "FDE 售前", "FDE 咨询", "FDE 陪跑", "FDE 百万",
  "AI 落地工程师 驻场", "大模型 落地 工程师", "Palantir FDE 模式", "FDE 职业指南",
  "FDE 能力模型", "FDE 知识转移", "FDE 入门",
];
const WX_JAR = path.join(os.tmpdir(), "sogou-wx.jar");
// 持久游标（重启/轮次间不重复扫已耗尽的查询）
const CUR_FILE = path.join(ROOT, "pipeline", "mega-cursors.json");
let cursors = { wxCursor: 0, soCursor: 0, jjCursor: 0, csCursor: 0, sfCursor: 0, bingCursor: 0, q360Cursor: 0, ai53Cursor: 1 };
try { cursors = { ...cursors, ...JSON.parse(readFileSync(CUR_FILE, "utf8")) }; } catch {}
const saveCursors = () => { try { writeFileSync(CUR_FILE, JSON.stringify(cursors)); } catch {} };
const wxCursorRef = cursors;
async function phaseWeixin() {
  console.log(`\n== Phase X: 搜狗微信文章搜索 ==`);
  const slice = WX_QUERIES.slice(wxCursorRef.wxCursor, wxCursorRef.wxCursor + 2);
  wxCursorRef.wxCursor += slice.length;
  saveCursors();
  for (const q of slice) {
    if (total0() >= TARGET) return;
    if (Date.now() < parked.weixin) { console.log("  搜狗停车中，跳过"); break; }
    let got = 0;
    for (let p = 1; p <= 5; p++) {
      if (total0() >= TARGET) return;
      if (Date.now() < parked.weixin) break;
      const { body } = await curl(`https://weixin.sogou.com/weixin?type=2&query=${encodeURIComponent(q)}&page=${p}`,
        { jar: WX_JAR, http1: true });
      fetched++;
      if (!body || /antispider|验证码/.test(body.slice(0, 4000))) {
        console.log("  !! 搜狗微信出现验证码，停车 25 分钟");
        parked.weixin = Date.now() + 25 * 60_000;
        break;
      }
      const links = [...new Set([...body.matchAll(/href="(\/link\?url=[^"]+)"/g)].map((m) => m[1].replace(/&amp;/g, "&")))];
      if (links.length === 0) break;
      for (const lk of links) {
        if (total0() >= TARGET) return;
        if (Date.now() < parked.weixin) break;
        // 解析中转页 → 真实 mp.weixin URL（TLS 偶发重置，重试一次）
        let r = await curl(`https://weixin.sogou.com${lk}`, { jar: WX_JAR, referer: "https://weixin.sogou.com/", http1: true });
        fetched++;
        if (!r.body) {
          await sleep(4000);
          r = await curl(`https://weixin.sogou.com${lk}`, { jar: WX_JAR, referer: "https://weixin.sogou.com/", http1: true });
          fetched++;
        }
        const real = resolveSogouLink(r.body);
        if (!real) { skipped++; continue; }
        const ok = await processCandidate(real, { src: "weixin" });
        if (ok) got++;
        await sleep(3500);
      }
      await sleep(6000);
    }
    console.log(`[weixin] "${q}" 本查询入库 ${got}，库=${total0()}`);
  }
}

/* ============ Phase G: 搜狗网页搜索（第二引擎，扩大查询空间） ============ */
const SOGOU_QUERIES = [
  "FDE 工程师", "前沿部署工程师", "前线部署工程师", "前置部署工程师", "FDE 落地 案例",
  "FDE Palantir 方法论", "FDE 腾讯 认证", "FDE 培训 开班", "FDE 岗位 暴涨", "FDE 年薪",
  "FDE 白皮书 2026", "FDE 智能体 落地", "FDE 知识库", "FDE 转型 售前", "FDE 驻场 交付",
  "Forward Deployed Engineer 中国", "FDE 医疗", "FDE 金融", "FDE 制造", "FDE 教育",
  "FDE 出海", "FDE MCP", "FDE 提示词", "FDE 复盘 踩坑", "FDE 招聘 大厂", "FDE 实战营",
  "FDE 大会", "FDE 图谱", "FDE 全景", "FDE 伪需求",
];
const SO_JAR = path.join(os.tmpdir(), "sogou-web.jar");
async function phaseSogou() {
  console.log(`\n== Phase G: 搜狗网页搜索 ==`);
  const slice = SOGOU_QUERIES.slice(cursors.soCursor, cursors.soCursor + 3);
  cursors.soCursor += slice.length;
  saveCursors();
  for (const q of slice) {
    if (total0() >= TARGET) return;
    if (Date.now() < parked.sogou) { console.log("  搜狗停车中，跳过"); break; }
    let got = 0;
    for (let p = 1; p <= 3; p++) {
      if (Date.now() < parked.sogou) break;
      const { body } = await curl(`https://www.sogou.com/web?query=${encodeURIComponent(q)}&page=${p}`,
        { jar: SO_JAR, http1: true });
      fetched++;
      if (!body || /antispider|验证码/.test(body.slice(0, 4000))) {
        console.log("  !! 搜狗网页出现验证码，停车 20 分钟");
        parked.sogou = Date.now() + 20 * 60_000;
        break;
      }
      // 标题块里的直接链接 + /link 中转
      const blocks = [...body.matchAll(/<h3[^>]*class="vr-title[^"]*"[^>]*>([\s\S]*?)<\/h3>/g)].map((m) => m[1]);
      const direct = blocks.map((b) => b.match(/href="(https?:\/\/[^"]+)"/)?.[1]).filter(Boolean);
      const linked = blocks.map((b) => b.match(/href="(\/link\?url=[^"]+)"/)?.[1].replace(/&amp;/g, "&")).filter(Boolean);
      if (direct.length + linked.length === 0) break;
      for (const u of direct) {
        if (total0() >= TARGET) return;
        const ok = await processCandidate(u, { src: "sogou" });
        if (ok) got++;
        await sleep(600);
      }
      for (const lk of linked) {
        if (total0() >= TARGET) return;
        const r = await curl(`https://www.sogou.com${lk}`, { jar: SO_JAR, referer: "https://www.sogou.com/", http1: true });
        fetched++;
        const real = resolveSogouLink(r.body);
        if (!real) { skipped++; continue; }
        const ok = await processCandidate(real, { src: "sogou" });
        if (ok) got++;
        await sleep(800);
      }
      await sleep(2500);
    }
    console.log(`[sogou] "${q}" 本查询入库 ${got}，库=${total0()}`);
  }
}


/* ============ Phase 3: 360 搜索（第三引擎，独立索引） ============ */
const SO360_JAR = path.join(os.tmpdir(), "so360.jar");
const Q360_ROLES = ["FDE", "前沿部署工程师", "前线部署工程师", "前置部署工程师", "Forward Deployed Engineer"];
const Q360_TOPICS = ["落地", "实战", "复盘", "方法论", "案例", "转型", "面试", "薪资", "岗位", "认证", "培训", "知识库", "Agent", "智能体", "驻场", "交付", "踩坑", "指南", "白皮书", "全景", "图谱", "招聘", "跳槽", "升职", "医疗", "金融", "制造", "教育", "零售", "政企", "出海", "MCP", "Skill", "提示词", "Palantir", "腾讯", "阿里", "华为", "字节", "大会", "特训营", "是什么", "年薪", "客户现场", "售前", "工作流", "数字人", "合同", "Copilot"];
const Q360_QUERIES = [
  ...SOGOU_QUERIES,
  ...Q360_ROLES.flatMap((r) => Q360_TOPICS.map((t) => `${r} ${t}`)),
];
async function phase360() {
  console.log(`\n== Phase 3: 360 搜索 ==`);
  const slice = Q360_QUERIES.slice(cursors.q360Cursor ?? 0, (cursors.q360Cursor ?? 0) + 5);
  cursors.q360Cursor = (cursors.q360Cursor ?? 0) + slice.length;
  saveCursors();
  for (const q of slice) {
    if (total0() >= TARGET) return;
    if (Date.now() < parked.q360) { console.log("  360 停车中，跳过"); break; }
    let got = 0;
    for (let p = 1; p <= 3; p++) {
      if (Date.now() < parked.q360) break;
      const { body } = await curl(`https://www.so.com/s?q=${encodeURIComponent(q)}&page=${p}`, { jar: SO360_JAR });
      fetched++;
      if (!body || /验证码|antispider/.test(body.slice(0, 4000))) {
        console.log("  !! 360 出现验证码，停车 20 分钟");
        parked.q360 = Date.now() + 20 * 60_000;
        break;
      }
      const blocks = [...body.matchAll(/<h3[^>]*class="res-title[^"]*"[^>]*>([\s\S]*?)<\/h3>/g)].map((m) => m[1]);
      const direct = blocks.map((b) => b.match(/href="(https?:\/\/[^"]+)"/)?.[1]).filter((u) => u && !/so\.com|360\.cn|360kuai|ai\.so\.com/.test(u));
      const linked = blocks.map((b) => b.match(/href="(https?:\/\/www\.so\.com\/link\?[^"]+)"/)?.[1]).filter(Boolean);
      if (direct.length + linked.length === 0) break;
      for (const u of direct) {
        if (total0() >= TARGET) return;
        const ok = await processCandidate(u, { src: "360" });
        if (ok) got++;
        await sleep(500);
      }
      for (const lk of linked) {
        if (total0() >= TARGET) return;
        const r = await curl(lk, { jar: SO360_JAR, referer: "https://www.so.com/" });
        fetched++;
        const real = resolveSogouLink(r.body);
        if (!real) { skipped++; continue; }
        const ok = await processCandidate(real, { src: "360" });
        if (ok) got++;
        await sleep(700);
      }
      await sleep(2000);
    }
    console.log(`[360] "${q}" 本查询入库 ${got}，库=${total0()}`);
  }
}


/* ============ Phase F: 53AI FDE 专栏（高密度：61 页 × ~27 篇） ============ */
async function phase53ai() {
  console.log(`\n== Phase F: 53AI FDE 专栏 ==`);
  let zeroPages = 0;
  for (let p = (cursors.ai53Cursor ?? 1); p <= 61; p++) {
    if (total0() >= TARGET) return;
    const { body } = await curl(`https://www.53ai.com/news/zhinenghuagaizao?page=${p}`);
    fetched++;
    const links = [...new Set([...body.matchAll(/href="(\/news\/zhinenghuagaizao\/\d+\.html)"/g)].map((m) => `https://www.53ai.com${m[1]}`))];
    if (links.length === 0) { console.log(`  第 ${p} 页无文章链接，栏目扫描结束`); break; }
    let got = 0;
    for (const u of links) {
      if (total0() >= TARGET) return;
      const ok = await processCandidate(u, { src: "53ai" });
      if (ok) got++;
      await sleep(700);
    }
    console.log(`[53ai] page ${p} +${got}，库=${total0()}`);
    if (got === 0) { zeroPages++; if (zeroPages >= 4) { console.log("  连续4页0入库，提前结束栏目扫描"); break; } }
    else zeroPages = 0;
    cursors.ai53Cursor = p + 1;
    saveCursors();
  }
}


/* ============ Phase P: 人人都是产品经理站内搜索（SSR 可解析） ============ */
const WSP_QUERIES = ["FDE", "前沿部署工程师", "前线部署工程师", "前置部署工程师", "Forward Deployed Engineer", "FDE 落地", "FDE 方法论"];
async function phaseWsp() {
  console.log(`\n== Phase P: 人人都是产品经理 ==`);
  for (const q of WSP_QUERIES) {
    if (total0() >= TARGET) return;
    const { body } = await curl(`https://www.woshipm.com/?s=${encodeURIComponent(q)}`);
    fetched++;
    const links = [...new Set([...body.matchAll(/href="(https:\/\/www\.woshipm\.com\/[\w/-]+\.html)"/g)].map((m) => m[1]))];
    for (const u of links) {
      if (total0() >= TARGET) return;
      await processCandidate(u, { src: "woshipm" });
      await sleep(600);
    }
    await sleep(1200);
  }
}

/* ============ 主流程：轮询各源直至达标 ============ */
console.log(`== collect-cases-mega 启动 == 目标 ${TARGET}，当前 ${total0()} ==`);
const phases = [
  ["53ai", phase53ai],     // 高密度且无反爬，最优先
  ["csdn", phaseCsdn],     // 大池，风控敏感
  ["weixin", phaseWeixin], // 高密度公众号池（切片执行防验证码）
  ["sogou", phaseSogou],   // 第二引擎（切片执行）
  ["q360", phase360],      // 第三引擎（独立索引）
  ["wsp", phaseWsp],       // 产品经理社区（SSR）
  ["juejin", phaseJuejin],
  ["sf", phaseSf],
  ["bing", phaseBing],     // 池接近耗尽，垫底慢慢磨
];
for (let round = 1; round <= 40 && total0() < TARGET; round++) {
  if (!(await diskOk())) process.exit(1);
  for (const [name, fn] of phases) {
    if (total0() >= TARGET) break;
    if (!(await diskOk())) process.exit(1);
    try { await fn(); } catch (e) { console.log(`Phase ${name} 异常：${e.message}`); }
  }
  console.log(`\n-- round ${round} 完成：新增累计 ${added}，库=${total0()}，抓页=${fetched} --`);
}
console.log(`== done == 新增 ${added}（跳过 ${skipped}，抓页 ${fetched}），案例库共 ${total0()} 条`);
