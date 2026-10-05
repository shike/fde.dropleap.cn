import Link from "next/link";
import { siteStats, listPersons, recentPersons } from "@/lib/db";
import { PersonCard } from "@/components/PersonCard";

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "https://fde.dropleap.cn";

function JsonLd({ data }: { data: object }) {
  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(data) }} />;
}


export default async function Home() {
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "WebSite",
    name: "中国 FDE 名录",
    alternateName: "China FDE Directory",
    url: SITE_URL,
    description: "中国最权威的 Forward Deployed Engineer（前置部署工程师）名录",
    inLanguage: "zh-CN",
  };
  const stats = siteStats();
  const recent = recentPersons(8);
  const lastRun = stats.lastRun ? stats.lastRun.slice(0, 10) : "—";

  return (
    <div className="space-y-16">
      <JsonLd data={jsonLd} />
      {/* Hero */}
      <section className="pt-6 text-center">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-indigo-600">
          China FDE Directory · Est. 2026
        </p>
        <h1 className="mt-4 text-4xl font-bold leading-tight tracking-tight sm:text-5xl">
          中国 FDE 名录
        </h1>
        <p className="mx-auto mt-5 max-w-2xl text-base leading-relaxed text-neutral-500">
          收录在中国大陆一线交付的 Forward Deployed Engineer，
          以及延伸岗位与中国 AI 从业者大名单。
          <br className="hidden sm:block" />
          全部条目来自公开渠道、附证据链接，按城市归属分类，每日更新。
        </p>
        <div className="mx-auto mt-8 flex max-w-md items-center gap-2">
          <form action="/persons" className="flex flex-1 gap-2">
            <input
              name="q"
              placeholder="搜索：登录名 / 公司 / 简介…"
              className="h-11 flex-1 rounded-xl border border-neutral-200 bg-white px-4 text-sm outline-none transition-colors placeholder:text-neutral-300 focus:border-indigo-400 focus:ring-4 focus:ring-indigo-50"
            />
            <button className="h-11 rounded-xl bg-neutral-900 px-5 text-sm font-medium text-white transition-colors hover:bg-neutral-700">
              搜索
            </button>
          </form>
        </div>
        <div className="mx-auto mt-10 grid max-w-2xl grid-cols-2 gap-px overflow-hidden rounded-2xl border border-neutral-200 bg-neutral-200 sm:grid-cols-4">
          {[
            { label: "收录人物", value: stats.persons, suffix: "人" },
            { label: "案例 / 资料", value: stats.cases, suffix: "条" },
            { label: "覆盖公司", value: stats.companies, suffix: "家" },
            { label: "最近更新", value: lastRun, suffix: "" },
          ].map((s) => (
            <div key={s.label} className="bg-white px-4 py-5">
              <dd className="tnum text-2xl font-bold tracking-tight">
                {s.value}
                <span className="ml-0.5 text-sm font-normal text-neutral-400">{s.suffix}</span>
              </dd>
              <dt className="mt-1 text-xs text-neutral-400">{s.label}</dt>
            </div>
          ))}
        </div>
      </section>

      {/* 最新收录 */}
      <section>
        <div className="flex items-baseline gap-3">
          <h2 className="text-xl font-bold tracking-tight">最新收录</h2>
          <Link href="/persons" className="ml-auto text-sm text-neutral-400 transition-colors hover:text-neutral-900">
            浏览全部 →
          </Link>
        </div>
        <div className="mt-5 grid gap-4 md:grid-cols-2">
          {recent.map((p) => (
            <PersonCard key={p.id} p={p as never} />
          ))}
        </div>
      </section>

      {/* 模块导航 */}
      <section className="grid gap-4 md:grid-cols-3">
        {[
          { href: "/cases", title: "案例与资料", desc: "方法论、行业报道、大会实录与政策解读，站内阅读" },
          { href: "/companies", title: "公司名录", desc: "FDE / AI 落地相关公司图谱，按城市归属" },
          { href: "/policies", title: "政策库", desc: "各地各部门围绕 FDE 与 AI 落地的政策清单" },
        ].map((m) => (
          <Link
            key={m.href}
            href={m.href}
            className="card-lift rounded-2xl border border-neutral-200 bg-white p-6"
          >
            <h3 className="font-bold tracking-tight">{m.title}</h3>
            <p className="mt-2 text-sm leading-relaxed text-neutral-500">{m.desc}</p>
            <span className="mt-3 inline-block text-sm text-indigo-600">进入 →</span>
          </Link>
        ))}
      </section>

      {/* 标准 + 自荐 CTA */}
      <section className="grid gap-4 md:grid-cols-2">
        <div className="rounded-2xl border border-neutral-200 bg-white p-7">
          <h3 className="font-bold">收录标准（严口径）</h3>
          <ol className="mt-4 list-decimal space-y-2 pl-5 text-sm leading-relaxed text-neutral-500">
            <li>驻场或深度贴近客户工作</li>
            <li>亲手用技术手段解决客户具体问题</li>
            <li>对交付结果负责</li>
          </ol>
          <p className="mt-4 text-xs leading-relaxed text-neutral-400">
            核心名录仅收中国大陆、公开自述身份者；营销培训号不收；提及≠自述。
            <Link href="/about" className="ml-1 underline hover:text-neutral-700">完整标准 →</Link>
          </p>
        </div>
        <div className="flex flex-col justify-between rounded-2xl bg-neutral-900 p-7 text-white">
          <div>
            <h3 className="font-bold">你就是 FDE？</h3>
            <p className="mt-3 text-sm leading-relaxed text-neutral-300">
              扫码加主理人微信自荐，审核通过即收录——
              和数万名一线实践者出现在同一张地图上。
            </p>
          </div>
          <Link
            href="/nominate"
            className="mt-6 inline-flex w-fit items-center rounded-xl bg-white px-5 py-2.5 text-sm font-semibold text-neutral-900 transition-colors hover:bg-neutral-200"
          >
            自荐上榜 →
          </Link>
        </div>
      </section>
    </div>
  );
}
