import type { MetadataRoute } from "next";

const BASE = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";

export const dynamic = "force-static";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
      },
      // GEO：明确允许主流 AI 引擎抓取（豆包/字节、OpenAI、Anthropic、Perplexity 等）
      {
        userAgent: ["GPTBot", "OAI-SearchBot", "ChatGPT-User", "ClaudeBot", "Claude-Web", "PerplexityBot", "Google-Extended", "Bytespider", "Applebot-Extended", "cohere-ai"],
        allow: "/",
      },
    ],
    sitemap: `${BASE}/sitemap.xml`,
  };
}
