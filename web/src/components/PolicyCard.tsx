import Link from "next/link";

type P = {
  title: string;
  region: string;
  level: string;
  date: string | null;
  summary: string | null;
  url: string | null;
  source: string | null;
};

const LEVEL_STYLE: Record<string, string> = {
  国家部委: "bg-red-50 text-red-700 border-red-200",
  城市政策: "bg-sky-50 text-sky-700 border-sky-200",
  区县政策: "bg-indigo-50 text-indigo-700 border-indigo-200",
  行业标准: "bg-emerald-50 text-emerald-700 border-emerald-200",
  企业标准: "bg-amber-50 text-amber-700 border-amber-200",
  行业动态: "bg-neutral-100 text-neutral-600 border-neutral-200",
};

export function PolicyCard({ p }: { p: P }) {
  return (
    <article className="card-lift rounded-2xl border border-neutral-200 bg-white p-5">
      <div className="flex flex-wrap items-center gap-2 text-xs text-neutral-400">
        <span className={`rounded-md border px-2 py-0.5 font-semibold ${LEVEL_STYLE[p.level] ?? "border-neutral-200 bg-neutral-100 text-neutral-600"}`}>
          {p.level}
        </span>
        <span className="tnum">{p.date ?? "日期待考"}</span>
        <span>·</span>
        <span>{p.region}</span>
      </div>
      <h3 className="mt-1.5 font-semibold leading-snug tracking-tight">{p.title}</h3>
      <p className="mt-2 text-sm leading-relaxed text-neutral-500">{p.summary}</p>
      <p className="mt-2 text-xs text-neutral-400">
        来源：{p.url ? (
          <a href={p.url} target="_blank" rel="noopener noreferrer" className="underline hover:text-neutral-700">
            {p.source} ↗
          </a>
        ) : (
          p.source
        )}
      </p>
    </article>
  );
}
