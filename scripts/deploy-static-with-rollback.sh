#!/usr/bin/env bash

set -euo pipefail

required=(STATIC_SOURCE STATIC_TARGET STATIC_SITE STATIC_HEALTH_URL SERVER_USER SERVER_HOST RELEASE_SHA)
for key in "${required[@]}"; do
  if [ -z "${!key:-}" ]; then
    echo "missing_required_input=$key" >&2
    exit 1
  fi
done

case "$STATIC_SITE:$STATIC_TARGET" in
  website:/www/wwwroot/website/|admin:/www/wwwroot/admin/|test-admin:/www/wwwroot/test-admin/|seller:/www/wwwroot/seller/|test-seller:/www/wwwroot/test-seller/) ;;
  *) echo "unsupported_static_target=$STATIC_SITE:$STATIC_TARGET" >&2; exit 1 ;;
esac

if [ ! -d "$STATIC_SOURCE" ]; then
  echo "static_source_missing=$STATIC_SOURCE" >&2
  exit 1
fi

case "$STATIC_HEALTH_URL" in
  https://app.ai-maimai.com|https://admin.ai-maimai.com|https://test-admin.ai-maimai.com|https://seller.ai-maimai.com|https://test-seller.ai-maimai.com) ;;
  *) echo "unsupported_static_health_url=$STATIC_HEALTH_URL" >&2; exit 1 ;;
esac

timestamp=$(date -u +%Y%m%dT%H%M%SZ)
short_sha=${RELEASE_SHA:0:12}
backup_dir="/www/backup/releases/$STATIC_SITE"
backup_path="$backup_dir/$timestamp-$short_sha.tar.gz"
remote="$SERVER_USER@$SERVER_HOST"
deploy_complete=false

restore_static() {
  status=$?
  trap - EXIT
  if [ "$status" -ne 0 ] && [ "$deploy_complete" != true ]; then
    echo "static_deploy_failed site=$STATIC_SITE restoring=$backup_path"
    ssh "$remote" \
      "STATIC_TARGET='$STATIC_TARGET' BACKUP_PATH='$backup_path' bash -s" <<'REMOTE'
set -euo pipefail
test -f "$BACKUP_PATH"
restore_dir=$(mktemp -d)
cleanup() { rm -rf -- "$restore_dir"; }
trap cleanup EXIT
tar -xzf "$BACKUP_PATH" -C "$restore_dir"
mkdir -p "$STATIC_TARGET"
rsync -a --delete --delay-updates "$restore_dir/" "$STATIC_TARGET/"
REMOTE
    if curl --fail --silent --show-error --max-time 20 "$STATIC_HEALTH_URL" >/dev/null; then
      echo "static_rollback=healthy site=$STATIC_SITE backup=$backup_path"
    else
      echo "static_rollback=health_failed site=$STATIC_SITE backup=$backup_path" >&2
    fi
  fi
  exit "$status"
}
trap restore_static EXIT

echo "static_backup_started site=$STATIC_SITE target=$STATIC_TARGET"
ssh "$remote" \
  "STATIC_TARGET='$STATIC_TARGET' BACKUP_DIR='$backup_dir' BACKUP_PATH='$backup_path' bash -s" <<'REMOTE'
set -euo pipefail
mkdir -p "$BACKUP_DIR" "$STATIC_TARGET"
tar -C "$STATIC_TARGET" -czf "$BACKUP_PATH" .
test -s "$BACKUP_PATH"
ls -1t "$BACKUP_DIR"/*.tar.gz 2>/dev/null | tail -n +21 | xargs -r rm --
REMOTE
echo "static_backup_complete site=$STATIC_SITE backup=$backup_path"

# release marker 与构建产物一同部署；健康检查必须读到本次候选 SHA，
# 不能把 CDN/SPA fallback 的旧 index 200 当成本次发布成功。
printf '%s\n' "$RELEASE_SHA" > "$STATIC_SOURCE/release-sha.txt"
asset_file=$(find "$STATIC_SOURCE" -type f \( -name '*.js' -o -name '*.css' \) -print -quit)
if [ -z "$asset_file" ]; then
  echo "static_asset_missing=$STATIC_SOURCE" >&2
  exit 1
fi
asset_relative=${asset_file#"$STATIC_SOURCE"/}
asset_sha=$(sha256sum "$asset_file" | awk '{print $1}')

rsync -avz --delete --delay-updates \
  --exclude='.htaccess' \
  --exclude='.user.ini' \
  --exclude='404.html' \
  -e 'ssh -o ServerAliveInterval=30 -o ServerAliveCountMax=10' \
  "$STATIC_SOURCE/" "$remote:$STATIC_TARGET/"

marker=$(curl --fail --silent --show-error --max-time 20 \
  "$STATIC_HEALTH_URL/release-sha.txt?release=$RELEASE_SHA")
test "$marker" = "$RELEASE_SHA"
remote_asset_sha=$(curl --fail --silent --show-error --max-time 20 \
  "$STATIC_HEALTH_URL/$asset_relative?release=$RELEASE_SHA" | sha256sum | awk '{print $1}')
test "$remote_asset_sha" = "$asset_sha"
deploy_complete=true
echo "static_deploy=healthy site=$STATIC_SITE sha=$RELEASE_SHA backup=$backup_path"
