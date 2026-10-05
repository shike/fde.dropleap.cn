#!/usr/bin/env bash
# fde-directory 发服务器唯一正规流程：构建 → rsync → systemd 重启 → 健康检查，三步一体不可拆。
# 用法：scripts/.deploy.env 配置 FDE_SYNC_HOST（user@host）与 FDE_SYNC_KEY（密钥路径）后：
#   bash scripts/deploy.sh
set -euo pipefail
cd "$(dirname "$0")/.."

ENV_FILE="scripts/.deploy.env"
[ -f "$ENV_FILE" ] || { echo "缺 $ENV_FILE：写入 FDE_SYNC_HOST=ubuntu@host 与 FDE_SYNC_KEY=~/.ssh/xxx（不入库）"; exit 1; }
# shellcheck disable=SC1090
source "$ENV_FILE"
KEY="${FDE_SYNC_KEY:-$HOME/.ssh/id_ed25519}"
SSH() { ssh -o BatchMode=yes -i "$KEY" "$FDE_SYNC_HOST" "$@"; }
RSYNC() { rsync -az --delete -e "ssh -o BatchMode=yes -i $KEY" "$@"; }
REMOTE_ROOT="${FDE_SYNC_ROOT:-/srv/fde-directory}"

echo "→ 本地构建"
(cd web && pnpm build) >/tmp/fde-build.log 2>&1 || { echo "✗ 构建失败，见 /tmp/fde-build.log"; exit 1; }

echo "→ rsync（构建产物 + 数据 + 管道脚本）"
SSH "mkdir -p $REMOTE_ROOT/data"
RSYNC --exclude node_modules web/.next/ "$FDE_SYNC_HOST:$REMOTE_ROOT/web/.next/"
RSYNC web/public/ "$FDE_SYNC_HOST:$REMOTE_ROOT/web/public/"
RSYNC web/package.json web/pnpm-lock.yaml web/next.config.ts "$FDE_SYNC_HOST:$REMOTE_ROOT/web/"
RSYNC data/fde.db "$FDE_SYNC_HOST:$REMOTE_ROOT/data/fde.db"
RSYNC pipeline/ "$FDE_SYNC_HOST:$REMOTE_ROOT/pipeline/"

echo "→ 远端安装依赖 + systemd 重启"
SSH "cd $REMOTE_ROOT/web && pnpm install --prod --frozen-lockfile >/dev/null 2>&1 || pnpm install --prod"
SSH "sudo cp -f $REMOTE_ROOT/deploy/fde-directory.service /etc/systemd/system/ 2>/dev/null || true"
SSH "sudo systemctl daemon-reload && sudo systemctl enable --now fde-directory && sudo systemctl restart fde-directory"

echo "→ 健康检查"
sleep 4
CODE=$(SSH "curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:3100/persons" || echo "000")
[ "$CODE" = "200" ] && echo "✓ 上线成功：/persons 200" || { echo "✗ 健康检查失败（$CODE），查：SSH sudo journalctl -u fde-directory -n 50"; exit 1; }
