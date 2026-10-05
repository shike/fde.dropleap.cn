#!/usr/bin/env node
/** 抖音头像批量补齐：IAB 逐个打开主页 → og:image → 服务器代下载。
 *  输入：/tmp/dy_top30.txt；输出：/tmp/dy_avatar_dl.txt（og:image URL 清单）
 */
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/126.0.0.0 Safari/537.36";
const secs = readFileSync("/tmp/dy_top30.txt", "utf8").trim().split("\n");
writeFileSync("/tmp/dy_avatar_dl.txt", secs.map((s) => `https://www.douyin.com/user/${s}`).join("\n"));
console.log("清单就绪", secs.length);
