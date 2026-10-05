import type { MetadataRoute } from "next";
import Database from "better-sqlite3";
import path from "node:path";

const BASE = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";

function db() {
  const p = process.env.FDE_DB ?? path.resolve(process.cwd(), "..", "data", "fde.db");
  try {
    return new Database(p, { readonly: true });
  } catch {
    return null;
  }
}

export const dynamic = "force-static";

export default function sitemap(): MetadataRoute.Sitemap {
  const statics: MetadataRoute.Sitemap = [
    "",
    "/persons",
    "/cases",
    "/companies",
    "/policies",
    "/about",
    "/nominate",
  ].map((p) => ({ url: `${BASE}${p}`, changeFrequency: "daily", priority: p === "" ? 1 : 0.8 }));

  const conn = db();
  if (!conn) return statics;

  const persons = conn
    .prepare("SELECT login FROM persons WHERE status IN ('candidate','approved')")
    .all() as { login: string }[];
  const cases = conn
    .prepare("SELECT slug, collected_at FROM cases WHERE status != 'offline'")
    .all() as { slug: string; collected_at: string }[];

  return [
    ...statics,
    ...persons.map((p) => ({
      url: `${BASE}/persons/${encodeURIComponent(p.login)}`,
      changeFrequency: "weekly" as const,
      priority: 0.7,
    })),
    ...cases.map((c) => ({
      url: `${BASE}/cases/${c.slug}`,
      lastModified: new Date(c.collected_at),
      changeFrequency: "monthly" as const,
      priority: 0.6,
    })),
  ];
}
