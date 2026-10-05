import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import Database from "better-sqlite3";
import path from "node:path";
import fs from "node:fs";


const TYPE_LABEL: Record<string, string> = {
  opensource: "开源项目",
  article: "复盘 / 方法论",
  video: "短视频内容",
  media: "报道 / 访谈",
  jd: "招聘 JD",
};

export function generateStaticParams() {
  const Database = require("better-sqlite3");
  const path = require("node:path");
  const p = process.env.FDE_DB ?? path.resolve(process.cwd(), "..", "data", "fde.db");
  const rows = new Database(p, { readonly: true })
    .prepare("SELECT slug FROM cases WHERE status != 'offline'")
    .all() as { slug: string }[];
  return rows.map((r) => ({ slug: r.slug }));
}

function getCase(slug: string) {
  const p = process.env.FDE_DB ?? path.resolve(process.cwd(), "..", "data", "fde.db");
  if (!fs.existsSync(p)) return null;
  const db = new Database(p, { readonly: true });
  const row = db
    .prepare("SELECT id, title, slug, type, url, summary, content, published_at, source_url, collected_at FROM cases WHERE slug = ?")
    .get(slug) as
    | {
        id: number;
        title: string;
        slug: string;
        type: string;
        url: string | null;
        summary: string | null;
        content: string | null;
        published_at: string | null;
        source_url: string | null;
        collected_at: string;
      }
    | undefined;
  return row ?? null;
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const c = getCase(slug);
  return { title: c ? c.title : "案例" };
}

export default async function CaseDetailPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const c = getCase(slug);
  if (!c) notFound();
  const articleLd = {
    "@context": "https://schema.org",
    "@type": "Article",
    headline: c.title,
    datePublished: c.published_at ?? undefined,
    inLanguage: "zh-CN",
    isBasedOn: c.url ?? undefined,
  };

  const host = (() => {
    try {
      return c.url ? new URL(c.url).hostname.replace(/^www\./, "") : "";
    } catch {
      return "";
    }
  })();
  const paragraphs = (c.content ?? c.summary ?? "").split("\n").filter((p) => p.trim());

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(articleLd) }} />
      <Link href="/cases" className="text-sm text-neutral-400 transition-colors hover:text-neutral-900">
        ← 返回案例与资料
      </Link>

      <article className="rounded-2xl border border-neutral-200 bg-white p-8">
        <div className="flex flex-wrap items-center gap-2 text-xs text-neutral-400">
          <span className="rounded-md bg-neutral-100 px-2 py-0.5 text-neutral-600">
            {TYPE_LABEL[c.type] ?? c.type}
          </span>
          {c.published_at && <span className="tnum">{c.published_at}</span>}
          <span className="tnum">收录于 {c.collected_at.slice(0, 10)}</span>
        </div>
        <h1 className="mt-3 text-2xl font-bold leading-snug tracking-tight">{c.title}</h1>
        {c.summary && c.content && (
          <p className="mt-3 rounded-xl bg-neutral-50 p-4 text-sm leading-relaxed text-neutral-600">
            {c.summary}
          </p>
        )}
        <div className="mt-6 space-y-3 text-[15px] leading-7 text-neutral-800">
          {paragraphs.map((p, i) => (
            <p key={i}>{p}</p>
          ))}
        </div>
        {paragraphs.length === 0 && (
          <p className="mt-4 text-sm text-neutral-400">（内容整理中）</p>
        )}
      </article>

      <section className="rounded-2xl border border-dashed border-neutral-200 bg-white p-5 text-xs leading-relaxed text-neutral-400">
        本文为本站基于公开渠道整理的资讯摘要。
        {c.url && (
          <>
            原文发布于 <span className="text-neutral-600">{host}</span>
            ，查看原文：
            <a href={c.url} target="_blank" rel="noopener noreferrer" className="underline hover:text-neutral-600">
              {c.url.slice(0, 60)}
            </a>
          </>
        )}
        。版权归原作者所有，如需删除或更正请联系我们，24 小时内处理。
      </section>
    </div>
  );
}
