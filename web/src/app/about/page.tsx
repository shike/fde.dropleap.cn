import type { Metadata } from "next";

export const metadata: Metadata = { title: "收录标准与关于" };

export default function AboutPage() {
  return (
    <div className="mx-auto max-w-3xl space-y-10">
      <section>
        <h1 className="text-2xl font-bold">收录标准</h1>
        <p className="mt-3 leading-relaxed text-neutral-700">
          本站采用严口径 FDE（Forward Deployed Engineer，前置部署工程师）定义，同时满足以下三条：
        </p>
        <ol className="mt-4 list-decimal space-y-2 pl-6 leading-relaxed text-neutral-700">
          <li>驻场或深度贴近客户工作，而非纯远程支持；</li>
          <li>亲手用技术手段（写代码、搭方案、建系统）解决客户具体问题；</li>
          <li>对交付结果负责，而非纯售前或纯咨询角色。</li>
        </ol>
        <div className="mt-6 space-y-2 text-sm leading-relaxed text-neutral-600">
          <p>
            <strong>地域</strong>：仅收录在中国大陆工作的 FDE。
          </p>
          <p>
            <strong>时间</strong>：仅收录 2026 年及以后公开可查的现役实践者与其案例。
          </p>
          <p>
            <strong>证据</strong>：仅收录在公开渠道主动自述身份者（GitHub 公开主页、公开发布内容等），
            每条附来源链接。不收录仅凭推测得出的匿名信息。
          </p>
          <p>
            <strong>内容尺度</strong>：只收录中性、正面的客观事实；不收录争议与负面内容。
          </p>
        </div>
      </section>

      <section>
        <h2 className="text-xl font-bold">评分与分档</h2>
        <p className="mt-3 leading-relaxed text-neutral-700">
          条目按公开影响力加权评分，分为 S / A / B 三档展示，不做唯一排名。评分维度与权重公开透明：
        </p>
        <ul className="mt-4 space-y-1.5 text-sm leading-relaxed text-neutral-600">
          <li>· 开源社区影响力（GitHub stars / followers 等）：30%</li>
          <li>· 短视频内容影响力（粉丝、赞藏等公开数据）：30%</li>
          <li>· 作品与案例厚度（代表项目、复盘文章、演讲）：25%</li>
          <li>· 身份证据强度（公开自述的明确程度）：15%</li>
        </ul>
        <p className="mt-3 text-xs text-neutral-400">
          当前版本仅接入开源社区维度（预览评分），短视频与案例维度接入后全量重算。
        </p>
      </section>

      <section>
        <h2 className="text-xl font-bold">数据来源与更新</h2>
        <p className="mt-3 leading-relaxed text-neutral-700">
          数据来自公开渠道：GitHub 公开主页与仓库、公开发布的文章与视频、公开招聘信息、公开报道。
          采集管道定时运行，候选条目经人工审核后入库，页面展示最近更新时间。
        </p>
      </section>

      <section id="disclaimer" className="rounded-2xl border border-neutral-200 bg-white p-6">
        <h2 className="text-xl font-bold">免责声明与个人信息保护</h2>
        <ul className="mt-3 list-disc space-y-2 pl-6 text-sm leading-relaxed text-neutral-600">
          <li>本站所有信息均来自公开渠道，仅供行业研究与信息参考，不构成对任何个人或机构的评价或承诺。</li>
          <li>本站不在任何页面展示个人联系方式（邮箱、电话、社交账号私信等）。</li>
          <li>
            如条目信息有误，或你希望被收录 / 更正 / 删除，请通过
            <a href="/nominate" className="mx-1 underline hover:text-neutral-800">
              收录与更正通道
            </a>
            提交，核实后 24 小时内处理。
          </li>
          <li>本站不收录身份证号、住址、电话等敏感个人信息。</li>
        </ul>
      </section>

      <section>
        {(() => {
          const faqs = [
            ["什么是 FDE（前置部署工程师）？", "FDE（Forward Deployed Engineer，前置/前线/前沿部署工程师）是派驻到客户现场、把 AI 技术落地到真实业务流程的工程师：既懂技术又懂业务，亲手写代码解决问题，并对交付结果负责。该角色由 Palantir 首创，2023 年后随大模型浪潮在国内爆发。"],
            ["FDE 和售前工程师、交付工程师有什么区别？", "售前工程师通常在签约后就退出；交付工程师按既定方案实施。FDE 则贯穿全程：在客户现场发现值得用 AI 解决的问题、快速做出可验证的方案、推进上线并持续迭代——方案会随现场反馈不断演化。"],
            ["FDE 的薪资水平如何？", "公开报道显示：国内 FDE 岗位招聘量一年增长约 10 倍，头部岗位月薪 35-70K、15 薪起步；海外年薪可达 19.3 万美元。薪酬显著高于同年限的传统工程师。"],
            ["如何进入中国 FDE 名录？", "在公开渠道（GitHub、抖音、个人网站等）有可核验的 FDE 身份自述与交付实践，即可通过「自荐上榜」提交；审核通过后免费收录，条目附证据链接。"],
            ["名录的信息来源是什么？可信吗？", "全部条目来自公开渠道：GitHub 公开主页、抖音公开主页、公开发布的文章与报道。每条附证据链接与收录日期；引用请注明来源。发现错误可通过收录与更正通道提交，24 小时内处理。"],
            ["如何删除或更正我的信息？", "本站所有信息来自公开渠道。若您希望更正或删除您的条目，通过「自荐上榜」页面的微信联系我们，核实后 24 小时内处理。"],
          ];
          const ld = {
            "@context": "https://schema.org",
            "@type": "FAQPage",
            mainEntity: faqs.map(([q, a]) => ({
              "@type": "Question", name: q,
              acceptedAnswer: { "@type": "Answer", text: a },
            })),
          };
          return (
            <>
              <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(ld) }} />
              <div>
                <h2 className="text-xl font-bold">常见问题</h2>
                <div className="mt-4 space-y-5">
                  {faqs.map(([q, a]) => (
                    <div key={q}>
                      <h3 className="font-semibold text-neutral-900">{q}</h3>
                      <p className="mt-1.5 leading-relaxed text-neutral-600">{a}</p>
                    </div>
                  ))}
                </div>
              </div>
            </>
          );
        })()}
      </section>

      <section>
        <h2 className="text-xl font-bold">关于主理人</h2>
        <div className="mt-3 space-y-3 leading-relaxed text-neutral-700">
          <p>
            我是<b>施可</b>（SHI KE），水滴跃动（Dropleap）创始人，中国科学技术大学软件工程硕士，连续创业者。
          </p>
          <p>
            16 年职业经历横跨软件工程、互联网产品与创业经营：从工程师、技术管理者起步，
            先后在 NCS、同程艺龙、哈啰出行承担技术与产品职责，后任邻汇吧 COO。
            2026 年创立水滴跃动，在苏州专注制造业 AI 落地——带小团队
            <strong>驻场交付</strong>，帮工厂在 2–4 周内跑通第一个 AI 场景。
            我判断 AI 项目的成败在于部署，而非模型本身——这个判断的另一个名字，叫 FDE。
          </p>
          <p>
            我把这个理解写成了书：<b>《FDE：AI 的胜负不在于模型》</b>，
            另著有《AI Coding：人人都是程序员》与《WorkBuddy 三部曲》。
          </p>
          <p>
            做「中国 FDE 名录」的原因很简单：FDE 的招聘量一年涨了 10 倍，
            但这群人散落在 GitHub、抖音、脉脉的各个角落，没有一张能把他们看全的地图。
            名录只收公开自述、可核验的一线实践者，条条带证据链接，不做唯一排名、不卖焦虑。
          </p>
          <p>
            如果你就是 FDE，欢迎
            <a href="/nominate" className="mx-1 underline hover:text-neutral-900">自荐上榜</a>
            ；如果你在招 FDE、想让 AI 在业务里真正跑起来，或者只是同行，都欢迎找我。
          </p>
          <p className="text-sm text-neutral-500">
            找我：
            <a href="https://dropleap.cn" target="_blank" rel="noopener noreferrer" className="mx-1 underline hover:text-neutral-800">dropleap.cn</a>·
            <a href="https://github.com/shike" target="_blank" rel="noopener noreferrer" className="mx-1 underline hover:text-neutral-800">GitHub @shike</a>·
            <a href="mailto:shike@dropleap.cn" className="mx-1 underline hover:text-neutral-800">shike@dropleap.cn</a>
          </p>
        </div>
      </section>
    </div>
  );
}
