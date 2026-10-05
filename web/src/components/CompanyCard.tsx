import Link from "next/link";

type Co = {
  name: string;
  slug: string;
  website: string;
  region: string | null;
  type: string | null;
  notes: string | null;
};

export function CompanyCard({ c }: { c: Co }) {
  return (
    <div className="card-lift flex flex-col rounded-2xl border border-neutral-200 bg-white p-5">
      <div className="flex items-center justify-between gap-2">
        <a
          href={c.website}
          target="_blank"
          rel="noopener noreferrer"
          className="truncate font-semibold tracking-tight hover:underline"
        >
          {c.name}
        </a>
        <span className="shrink-0 rounded-full border border-neutral-200 bg-neutral-50 px-2.5 py-0.5 text-xs text-neutral-600">
          {c.region ?? "中国"}
        </span>
      </div>
      {c.notes && <p className="mt-2 text-xs leading-relaxed text-neutral-500">{c.notes}</p>}
      <a
        href={c.website}
        target="_blank"
        rel="noopener noreferrer"
        className="mt-auto pt-3 text-xs text-neutral-400 hover:text-neutral-700"
      >
        {c.website.replace(/^https?:\/\//, "")} ↗
      </a>
    </div>
  );
}
