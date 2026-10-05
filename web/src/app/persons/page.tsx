"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { PersonCard } from "@/components/PersonCard";

type P = {
  login: string;
  name: string | null;
  bio: string | null;
  company: string | null;
  city: string | null;
  html_url: string | null;
  avatar_file: string | null;
  followers: number;
  stars_total: number;
  layer: string | null;
  platform: string;
  tags: string | null;
  top: { name: string; stars: number; url: string } | null;
};

const LAYERS = [
  { key: "", label: "全部", hint: "所有收录人群" },
  { key: "fde", label: "FDE 核心", hint: "公开自述 FDE、严口径核验" },
  { key: "edge", label: "延伸岗位", hint: "解决方案/交付/售前等相邻岗位" },
  { key: "practitioner", label: "AI 从业者", hint: "中国 AI 工程师大名单" },
];

const PAGE_SIZE = 40;

export default function PersonsPage() {
  const [data, setData] = useState<P[] | null>(null);
  const [layer, setLayer] = useState("");
  const [city, setCity] = useState("");
  const [q, setQ] = useState("");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);

  useEffect(() => {
    fetch("/data/persons.json").then((r) => r.json()).then(setData);
  }, []);

  const cityCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const p of data ?? []) m.set(p.city ?? "未填写", (m.get(p.city ?? "未填写") ?? 0) + 1);
    const arr = [...m.entries()].map(([c, n]) => ({ city: c, n }));
    const main = arr.filter((c) => c.city !== "未填写").sort((a, b) => b.n - a.n);
    const unfilled = arr.find((c) => c.city === "未填写");
    if (unfilled) main.push(unfilled);
    return main;
  }, [data]);

  const filtered = useMemo(() => {
    let out = data ?? [];
    if (layer === "fde") out = out.filter((p) => p.layer === "core");
    else if (layer === "edge") out = out.filter((p) => p.layer === "edge");
    else if (layer === "practitioner") out = out.filter((p) => p.layer === "practitioner");
    if (city) out = out.filter((p) => (p.city ?? "未填写") === city);
    if (query) {
      const qq = query.toLowerCase();
      out = out.filter((p) =>
        [p.login, p.name, p.company, p.bio, p.tags].some((f) => (f ?? "").toLowerCase().includes(qq))
      );
    }
    return [...out].sort((a, b) => b.followers - a.followers || b.stars_total - a.stars_total);
  }, [data, layer, city, query]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const rows = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);
  const layerN = (key: string) =>
    key === "" ? (data ?? []).length : (data ?? []).filter((p) => (key === "fde" ? p.layer === "core" : p.layer === key)).length;

  if (!data) {
    return <p className="p-12 text-center text-sm text-neutral-400">名录加载中…</p>;
  }

  return (
    <div className="space-y-7">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">人物名录</h1>
          <p className="tnum mt-1.5 text-sm text-neutral-400">
            共 {filtered.length} 人{city ? ` · ${city}` : ""} · 按城市归属分类 · 每条附证据来源
          </p>
        </div>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            setQuery(q);
            setPage(1);
          }}
          className="flex gap-2"
        >
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="搜索登录名 / 公司 / 简介"
            className="h-10 w-64 rounded-xl border border-neutral-200 bg-white px-3.5 text-sm outline-none transition-colors placeholder:text-neutral-300 focus:border-indigo-400 focus:ring-4 focus:ring-indigo-50"
          />
          <button className="h-10 rounded-xl bg-neutral-900 px-4 text-sm font-medium text-white hover:bg-neutral-700">
            搜索
          </button>
        </form>
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {LAYERS.map((l) => {
          const active = layer === l.key;
          const n = layerN(l.key);
          return (
            <button
              key={l.key || "all"}
              onClick={() => { setLayer(l.key); setPage(1); }}
              className={`rounded-xl border p-3.5 text-left transition-colors ${
                active ? "border-neutral-900 bg-neutral-900 text-white" : "border-neutral-200 bg-white hover:border-neutral-400"
              }`}
            >
              <div className="flex items-baseline justify-between">
                <span className={`text-sm font-semibold ${active ? "" : "text-neutral-800"}`}>{l.label}</span>
                <span className="tnum text-lg font-bold">{n.toLocaleString()}</span>
              </div>
              <p className={`mt-0.5 text-[11px] leading-snug ${active ? "text-neutral-300" : "text-neutral-400"}`}>{l.hint}</p>
            </button>
          );
        })}
      </div>

      <div>
        <h2 className="text-xs font-semibold uppercase tracking-wider text-neutral-400">按城市</h2>
        <div className="mt-2.5 flex flex-wrap gap-2">
          <button
            onClick={() => { setCity(""); setPage(1); }}
            className={`rounded-full border px-3.5 py-1.5 text-sm transition-colors ${
              !city ? "border-neutral-900 bg-neutral-900 text-white" : "border-neutral-200 bg-white text-neutral-600 hover:border-neutral-400 hover:text-neutral-900"
            }`}
          >
            全部 <span className="tnum">{(data ?? []).length.toLocaleString()}</span>
          </button>
          {cityCounts.map((c) => (
            <button
              key={c.city}
              onClick={() => { setCity(c.city); setPage(1); }}
              className={`rounded-full border px-3.5 py-1.5 text-sm transition-colors ${
                city === c.city ? "border-neutral-900 bg-neutral-900 text-white" : "border-neutral-200 bg-white text-neutral-600 hover:border-neutral-400 hover:text-neutral-900"
              }`}
            >
              {c.city} <span className="tnum">{c.n.toLocaleString()}</span>
            </button>
          ))}
        </div>
      </div>

      {rows.length ? (
        <div className="grid gap-4 md:grid-cols-2">
          {rows.map((p) => (
            <PersonCard key={p.login} p={p as never} />
          ))}
        </div>
      ) : (
        <p className="rounded-2xl border border-dashed border-neutral-200 bg-white p-12 text-center text-sm text-neutral-400">
          没有匹配的条目
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
