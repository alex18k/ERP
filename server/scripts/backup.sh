#!/usr/bin/env bash
# ERP PostgreSQL 自动备份脚本
# 用 pg_dump 生成一致性逻辑备份，gzip 压缩，按 BACKUP_KEEP 保留最近 N 份。
# 连接串取自 server/.env 的 DATABASE_URL（可用环境变量 DATABASE_URL 覆盖）。
# 恢复：zcat erp-XXX.sql.gz | psql "$DATABASE_URL"
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SERVER_DIR="$(dirname "$SCRIPT_DIR")"
BACKUP_DIR="${BACKUP_DIR:-$SERVER_DIR/backups}"
KEEP="${BACKUP_KEEP:-14}"
STAMP="$(date +%Y%m%d-%H%M%S)"

if [[ -z "${DATABASE_URL:-}" && -f "$SERVER_DIR/.env" ]]; then
  DATABASE_URL="$(grep -E '^DATABASE_URL=' "$SERVER_DIR/.env" | head -1 | cut -d= -f2- | sed -e 's/^"//' -e 's/"$//')"
fi
if [[ -z "${DATABASE_URL:-}" ]]; then
  echo "[$(date '+%F %T')] ERROR: 未找到 DATABASE_URL" >&2
  exit 1
fi

mkdir -p "$BACKUP_DIR"
GZ="$BACKUP_DIR/erp-${STAMP}.sql.gz"

if ! pg_dump --dbname="$DATABASE_URL" --no-owner --no-privileges 2>/dev/null | gzip -c > "$GZ"; then
  rm -f "$GZ"
  echo "[$(date '+%F %T')] ERROR: pg_dump 失败" >&2
  exit 1
fi

# 清理旧备份，保留最近 KEEP 份
ls -1t "$BACKUP_DIR"/erp-*.sql.gz 2>/dev/null | tail -n +$((KEEP + 1)) | xargs -r rm -f

echo "[$(date '+%F %T')] 备份完成: $GZ ($(du -h "$GZ" | cut -f1))，保留 $KEEP 份"
