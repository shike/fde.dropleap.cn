#!/usr/bin/env node
/** 人物领域标签提取：从 bio/签名按词表匹配 2-4 个领域标签 → persons.tags（逗号分隔）。跑法：node pipeline/backfill-tags.mjs */
import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const db = new DatabaseSync(path.join(ROOT, "data", "fde.db"));
try {
  db.exec("ALTER TABLE persons ADD COLUMN tags TEXT");
} catch {}

const TAG_DICT = [
  ["大模型", /大模型|LLM|llm|GPT|gpt/i],
  ["AI Agent", /Agent|智能体|agent/i],
  ["RAG", /RAG|rag|知识库|检索增强/i],
  ["AI 编程", /AI编程|Coding|coding|Copilot|Cursor|Claude Code|vibe coding|Vibe Coding|编程助手/i],
  ["制造业", /制造|工厂|产线|工业|工艺|精密|零部件/i],
  ["数字人", /数字人|虚拟人/i],
  ["AI 视频", /视频|Seedance|可灵|即梦|Sora/i],
  ["AI 绘画", /绘画|Midjourney|MJ|Stable Diffusion|ComfyUI|文生图/i],
  ["语音", /语音|TTS|ASR|配音/i],
  ["计算机视觉", /视觉|CV|OCR|图像/i],
  ["自动驾驶", /自动驾驶|智驾|NOA/i],
  ["机器人", /机器人|人形|具身/i],
  ["电商", /电商|亚马逊|跨境|淘宝|抖音电商|1688/i],
  ["教育", /教育|培训师|学员|课程|老师|升学/i],
  ["医疗", /医疗|Health|临床|医院/i],
  ["金融", /金融|风控|银行|证券|保险/i],
  ["出海", /出海|跨境|海外|全球化/i],
  ["企业服务", /企业服务|ToB|To B|B端|SaaS|数字化/i],
  ["咨询", /咨询|顾问|陪跑/i],
  ["内容营销", /内容营销|新媒体|公众号|涨粉|博主/i],
  ["独立开发", /独立开发|独立开发者|solopreneur|一人公司/i],
  ["云原生", /云原生|K8s|k8s|Docker|运维|DevOps|SRE/i],
  ["数据", /数据|数仓|BI|取数/i],
  ["安全", /安全|红队|渗透|攻防/i],
  ["HR tech", /面试|HR|招聘|人力资源/i],
  ["职级成长", /转型|成长|职业|就业|入行|求职/i],
  ["AI 科普", /科普|入门|小白|解读|分享/i],
];

const rows = db.prepare("SELECT id, bio, name FROM persons WHERE status IN ('candidate','approved')").all();
const upd = db.prepare("UPDATE persons SET tags=? WHERE id=?");
let filled = 0;
for (const r of rows) {
  const blob = `${r.bio ?? ""} ${r.name ?? ""}`;
  if (!blob.trim()) continue;
  const tags = [];
  for (const [tag, re] of TAG_DICT) {
    if (re.test(blob) && !tags.some((t) => tag.includes(t) || t.includes(tag))) tags.push(tag);
    if (tags.length >= 4) break;
  }
  if (tags.length) {
    upd.run(tags.join(","), r.id);
    filled++;
  }
}
console.log(`标签提取：${filled}/${rows.length} 人有标签`);
