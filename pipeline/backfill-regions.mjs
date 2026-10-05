#!/usr/bin/env node
/** 公司库补地域：ALTER + 按公开总部信息回填存量公司。跑法：node pipeline/backfill-regions.mjs */
import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const db = new DatabaseSync(path.join(ROOT, "data", "fde.db"));
try {
  db.exec("ALTER TABLE companies ADD COLUMN region TEXT");
} catch {}

// 公开总部所在地（按公司注册/总部公开信息）
const REGION_MAP = {
  bytedance: "北京", alibaba: "杭州", tencent: "深圳", baidu: "北京", huawei: "深圳",
  deepseek: "杭州", zhipu: "北京", moonshot: "北京", minimax: "上海", stepfun: "上海",
  modelbest: "北京", shengshu: "北京", baichuan: "北京", lingyiwanwu: "北京",
  iflytek: "合肥", sensetime: "上海", meituan: "北京", jd: "北京", antgroup: "杭州",
  manycore: "杭州", kuaishou: "北京", infinigence: "上海", siliconflow: "北京",
  luchen: "北京", dropleap: "苏州", brrd: "北京", swtd: "北京", ruitazhizao: "苏州",
  zhiyuanrobot: "上海", unitree: "杭州", galaxygeneral: "北京", guijintech: "南京",
  mobvoi: "北京", recurrentai: "北京", zhuiyi: "深圳", emotibot: "上海", datagrand: "上海",
  ronglian: "北京", baicells: "北京", "4paradigm": "北京", ainnovation: "深圳",
  cloudwalk: "广州", deepglint: "北京", horizonrobotics: "北京", blacksesame: "武汉",
  qcraft: "苏州", weride: "广州", pony: "广州", haomo: "北京", terminus: "北京",
  deepblue: "上海", intellifusion: "深圳", intsig: "上海", damo: "杭州",
  dingtalk: "杭州", feishu: "北京", wecom: "广州", volcengine: "北京",
  bce: "北京", huaweicloud: "深圳", jdcloud: "北京", youdao: "北京", sogou: "北京",
  iflytekhealth: "合肥", unitedimaging: "上海", shukun: "北京", infervision: "北京",
  airdoc: "北京", dptech: "北京", xtalpi: "深圳",
};

let filled = 0;
for (const [slug, region] of Object.entries(REGION_MAP)) {
  const info = db.prepare("UPDATE companies SET region=? WHERE slug=? AND (region IS NULL OR region='')").run(region, slug);
  filled += info.changes;
}
// 兜底：仍无地域的标"中国"
db.prepare("UPDATE companies SET region='中国' WHERE region IS NULL OR region=''").run();
console.log(`回填 ${filled} 家，兜底后全部有地域：`, db.prepare("SELECT COUNT(*) n FROM companies WHERE region IS NOT NULL").get().n);
