#!/usr/bin/env bash
# 站点更新一条龙：本地数据重导出 → 构建 → rsync 到服务器（增量）。
# 用法：bash scripts/deploy-static.sh
# 依赖：~/.ssh/content_studio_deploy 私钥已注入新服务器 root@175.27.131.72
set -euo pipefail
cd "$(dirname "$0")/.."

HOST="${FDE_DEPLOY_HOST:-root@175.27.131.72}"
KEY="${FDE_DEPLOY_KEY:-$HOME/.ssh/content_studio_deploy}"
REMOTE_ROOT="${FDE_DEPLOY_ROOT:-/srv/fde-directory}"

echo "→ 导出站点数据（数据库 → JSON）"
node pipeline/export-site-data.mjs

echo "→ 静态构建"
(cd web && pnpm build) >/tmp/fde-build.log 2>&1 || { echo "✗ 构建失败，见 /tmp/fde-build.log"; exit 1; }

echo "→ rsync 增量上传"
rsync -az --delete --info=stats1 -e "ssh -o BatchMode=yes -i $KEY" web/out/ "$HOST:$REMOTE_ROOT/"

echo "→ 服务器端权限与重载"
ssh -o BatchMode=yes -i "$KEY" "$HOST" "chmod -R 755 $REMOTE_ROOT; chcon -R -t httpd_sys_content_t $REMOTE_ROOT 2>/dev/null; systemctl reload nginx 2>/dev/null || true"

echo "→ 验收"
CODE=$(ssh -o BatchMode=yes -i "$KEY" "$HOST" "curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1/persons.html")
[ "$CODE" = "200" ] && echo "✓ 部署成功（persons.html 200）" || { echo "✗ 验收失败（$CODE）"; exit 1; }
