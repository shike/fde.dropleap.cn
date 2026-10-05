import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { getPerson, topRepos } from "@/lib/db";

export function generateStaticParams() {
  const Database = require("better-sqlite3");
  const path = require("node:path");
  const p = process.env.FDE_DB ?? path.resolve(process.cwd(), "..", "data", "fde.db");
  const rows = new Database(p, { readonly: true })
    .prepare("SELECT login FROM persons WHERE status IN ('candidate','approved')")
    .all() as { login: string }[];
  return rows.map((r) => ({ login: encodeURIComponent(r.login) }));
}


export async function generateMetadata({
  params,
}: {
  params: Promise<{ login: string }>;
}): Promise<Metadata> {
  const { login } = await params;
  const p = getPerson(login);
  return { title: p ? `${p.name ?? p.login} · 人物` : "人物" };
}

export default async function PersonPage({ params }: { params: Promise<{ login: string }> }) {
  const { login: rawLogin } = await params;
  const p = getPerson(decodeURIComponent(rawLogin));
  if (!p) notFound();
  const personLd = {
    "@context": "https://schema.org",
    "@type": "Person",
    name: p.name ?? p.login,
    alternateName: p.login,
    description: p.bio ?? undefined,
    jobTitle: "FDE (Forward Deployed Engineer)",
    address: p.city ? { "@type": "PostalAddress", addressLocality: p.city, addressCountry: "CN" } : undefined,
    url: p.html_url ?? undefined,
    knowsAbout: (p.tags ?? "").split(",").filter(Boolean),
  };
  const repos = topRepos(p);
  const isDouyin = p.platform === "douyin";

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(personLd) }} />
      <Link href="/persons" className="text-sm text-neutral-400 transition-colors hover:text-neutral-900">
        ← 返回名录
      </Link>

      {/* 头部 */}
      <section className="overflow-hidden rounded-2xl border border-neutral-200 bg-white">
        <div className="h-24 bg-gradient-to-r from-neutral-900 via-neutral-800 to-neutral-700" />
        <div className="px-6 pb-6">
          <div className="-mt-10 flex flex-wrap items-end gap-4">
            {p.avatar_file ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={p.avatar_file}
                alt={p.name ?? p.login}
                className="h-20 w-20 rounded-2xl border-4 border-white object-cover shadow-md"
              />
            ) : (
              <div className="flex h-20 w-20 items-center justify-center rounded-2xl border-4 border-white bg-neutral-900 text-2xl font-bold text-white shadow-md">
                {(p.name ?? p.login ?? "?").slice(0, 1).toUpperCase()}
              </div>
            )}
            <div className="flex flex-wrap items-center gap-2.5 pb-1">
              <h1 className="text-2xl font-bold tracking-tight">{p.name ?? p.login}</h1>
              {isDouyin && (
                <span className="rounded bg-neutral-900 px-1.5 py-0.5 text-[10px] font-bold text-white">抖音</span>
              )}
            </div>
          </div>

          <p className="mt-4 text-sm text-neutral-400">
            {isDouyin ? (
              <a
                href={p.html_url ?? "#"}
                target="_blank"
                rel="noopener noreferrer"
                className="underline decoration-neutral-300 underline-offset-4 hover:text-neutral-700"
              >
                抖音主页 ↗
              </a>
            ) : p.platform === "web" ? (
              p.html_url ? (
                <a
                  href={p.html_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline decoration-neutral-300 underline-offset-4 hover:text-neutral-700"
                >
                  个人主页 ↗
                </a>
              ) : (
                "行业人物（身份证据见下方）"
              )
            ) : (
              <>
                <a
                  href={p.html_url ?? `https://github.com/${p.login}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline decoration-neutral-300 underline-offset-4 hover:text-neutral-700"
                >
                  GitHub @{p.login} ↗
                </a>
                {p.blog && (
                  <>
                    {" · "}
                    <a href={p.blog} target="_blank" rel="noopener noreferrer" className="underline decoration-neutral-300 underline-offset-4 hover:text-neutral-700">
                      个人主页 ↗
                    </a>
                  </>
                )}
              </>
            )}
          </p>
          <p className="mt-4 leading-relaxed text-neutral-700">{p.bio ?? "（未填写简介）"}</p>

          <dl className="tnum mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[
              ["公司", p.company ?? "—"],
              ["位置", p.location ?? "—"],
              ["Stars", p.platform === "github" ? p.stars_total.toLocaleString() : "—"],
              ["粉丝 / 仓库", p.platform === "github" ? p.followers.toLocaleString() : p.followers.toLocaleString()],
            ].map(([k, v]) => (
              <div key={k} className="rounded-xl bg-neutral-50 px-4 py-3">
                <dt className="text-xs text-neutral-400">{k}</dt>
                <dd className="mt-1 truncate text-sm font-semibold">{v}</dd>
              </div>
            ))}
          </dl>

          <p className="mt-4 text-xs leading-relaxed text-neutral-400"></p>
        </div>
      </section>

      {repos.length > 0 && (
        <section className="rounded-2xl border border-neutral-200 bg-white p-6">
          <h2 className="font-bold tracking-tight">代表作品 / 项目</h2>
          <ul className="mt-4 divide-y divide-neutral-100">
            {repos.map((r) => (
              <li key={r.url} className="flex items-baseline gap-3 py-2.5 text-sm">
                <a
                  href={r.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="shrink-0 font-medium underline decoration-neutral-200 underline-offset-4 hover:decoration-neutral-800"
                >
                  {r.name}
                </a>
                <span className="tnum shrink-0 text-xs text-neutral-400">⭐ {r.stars}</span>
                {r.desc && <span className="truncate text-neutral-500">{r.desc}</span>}
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="rounded-2xl border border-dashed border-neutral-200 bg-white p-5 text-xs leading-relaxed text-neutral-400">
        条目信息来自其公开主页与公开发布内容。按本站规范，页面不展示任何联系方式。
        需要更正或删除？通过
        <Link href="/nominate" className="mx-1 underline hover:text-neutral-600">
          收录与更正通道
        </Link>
        提交，24 小时内处理。
      </section>
    </div>
  );
}
