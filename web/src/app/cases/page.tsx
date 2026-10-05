"use client";

import { useEffect, useMemo, useState } from "react";
import { CaseCard } from "@/components/CaseCard";

type C = {
  slug: string;
  title: string;
  type: string;
  summary: string | null;
  content: string | null;
  published_at: string | null;
  url: string | null;
};

const TYPE_LABEL: Record<string, string> = {
  article: "复盘 / 方法论",
  media: "报道 / 访谈",
  opensource: "开源项目",
  video: "短视频内容",
  jd: "招聘 JD",
};

const PAGE_SIZE = 24;

export default function CasesPage() {
  const [data, setData] = useState<C[] | null>(null);
  const [type, setType] = useState("");
  const [page, setPage] = useState(1);

  useEffect(() => {
    fetch("/data/cases.json").then((r) => r.json()).then(setData);
  }, []);

  const typeCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const c of data ?? []) m.set(c.type, (m.get(c.type) ?? 0) + 1);
    return [...m.entries()].map(([t, n]) => ({ type: t, n })).sort((a, b) => b.n - a.n);
  }, [data]);

  const filtered = useMemo(
    () => (data ?? []).filter((c) => !type || c.type === type),
    [data, type]
  );
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const rows = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);
  const totalAll = (data ?? []).length;

  return (
    <div className="space-y-7">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">案例与资料</h1>
          <p className="tnum mt-1.5 text-sm text-neutral-400">
            共 {filtered.length} 条{type ? ` · ${TYPE_LABEL[type] ?? type}` : ""} ·
            站内阅读 · 原文出处已在文内标注
          </p>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <button
          onClick={() => { setType(""); setPage(1); }}
          className={`rounded-full border px-4 py-1.5 text-sm transition-colors ${
            !type ? "border-neutral-900 bg-neutral-900 text-white" : "border-neutral-200 bg-white text-neutral-600 hover:border-neutral-400 hover:text-neutral-900"
          }`}
        >
          全部 <span className="tnum">{totalAll.toLocaleString()}</span>
        </button>
        {typeCounts.map((t) => (
          <button
            key={t.type}
            onClick={() => { setType(t.type); setPage(1); }}
            className={`rounded-full border px-4 py-1.5 text-sm transition-colors ${
              type === t.type ? "border-neutral-900 bg-neutral-900 text-white" : "border-neutral-200 bg-white text-neutral-600 hover:border-neutral-400 hover:text-neutral-900"
            }`}
          >
            {TYPE_LABEL[t.type] ?? t.type} <span className="tnum">{t.n.toLocaleString()}</span>
          </button>
        ))}
      </div>

      {rows.length ? (
        <div className="grid gap-4 md:grid-cols-2">
          {rows.map((c) => (
            <CaseCard key={c.slug} c={c} />
          ))}
        </div>
      ) : (
        <p className="rounded-2xl border border-dashed border-neutral-200 bg-white p-12 text-center text-sm text-neutral-400">
          加载中或暂无条目
        </p>
      )}

      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-3 pt-2 text-sm">
          {safePage > 1 ? (
            <button onClick={() => setPage(safePage - 1)} className="rounded-xl border border-neutral-200 bg-white px-4 py-2 font-medium hover:bg-neutral-100">← 上一页</button>
          ) : (
            <span className="rounded-xl border border-neutral-100 bg-white px-4 py-2 font-medium text-neutral-300">← 上一页</span>
          )}
          <span className="tnum px-2 text-neutral-400">{safePage} / {totalPages}</span>
          {safePage < totalPages ? (
            <button onClick={() => setPage(safePage + 1)} className="rounded-xl border border-neutral-200 bg-white px-4 py-2 font-medium hover:bg-neutral-100">下一页 →</button>
          ) : (
            <span className="rounded-xl border border-neutral-100 bg-white px-4 py-2 font-medium text-neutral-300">下一页 →</span>
          )}
        </div>
      )}
    </div>
  );
}
