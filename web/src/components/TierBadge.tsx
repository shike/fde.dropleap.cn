const TIER_STYLE: Record<string, string> = {
  S: "bg-amber-50 text-amber-700 border-amber-200",
  A: "bg-indigo-50 text-indigo-700 border-indigo-200",
  B: "bg-neutral-100 text-neutral-500 border-neutral-200",
};

const TIER_LABEL: Record<string, string> = {
  S: "S · 领军",
  A: "A · 资深",
  B: "B · 活跃",
};

export function TierBadge({ tier, className = "" }: { tier: string; className?: string }) {
  if (!tier) return null;
  return (
    <span
      className={`inline-flex shrink-0 items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold ${TIER_STYLE[tier] ?? TIER_STYLE.B} ${className}`}
      title="分档说明见「收录标准」页"
    >
      {TIER_LABEL[tier] ?? tier}
    </span>
  );
}
