#!/usr/bin/env bash
# ERP SQLite 自动冷备脚本
# 通过 VACUUM INTO 生成一致性快照（比 cp dev.db 安全：WAL 模式会遗留未合并数据），
# 再 gzip 压缩，按 BACKUP_KEEP 保留最近 N 份。
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SERVER_DIR="$(dirname "$SCRIPT_DIR")"
DB_FILE="$SERVER_DIR/prisma/dev.db"
BACKUP_DIR="${BACKUP_DIR:-$SERVER_DIR/backups}"
KEEP="${BACKUP_KEEP:-14}"
STAMP="$(date +%Y%m%d-%H%M%S)"
BASENAME="erp-${STAMP}.db"

if [[ ! -f "$DB_FILE" ]]; then
  echo "[$(date '+%F %T')] ERROR: $DB_FILE 不存在，跳过备份" >&2
  exit 1
fi

mkdir -p "$BACKUP_DIR"
RAW="$BACKUP_DIR/$BASENAME"
GZ="$RAW.gz"

# VACUUM INTO 需要 Node 端通过 Prisma 执行（SQLite 无 CLI 时的唯一一致性导出路径）
cd "$SERVER_DIR"
DATABASE_URL="file:./dev.db" node --input-type=module -e "
import { PrismaClient } from '@prisma/client';
const p = new PrismaClient();
try {
  await p.\$queryRawUnsafe('VACUUM INTO \"$RAW\"');
} finally {
  await p.\$disconnect();
}
" > /dev/null 2>&1 || {
  echo "[$(date '+%F %T')] ERROR: VACUUM INTO 失败" >&2
  exit 1
}

gzip -f "$RAW"

# 清理旧备份，保留最近 KEEP 份
ls -1t "$BACKUP_DIR"/erp-*.db.gz 2>/dev/null | tail -n +$((KEEP + 1)) | xargs -r rm -f

echo "[$(date '+%F %T')] 备份完成: $GZ ($(du -h "$GZ" | cut -f1))，保留 $KEEP 份"