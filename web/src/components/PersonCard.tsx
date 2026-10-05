import Link from "next/link";
type CardPerson = {
  login: string;
  name?: string | null;
  bio?: string | null;
  company?: string | null;
  city?: string | null;
  html_url?: string | null;
  avatar_file?: string | null;
  followers?: number;
  stars_total?: number;
  platform?: string;
  tags?: string | null;
  top?: { name: string; stars: number; url: string } | null;
};

export function PersonCard({ p }: { p: CardPerson }) {
  const isDouyin = p.platform === "douyin";
  const isWeb = p.platform === "web";
  return (
    <Link
      href={`/persons/${encodeURIComponent(p.login)}`}
      className="card-lift flex items-start gap-4 rounded-2xl border border-neutral-200 bg-white p-5"
    >
      {p.avatar_file ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={p.avatar_file}
          alt={p.name ?? p.login}
          className="h-12 w-12 shrink-0 rounded-xl object-cover"
          loading="lazy"
        />
      ) : (
        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-neutral-100 text-base font-bold text-neutral-400">
          {(p.name ?? p.login ?? "?").slice(0, 1).toUpperCase()}
        </div>
      )}
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-semibold tracking-tight">{p.name ?? p.login}</span>
          {isDouyin ? (
            <span className="rounded bg-neutral-900 px-1.5 py-0.5 text-[10px] font-bold text-white">抖音</span>
          ) : !isWeb && p.name && p.name !== p.login ? (
            <span className="text-xs text-neutral-300">@{p.login}</span>
          ) : null}
          {p.city && p.city !== "未填写" && (
            <span className="rounded-full border border-neutral-200 bg-neutral-50 px-2 py-0.5 text-[11px] text-neutral-500">
              {p.city}
            </span>
          )}
        </div>
        <p className="mt-1.5 line-clamp-2 text-sm leading-relaxed text-neutral-500">
          {p.bio ?? "（未填写简介）"}
        </p>
        {(p.tags ?? "").split(",").filter(Boolean).slice(0, 4).length > 0 && (
          <div className="mt-2.5 flex flex-wrap gap-1.5">
            {(p.tags ?? "").split(",").filter(Boolean).slice(0, 4).map((t) => (
              <span key={t} className="rounded-md bg-indigo-50 px-1.5 py-0.5 text-[11px] text-indigo-600">
                {t}
              </span>
            ))}
          </div>
        )}
        <div className="tnum mt-2.5 flex flex-wrap items-center gap-x-3.5 gap-y-1 border-t border-neutral-100 pt-2.5 text-xs text-neutral-400">
          {p.company && <span className="truncate">{p.company}</span>}
          {(p.stars_total ?? 0) > 0 && <span>⭐ {(p.stars_total ?? 0).toLocaleString()}</span>}
          {(p.followers ?? 0) > 0 && <span>粉丝 {(p.followers ?? 0).toLocaleString()}</span>}
        {p.platform === "github" && p.top && p.top.stars > 0 && (
          <span className="truncate">代表作 {p.top.name} ⭐{p.top.stars.toLocaleString()}</span>
        )}
        {p.platform === "douyin" && p.top && (p.top.stars ?? 0) > 0 && (
          <span>获赞 {p.top.stars.toLocaleString()}</span>
        )}
        </div>
      </div>
    </Link>
  );
}
