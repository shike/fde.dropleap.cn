#!/usr/bin/env node
/**
 * 公司库扩充第三批（2026-10-05）：公开检索驱动（WebSearch/cn.bing 行业榜单与公司公开资料），region=总部所在城市必填。
 * 规则：新公司 fde_team_known=0；按 slug/name 去重；只插 companies 表，不删数据。
 * 跑法：node pipeline/seed-companies-round3.mjs
 */
import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const db = new DatabaseSync(path.join(ROOT, "data", "fde.db"));
const now = new Date().toISOString();

// [name, slug, website, region, note]
// website 标 ⚠ 为占位域名（官网待确认）
const COMPANIES = [
  // —— 北京 ——
  ["昆仑万维", "kunlun", "https://www.kunlun.com", "北京", "天工大模型；All in AGI 与 AIGC，A 股 300418"],
  ["三六零", "360", "https://www.360.cn", "北京", "360 智脑大模型与安全大模型，数字安全 + AI"],
  ["度小满", "duxiaoman", "https://www.duxiaoman.com", "北京", "金融大模型，开源轩辕（XuanYuan）系列"],
  ["旷视科技", "megvii", "https://www.megvii.com", "北京", "AI 四小龙之一，视觉 AI + 物流机器人"],
  ["寒武纪", "cambricon", "https://www.cambricon.com", "北京", "AI 芯片（思元 MLU），科创板 688256"],
  ["摩尔线程", "moorethreads", "https://www.moorethreads.com", "北京", "全功能 GPU，2025-12 科创板上市"],
  ["易控智驾", "yikongzhijia", "https://www.yikongzhijia.com", "北京", "矿区无人驾驶头部，专精特新小巨人", "官网待确认"],
  ["踏歌智行", "tagezhixing", "https://www.tagezhixing.com", "北京", "露天矿无人驾驶运输方案商", "官网待确认"],
  ["医渡云", "yiducloud", "https://www.yiducloud.com", "北京", "医疗大数据与真实世界研究，港交所 2158"],
  ["深睿医疗", "deepwise", "https://www.deepwise.com", "北京", "AI 医学影像辅助诊断"],
  ["惠每科技", "huimei", "https://www.huimai.com", "北京", "医疗 AI 临床决策支持（CDSS）", "官网待确认"],
  ["百图生科", "biomap", "https://www.biomap.com", "北京", "百度旗下 AI 生命科学平台（xTrimo）"],
  ["云知声", "unisound", "https://www.unisound.com", "北京", "语音 AI 与山海大模型，港交所 9678"],
  ["星动纪元", "robotera", "https://www.robotera.com", "北京", "清华系人形机器人，软硬件全栈自研"],
  ["加速进化", "booster", "https://www.boosterobotics.com", "北京", "教育/开发者人形机器人 Booster"],
  ["松延动力", "noetix", "https://www.noetix.com", "北京", "高性价比人形机器人（N2 等）", "官网待确认"],
  ["作业帮", "zuoyebang", "https://www.zuoyebang.com", "北京", "教育科技，自研银河大模型"],
  ["好未来", "tal", "https://www.tal.com", "北京", "学而思，自研 MathGPT 学习机"],
  ["小米", "xiaomi", "https://www.mi.com", "北京", "MiLM 端侧大模型、AIoT 与人形机器人 CyberOne"],
  ["滴滴", "didi", "https://www.didiglobal.com", "北京", "自动驾驶与出行 AI 平台"],
  ["理想汽车", "lixiang", "https://www.lixiang.com", "北京", "MindGPT 大模型、端到端智驾"],
  ["来也科技", "laiye", "https://www.laiye.com", "北京", "RPA + AI Agent 智能自动化"],
  ["用友", "yonyou", "https://www.yonyou.com", "北京", "企业软件 YonGPT 商业创新平台"],
  ["奇安信", "qianxin", "https://www.qianxin.com", "北京", "网络安全 + Q-GPT 安全机器人"],
  // —— 上海 ——
  ["依图科技", "yitu", "https://www.yitutech.com", "上海", "AI 四小龙之一，视觉 + 语音全栈"],
  ["沐曦", "metax", "https://www.metax-tech.com", "上海", "GPU（曦云系列），科创板 688802"],
  ["壁仞科技", "biren", "https://www.biren.tech", "上海", "通用 GPU（BR 系列），2026 港交所上市"],
  ["燧原科技", "enflame", "https://www.enflame.com", "上海", "AI 训练/推理云燧芯片"],
  ["天数智芯", "tianshu", "https://www.tianshuzhixin.com", "上海", "通用 GPU（天垓系列）", "官网待确认"],
  ["西井科技", "westwell", "https://www.westwell.cn", "上海", "港口/物流无人驾驶（Q-Truck）"],
  ["米哈游", "mihoyo", "https://www.mihoyo.com", "上海", "游戏 AI Lab（逆熵），AIGC 内容生产"],
  ["小红书", "xiaohongshu", "https://www.xiaohongshu.com", "上海", "社区搜索与 dots 大模型（hi lab）"],
  ["携程", "ctrip", "https://www.ctrip.com", "上海", "旅游大模型携程问道"],
  // —— 深圳 ——
  ["元象 XVERSE", "xverse", "https://www.xverse.cn", "深圳", "MoE 开源大模型 XChat，3D + AI"],
  ["荣耀", "honor", "https://www.honor.com", "深圳", "端侧 AI 智能体 YOYO，布局具身智能"],
  ["思谋科技", "smartmore", "https://www.smartmore.com", "深圳", "工业质检多模态大模型（贾佳亚创立）"],
  ["奥比中光", "orbbec", "https://www.orbbec.com", "深圳", "3D 视觉感知，机器人之眼"],
  ["佑驾创新", "minieye", "https://www.minieye.cc", "深圳", "智能驾驶方案 MINIEYE，港交所 2431"],
  ["元戎启行", "deeproute", "https://www.deeproute.ai", "深圳", "L4 自动驾驶 DeepRoute"],
  ["逐际动力", "limx", "https://www.limxdynamics.com", "深圳", "全尺寸人形机器人 LimX"],
  ["众擎机器人", "engineai", "https://www.engineai.com", "深圳", "人形机器人 T800/SE 系列", "官网待确认"],
  ["睿心医疗", "ruixinmedical", "https://www.ruixinmedical.com", "深圳", "心脑血管 AI（睿心分数 CT-FFR）", "官网待确认"],
  ["金蝶", "kingdee", "https://www.kingdee.com", "深圳", "企业云服务，苍穹 GPT"],
  ["深信服", "sangfor", "https://www.sangfor.com.cn", "深圳", "网络安全 + 安全 GPT"],
  ["大疆", "dji", "https://www.dji.com", "深圳", "无人机全球龙头，具身智能与视觉 AI"],
  ["优必选", "ubtech", "https://www.ubtrobot.com", "深圳", "人形机器人 Walker，港交所 9880"],
  // —— 杭州 ——
  ["实在智能", "shizai", "https://www.ai-indeed.com", "杭州", "TARS 塔斯大模型 + Agent（OSWorld 榜单登顶）"],
  ["云深处科技", "deeprobotics", "https://www.deeprobotics.cn", "杭州", "杭州四小龙，四足/人形机器人电力巡检"],
  ["虹软科技", "arcsoft", "https://www.arcsoft.com.cn", "杭州", "视觉 AI 算法，科创板 688088"],
  ["网易", "netease", "https://www.netease.com", "杭州", "互娱 AI Lab 与子曰大模型"],
  ["同花顺", "myhexin", "https://www.10jqka.com.cn", "杭州", "AI 金融，问财 HithinkGPT"],
  ["恒生电子", "hundsun", "https://www.hundsun.com", "杭州", "金融科技 LightGPT"],
  ["海康威视", "hikvision", "https://www.hikvision.com", "杭州", "智能物联 AIoT 与观澜大模型"],
  // —— 其他城市 ——
  ["思必驰", "aispeech", "https://www.aispeech.com", "苏州", "全链路语音 + DFM 大模型（苏州独角兽）"],
  ["追觅科技", "dreame", "https://www.dreame.com", "苏州", "智能清洁 + 人形机器人布局", "官网待确认"],
  ["小鹏汽车", "xiaopeng", "https://www.xiaopeng.com", "广州", "XNGP 智驾 + 图灵 AI 芯片 + 铁人形机器人"],
  ["智象未来", "hidream", "https://www.hidreamai.com", "合肥", "视觉多模态生成式 AI（梅涛创立，合肥独角兽）"],
  ["主线科技", "trunktech", "https://www.trunk.tech", "天津", "L4 港口物流自动驾驶卡车"],
  ["vivo", "vivo", "https://www.vivo.com", "东莞", "蓝心大模型 BlueLM，机器人 Lab"],
  ["OPPO", "oppo", "https://www.oppo.com", "东莞", "安第斯大模型 AndesGPT"],
  ["晓多科技", "xiaoduo", "https://www.xiaoduoai.com", "成都", "电商智能客服大模型"],
  ["考拉悠然", "kaolayouren", "https://www.kaolayouren.com", "成都", "多模态 AI 操作系统（电子科大团队）", "官网待确认"],
  ["拓维信息", "talkweb", "https://www.talkweb.com.cn", "长沙", "华为昇腾/盘古生态 AI 软件与服务"],
  ["后摩智能", "houmo", "https://www.houmo.ai", "南京", "存算一体大算力 AI 芯片"],
  ["慧拓智能", "huituo", "https://www.huituozhineng.com", "青岛", "智慧矿山无人化（平行驾驶）", "官网待确认"],
  ["浪潮云", "inspurcloud", "https://www.inspurcloud.cn", "济南", "政务云 + 海若行业大模型"],
  ["超聚变", "xfusion", "https://www.xfusion.com", "郑州", "AI 算力服务器（FusionServer）"],
  ["美图", "meitu", "https://www.meitu.com", "厦门", "AI 影像，奇想大模型 MirageStudio"],
  ["马上消费", "msxf", "https://www.msxf.com", "重庆", "天镜大模型，重庆 AI 代表企业"],
  ["金山办公", "wps", "https://www.wps.cn", "珠海", "WPS AI 智能办公"],
];

const existSlugs = new Set(db.prepare("SELECT slug FROM companies").all().map((r) => r.slug));
const existNames = new Set(db.prepare("SELECT name FROM companies").all().map((r) => r.name));
const insert = db.prepare(
  `INSERT INTO companies (name, slug, website, fde_team_known, jd_count, notes, created_at, region)
   VALUES (?, ?, ?, 0, 0, ?, ?, ?)`
);

let added = 0, skipped = 0;
for (const [name, slug, website, region, note, flag] of COMPANIES) {
  if (existSlugs.has(slug) || existNames.has(name)) {
    console.log(`  skip（重复）: ${name} / ${slug}`);
    skipped++;
    continue;
  }
  const finalNote = flag === "官网待确认" ? `${note}；官网待确认` : note;
  insert.run(name, slug, website, finalNote, now, region);
  existSlugs.add(slug);
  existNames.add(name);
  added++;
}
console.log(`新增 ${added} 家，跳过重复 ${skipped} 家`);
console.log(`当前总数: ${db.prepare("SELECT COUNT(*) AS n FROM companies").get().n}`);
