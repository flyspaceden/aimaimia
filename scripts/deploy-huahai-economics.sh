#!/usr/bin/env bash
set -euo pipefail
: "${SERVER_USER:?}" "${SERVER_HOST:?}" "${RELEASE_SHA:?}"
[[ "$RELEASE_SHA" =~ ^[0-9a-f]{40}$ ]]
[[ "$(git rev-parse HEAD)" == "$RELEASE_SHA" ]]
node --test scripts/__tests__/huahai-economics.test.mjs
destination="$SERVER_USER@$SERVER_HOST"
stage="/www/server/huahai-economics/releases/$RELEASE_SHA"
ssh "$destination" "mkdir -p '$stage'"
tar -cf - huahai-corporate-site/jjxmx scripts/nginx/huahai-economics-gate.lua scripts/nginx/huahai-economics.conf scripts/nginx/huahai-economics-shared.conf | ssh "$destination" "tar -xf - -C '$stage'"
ssh "$destination" bash -s -- "$RELEASE_SHA" <<'REMOTE'
set -euo pipefail
release="$1"
stage="/www/server/huahai-economics/releases/$release"
backup="/var/backups/huahai-economics/$(date -u +%Y%m%dT%H%M%SZ)-$release"
nginx=/www/server/nginx/sbin/nginx
test -s /www/server/huahai-economics/credentials.lua
sources=(scripts/nginx/huahai-economics-gate.lua scripts/nginx/huahai-economics.conf scripts/nginx/huahai-economics-shared.conf huahai-corporate-site/jjxmx/index.html huahai-corporate-site/jjxmx/login.html)
targets=(/www/server/huahai-economics/gate.lua /www/server/panel/vhost/nginx/extension/huahainongke.com/huahai-economics.conf /www/server/panel/vhost/nginx/00-huahai-economics-shared.conf /www/wwwroot/huahainongke.com/jjxmx/index.html /www/wwwroot/huahainongke.com/jjxmx/login.html)
mkdir -p "$backup"
for i in "${!targets[@]}"; do
  test -f "$stage/${sources[$i]}"
  if test -e "${targets[$i]}"; then cp -p "${targets[$i]}" "$backup/$i"; else touch "$backup/$i.absent"; fi
done
rollback() {
  trap - ERR
  for i in "${!targets[@]}"; do
    if test -f "$backup/$i.absent"; then rm -f "${targets[$i]}"; else cp -p "$backup/$i" "${targets[$i]}"; fi
  done
  "$nginx" -t && "$nginx" -s reload
  exit 1
}
trap rollback ERR
for i in 0 1 2; do
  mkdir -p "$(dirname "${targets[$i]}")"
  install -m 0644 "$stage/${sources[$i]}" "${targets[$i]}"
done
"$nginx" -t
"$nginx" -s reload
# 新路径首次上线先确认门禁接管，避免 reload 尚未生效时发送页面。
ready=false
for attempt in {1..20}; do
  status=$(curl --silent --show-error --connect-timeout 5 --max-time 10 --resolve huahainongke.com:443:127.0.0.1 -D "$backup/unauth.headers" -o "$backup/unauth.html" -w '%{http_code}' https://huahainongke.com/jjxmx)
  if grep -qi '^X-Huahai-Economics-Gate: v1' "$backup/unauth.headers" && { [[ "$status" == 503 ]] || { [[ "$status" == 200 ]] && grep -q '访问密码' "$backup/unauth.html" && ! grep -q 'data-economics' "$backup/unauth.html"; }; }; then ready=true; break; fi
  sleep 1
done
[[ "$ready" == true ]]
for i in 3 4; do
  mkdir -p "$(dirname "${targets[$i]}")"
  install -m 0644 "$stage/${sources[$i]}" "${targets[$i]}.new"
  mv "${targets[$i]}.new" "${targets[$i]}"
done
status=$(curl --silent --show-error --connect-timeout 5 --max-time 10 --resolve huahainongke.com:443:127.0.0.1 -D "$backup/unauth.headers" -o "$backup/unauth.html" -w '%{http_code}' https://huahainongke.com/jjxmx/index.html)
[[ "$status" == 200 ]]
grep -qi '^X-Huahai-Economics-Gate: v1' "$backup/unauth.headers"
grep -q '访问密码' "$backup/unauth.html"
if grep -q 'data-economics' "$backup/unauth.html"; then rollback; fi
printf '%s\n' "$release" > /www/server/huahai-economics/release-sha
sha256sum "${targets[@]}" > "$backup/installed-sha256.txt"
printf 'release_sha=%s\nbackup=%s\n' "$release" "$backup"
REMOTE
