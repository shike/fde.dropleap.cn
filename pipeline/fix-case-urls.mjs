#!/usr/bin/env node
/**
 * 案例 URL 闭环修复：Bing 关键词搜索 → 候选 URL → curl 抓 <title> → 关键词吻合才回写。
 * 吻合标准：标题含（FDE|前置部署|前线部署）且含该案例至少 1 个特征词。
 * 跑法：node pipeline/fix-case-urls.mjs
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
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

// 每条案例的检索词与特征词（人工指定，保证判断质量）
const HINTS = {
  "Demo 都跑通了": { q: "53AI Demo都跑通了 为什么企业反而开始抢FDE", tokens: ["抢FDE", "Demo"] },
  "徐汇首期": { q: "徐汇 FDE 专题培训 创智开讲 腾讯新闻", tokens: ["徐汇", "FDE"] },
  "FDE岗位量暴涨42倍": { q: "知乎 FDE岗位量暴涨42倍 AI落地", tokens: ["42倍", "FDE"] },
  "硅谷最抢手": { q: "36kr 硅谷最抢手的新岗位出现了", tokens: ["硅谷", "抢手"] },
  "FDE 岗位发布量": { q: "FDE 岗位 发布量 增长 800% 1522", tokens: ["800%", "1522"] },
  "岗位一年增长10倍": { q: "DoNews FDE岗位一年增长10倍", tokens: ["10倍", "DoNews"] },
  "工信部人才交流中心": { q: "FDE 评价证书 工信部人才交流中心 2688", tokens: ["工信部", "证书"] },
  "729%岗位爆发": { q: "FDE 729% 岗位爆发 193K 年薪", tokens: ["729%", "193K"] },
  "硅谷今年最火的岗位FDE": { q: "53AI 硅谷今年最火的岗位FDE 闷头干了三年", tokens: ["三年", "FDE"] },
  "派往前线的工程师": { q: "indigox 派往前线的工程师 FDE", tokens: ["派往前线", "indigox"] },
  "你需要一名前置部署工程师": { q: "hubwiz 你需要一名前置部署工程师吗", tokens: ["前置部署工程师"] },
  "PEC 2026": { q: "PEC 2026 AI创新者大会 FDE 实战营", tokens: ["PEC", "实战营"] },
  "Palantir 怎样从一个真实问题": { q: "腾讯云 FDE 方法 Palantir 真实问题 长出产品", tokens: ["Palantir", "长出产品"] },
  "一线驱动的组织进化": { q: "CSDN FDE模式 一线驱动 组织进化方法论", tokens: ["组织进化", "FDE"] },
  "1+N": { q: "科大讯飞 AI应用的美好时代 FDE 1+N 五层资产", tokens: ["讯飞", "1+N"] },
  "五个转向": { q: "CIO 的AI落地复盘 2026 五个转向", tokens: ["五个转向", "CIO"] },
  "能力模型、学习路线": { q: "FDE前线部署工程师 能力模型 学习路线 职业发展 CSDN", tokens: ["能力模型", "学习路线"] },
  "FDE崛起与AI": { q: "FDE前沿部署工程师 崛起 AI的业务落地深水区 掘金", tokens: ["崛起", "深水区"] },
  "驻场：FDE的工作方法": { q: "知乎 驻场 FDE的工作方法 反模式", tokens: ["驻场", "反模式"] },
  "全面了解FDE": { q: "一文带你全面了解FDE 让AI变成真正的生产力", tokens: ["全面了解FDE", "生产力"] },
  "高手怎么用AI": { q: "对谈课 高手怎么用AI 普通人怎么学AI 小宇宙", tokens: ["对谈课", "小宇宙"] },
  "源自Palantir的FDE": { q: "源自Palantir的FDE 前线部署工程师 AI to B 银弹", tokens: ["Palantir", "银弹"] },
  "FDE修炼之道": { q: "国产FDE修炼之道 AI办公前线 公众号", tokens: ["修炼之道", "FDE"] },
  "AI时代最贵的新岗位": { q: "FDE AI时代最贵的新岗位 工程师派进客户车间", tokens: ["最贵", "车间"] },
  "FDE工程师是什么": { q: "FDE工程师是什么 岗位定义与核心能力解析", tokens: ["岗位定义", "核心能力"] },
};

const keyFor = (title) => Object.keys(HINTS).find((k) => title.includes(k)) ?? null;

async function curl(url, { maxBuf = "4M" } = {}) {
  try {
    const { stdout } = await run(
      "curl",
      ["-sL", "-m", "15", "-A", UA, url],
      { timeout: 20_000, maxBuffer: 8 * 1024 * 1024 }
    );
    return stdout ?? "";
  } catch {
    return "";
  }
}

function decodeBingUrls(html) {
  const urls = [];
  for (const m of html.matchAll(/u=a1([A-Za-z0-9_-]+)/g)) {
    try {
      const dec = Buffer.from(m[1].replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
      if (/^https?:\/\//.test(dec)) urls.push(dec.split("#")[0]);
    } catch {}
  }
  for (const m of html.matchAll(/href="(https?:\/\/[^"]+)"/g)) {
    const u = m[1];
    if (/bing|microsoft|msn\.com|duckduckgo/.test(u)) continue;
    urls.push(u.split("#")[0]);
  }
  return [...new Set(urls)].filter((u) => !/\.(png|jpe?g|gif|css|js|ico)$/i.test(u) && !/finance\.sina|news\.qq\.com\/rain\/a\/20231018/.test(u));
}

function titleMatches(html, tokens) {
  const m = html.match(/<title>([^<]*)<\/title>/i);
  const title = (m?.[1] ?? "").toLowerCase();
  const hasFde = /(fde|前置部署|前线部署|前沿部署)/i.test(title);
  const hitToken = tokens.some((t) => title.includes(t.toLowerCase().replace("%", "％")) || title.includes(t.toLowerCase()));
  return { ok: hasFde && hitToken, title };
}

const cases = db.prepare("SELECT id, title, url FROM cases WHERE status='offline'").all();
let fixed = 0;
for (const c of cases) {
  const key = keyFor(c.title);
  if (!key) { console.log(`  - 无检索策略: ${c.title.slice(0, 28)}`); continue; }
  const { q, tokens } = HINTS[key];
  const html = await curl(`https://www.bing.com/search?q=${encodeURIComponent(q)}&count=15`);
  const candidates = decodeBingUrls(html).slice(0, 6);
  let found = null;
  for (const u of candidates) {
    const page = await curl(u);
    if (!page) continue;
    const { ok, title } = titleMatches(page, tokens);
    if (ok) { found = { u, title }; break; }
    await sleep(300);
  }
  if (found) {
    db.prepare("UPDATE cases SET url=?, source_url=?, status='candidate' WHERE id=?").run(found.u, found.u, c.id);
    fixed++;
    console.log(`  ✓ ${c.title.slice(0, 26)} → ${found.u.slice(0, 70)}`);
  } else {
    console.log(`  ✗ 仍未找到: ${c.title.slice(0, 26)}`);
  }
  await sleep(2200);
}
console.log(`== done == 找回 ${fixed}/${cases.length}`);
