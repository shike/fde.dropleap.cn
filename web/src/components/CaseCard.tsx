import Link from "next/link";

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
const TYPE_STYLE: Record<string, string> = {
  article: "bg-sky-50 text-sky-700",
  media: "bg-amber-50 text-amber-700",
  opensource: "bg-indigo-50 text-indigo-700",
  video: "bg-rose-50 text-rose-700",
  jd: "bg-emerald-50 text-emerald-700",
};

function hostOf(u: string | null) {
  if (!u) return "";
  try {
    return new URL(u).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

export function CaseCard({ c }: { c: C }) {
  return (
    <Link
      href={`/cases/${c.slug}`}
      className="card-lift flex flex-col rounded-2xl border border-neutral-200 bg-white p-5"
    >
      <div className="flex items-center gap-2">
        <span className={`rounded-md px-2 py-0.5 text-xs font-medium ${TYPE_STYLE[c.type] ?? "bg-neutral-100 text-neutral-600"}`}>
          {TYPE_LABEL[c.type] ?? c.type}
        </span>
        <span className="tnum ml-auto text-xs text-neutral-300">{c.published_at ?? "日期待考"}</span>
      </div>
      <h2 className="mt-3 font-semibold leading-snug tracking-tight">{c.title}</h2>
      <p className="mt-2 line-clamp-3 text-sm leading-relaxed text-neutral-500">
        {c.summary ?? (c.content ?? "").slice(0, 90)}
      </p>
      <span className="mt-auto pt-3 text-xs text-neutral-400">
        来源：{hostOf(c.url) || "公开渠道"} · 站内阅读
      </span>
    </Link>
  );
}
