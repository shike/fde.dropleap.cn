#!/usr/bin/env node
/**
 * FDE 生态企业采集器：
 *   node pipeline/collect-companies-fde.mjs seeds             # 入库人工核验种子名单
 *   node pipeline/collect-companies-fde.mjs backfill          # 回填存量缺失 region
 *   node pipeline/collect-companies-fde.mjs harvest [批次号]   # cn.bing 矩阵挖掘
 *   node pipeline/collect-companies-fde.mjs test <url>        # 单页抽取测试（不入库）
 * 红线：只写 companies 表；region 必填；按公司名去重；非服务商跳过；磁盘不足 2GB 停。
 * 抽取策略（精确优先）：页面门控(强上下文标题+AI词密度) → 块级解析 → 仅收
 *   a) 法律名(XX有限公司)  b) 名称（城市）列表格式  c) 列表行首的公司名(纯中文,≥4字)
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { DatabaseSync } from "node:sqlite";
import { createRequire } from "node:module";
import { statfs, readFile, appendFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { SEEDS } from "./fde-company-seeds.mjs";

const run = promisify(execFile);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const db = new DatabaseSync(path.join(ROOT, "data", "fde.db"));
const require2 = createRequire(import.meta.url);
let pinyinFn = null;
try {
  const { pinyin } = require2("/tmp/pinyin-test/node_modules/pinyin-pro");
  pinyinFn = (t) => pinyin(t, { toneType: "none", type: "array", nonZh: "consecutive" }).join("").toLowerCase();
} catch {
  pinyinFn = null;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";
const now = () => new Date().toISOString();

async function diskFreeGB() {
  try {
    const s = await statfs(ROOT);
    return (s.bsize * s.bavail) / 1e9;
  } catch {
    return 999;
  }
}
async function diskGuard() {
  const gb = await diskFreeGB();
  if (gb < 2) {
    console.log(`!! 磁盘仅剩 ${gb.toFixed(2)}GB，立即停止`);
    process.exit(1);
  }
}

// ---------- 城市/区域 ----------
const CITIES = "北京|上海|天津|重庆|广州|深圳|成都|杭州|武汉|西安|南京|苏州|济南|青岛|郑州|长沙|福州|厦门|合肥|昆明|贵阳|南昌|南宁|海口|兰州|西宁|银川|乌鲁木齐|拉萨|太原|石家庄|呼和浩特|沈阳|大连|长春|哈尔滨|无锡|宁波|温州|常州|南通|徐州|扬州|泰州|盐城|嘉兴|绍兴|金华|台州|湖州|丽水|衢州|舟山|惠州|东莞|佛山|珠海|中山|江门|汕头|湛江|烟台|潍坊|淄博|临沂|济宁|泰安|威海|日照|德州|聊城|菏泽|洛阳|开封|新乡|南阳|许昌|襄阳|宜昌|岳阳|株洲|衡阳|常德|绵阳|德阳|宜宾|泸州|南充|泉州|漳州|莆田|宁德|南平|龙岩|三明|镇江|昆山|常熟|张家港|太仓|淮安|连云港|宿迁|安庆|芜湖|马鞍山|滁州|蚌埠|景德镇|赣州|九江|上饶|桂林|柳州|遵义|六盘水|曲靖|玉溪|大理|包头|鄂尔多斯|唐山|保定|沧州|廊坊|邯郸|秦皇岛|大同|长治|锦州|抚顺|营口|吉林|大庆|齐齐哈尔|咸阳|宝鸡|渭南|汉中|延安";
const CITY_RE_STR = `(${CITIES})`;
const PROVINCES = "浙江|江苏|广东|山东|河南|湖北|湖南|四川|福建|安徽|河北|陕西|辽宁|江西|云南|广西|山西|吉林|黑龙江|贵州|甘肃|海南|内蒙古|新疆|西藏|青海|宁夏";

// ---------- 归一化与去重 ----------
const normalize = (n) =>
  n
    .replace(/[（(][^（）()]*[）)]/g, "")
    .replace(/[\s·・]/g, "")
    .replace(/(股份|集团)?(有限)?责任?公司$/, "")
    .replace(/(股份|集团)?有限公司$/, "")
    .replace(/集团$/, "")
    .trim();

const EXISTING_ALIASES = [
  "阿里巴巴", "阿里", "alibaba", "腾讯", "tencent", "科大讯飞", "讯飞", "iflytek", "水滴跃动", "dropleap",
  "循环智能", "recurrentai", "追一科技", "zhuiyi", "竹间智能", "emotibot", "达观数据", "datagrand",
  "创新奇智", "ainnovation", "火山引擎", "volcengine", "百度智能云", "百度", "bce", "华为云", "华为",
  "huaweicloud", "京东云", "jdcloud", "讯飞医疗", "iflytekhealth", "百融云创", "brrd", "三维天地", "swtd",
  "睿塔", "睿塔智造", "ruitazhizao", "思谋科技", "smartmore", "得理法律", "得理", "deli-legal", "明略科技",
  "minglue", "中科闻歌", "zhongkewenge", "海致星图", "海致", "haizhi", "通付盾", "tongfudun", "微亿智造",
  "微亿", "weiyizhizao", "海纳AI", "海纳", "hainai", "汉得信息", "汉得", "handinfo", "软通动力", "isoftstone",
  "中软国际", "chinasoft", "法本信息", "fa-info", "博彦科技", "beyondsoft", "澳鹏", "appen",
];
const BLOCK = [
  "百度", "阿里巴巴", "阿里", "腾讯", "华为", "京东", "字节", "抖音", "今日头条", "快手", "小米", "美团",
  "拼多多", "滴滴", "微博", "商汤", "依图", "海康威视", "大华股份", "科大讯飞", "联想", "中兴", "OPPO",
  "VIVO", "荣耀", "海尔", "美的", "格力", "TCL", "创维", "长虹", "康佳", "爱奇艺", "哔哩", "bilibili",
  "智谱", "月之暗面", "百川智能", "MiniMax", "minimax", "稀宇科技", "零一万物", "阶跃星辰", "深度求索",
  "DeepSeek", "deepseek", "面壁智能", "澜舟", "出门问问", "燧原", "寒武纪", "地平线", "黑芝麻", "壁仞",
  "摩尔线程", "天数智芯", "海光", "龙芯", "嘉楠", "云天励飞", "奥比中光", "优必选", "擎朗", "普渡",
  "猎户星空", "云迹", "禾赛", "速腾聚创", "文远知行", "小马智行", "毫末智行", "Momenta", "四维图新",
  "中科曙光", "金山办公", "万兴", "虹软", "微盟", "有赞", "网易", "OpenAI", "openai", "微软", "谷歌", "Google",
  "亚马逊", "Meta", "英伟达", "英特尔", "meta",
];
const NAME_BLACKLIST = [
  "银行", "证券", "保险", "信托", "基金", "期货", "小贷", "担保", "租赁", "典当", "医院", "诊所", "药业",
  "制药", "医药", "生物", "基因", "医疗器械", "器械", "大学", "学院", "学校", "研究院", "研究所", "事务所",
  "商会", "协会", "联合会", "酒店", "餐饮", "食品", "乳业", "酒业", "白酒", "啤酒", "烟草", "茶业", "种植",
  "养殖", "畜牧", "渔业", "房地产", "置业", "地产", "物业", "建筑", "市政", "园林", "钢铁", "铝业", "铜业",
  "矿业", "煤矿", "油田", "石油", "石化", "化工", "化肥", "农药", "水泥", "玻璃", "陶瓷", "家具", "家居",
  "服装", "纺织", "鞋业", "玩具", "珠宝", "黄金", "游戏", "动漫", "影视", "电影", "传媒", "文化传播",
  "娱乐", "直播", "电商", "贸易", "商贸", "进出口", "实业", "控股", "投资", "资产", "资本", "私募", "创投",
  "人力资源", "劳务", "留学", "旅游", "旅行社", "航空", "机场", "铁路", "地铁", "公交", "港口", "航运",
  "船务", "快递", "汽车", "摩托", "电动车", "电池", "光伏", "储能", "风电", "核电", "水务", "燃气", "环保",
  "装备", "精密", "机械", "仪器", "仪表", "材料", "新材", "五金", "模具", "塑胶", "包装", "印刷", "芯片",
  "半导体", "集成电路", "晶圆", "光电", "面板", "显示", "手机", "相机", "机器人", "无人机", "兵器", "军工",
  "国防", "陵园", "墓", "殡葬", "婚庆", "美容", "美发", "健身", "体育文化", "俱乐部",
];
const JUNK_PHRASE = [
  "怎么", "如何", "输入", "输出", "表示", "等于", "选择", "点击", "对应", "键盘", "罗马", "阿拉伯", "字母",
  "排名", "名单", "盘点", "榜单", "推荐", "分享", "整理", "总结", "汇总", "方法", "步骤", "教程", "什么",
  "意思", "原因", "结果", "影响", "作用", "用途", "功能", "特点", "优势", "缺点", "问题", "答案", "回答",
  "提问", "知道", "觉得", "认为", "发现", "介绍", "了解", "学习", "掌握", "打造", "推动", "加速", "助力",
  "构建", "升级", "赋能", "实现", "提供", "覆盖", "满足", "基于", "依托", "深耕", "专注", "致力于", "成立",
  "总部", "位于", "旗下", "推出", "发布", "上线", "签约", "合作", "中标", "荣获", "斩获", "入选", "评估",
  "评测", "对比", "解读", "分析", "研究", "报告", "白皮书", "成为", "最具", "价值", "商业", "领域", "领军",
  "领先", "知名", "主流", "优秀", "卓越", "十大", "百强", "10强", "30强", "50强", "100强", "首届", "年度",
  "峰会", "论坛", "大会", "展位", "嘉宾", "演讲", "公司", "企业", "中国区", "国家级", "是由", "关于",
  "针对", "更多", "折腾", "场景", "架构", "支持", "轻松", "一键", "无需",
];
const STOP_NAMES = new Set([
  "大数据", "人工智能", "智能体", "数字化转型", "智能制造", "智慧城市", "智能网联", "云计算", "云平台",
  "云服务", "数据中台", "数据治理", "数据库", "科技公司", "智能科技", "数据科技", "网络科技", "信息科技",
  "中国智能", "国家智能", "世界科技", "全球科技", "国际智能", "未来科技", "前沿科技", "基础软件", "开源软件",
  "服务机器人", "数字化转型服务商", "系统集成商", "整体解决方案",
]);
// 短名单名称结尾词（严格）
const STRICT_END = /(科技|信息技术|数智|软件|数字|网络|咨询|算法|标注|人工智能|自动化|云|通信|教育|培训)$/;
const LEGAL_MID = "(?:科技|信息技术|信息科技|智能科技|数据科技|数字科技|网络科技|系统集成|人工智能|数据服务|数智科技|数智|数据|智能|软件|云服务|云计算|数字|咨询|自动化|信息服务|技术服务)";

const FUNC_FIRST = "的了在与及为对从被把让使这那该等各每更最已将可就都是其含和或并用是以个通依按据本众多若干上下前后内外高低快慢新旧好坏大小多少要需先再又还很无不非关针某均皆且然而因此所以如若将请";
function blacklisted(name, kind = "short") {
  const n = name.toLowerCase();
  if (STOP_NAMES.has(name)) return true;
  if (BLOCK.some((b) => n.includes(b.toLowerCase()))) return true;
  if (NAME_BLACKLIST.some((b) => name.includes(b))) return true;
  if (kind !== "legal" && JUNK_PHRASE.some((b) => name.includes(b))) return true;
  if (kind === "short" && !STRICT_END.test(name)) return true;
  if (kind === "short" && FUNC_FIRST.includes(name[0])) return true;
  if (kind === "short" && !/^[\u4e00-\u9fa5]{3,16}$/.test(name)) return true;
  if (kind === "label" && (name.length < 3 || name.length > 20)) return true;
  if (kind === "legal" && (name.length < 3 || name.length > 22)) return true;
  if (EXISTING_ALIASES.some((a) => n === a.toLowerCase())) return true;
  if (/^(微信|企业微信|飞书|钉钉)/.test(name)) return true;
  return false;
}

// ---------- slug ----------
const usedSlugs = new Set(db.prepare("SELECT slug FROM companies").all().map((r) => r.slug));
function makeSlug(name) {
  let base = "";
  const latin = name.match(/[A-Za-z][A-Za-z0-9]{2,}/);
  if (pinyinFn && /[\u4e00-\u9fa5]/.test(name)) base = pinyinFn(name).replace(/[^a-z0-9]/g, "");
  else if (latin) base = latin[0].toLowerCase();
  else if (pinyinFn) base = pinyinFn(name).replace(/[^a-z0-9]/g, "");
  else base = "c" + Buffer.from(name).toString("hex").slice(0, 10);
  if (!base) base = "c" + Buffer.from(name).toString("hex").slice(0, 10);
  let s = base, i = 2;
  while (usedSlugs.has(s)) s = `${base}${i++}`;
  usedSlugs.add(s);
  return s;
}

// ---------- 数据库 ----------
const insert = db.prepare(
  `INSERT INTO companies (name, slug, website, fde_team_known, jd_count, notes, created_at, region, type, category)
   VALUES (?, ?, ?, 0, 0, ?, ?, ?, ?, ?)`
);
const allNorm = db.prepare("SELECT name FROM companies").all().map((r) => normalize(r.name));
function isDup(name) {
  const n = normalize(name);
  if (!n || n.length < 2) return true;
  for (const norm of allNorm) {
    if (!norm) continue;
    if (norm === n) return true;
    if (n.length >= 4 && norm.length >= 4 && (norm.includes(n) || n.includes(norm))) return true;
    if ((n.length === 2 || n.length === 3) && (norm.startsWith(n) || norm.endsWith(n))) return true;
  }
  return false;
}
function remember(name) {
  allNorm.push(normalize(name));
}
function addCompany({ name, region, type = "FDE服务商", website = null, note = "" }) {
  const nName = normalize(name);
  if (isDup(nName)) return false;
  const slug = makeSlug(nName);
  const ws = website || `https://www.${slug}.com`;
  const notes = website ? note : `${note}｜官网待确认`;
  insert.run(nName, slug, ws, notes, now(), region || "中国", type, type);
  remember(nName);
  return true;
}

// ---------- 抓取与解析 ----------
async function curl(url) {
  try {
    const { stdout } = await run("curl", ["-sL", "-m", "15", "-A", UA, url], { timeout: 20_000, maxBuffer: 8 * 1024 * 1024 });
    return stdout ?? "";
  } catch {
    return "";
  }
}
function stripHtml(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;|&amp;|&quot;|&ldquo;|&rdquo;|&mdash;|&#\d+;|&ensp;|&emsp;/g, " ")
    .replace(/\s+/g, " ");
}
function toBlocks(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .split(/<\/(p|li|h[1-6]|tr|dd|dt)>|<br\s*\/?>/i)
    .map((s) => (typeof s === "string" ? stripHtml(s).trim() : ""))
    .filter((s) => s.length >= 6 && s.length <= 260);
}

// 页面门控
const HOST_BLOCK = /zhidao\.baidu|jingyan\.baidu|wenku\.baidu|baijiahao|tieba\.baidu|baike|riskbird|tianyancha|qcc\.com|aiqicha|qixin|11467|shuidi|gongsi\.com|ai\.baidu|cloud\.baidu|fanyi\.baidu|graph\.baidu|baidu\.com$|so\.com\/s|weixin\.qq\.com|openfde/i;
const TITLE_GATE = /(AI|人工智能|大模型|AIGC|数字化|数智|智能|解决方案|服务商|集成商|交付|咨询|标注|培训|认证|转型|Agent|RPA|SaaS)/;
const STRONG_GATE = /(AI|人工智能|大模型|AIGC|数字化|数智|智能化|解决方案|服务商|集成|交付|咨询|标注|RPA|Agent|SaaS|算力)/gi;
function pageGated(url, title, text) {
  if (HOST_BLOCK.test(url)) return false;
  if (!TITLE_GATE.test(title)) return false;
  const density = (text.slice(0, 4000).match(STRONG_GATE) || []).length;
  return density >= 6;
}

// 候选校验
function cleanName(name) {
  return name.replace(/[（(][^（）()]*[）)]/g, "").replace(/[\s·・]/g, "").trim();
}
function validName(name, kind, occurs = 1) {
  // kind: 'legal' | 'label' | 'short'
  if (!name) return false;
  if (/^(微信|企业微信|飞书|钉钉)/.test(name)) return false;
  if (blacklisted(name, kind)) return false;
  // 高频提及的品牌可放宽结尾词限制（如 天润融通/xx智能装备类真实企业）
  if (kind === "short" && occurs >= 3) return true;
  return true;
}

// 抽取：blocks → 候选
function extractCandidates(blocks, fullText) {
  const out = new Map(); // name -> {name, region, src}
  const push = (name, region, src, block = "") => {
    const kind = src === "legal" ? "legal" : src === "label" ? "label" : src === "enum" ? "enum" : "short";
    // short 类候选要求块内出现公司语境，过滤功能短语
    if (kind === "short" && !/(公司|企业|成立|总部|集团|有限|厂商|服务商|供应商|解决方案|有限公司)/.test(block)) return;
    if (!validName(name, kind)) return;
    const k = cleanName(name);
    if (!k || k.length < 3) return;
    // 全路径去除地名前缀（如 杭州有年科技 → 有年科技）
    const lead = k.match(new RegExp(`^(${CITIES}|${PROVINCES})市?(?=[\\u4e00-\\u9fa5]{3,}$)`));
    let kname = k, kregion = region;
    if (lead && lead[1].length >= 2) {
      kname = k.slice(lead[0].length);
      if (!kregion) kregion = lead[1];
    }
    if (!validName(kname, kind)) return;
    if (out.has(kname)) {
      const cur = out.get(kname);
      if (kregion && !cur.region) cur.region = kregion;
    } else out.set(kname, { name: kname, region: kregion || null, src });
  };
  const cutAt = (s) => s.replace(/[（(【\[，。：:；;、“”"'}{]|已这|是一|旗下|官网|—|－|,|∣].*$/, "").trim();
  const legalRe = new RegExp(`([\\u4e00-\\u9fa5A-Za-z0-9·]{2,20}?)${LEGAL_MID}(?:股份|集团)?有限公司`, "g");
  const nearCityRe = new RegExp(
    `([\\u4e00-\\u9fa5]{4,16}?(?:科技|信息技术|数智|软件|数字|网络|咨询|算法|标注|人工智能|数据|云|通信|自动化))\\s*[（(]\\s*(${CITIES})\\s*[）)]`,
    "g"
  );
  const bulletRe = new RegExp(
    `^(?:[0-9]{1,3}[\\.、)）]\\s*|[一二三四五六七八九十]{1,3}[、\\.]\\s*|[•·\\-—*]\\s*)?([\\u4e00-\\u9fa5]{4,16}?(?:科技|信息技术|数智|软件|数字|网络|咨询|算法|标注|人工智能|数据|云|通信|自动化))(?![\\u4e00-\\u9fa5])(?:[（(]\\s*(${CITIES})\\s*[）)])?(?=$|[，。：:、,;；\\s]|(是一家)|(成立)|(总部)|(位于))`
  );
  const labelRe = /(?:企业名称|公司名称|企业名|公司名)\s*[:：]\s*([\u4e00-\u9fa5A-Za-z0-9·]{2,22})/g;
  const enumRe = /(如|包括|例如|均为|核心企业有|代表企业有|企业有|厂商有|玩家有|服务商有)[:：]?\s*([\u4e00-\u9fa5A-Za-z0-9·]{2,16}(?:[、,]\s*[\u4e00-\u9fa5A-Za-z0-9·]{2,16}){2,30})(?:等)(?:公司|企业|服务商|厂商|玩家)/g;
  for (const b of blocks) {
    let m;
    legalRe.lastIndex = 0;
    while ((m = legalRe.exec(b))) {
      let name = m[1];
      const lead = name.match(new RegExp(`^(${CITIES})市?(?=[\\u4e00-\\u9fa5]{3,})`));
      let region = null;
      if (lead) {
        region = lead[1];
        name = name.slice(lead[0].length);
      }
      push(name, region, "legal");
    }
    nearCityRe.lastIndex = 0;
    while ((m = nearCityRe.exec(b))) push(m[1], m[2], "short", b);
    labelRe.lastIndex = 0;
    while ((m = labelRe.exec(b))) push(cutAt(m[1]), null, "label", b);
    enumRe.lastIndex = 0;
    while ((m = enumRe.exec(b))) {
      for (const it of m[2].split(/[、,]/)) {
        const name = cutAt(it.trim());
        if (name) push(name, null, "enum", b);
      }
    }
    bulletRe.lastIndex = 0;
    if ((m = bulletRe.exec(b))) push(m[1], m[2] || null, "short", b);
  }
  // 枚举/短名兜底：全文出现 ≥3 次的品牌（可能是无标准后缀的真实企业）
  if (fullText) {
    for (const [k, v] of out) {
      const occurs = fullText.split(k).length - 1;
      if (occurs < 3 && v.src === "enum") out.delete(k);
      if (occurs < 2 && v.src === "label") out.delete(k);
    }
  }
  return [...out.values()];
}

function dominantCity(text, hint) {
  if (hint && new RegExp(hint).test(text)) return hint;
  const counts = {};
  const re = new RegExp(CITY_RE_STR, "g");
  let m, total = 0;
  while ((m = re.exec(text))) {
    counts[m[1]] = (counts[m[1]] || 0) + 1;
    total++;
    if (total > 400) break;
  }
  const best = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
  if (best && best[1] >= 3 && best[1] / Math.max(1, total) >= 0.2) return best[0];
  return null;
}

async function harvestPage(url, { type, city }, dry = false) {
  const html = await curl(url);
  if (dry) console.error(`DBG html len=${html?.length ?? 0}`);
  if (!html || html.length < 3000) return { n: 0, reason: "short" };
  const title = html.match(/<title>([^<]*)<\/title>/i)?.[1]?.trim() ?? "";
  const text = stripHtml(html);
  const gated = pageGated(url, title, text);
  if (dry) console.error(`DBG title=${title.slice(0, 50)} gated=${gated}`);
  if (!gated) return { n: 0, reason: "gate" };
  const pageCity = dominantCity(text, city);
  const cands = extractCandidates(toBlocks(html), text);
  let n = 0;
  for (const c of cands) {
    const region = c.region || pageCity || city || "中国";
    if (dry) {
      console.log(`  [${c.src}] ${c.name} | ${region}`);
      n++;
      continue;
    }
    const host = new URL(url).hostname.replace(/^www\./, "");
    const ok = addCompany({ name: c.name, region, type, website: null, note: `AI/数字化服务商｜来源:${host}` });
    if (ok) n++;
  }
  return { n, title };
}

// ---------- 搜索 ----------
const SKIP_HOST = /bing|microsoft|msn|go\.micro|beian|miit\.gov|baike|zhihu\.com|weixin\.qq\.com|openfde|gov\.cn|edu\.cn|zhidao|jingyan|wenku|baijiahao|tieba|riskbird|tianyancha|qcc\.com|aiqicha|qixin|11467|shuidi|sogou|so\.com|baidu\.com/i;
async function searchBingRss(q) {
  const html = await curl(`https://www.bing.com/search?q=${encodeURIComponent(q)}&format=rss&count=20`);
  const out = [];
  for (const m of html.matchAll(/<item>[\s\S]*?<link>([^<]+)<\/link>/g)) {
    const u = m[1].trim();
    if (/^https?:\/\//.test(u)) out.push(u);
  }
  return [...new Set(out)].filter((u) => !SKIP_HOST.test(u)).filter((u) => !/\.(png|jpe?g|css|js|ico|svg|pdf|docx?|xlsx?)$/i.test(u)).slice(0, 12);
}
async function searchSogou(q) {
  const html = await curl(`https://www.sogou.com/web?query=${encodeURIComponent(q)}&num=20`);
  if (/访问异常|验证码|antispider/i.test(html)) return [];
  const links = [...new Set([...html.matchAll(/href="(\/link\?url=[^"]+)"/g)].map((m) => `https://www.sogou.com${m[1].replace(/&amp;/g, "&")}`))].slice(0, 14);
  const out = [];
  for (const l of links) {
    const lp = await curl(l);
    const real =
      lp.match(/window\.location\.replace\("([^"]+)"\)/)?.[1] ||
      lp.match(/window\.location\.href\s*=\s*"([^"]+)"/)?.[1] ||
      lp.match(/url=([^"'<>]+)"/)?.[1] ||
      lp.match(/HTTP-EQUIV="refresh"[^>]*URL=([^"'>]+)/i)?.[1] ||
      "";
    await sleep(180);
    if (real && /^https?:\/\//.test(real)) out.push(real);
  }
  return out.filter((u) => !SKIP_HOST.test(u)).filter((u) => !/\.(png|jpe?g|css|js|ico|svg|pdf|docx?|xlsx?)$/i.test(u));
}
async function searchBing(q) {
  const html = await curl(`https://www.bing.com/search?q=${encodeURIComponent(q)}&form=QBLH&count=20`);
  return [
    ...new Set(
      [...html.matchAll(/href="(https?:\/\/[^"]+)"/g)]
        .map((m) => m[1])
        .filter((u) => !SKIP_HOST.test(u))
        .filter((u) => !/\.(png|jpe?g|css|js|ico|svg|pdf|docx?|xlsx?)$/i.test(u))
    ),
  ].slice(0, 12);
}
async function search(q) {
  let urls = await searchBingRss(q);
  if (urls.length < 3) {
    await sleep(1500);
    urls = await searchBing(q);
  }
  if (urls.length < 3) {
    await sleep(1500);
    urls = await searchSogou(q);
  }
  return urls;
}

// ---------- 查询矩阵 ----------
const TRACK_QUERIES = [
  "AI 交付服务商 名单", "大模型 实施商 名单", "AI 咨询 公司 排名", "企业数字化 服务商 名单",
  "AI Agent 服务商 中国 盘点", "大模型 集成商 TOP 名单", "AI 应用 解决方案商 名单", "数字化转型 服务商 AI 名单",
  "AI 数据标注 公司 名单", "人工智能 服务商 白皮书", "大模型 落地 服务商 盘点", "AIGC 服务商 名单",
  "AI toB 独角兽 名单", "人工智能 企业 名单 2024", "人工智能 企业 名单 2025", "AI 解决方案 商 百强",
  "数字员工 服务商 名单", "智能客服 公司 名单", "RPA 厂商 名单", "数据中台 公司 名单",
  "工业互联网 平台 名单", "AI 制造 解决方案 公司", "AI 医疗 公司 名单", "AI 金融 科技 公司 名单",
  "AI 法律 科技 公司", "AI 零售 科技 公司 名单", "AI 能源 解决方案 公司", "AI 政务 公司 名单",
  "AI 营销 服务商 名单", "AI 物流 科技 公司 名单", "AI 农业 科技 公司", "AI 汽车 软件 公司 名单",
  "AI 人力 外包 驻场 公司", "软件 外包 公司 排名 中国", "IT 服务 领军 企业 名单", "大数据 公司 名单 排行",
  "SaaS 公司 名单 2024", "云 厂商 名单 中国", "数据标注 外包 公司 有哪些", "大模型 中标 服务商",
  "AI 运营 服务商 名单", "智能网联 软件 服务商", "大模型 应用 开发 公司 名单", "AI Agent 创业 公司 toB 盘点",
  "企业服务 独角兽 AI 名单", "低代码 平台 厂商 名单", "AI 咨询 培训 公司", "数字孪生 公司 名单",
  "智慧城市 服务商 名单", "AI 智能体 公司 名单", "大模型 生态 伙伴 名单", "生成式AI 备案 公司 名单",
];
const TRAIN_QUERIES = [
  "AI 培训 认证 机构 有哪些", "人工智能 训练营 机构 名单", "大模型 培训 课程 机构", "数据分析 培训 认证 机构",
  "AI 人才 培养 机构 名单", "人工智能 职业培训 学校", "大模型 认证 考试 机构", "AI 训练营 城市 名单",
];
const CITY_LIST = [
  "北京", "上海", "深圳", "杭州", "广州", "苏州", "成都", "南京", "武汉", "西安", "合肥", "长沙", "重庆",
  "青岛", "郑州", "无锡", "宁波", "厦门", "济南", "沈阳", "福州", "昆明", "贵阳", "海口", "天津", "大连",
  "常州", "南通", "徐州", "烟台", "潍坊", "洛阳", "珠海", "东莞", "佛山", "温州", "绍兴", "嘉兴", "泰州",
  "泉州", "漳州", "南宁", "南昌", "太原", "石家庄", "长春", "哈尔滨", "兰州", "乌鲁木齐", "呼和浩特",
];
const INDUSTRIES = ["制造", "医疗", "金融", "法律", "教育", "零售", "物流", "能源", "政务", "地产", "农业", "文旅", "汽车", "建筑", "环保", "航空"];
function buildQueries(batch) {
  const qs = [];
  if (batch === 1) {
    for (const q of TRACK_QUERIES) qs.push({ q, type: "FDE服务商", city: null });
    for (const q of TRAIN_QUERIES) qs.push({ q, type: "认证与培训", city: null });
    for (const c of CITY_LIST) {
      qs.push({ q: `${c} AI 公司 服务商 名单`, type: "FDE服务商", city: c });
      qs.push({ q: `${c} 人工智能 企业 名单`, type: "FDE服务商", city: c });
    }
  } else {
    for (const ind of INDUSTRIES) {
      qs.push({ q: `${ind} AI 解决方案 公司`, type: "FDE服务商", city: null });
      qs.push({ q: `${ind} 数字化 服务商 AI 名单`, type: "FDE服务商", city: null });
    }
    for (const c of CITY_LIST) qs.push({ q: `${c} 数字化 AI 交付 服务商`, type: "FDE服务商", city: c });
    for (const c of CITY_LIST.slice(0, 26)) qs.push({ q: `${c} 软件 信息服务 企业 名单`, type: "FDE服务商", city: c });
    qs.push(
      { q: "专精特新 人工智能 服务商 名单", type: "FDE服务商", city: null },
      { q: "专精特新 小巨人 人工智能 企业 名单", type: "FDE服务商", city: null },
      { q: "AI 中标 项目 公司 排行 服务商", type: "FDE服务商", city: null },
      { q: "大模型 中标 公告 单位 盘点", type: "FDE服务商", city: null },
      { q: "数字化 项目 中标 服务商 统计", type: "FDE服务商", city: null },
      { q: "信息化 中标 服务商 排名", type: "FDE服务商", city: null },
      { q: "信创 人工智能 企业 名单", type: "FDE服务商", city: null },
      { q: "AI 算力 服务 商 名单", type: "FDE服务商", city: null },
      { q: "AI 数据 服务 商 盘点", type: "FDE服务商", city: null },
      { q: "智能 制造 系统集成 商 名单", type: "FDE服务商", city: null },
      { q: "弱电 智能化 系统集成 公司 名单", type: "FDE服务商", city: null },
      { q: "信息化 项目 集成商 名单", type: "FDE服务商", city: null },
      { q: "呼叫中心 外包 服务商 名单", type: "FDE服务商", city: null },
      { q: "IT 人力 外包 公司 排名", type: "FDE服务商", city: null },
      { q: "软件 驻场 开发 服务 公司", type: "FDE服务商", city: null },
      { q: "AI 解决方案 商 100 强", type: "FDE服务商", city: null },
      { q: "爱分析 大模型 服务商 榜单", type: "FDE服务商", city: null },
      { q: "艾瑞 AI 服务商 报告 名单", type: "FDE服务商", city: null },
      { q: "甲子光年 AI 公司 榜单", type: "FDE服务商", city: null },
      { q: "亿欧 AI 服务商 名单", type: "FDE服务商", city: null },
      { q: "数据猿 企业 盘点 服务商", type: "FDE服务商", city: null },
      { q: "互联网周刊 AI 企业 榜单", type: "FDE服务商", city: null },
      { q: "人工智能 产业图谱 服务商", type: "FDE服务商", city: null },
      { q: "IT 桔子 人工智能 公司 名单", type: "FDE服务商", city: null },
      { q: "企查查 人工智能 服务商 名单", type: "FDE服务商", city: null },
      { q: "AI 训练 数据 服务 商 名单", type: "FDE服务商", city: null },
      { q: "大模型 对话 数据 标注 公司", type: "FDE服务商", city: null },
      { q: "AI 外包 数据 标注 基地 名单", type: "FDE服务商", city: null },
      { q: "人工智能 数据 标注 产业 基地 城市", type: "FDE服务商", city: null },
      { q: "IT 培训 机构 排名 中国", type: "认证与培训", city: null },
      { q: "人工智能 培训 机构 排名 十大", type: "认证与培训", city: null },
      { q: "AI 训练营 大学 企业 合作 认证", type: "认证与培训", city: null },
      { q: "大数据 人才培养 基地 认证 机构", type: "认证与培训", city: null }
    );
  }
  return qs;
}

// ---------- 主流程 ----------
const processedUrls = new Set();
let inserted = 0, fetched = 0, searchCalls = 0;
const RESUME_FILE = path.join(ROOT, "pipeline", ".harvest-urls.txt");
async function loadResume() {
  try {
    for (const u of (await readFile(RESUME_FILE, "utf8")).split("\n").filter(Boolean)) processedUrls.add(u);
  } catch {}
}
function saveResume(url) {
  appendFile(RESUME_FILE, url + "\n").catch(() => {});
}

async function harvest(batch) {
  await loadResume();
  console.log(`== harvest 批次 ${batch}：查询数 ${buildQueries(batch).length}｜断点URL ${processedUrls.size} ==`);
  const queries = buildQueries(batch);
  console.log(`== harvest 批次 ${batch}：${queries.length} 个查询 ==`);
  for (const { q, type, city } of queries) {
    await diskGuard();
    let urls = await search(q);
    searchCalls++;
    if (urls.length < 3) {
      await sleep(3000);
      urls = await search(q);
      searchCalls++;
    }
    let qNew = 0;
    for (const u of urls) {
      if (processedUrls.has(u)) continue;
      processedUrls.add(u);
      saveResume(u);
      const { n } = await harvestPage(u, { type, city });
      fetched++;
      if (n > 0) {
        inserted += n;
        qNew += n;
        console.log(`  [${q}] ${new URL(u).hostname} +${n}`);
      }
      await sleep(350);
    }
    if (inserted % 1 === 0 && inserted > 0 && Math.floor(inserted / 50) !== Math.floor((inserted - qNew) / 50)) {
      console.log(`  == 累计新增 ${inserted}｜总数 ${db.prepare("SELECT COUNT(*) n FROM companies").get().n} ==`);
    }
    await sleep(1800);
  }
}

function seedRun() {
  let n = 0;
  for (const [name, region, website, type, note] of SEEDS) {
    const ok = addCompany({ name, region, type, website, note: `${note}｜人工核验` });
    if (ok) n++;
    else console.log(`  - 跳过(重复) ${name}`);
  }
  console.log(`== seeds 完成：新增 ${n}，总数 ${db.prepare("SELECT COUNT(*) n FROM companies").get().n} ==`);
}

function backfillRun() {
  const MAP = {
    明略科技: "北京", 中科闻歌: "北京", 海致星图: "北京", 通付盾: "苏州", 微亿智造: "常州", 海纳AI: "北京",
    汉得信息: "上海", 软通动力: "北京", 中软国际: "北京", 法本信息: "深圳", 博彦科技: "北京", "澳鹏 Appen": "上海",
  };
  const rows = db.prepare("SELECT id, name FROM companies WHERE region IS NULL OR region=''").all();
  let n = 0;
  for (const r of rows) {
    const reg = MAP[r.name];
    if (reg) {
      db.prepare("UPDATE companies SET region=? WHERE id=?").run(reg, r.id);
      n++;
    }
  }
  console.log(`== backfill 完成：更新 ${n} ==`);
}

const [, , cmd = "all", arg = "1"] = process.argv;
await diskGuard();
if (cmd === "test" && arg && arg.startsWith("http")) {
  await harvestPage(arg, { type: "FDE服务商", city: null }, true);
  process.exit(0);
}
if (cmd === "seeds" || cmd === "all") seedRun();
if (cmd === "backfill" || cmd === "all") backfillRun();
if (cmd === "harvest" || cmd === "all") await harvest(Number(arg) || 1);
const total = db.prepare("SELECT COUNT(*) n FROM companies").get().n;
const noRegion = db.prepare("SELECT COUNT(*) n FROM companies WHERE region IS NULL OR region=''").get().n;
console.log(`== done == 总数 ${total}｜无地域 ${noRegion}｜本次新增 ${inserted}｜搜索 ${searchCalls}｜抓页 ${fetched}`);
