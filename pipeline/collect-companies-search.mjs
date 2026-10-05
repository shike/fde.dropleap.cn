#!/usr/bin/env node
/**
 * 公司挖掘辅助：cn.bing 直连检索 → 提取结果标题/摘要 → stdout（供人工挑选后入库）。
 * 跑法：node pipeline/collect-companies-search.mjs "查询词"
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

const q = process.argv[2] ?? "中国 大模型 公司 名单";
const url = `https://cn.bing.com/search?q=${encodeURIComponent(q)}&count=20&setlang=zh-CN`;

try {
  const { stdout } = await run("curl", ["-sL", "-m", "20", "-A", UA, "-H", "Accept-Language: zh-CN,zh;q=0.9", url], {
    timeout: 25_000,
    maxBuffer: 8 * 1024 * 1024,
  });
  const blocks = [...stdout.matchAll(/<li class="b_algo"[\s\S]*?<\/li>/g)].map((m) => m[0]);
  if (!blocks.length) {
    console.log("(no b_algo blocks; len=" + stdout.length + ")");
    const t = stdout.match(/<title>([^<]*)<\/title>/i)?.[1];
    console.log("page title: " + t);
  }
  let i = 0;
  for (const b of blocks) {
    i++;
    const title = b.match(/<h2[^>]*>([\s\S]*?)<\/h2>/)?.[1]?.replace(/<[^>]+>/g, "").trim() ?? "";
    const href = b.match(/href="(https?:\/\/[^"]+)"/)?.[1] ?? "";
    const snip = b.match(/<p[^>]*>([\s\S]*?)<\/p>/)?.[1]?.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim().slice(0, 400) ?? "";
    console.log(`[${i}] ${title}\n    ${href}\n    ${snip}\n`);
  }
} catch (e) {
  console.error("fetch failed: " + e.message);
}
