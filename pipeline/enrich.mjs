#!/usr/bin/env node
/**
 * 信息加深（做透）：对每位候选/已收录人物抓取尽可能多的公开信息。
 * 合规（SPEC §6）：联系方式只写 person_contacts 表，Web 层永不读取、页面永不展示。
 *
 * GitHub 人物：
 *   1. public push 事件里的 commit author email（公开数据，很多人因此暴露真实邮箱）
 *   2. /social_accounts 公开社交链接
 *   3. 简介仓库/个人站 README 文本里的 邮箱/微信/公众号/QQ/手机号（正则）
 * 抖音人物：签名与抖音号里的联系方式（微信/公众号/合作vx）
 *
 * 跑法：node pipeline/enrich.mjs [--limit N]
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import { fileURLToPath } from "node:url";

const run = promisify(execFile);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const db = new DatabaseSync(path.join(ROOT, "data", "fde.db"));
const LIMIT = (() => {
  const i = process.argv.indexOf("--limit");
  return i > -1 ? parseInt(process.argv[i + 1], 10) || 9999 : 9999;
})();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function ghApi(endpoint) {
  try {
    const { stdout } = await run("gh", ["api", endpoint], { maxBuffer: 32 * 1024 * 1024, timeout: 30_000 });
    return JSON.parse(stdout);
  } catch {
    return null;
  }
}

async function fetchText(url) {
  try {
    const { stdout } = await run("curl", ["-sL", "-m", "10", "-A", "Mozilla/5.0", url], { timeout: 12_000, maxBuffer: 8 * 1024 * 1024 });
    return stdout ?? "";
  } catch {
    return "";
  }
}

// 联系方式正则（公开文本层面的挖掘）
const EMAIL_RE = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
const WECHAT_RE = /(?:微信|加微|weixin|wechat|vx|VX|WX|wx)\s*[:：?？]?\s*([a-zA-Z0-9_-]{5,24})/g;
const GZH_RE = /(?:公众号|微信公众号|微信公号|gzh|GZH)\s*[:：?？]?\s*([\u4e00-\u9fa5a-zA-Z0-9_-]{2,30})/g;
const QQ_RE = /(?:QQ|qq|扣扣)\s*[:：]?\s*(\d{5,12})/g;
const PHONE_RE = /(?:手机|电话|tel|联系)\s*[:：]?\s*(1[3-9]\d{9})/g;
const noreply = (e) => /users\.noreply\.github\.com|@users\.noreply/i.test(e);

function mineContacts(text) {
  const out = { emails: [], wechat: [], gzh: [], qq: [], phone: [] };
  if (!text) return out;
  for (const m of text.matchAll(EMAIL_RE)) if (!noreply(m[0])) out.emails.push(m[0].toLowerCase());
  for (const m of text.matchAll(WECHAT_RE)) out.wechat.push(m[1]);
  for (const m of text.matchAll(GZH_RE)) out.gzh.push(m[1]);
  for (const m of text.matchAll(QQ_RE)) out.qq.push(m[2] ?? m[1]);
  for (const m of text.matchAll(PHONE_RE)) out.phone.push(m[1]);
  return out;
}

const uniq = (a) => [...new Set(a)].slice(0, 8);

// ---------- GitHub 人物 ----------
const ghPersons = db
  .prepare(
    `SELECT p.id, p.login, p.bio, p.name, pc.blog, pc.twitter, pc.other_json
     FROM persons p LEFT JOIN person_contacts pc ON pc.person_id = p.id
     WHERE p.platform='github' AND p.status IN ('candidate','approved')
     LIMIT ?`
  )
  .all(LIMIT);
console.log(`GitHub 人物：${ghPersons.length}`);

let ghEmailHits = 0, ghSocialHits = 0, ghContactHits = 0;
for (const p of ghPersons) {
  const found = { emails: [], wechat: [], gzh: [], qq: [], phone: [], socials: {} };
  // 1. commit email（public push 事件）
  const events = await ghApi(`/users/${p.login}/events/public?per_page=100`);
  if (Array.isArray(events)) {
    for (const ev of events) {
      for (const c of ev?.payload?.commits ?? []) {
        if (c.author?.email && !noreply(c.author.email)) found.emails.push(c.author.email.toLowerCase());
      }
    }
  }
  await sleep(120);
  // 2. 公开社交账号
  const socials = await ghApi(`/users/${p.login}/social_accounts`);
  if (socials && Array.isArray(socials) && socials.length) {
    found.socials = socials.map((s) => ({ provider: s.provider, url: s.url }));
    ghSocialHits++;
  }
  await sleep(120);
  // 3. 简介仓库 README（code 命中文件优先，其次 profile README）
  let readme = "";
  const srcs = db.prepare("SELECT sources_json FROM persons WHERE id=?").get(p.id)?.sources_json ?? "[]";
  try {
    const sources = JSON.parse(srcs);
    const codeSrc = sources.find((s) => s.type === "github-code" && s.url);
    if (codeSrc) {
      const m = codeSrc.url.match(/github\.com\/([^/]+\/[^/]+)\/blob\/HEAD\/(.+)$/);
      if (m) readme = await fetchText(`https://raw.githubusercontent.com/${m[1]}/HEAD/${m[2]}`);
    }
    if (!readme) readme = await fetchText(`https://raw.githubusercontent.com/${p.login}/${p.login}/HEAD/README.md`);
  } catch {}
  const mined = mineContacts(readme);
  found.emails.push(...mined.emails);
  found.wechat.push(...mined.wechat);
  found.gzh.push(...mined.gzh);
  found.qq.push(...mined.qq);
  found.phone.push(...mined.phone);
  // 简介字段里也可能有
  const bioMined = mineContacts(p.bio ?? "");
  found.emails.push(...bioMined.emails);
  found.wechat.push(...bioMined.wechat);
  found.gzh.push(...bioMined.gzh);

  found.emails = uniq(found.emails);
  found.wechat = uniq(found.wechat);
  found.gzh = uniq(found.gzh);
  found.qq = uniq(found.qq);
  found.phone = uniq(found.phone);
  if (found.emails.length) ghEmailHits++;
  if (Object.keys(found.socials).length || found.wechat.length || found.gzh.length || found.qq.length || found.phone.length) ghContactHits++;

  const prevOther = (() => {
    try {
      return JSON.parse(p.other_json ?? "{}");
    } catch {
      return {};
    }
  })();
  db.prepare(
    `INSERT INTO person_contacts (person_id, email, blog, twitter, other_json) VALUES (?,?,?,?,?)
     ON CONFLICT(person_id) DO UPDATE SET
       email=COALESCE(excluded.email, person_contacts.email),
       blog=COALESCE(excluded.blog, person_contacts.blog),
       twitter=COALESCE(excluded.twitter, person_contacts.twitter),
       other_json=json(excluded.other_json)`
  ).run(
    p.id,
    found.emails[0] ?? null,
    p.blog ?? null,
    p.twitter ?? null,
    JSON.stringify({
      ...prevOther,
      emails_extra: found.emails.slice(1),
      wechat: found.wechat,
      gongzhonghao: found.gzh,
      qq: found.qq,
      phone: found.phone,
      socials: found.socials,
      enriched_at: new Date().toISOString(),
    })
  );
  if ((ghEmailHits + ghContactHits) % 20 === 0) console.log(`  ...${p.login}`);
}
console.log(`GitHub 加深完成：commit/README 邮箱 ${ghEmailHits} 人，社交/微信/公众号 ${ghContactHits} 人`);

// ---------- 抖音人物 ----------
const dyPersons = db
  .prepare(
    `SELECT p.id, p.login, p.name, p.bio FROM persons p
     WHERE p.platform='douyin' AND p.status IN ('candidate','approved') LIMIT ?`
  )
  .all(LIMIT);
let dyHits = 0;
for (const p of dyPersons) {
  const text = `${p.name ?? ""} ${p.bio ?? ""}`;
  const mined = mineContacts(text);
  const row = db.prepare("SELECT douyin, other_json FROM person_contacts WHERE person_id=?").get(p.id);
  const prevOther = (() => {
    try {
      return JSON.parse(row?.other_json ?? "{}");
    } catch {
      return {};
    }
  })();
  const hasAny = mined.emails.length || mined.wechat.length || mined.gzh.length || mined.qq.length || mined.phone.length;
  if (hasAny) {
    dyHits++;
    db.prepare(
      `UPDATE person_contacts SET email=COALESCE(email, ?), other_json=json(?) WHERE person_id=?`
    ).run(
      mined.emails[0] ?? null,
      JSON.stringify({
        ...prevOther,
        emails_extra: mined.emails.slice(1),
        wechat: mined.wechat,
        gongzhonghao: mined.gzh,
        qq: mined.qq,
        phone: mined.phone,
        enriched_at: new Date().toISOString(),
      }),
      p.id
    );
  }
}
console.log(`抖音加深完成：签名含联系方式 ${dyHits}/${dyPersons.length}`);
console.log(`== done ==（全部只入 person_contacts，前端不展示）`);
