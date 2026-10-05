#!/bin/zsh
# 流水线：等批次1 → 种子第二批 → 批次2 → 汇总
cd /Users/shike/Desktop/code/fde-directory
LOG=pipeline/collect-companies-fde.log
# 等当前 harvest 1 结束
while pgrep -f "collect-companies-fde.mjs harvest" >/dev/null 2>&1; do sleep 20; done
echo "[$(date '+%H:%M')] batch1 done, seeds round2..." >> "$LOG"
node pipeline/collect-companies-fde.mjs seeds >> "$LOG" 2>&1
echo "[$(date '+%H:%M')] seeds done, start harvest 2..." >> "$LOG"
node pipeline/collect-companies-fde.mjs harvest 2 >> "$LOG" 2>&1
echo "[$(date '+%H:%M')] harvest2 done" >> "$LOG"
sqlite3 data/fde.db "SELECT COUNT(*) FROM companies;" >> "$LOG"
