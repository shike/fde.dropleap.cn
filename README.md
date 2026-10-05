# 中国 FDE 名录 · fde-directory

中国最权威的 Forward Deployed Engineer（前置部署工程师）名录：人物、案例、公司三库联动，持续更新。

项目定义、收录标准、合规红线见 **[SPEC.md](./SPEC.md)**（唯一标准，改口径先改它）。

## 结构

```
├── SPEC.md                  # 项目宪法：定位 / 收录标准 / 合规 / 路线图
├── pipeline/                # A线：数据采集
│   ├── collect.mjs          # GitHub bio 自述 → 候选池（core/edge 双层，--resume 补拉，--edge 只跑边缘层）
│   ├── collect-githubpages.mjs  # GitHub Pages/简介仓库通道（提及≠自述，弱证据自动降级）
│   ├── re-mine-rejects.mjs  # 空location拒绝者的仓库/个人站二次挖掘
│   ├── convert-cs-seeds.mjs # content-studio 生产库种子 → 抖音候选（只读拉取）
│   ├── ingest-douyin.mjs    # 抖音资料入库
│   ├── reclassify-douyin.mjs # 抖音严选：营销/培训号不收（SPEC §2.4 判例）
│   ├── seed-companies.mjs   # 公司库种子
│   └── seed-cases.mjs       # 案例库种子
├── data/
│   └── fde.db               # SQLite：persons / person_contacts / companies / cases / nominations / search_hits
├── reports/                 # 每轮采集的池子规模报告
└── web/                     # B线：Next.js 16 站点（App Router + Tailwind 4）
```

## 常用命令

```bash
# 采集（需 gh CLI 已登录；写入 data/fde.db 并生成 reports/pool-size-<date>.md）
node pipeline/collect.mjs

# 公司库种子
node pipeline/seed-companies.mjs

# 站点（在 web/ 目录）
pnpm install
pnpm dev      # 开发 http://localhost:3000
pnpm build && pnpm start
```

## 数据安全红线（写代码前必读）

1. **`person_contacts` 表任何 Web 查询不得读取**（`web/src/lib/db.ts` 顶部有红线注释）——联系方式只供 pipeline 离线商务使用，页面永不展示。
2. 站点必须保留「收录/更正/删除」通道（`/nominate`）与免责声明。
3. 只收中性正面内容；负面争议一律不入库。
4. 每条数据必须带来源链接与收录时间。

## 状态说明（2026-10-05 起：人物无审核概念）

人物采集即上站，无审核环节。质量把控全部前置到采集端（质量闸脚本自动执行）：
- rejected = 采集端过滤（组织账号/海外/提及≠自述/营销号），不是"待审"
- 上站人物 = status IN (candidate, approved)，两者无实质区别
- candidate 池快速通道：sqlite3 data/fde.db "SELECT login,score,bio FROM persons WHERE status='candidate' ORDER BY score DESC;"
