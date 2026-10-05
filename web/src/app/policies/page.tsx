"use client";

import { useEffect, useState } from "react";
import { PolicyCard } from "@/components/PolicyCard";

type P = {
  title: string;
  region: string;
  level: string;
  date: string | null;
  summary: string | null;
  url: string | null;
  source: string | null;
};

const PAGE_SIZE = 20;

export default function PoliciesPage() {
  const [data, setData] = useState<P[] | null>(null);
  const [level, setLevel] = useState("");
  const [page, setPage] = useState(1);

  useEffect(() => {
    fetch("/data/policies.json").then((r) => r.json()).then(setData);
  }, []);

  const levelCounts = (() => {
    const m = new Map<string, number>();
    for (const p of data ?? []) m.set(p.level, (m.get(p.level) ?? 0) + 1);
    return [...m.entries()].map(([l, n]) => ({ level: l, n })).sort((a, b) => b.n - a.n);
  })();

  const filtered = (data ?? []).filter((p) => !level || p.level === level);
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const rows = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);
  const totalAll = (data ?? []).length;

  return (
    <div className="space-y-7">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">政策库</h1>
          <p className="tnum mt-1.5 max-w-3xl text-sm leading-relaxed text-neutral-400">
            共 {filtered.length} 条{level ? ` · ${level}` : ""} ·
            各地各部门围绕 FDE / AI 落地的政策、人才工程与行业标准 · 按发布时间排序
          </p>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <button onClick={() => { setLevel(""); setPage(1); }} className={`rounded-full border px-4 py-1.5 text-sm transition-colors ${
          !level ? "border-neutral-900 bg-neutral-900 text-white" : "border-neutral-200 bg-white text-neutral-600 hover:border-neutral-400 hover:text-neutral-900"
        }`}>
          全部 <span className="tnum">{totalAll.toLocaleString()}</span>
        </button>
        {levelCounts.map((l) => (
          <button key={l.level} onClick={() => { setLevel(l.level); setPage(1); }} className={`rounded-full border px-4 py-1.5 text-sm transition-colors ${
            level === l.level ? "border-neutral-900 bg-neutral-900 text-white" : "border-neutral-200 bg-white text-neutral-600 hover:border-neutral-400 hover:text-neutral-900"
          }`}>
            {l.level} <span className="tnum">{l.n.toLocaleString()}</span>
          </button>
        ))}
      </div>

      {rows.length ? (
        <div className="space-y-3">
          {rows.map((r, i) => (
            <PolicyCard key={`${r.title}-${i}`} p={r} />
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
