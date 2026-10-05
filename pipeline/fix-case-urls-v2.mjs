#!/usr/bin/env node
/**
 * 案例真链重建 v2：直连 cn.bing 关键词搜索（返回直链）→ 候选 URL → 抓 <title> 关键词吻合才回写。
 * 跑法：node pipeline/fix-case-urls-v2.mjs
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

const HINTS = {
  "Demo 都跑通了": { q: "Demo都跑通了 为什么企业反而开始抢FDE", tokens: ["抢FDE", "Demo"] },
  "徐汇首期": { q: "徐汇 FDE 专题培训 创智开讲", tokens: ["徐汇", "FDE"] },
  "FDE岗位量暴涨42倍": { q: "FDE岗位量暴涨42倍 AI落地都在白忙", tokens: ["42倍", "白忙"] },
  "硅谷最抢手": { q: "硅谷最抢手的新岗位出现了 36氪", tokens: ["硅谷", "抢手"] },
  "FDE 岗位发布量": { q: "FDE 岗位 发布量 增长 800% 1522.73", tokens: ["800%", "1522"] },
  "岗位一年增长10倍": { q: "FDE岗位一年增长10倍 AI时代 前置部署工程师", tokens: ["增长10倍", "10倍"] },
  "工信部人才交流中心": { q: "FDE工程师 岗位定义 核心能力解析 工信部 2688", tokens: ["工信部", "2688"] },
  "729%岗位爆发": { q: "FDE 729% 岗位爆发 193K", tokens: ["729%", "193K"] },
  "硅谷今年最火的岗位FDE": { q: "硅谷今年最火的岗位FDE 闷头干了三年", tokens: ["最火", "三年"] },
  "派往前线的工程师": { q: "派往前线的工程师 FDE 为什么是AI落地时代最重要", tokens: ["派往前线", "最重要的职业"] },
  "你需要一名前置部署工程师": { q: "你需要一名前置部署工程师吗", tokens: ["前置部署工程师"] },
  "PEC 2026": { q: "PEC 2026 AI创新者大会 FDE 走到交付一线", tokens: ["PEC", "交付一线"] },
  "Palantir 怎样从一个真实问题": { q: "Palantir 怎样从一个真实问题长出产品 FDE 方法", tokens: ["长出产品", "Palantir"] },
  "一线驱动的组织进化": { q: "FDE模式 一线驱动的组织进化方法论", tokens: ["组织进化", "一线驱动"] },
  "1+N": { q: "AI应用的美好时代 科大讯飞 FDE 1+N", tokens: ["讯飞", "1+N"] },
  "五个转向": { q: "CIO的AI落地复盘 2026年五个转向", tokens: ["五个转向", "复盘"] },
  "能力模型、学习路线": { q: "FDE前线部署工程师 能力模型 学习路线 职业发展全解析", tokens: ["能力模型", "学习路线"] },
  "FDE崛起与AI": { q: "FDE 前沿部署工程师 崛起 AI的业务落地深水区", tokens: ["崛起", "深水区"] },
  "驻场：FDE的工作方法": { q: "驻场 FDE的工作方法 反模式 指南", tokens: ["驻场", "工作方法"] },
  "全面了解FDE": { q: "一文带你全面了解FDE 让AI变成真正的生产力", tokens: ["全面了解FDE", "生产力"] },
  "高手怎么用AI": { q: "高手怎么用AI 普通人怎么学AI 投资人如何投AI 对谈课", tokens: ["高手怎么用AI", "对谈"] },
  "源自Palantir的FDE": { q: "源自Palantir的FDE 前线部署工程师 AI to B 银弹", tokens: ["银弹", "Palantir"] },
  "FDE修炼之道": { q: "国产FDE修炼之道 AI办公前线", tokens: ["修炼之道"] },
  "AI时代最贵的新岗位": { q: "FDE AI时代最贵的新岗位 把工程师派进客户 车间", tokens: ["最贵", "车间"] },
  "FDE工程师是什么": { q: "FDE工程师是什么 岗位定义与核心能力解析", tokens: ["岗位定义", "核心能力"] },
  "光谷启动首个": { q: "光谷 启动 FDE+智能体 培训工程", tokens: ["光谷", "培训工程"] },
  "工信部专项文件": { q: "工信部 前沿部署工程师 纳入 政策体系", tokens: ["工信部", "前沿部署"] },
};

const keyFor = (title) => Object.keys(HINTS).find((k) => title.includes(k)) ?? null;

async function curl(url) {
  try {
    const { stdout } = await run("curl", ["-sL", "-m", "15", "-A", UA, url], { timeout: 20_000, maxBuffer: 8 * 1024 * 1024 });
    return stdout ?? "";
  } catch {
    return "";
  }
}

function candidateUrls(html) {
  const urls = new Set();
  for (const m of html.matchAll(/href="(https?:\/\/[^"]+)"/g)) {
    const u = m[1];
    if (/bing|microsoft|msn\.com|go\.microsoft|baike\.baidu|openfde\.net/.test(u)) continue;
    urls.add(u.split("#")[0]);
  }
  return [...urls].filter((u) => !/\.(png|jpe?g|gif|css|js|ico|svg)$/i.test(u));
}

function titleOk(html, tokens) {
  const m = html.match(/<title>([^<]*)<\/title>/i);
  const title = (m?.[1] ?? "").toLowerCase();
  if (!title) return false;
  const hasFde = /(fde|前置部署|前线部署|前沿部署)/i.test(title) || /(人工智能|大模型|ai落地|ai应用)/i.test(title);
  const hit = tokens.some((t) => title.includes(t.toLowerCase()));
  return hasFde && hit;
}

const cases = db.prepare("SELECT id, title, url FROM cases WHERE status='offline'").all();
let fixed = 0;
for (const c of cases) {
  const key = keyFor(c.title);
  if (!key) { console.log(`  - 无策略: ${c.title.slice(0, 26)}`); continue; }
  const { q, tokens } = HINTS[key];
  const html = await curl(`https://cn.bing.com/search?q=${encodeURIComponent(q)}`);
  const candidates = candidateUrls(html).slice(0, 8);
  let found = null;
  for (const u of candidates) {
    const page = await curl(u);
    if (!page) continue;
    const { ok } = titleOk(page, tokens);
    if (ok) { found = u; break; }
    await sleep(250);
  }
  if (found) {
    db.prepare("UPDATE cases SET url=?, source_url=?, status='candidate' WHERE id=?").run(found, found, c.id);
    fixed++;
    console.log(`  ✓ ${c.title.slice(0, 26)} → ${found.slice(0, 75)}`);
  } else {
    console.log(`  ✗ ${c.title.slice(0, 26)}`);
  }
  await sleep(1500);
}
console.log(`== done == 找回 ${fixed}/${cases.length}`);
