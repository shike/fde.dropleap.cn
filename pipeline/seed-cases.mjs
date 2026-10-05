#!/usr/bin/env node
/** 案例库种子：公开搜索发现的 FDE 相关中文内容（URL 仅域名级的标记 status 注释，待精确） */
import { DatabaseSync } from "node:sqlite";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const db = new DatabaseSync(path.join(ROOT, "data", "fde.db"));
db.exec(`
CREATE TABLE IF NOT EXISTS cases (
  id INTEGER PRIMARY KEY, title TEXT, slug TEXT UNIQUE, type TEXT,
  url TEXT, person_id INTEGER, company_id INTEGER, summary TEXT,
  published_at TEXT, source_url TEXT, status TEXT DEFAULT 'candidate',
  collected_at TEXT
);
`);

const CASES = [
  ["article", "Demo 都跑通了，为什么企业反而开始抢FDE？", "https://www.53ai.com", "企业AI项目需求模糊的落地难题、FDE 的定义与核心价值、解决问题的关键步骤（追问问题、拆解目标）", "2026-09-02"],
  ["article", "FDE前沿部署工程师深度解析：从大模型落地到职业发展路线", "https://bbs.csdn.net", "FDE 解决什么问题、日常工作、在招公司、薪资与职业发展路线", "2026-09-24"],
  ["article", "FDE前线部署工程师：AI Agent落地与Skill体系的前线共创模式", "https://blog.csdn.net", "FDE 把工程能力推到业务最前线：需求确认、方案设计、原型验证、上线调优压缩进一个角色", "2026-09-28"],
  ["article", "FDE（前沿部署工程师）崛起与AI的业务落地深水区", "https://juejin.cn", "Indeed 招聘数据与科技巨头布局：FDE 成为连接 AI 技术与企业业务的关键桥梁", "2026-05-26"],
  ["article", "驻场：FDE的工作方法", "https://zhuanlan.zhihu.com", "引用《Forward Deployed Engineering 指南》，讨论 FDE 的第一种反模式「驻场化」", "2026"],
  ["media", "一文带你全面了解FDE：让AI变成真正的生产力", "https://news.qq.com", "FDE 岗位科普：把通用 AI 技术方案在客户组织内落地交付的工程师", "2026"],
  ["media", "打造AI落地「特种兵」，徐汇首期FDE专题培训创智开讲", "https://news.qq.com", "上海徐汇区开办首期 FDE 专题培训——地方政府入场信号", "2026"],
  ["media", "对谈课：高手怎么用AI？普通人怎么学AI？投资人如何投AI？", "https://www.xiaoyuzhoufm.com", "播客：FDE 是既有工种（售前/客户成功/驻场）的重新命名，人才缺口巨大", "2026-06-10"],
  ["article", "源自Palantir的FDE（前线部署工程师），AI to B 的银弹？", "https://cloud.tencent.com", "Palantir 与 OpenAI 验证的「产品化咨询」模式：技术栈 × 业务理解", "2026"],
];

const now = new Date().toISOString();
let n = 0;
for (const [type, title, url, summary, publishedAt] of CASES) {
  const slug = createHash("md5").update(title).digest("hex").slice(0, 12);
  const info = db
    .prepare(
      `INSERT INTO cases (title, slug, type, url, summary, published_at, source_url, status, collected_at)
       VALUES (?,?,?,?,?,?,?, 'candidate', ?)
       ON CONFLICT(slug) DO NOTHING`
    )
    .run(title, slug, type, url, summary, publishedAt, url, now);
  n += info.changes;
}
// 公司证据：科大讯飞 2026 半年报公开披露 FDE 驻场服务
db.prepare(
  "UPDATE companies SET fde_team_known=1, notes=? WHERE slug='iflytek'"
).run("2026 半年报公开披露：通过 FDE 驻场服务开展数据治理、模型调优、工作流编排（来源：公开财报）");
console.log(`seeded ${n} cases; iflytek marked verified`);
