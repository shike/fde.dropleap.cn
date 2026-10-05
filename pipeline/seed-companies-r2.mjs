#!/usr/bin/env node
/** 公司库扩充 R2：中国 AI/科技企业补充名单（公开总部信息），全部观察状态。跑法：node pipeline/seed-companies-r2.mjs */
import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const db = new DatabaseSync(path.join(ROOT, "data", "fde.db"));
const now = new Date().toISOString();

const COMPANIES = [
  // AI 视频与内容科技
  ["小影科技", "quvideo", "厦门", "AI 视频科技，入选 2026 数字贸易中国企业全球化新势力 100 强"],
  ["特赞", "tezign", "上海", "内容中台与 AIGC 设计"],
  ["无尾科技", "wutailabs", "北京", "AIGC 内容科技"],
  ["爱诗科技", "aishi", "北京", "PixVerse AI 视频生成"],
  ["右脑科技", "rightbrain", "北京", "AI 视觉生成"],
  // 大模型与 AGI 补充
  ["澜舟科技", "langboat", "北京", "孟子大模型，认知智能"],
  ["深言科技", "deepyan", "北京", "大模型信息处理与知识引擎"],
  ["元象 XVERSE", "xverse", "深圳", "MoE 大模型"],
  ["智象未来", "hirain-ai", "合肥", "多模态大模型 HiDream"],
  ["度小满", "dupont", "北京", "金融大模型轩言"],
  ["面壁露露", "modelbest-pp", "北京", "端侧模型 MiniCPM（面壁智能系）"],
  // AI 芯片与算力补充
  ["芯原股份", "verisilicon", "上海", "芯片 IP 与 AI 算力"],
  ["云豹智能", "cloudpanther", "深圳", "DPU 芯片"],
  ["中昊芯英", "zhonghao", "杭州", "TPU 架构 AI 芯片"],
  // 机器人与具身智能补充
  ["擎朗智能", "keenzon", "上海", "商用配送机器人"],
  ["普渡科技", "pudu", "深圳", "商用服务机器人"],
  ["云迹科技", "yunji", "北京", "酒店服务机器人"],
  ["优艾智合", "youibot", "深圳", "工业移动机器人"],
  ["海康机器人", "hikrobot", "杭州", "机器视觉与移动机器人"],
  ["乐聚机器人", "leju", "深圳", "人形机器人"],
  ["傅利叶智能", "fourier", "上海", "人形机器人与康复机器人"],
  // AI 医疗补充
  ["医渡云", "yiducloud", "北京", "医疗大数据与 AI"],
  ["深睿医疗", "deepwise", "北京", "医学影像 AI"],
  ["惠每科技", "huimai", "北京", "医疗质量 AI"],
  ["睿心医疗", "ruixin", "深圳", "心血管 AI"],
  ["百图生科", "bio map", "北京", "生命科学大模型"],
  // AI 金融/法律/政务
  ["同花顺", "10jqka", "杭州", "问财 AI 金融问答"],
  ["恒生电子", "hundsun", "杭州", "金融科技 LightGPT"],
  ["马上消费", "msxf", "重庆", "金融大模型天马"],
  ["得理法律", "deli-legal", "深圳", "法律 AI"],
  ["秘塔科技", "metaso", "上海", "秘塔 AI 搜索与法律翻译"],
  // AI 教育/办公
  ["网易有道", "youdao-ai", "北京", "子曰大模型与 AI 学习机"],
  ["金山办公", "wps", "珠海", "WPS AI"],
  ["万兴科技", "wondershare", "深圳", "AIGC 创意软件"],
  ["美图", "meitu", "厦门", "美图秀秀 AI 影像大模型"],
  // 行业 AI 应用补充
  ["晶泰科技", "xtalpi", "深圳", "AI 制药"],
  ["深势科技", "dptech-ai", "北京", "AI for Science"],
  ["创新奇智", "ainnovation2", "青岛", "AInnovation 制造业 AIGC"],
  ["思谋科技", "smartmore", "深圳", "工业视觉大模型"],
  ["惠尔智能", "huier", "深圳", "多传感器融合自动驾驶"],
];

let n = 0;
for (const [name, slug, region, notes] of COMPANIES) {
  const info = db.prepare(
    `INSERT INTO companies (name, slug, website, fde_team_known, jd_count, notes, created_at, region)
     VALUES (?, ?, ?, 0, 0, NULL, ?, ?)
     ON CONFLICT(slug) DO NOTHING`
  ).run(name, slug, `https://www.${slug}.com`, now, region);
  n += info.changes;
}
console.log(`新增 ${n} 家，公司库总数:`, db.prepare("SELECT COUNT(*) n FROM companies").get().n);
