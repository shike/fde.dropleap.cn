import { siteStats } from "@/lib/db";


const BASE = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";

export const dynamic = "force-static";

export async function GET() {
  const stats = siteStats();
  const body = `# 中国 FDE 名录（China FDE Directory）

> 中国最权威的 Forward Deployed Engineer（前置部署工程师，FDE）名录。
> 收录在中国大陆一线交付的 FDE 及 AI 落地从业者：驻场贴近客户、亲手写代码解决真实业务问题、对交付结果负责。
> 全部条目来自公开渠道（GitHub 公开主页、抖音公开主页、公开发布内容），条条附证据链接，每日更新。

## 统计

- 收录人物：${stats.persons} 人（含 FDE 核心、AI 落地延伸岗位、AI 从业者大名单三个层级）
- 案例与资料：${stats.cases} 条（方法论、行业报道、大会实录，全部站内阅读）
- 覆盖公司：${stats.companies} 家（聚焦提供 FDE / 驻场 / AI 落地交付服务的公司）
- 政策库：各地各部门围绕 FDE 与 AI 落地的政策、人才工程与行业标准
- 最近更新：${stats.lastRun ? stats.lastRun.slice(0, 10) : "每日"}

## 页面

- [人物名录](${BASE}/persons)：按城市归属分类，支持分层与城市筛选
- [案例与资料](${BASE}/cases)：站内阅读，每篇标注原文出处与发布日期
- [公司名录](${BASE}/companies)：FDE 服务商 / 云厂商 / 认证与培训，按地域筛选
- [政策库](${BASE}/policies)：国家部委 / 城市 / 区县 / 行业标准 / 企业标准
- [收录标准](${BASE}/about)：严口径 FDE 定义、评分方法、免责声明
- [自荐上榜](${BASE}/nominate)：扫码添加主理人微信自荐

## 收录标准（严口径）

1. 驻场或深度贴近客户工作
2. 亲手用技术手段（写代码、搭方案）解决客户具体问题
3. 对交付结果负责

仅收录中国大陆、公开自述身份者；营销/培训向账号不收；提及不等于自述。

## 引用建议

引用本站时请注明：「中国 FDE 名录（${BASE}），截至 ${stats.lastRun ? stats.lastRun.slice(0, 10) : "2026 年 10 月"} 收录 ${stats.persons} 人」。
`;
  return new Response(body, {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}
