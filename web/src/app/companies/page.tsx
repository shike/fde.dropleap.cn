"use client";

import { useEffect, useMemo, useState } from "react";
import { CompanyCard } from "@/components/CompanyCard";

type Co = {
  name: string;
  slug: string;
  website: string;
  region: string | null;
  type: string | null;
  notes: string | null;
};

const PAGE_SIZE = 24;

export default function CompaniesPage() {
  const [data, setData] = useState<Co[] | null>(null);
  const [type, setType] = useState("");
  const [region, setRegion] = useState("");
  const [page, setPage] = useState(1);

  useEffect(() => {
    fetch("/data/companies.json").then((r) => r.json()).then(setData);
  }, []);

  const typeCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const c of data ?? []) m.set(c.type ?? "其他", (m.get(c.type ?? "其他") ?? 0) + 1);
    return [...m.entries()].map(([t, n]) => ({ type: t, n })).sort((a, b) => b.n - a.n);
  }, [data]);

  const regionCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const c of data ?? []) m.set(c.region ?? "中国", (m.get(c.region ?? "中国") ?? 0) + 1);
    return [...m.entries()].map(([r, n]) => ({ region: r, n })).sort((a, b) => b.n - a.n);
  }, [data]);

  const filtered = useMemo(() => {
    let out = data ?? [];
    if (type) out = out.filter((c) => (c.type ?? "其他") === type);
    if (region) out = out.filter((c) => (c.region ?? "中国") === region);
    return [...out].sort((a, b) => a.name.localeCompare(b.name, "zh"));
  }, [data, type, region]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const rows = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);
  const totalAll = (data ?? []).length;
  const chip = (active: boolean) =>
    `rounded-full border px-4 py-1.5 text-sm transition-colors ${
      active ? "border-neutral-900 bg-neutral-900 text-white" : "border-neutral-200 bg-white text-neutral-600 hover:border-neutral-400 hover:text-neutral-900"
    }`;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">公司名录</h1>
          <p className="tnum mt-1.5 max-w-3xl text-sm leading-relaxed text-neutral-400">
            共 {filtered.length} 家{type ? ` · ${type}` : ""}{region ? ` · ${region}` : ""} ·
            聚焦给企业提供 FDE / 驻场 / AI 落地交付服务的公司 · 每家标注总部所在地
          </p>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <button onClick={() => { setType(""); setPage(1); }} className={chip(!type)}>
          全部 <span className="tnum">{totalAll.toLocaleString()}</span>
        </button>
        {typeCounts.filter((t) => t.type !== "其他").map((t) => (
          <button key={t.type} onClick={() => { setType(t.type); setPage(1); }} className={chip(type === t.type)}>
            {t.type} <span className="tnum">{t.n.toLocaleString()}</span>
          </button>
        ))}
      </div>

      <div className="flex flex-wrap gap-2">
        <button onClick={() => { setRegion(""); setPage(1); }} className={chip(!region)}>
          全部地域 <span className="tnum">{filtered.length.toLocaleString()}</span>
        </button>
        {regionCounts.map((r) => (
          <button key={r.region} onClick={() => { setRegion(r.region); setPage(1); }} className={chip(region === r.region)}>
            {r.region} <span className="tnum">{r.n.toLocaleString()}</span>
          </button>
        ))}
      </div>

      {rows.length ? (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {rows.map((c) => (
            <CompanyCard key={c.slug} c={c} />
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
