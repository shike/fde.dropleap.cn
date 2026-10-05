#!/usr/bin/env node
/**
 * pending 池强证据验证：用「commit 邮箱域名」和「README 联系块」把推断级中国大陆信号坐实。
 *
 * 信号强度（≥1 即可升级 candidate）：
 *   A. commit author email 为中国个人邮箱域（qq/163/126/foxmail/sina）——近乎实锤
 *   B. commit author email 为中国科技企业邮箱域（bytedance/alibaba/tencent/…）——实锤
 *   C. README 出现 +86 手机号，或「微信/公众号 + 中文昵称」联系块
 * 全部不中 → 维持 pending（宁缺毋滥，质量线不降）。
 *
 * 跑法：node pipeline/validate-pending.mjs
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

const CN_PERSONAL_DOMAIN = /@(qq|163|126|foxmail|sina|sohu|aliyun)\.com$/i;
const CN_CORP_DOMAIN =
  /@(bytedance|alibaba-inc|alipay|tencent|meituan|baidu|jd|xiaomi|huawei|iflytek|zhipuai|zhipu\.ai|moonshot|deepseek|minimax|stepfun|senseTIME|sensetime|netease|djicorp|manycore|kuaishou|ideogram|virtaigroup|4paradigm)\.(com|cn|ai)$/i;
const PHONE86_RE = /(?:\+?86[-\s]?)?1[3-9]\d{9}/;
const CN_CONTACT_RE = /(?:微信|公众号|加微|vx)[:：]?\s*[\u4e00-\u9fa5a-zA-Z0-9_-]{3,}/;

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

const targets = db
  .prepare("SELECT id, login, name, bio, china_signal, sources_json FROM persons WHERE status='pending'")
  .all();
console.log(`待验证：${targets.length} 条`);

const promote = db.prepare(
  `UPDATE persons SET status='candidate', china_signal=?, sources_json=?, score=max(score, 20),
     tier=CASE WHEN score>=35 THEN 'S' WHEN score>=22 THEN 'A' ELSE 'B' END,
     reject_reason=NULL, updated_at=datetime('now') WHERE id=?`
);
let promoted = 0, checked = 0;

for (const t of targets) {
  checked++;
  let signal = null;
  // A/B. commit 邮箱域名
  const events = await ghApi(`/users/${t.login}/events/public?per_page=100`);
  if (Array.isArray(events)) {
    const emails = new Set();
    for (const ev of events) for (const c of ev?.payload?.commits ?? []) if (c.author?.email) emails.add(c.author.email.toLowerCase());
    for (const e of emails) {
      if (CN_CORP_DOMAIN.test(e)) { signal = `中国企业邮箱 commit 记录（${e.replace(/^[^@]*/, "***")}）`; break; }
      if (CN_PERSONAL_DOMAIN.test(e)) { signal = `中国个人邮箱 commit 记录（${e.replace(/^[^@]*/, "***")}）`; break; }
    }
  }
  await sleep(150);
  // C. 简介 README 联系块
  if (!signal) {
    const md = await fetchText(`https://raw.githubusercontent.com/${t.login}/${t.login}/HEAD/README.md`);
    if (md) {
      const head = md.slice(0, 5000);
      if (PHONE86_RE.test(head)) signal = "README 含 +86 手机号";
      else if (CN_CONTACT_RE.test(head)) signal = "README 含中文联系块（微信/公众号）";
    }
    await sleep(220);
  }
  if (!signal) continue;
  promoted++;
  let sources = [];
  try { sources = JSON.parse(t.sources_json ?? "[]"); } catch {}
  sources.push({ type: "cn-evidence", note: signal, collected_at: new Date().toISOString() });
  promote.run(`${t.china_signal ?? ""},${signal}`.replace(/^,/, ""), JSON.stringify(sources), t.id);
  if (promoted % 10 === 0) console.log(`  已坐实 ${promoted}（检查 ${checked}）`);
}
console.log(`== done == 坐实 ${promoted}/${targets.length}`);
