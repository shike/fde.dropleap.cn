# 中国 FDE 名录 · China FDE Directory

> 中国最权威的 Forward Deployed Engineer（前置部署工程师）名录
> 线上地址：**[https://fde.dropleap.cn](https://fde.dropleap.cn)**

收录在中国大陆一线交付的 FDE 与 AI 落地从业者，以及延伸岗位、AI 从业者大名单、
交付服务商、行业案例与各地政策——四个库相互关联，条条附证据链接，每日更新。

| 库 | 规模 | 说明 |
|---|---|---|
| 人物 | 5,500+ | FDE 核心（严口径）/ 延伸岗位 / AI 从业者三层，按城市归属分类 |
| 案例与资料 | 300+ | 方法论、行业报道、大会实录，站内阅读，97%+ 带原站发布日期 |
| 公司 | 140+ | FDE 服务商 / 云厂商 / 认证与培训，覆盖 19+ 城，全部标注总部地域 |
| 政策 | 100+ | 国家部委 / 城市 / 区县 / 行业标准 / 企业标准，23 个地域 |

## 收录标准（严口径）

1. 驻场或深度贴近客户工作
2. 亲手用技术手段解决客户具体问题
3. 对交付结果负责

仅收录中国大陆、公开渠道可核验者；营销/培训向账号不收；**提及不等于自述**。
完整标准见[收录标准页](https://fde.dropleap.cn/about)。

## 功能特性

- **四库联动**：人物、案例、公司、政策互相引用关联
- **城市归属分类**：全量条目按总部/常驻城市归一，Tab 筛选 + 分页
- **评分分层**：按公开影响力加权评分，分档展示
- **SEO + GEO 就绪**：SSR 预渲染 5,900+ 页面、sitemap、JSON-LD（WebSite/Person/Article/FAQPage）、llms.txt、FAQ 结构化数据
- **合规内建**：全站不展示任何个人联系方式；收录/更正/删除通道；免责声明

## 技术架构

```
数据源（GitHub / 抖音 / 搜索引擎 / 公开报道）
  ↓ 采集管道（质量闸：提及≠自述、营销号不收、地域坐实）
SQLite（单文件库：persons / cases / companies / policies）
  ↓ export-site-data（数据 → JSON 包）
Next.js（output: export，5,900+ 页面构建期预渲染）
  ↓ rsync
nginx（纯静态，零动态进程）
```

- **站点**：Next.js 16（App Router + 静态导出）+ Tailwind CSS 4 + better-sqlite3
- **采集管道**：Node 22 脚本（GitHub API / Playwright / 多搜索引擎），无重型依赖
- **部署**：纯静态产物，任意 nginx / 对象存储 + CDN 可托管

## 目录结构

```
├── SPEC.md            # 项目标准文档（收录标准 / 合规 / 路线图）
├── pipeline/          # 数据管道：采集、清洗、验真、分层入库、导出
├── data/              # SQLite 数据库（不入库，见 .gitignore）
├── reports/           # 采集规模与质量报告
├── deploy/            # nginx 配置模板
├── scripts/           # 构建部署脚本
└── web/               # Next.js 站点
    ├── src/app/       # 页面（人物/案例/公司/政策/收录标准/自荐）
    ├── src/components/# 卡片与组件
    └── public/data/   # 构建期生成的数据 JSON（不入库）
```

## 本地运行

```bash
# 1. 准备数据（需要本地 SQLite 数据库 data/fde.db，由采集管道生成）
node pipeline/export-site-data.mjs

# 2. 安装依赖并构建
cd web && pnpm install && pnpm build

# 3. 本地预览（静态产物在 web/out/）
npx serve out
```

## 数据更新

每日 5 点自动执行五步增量管道：发现 → 自述检测 → 信息加深 → 城市归一 → 政策采集。
更新数据库后重新导出 + 构建即可刷新站点：

```bash
node pipeline/export-site-data.mjs && cd web && pnpm build
```

## 部署

```bash
bash scripts/deploy-static.sh   # rsync 静态产物到服务器（目标可配置）
```

## 免责声明

本站所有信息来自公开渠道（GitHub 公开主页、抖音公开主页、公开发布内容），
仅供行业研究与信息参考，不构成对任何个人或机构的评价或承诺。
本站不展示任何个人联系方式。条目有误或希望收录/更正/删除，
请通过[自荐与更正通道](https://fde.dropleap.cn/nominate)提交，核实后 24 小时内处理。

## License

[MIT](./LICENSE) © 2026 shike（站内案例与资料的版权归原作者所有，条目均标注原文出处）
