#!/usr/bin/env bash

set -euo pipefail
umask 077

required=(SRC_DIR PM2_NAME BRANCH RELEASE_SHA RELEASE_RUN_KEY)
for key in "${required[@]}"; do
  if [ -z "${!key:-}" ]; then
    echo "missing_required_input=$key" >&2
    exit 1
  fi
done

case "$BRANCH:$SRC_DIR:$PM2_NAME" in
  main:/www/wwwroot/aimaimai-prod-src:aimaimai-api-prod|staging:/www/wwwroot/aimaimai-staging-src:aimaimai-api-test) ;;
  *) echo "unsupported_backend_target=$BRANCH:$SRC_DIR:$PM2_NAME" >&2; exit 1 ;;
esac
[[ "$RELEASE_SHA" =~ ^[0-9a-f]{40}$ ]] || { echo 'invalid_release_sha' >&2; exit 1; }
[[ "$RELEASE_RUN_KEY" =~ ^[0-9]+-[0-9]+$ ]] || { echo 'invalid_release_run_key' >&2; exit 1; }

live_backend="$SRC_DIR/backend"
release_id="${RELEASE_SHA:0:12}-$RELEASE_RUN_KEY"
release_root="/www/wwwroot/.aimaimai-backend-releases/$PM2_NAME"
candidate_dir="$release_root/$release_id"
candidate_backend="$candidate_dir/backend"
journal_root="/www/backup/releases/backend-journal/$PM2_NAME"
journal_file="$journal_root/$release_id.state"
lock_file="$journal_root/deploy.lock"
public_ready_url=$([ "$BRANCH" = main ] \
  && printf '%s' 'https://api.ai-maimai.com/api/v1/health/ready' \
  || printf '%s' 'https://test-api.ai-maimai.com/api/v1/health/ready')
public_api_base=${public_ready_url%/health/ready}

mkdir -p "$release_root" "$journal_root"
chmod 700 "$journal_root"
exec 9>"$lock_file"
flock -n 9 || { echo "backend_deploy=locked pm2=$PM2_NAME" >&2; exit 1; }

for previous_journal in "$journal_root"/*.state; do
  [ -e "$previous_journal" ] || continue
  previous_stage=$(sed -n 's/^STAGE=//p' "$previous_journal" | tail -n 1)
  case "$previous_stage" in COMPLETE|ROLLED_BACK|ROLLED_BACK_DB_FORWARD) ;;
    *) echo "unfinished_backend_deploy=$previous_journal stage=$previous_stage" >&2; exit 1 ;;
  esac
done

stage='INITIALIZING'
previous_sha='unknown'
old_pm_id=''
old_exec=''
old_cwd=''
old_env_arg='false'
old_node_env=''
old_interpreter=''
old_health_mode='legacy'
backup_path=''
pm2_stopped=false
deploy_complete=false
migration_started=false
migration_completed=false
pm2_snapshot=''
pm2_values=''
stopped_snapshot=''
post_start_snapshot=''

record_stage() {
  stage="$1"
  temporary_journal="$journal_file.tmp"
  {
    echo "STAGE=$stage"
    echo "RELEASE_SHA=$RELEASE_SHA"
    echo "PREVIOUS_SHA=$previous_sha"
    echo "PM2_NAME=$PM2_NAME"
    echo "OLD_PM_ID=$old_pm_id"
    echo "OLD_EXEC=$old_exec"
    echo "OLD_CWD=$old_cwd"
    echo "OLD_NODE_ENV=$old_node_env"
    echo "OLD_HEALTH_MODE=$old_health_mode"
    echo "BACKUP_PATH=$backup_path"
    echo "UPDATED_AT=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  } > "$temporary_journal"
  chmod 600 "$temporary_journal"
  mv "$temporary_journal" "$journal_file"
  echo "backend_release_stage=$stage release_sha=$RELEASE_SHA"
}
record_stage INITIALIZING

health_check() {
  allow_legacy="${1:-false}"
  expected_sha="${2:-}"
  api_port=$(sed -n 's/^PORT=//p' "$live_backend/.env" | tail -n 1 | tr -d '\r"')
  case "$api_port" in ''|*[!0-9]*) api_port=3000 ;; esac
  readiness_url="http://127.0.0.1:${api_port}/api/v1/health/ready"
  legacy_url="http://127.0.0.1:${api_port}/api/v1/products?page=1&pageSize=1"
  for attempt in $(seq 1 15); do
    if readiness_body=$(curl --fail --silent --show-error "$readiness_url"); then
      if [ -z "$expected_sha" ] || HEALTH_BODY="$readiness_body" EXPECTED_SHA="$expected_sha" node -e '
        const body = JSON.parse(process.env.HEALTH_BODY);
        const data = body?.data && typeof body.data === "object" ? body.data : body;
        if (data.releaseSha !== process.env.EXPECTED_SHA) process.exit(1);
      '; then
        echo "backend_health=ready attempt=$attempt release_sha=${expected_sha:-legacy}"
        return 0
      fi
    fi
    if [ "$allow_legacy" = true ] \
      && curl --fail --silent --show-error "$legacy_url" >/dev/null; then
      echo "backend_health=legacy attempt=$attempt"
      return 0
    fi
    sleep 2
  done
  return 1
}

public_health_check() {
  expected_sha="$1"
  public_body=$(curl --fail --silent --show-error --max-time 20 "$public_ready_url?release=$expected_sha")
  HEALTH_BODY="$public_body" EXPECTED_SHA="$expected_sha" node -e '
    const body = JSON.parse(process.env.HEALTH_BODY);
    const data = body?.data && typeof body.data === "object" ? body.data : body;
    if (data.releaseSha !== process.env.EXPECTED_SHA) process.exit(1);
  '
}

assert_public_status() {
  method="$1" path="$2" expected="$3"
  if [ "$method" = GET ]; then
    actual=$(curl --silent --show-error --max-time 20 -o /dev/null -w '%{http_code}' "$public_api_base$path")
  else
    actual=$(curl --silent --show-error --max-time 20 -o /dev/null -w '%{http_code}' \
      -X "$method" -H 'Content-Type: application/json' --data '{}' "$public_api_base$path")
  fi
  test "$actual" = "$expected"
}

verify_backend_dependencies() {
  npm ls --depth=0 --omit=optional --loglevel=error >/dev/null \
    && test -x node_modules/.bin/prisma \
    && test -x node_modules/.bin/nest \
    && node -e "require.resolve('@prisma/client'); require.resolve('@nestjs/core'); require.resolve('typescript')"
}

run_npm_ci() {
  registry="$1" retries="$2" fetch_timeout="$3" attempt_timeout="$4" label="$5"
  echo "npm_install_attempt=$label registry=$registry started_at=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  npm_config_registry="$registry" \
    npm_config_replace_registry_host=always \
    npm_config_fetch_retries="$retries" \
    npm_config_fetch_retry_mintimeout=5000 \
    npm_config_fetch_retry_maxtimeout=30000 \
    npm_config_fetch_timeout="$fetch_timeout" \
    timeout --signal=TERM --kill-after=30s "$attempt_timeout" \
    npm ci --no-audit --no-fund --timing --loglevel=notice \
    && verify_backend_dependencies
}

install_backend_dependencies() {
  run_npm_ci 'https://registry.npmjs.org' 0 45000 3m official \
    || run_npm_ci 'https://registry.npmmirror.com' 2 120000 12m mirror
}

build_backend() {
  NODE_OPTIONS="${NODE_OPTIONS:---max-old-space-size=4096}" npm run build
}

start_release() {
  exec_path="$1" cwd_path="$2" target_sha="$3"
  if [ "$old_env_arg" = true ]; then
    NODE_ENV="$old_node_env" RELEASE_SHA="$target_sha" \
      pm2 start "$exec_path" --name "$PM2_NAME" --cwd "$cwd_path" --interpreter "$old_interpreter" --time -- --env=production
  else
    NODE_ENV="$old_node_env" RELEASE_SHA="$target_sha" \
      pm2 start "$exec_path" --name "$PM2_NAME" --cwd "$cwd_path" --interpreter "$old_interpreter" --time
  fi
}

cleanup_sensitive_snapshots() {
  for snapshot_path in "$pm2_snapshot" "$pm2_values" "$stopped_snapshot" "$post_start_snapshot"; do
    [ -z "$snapshot_path" ] || rm -f -- "$snapshot_path"
  done
}

restore_old_release() {
  status=$?
  trap - EXIT
  if [ "$status" -ne 0 ] && [ "$deploy_complete" != true ]; then
    echo "backend_deploy=failed stage=$stage previous_sha=$previous_sha release_sha=$RELEASE_SHA" >&2
    set +e
    if [ "$pm2_stopped" = true ]; then
      # delete/start 即使部分成功后返回非 0，也统一清掉同名候选并从已验证的旧绝对路径重建。
      pm2 delete "$PM2_NAME" >/dev/null 2>&1 || true
      start_release "$old_exec" "$old_cwd" "$previous_sha"
      rollback_status=$?
      if [ "$rollback_status" -eq 0 ]; then
        if [ "$old_health_mode" = release ]; then
          health_check false "$previous_sha"
          rollback_status=$?
          if [ "$rollback_status" -eq 0 ]; then public_health_check "$previous_sha"; rollback_status=$?; fi
        else
          health_check true
          rollback_status=$?
          if [ "$rollback_status" -eq 0 ]; then
            public_status=$(curl --silent --show-error --max-time 20 -o /dev/null -w '%{http_code}' \
              "$public_api_base/products?page=1&pageSize=1")
            [ "$public_status" = 200 ]
            rollback_status=$?
          fi
        fi
      fi
      if [ "$rollback_status" -eq 0 ]; then
        pm2 save
        if [ "$migration_started" = true ] && [ "$migration_completed" != true ]; then
          record_stage MIGRATION_FAILED_NEEDS_RECONCILIATION
          echo "database_reconciliation=required backup=$backup_path" >&2
        elif [ "$migration_completed" = true ]; then
          if (cd "$candidate_backend" && npx --no-install prisma migrate status >/dev/null); then
            record_stage ROLLED_BACK_DB_FORWARD
            echo "database_rollback=expand_fail_forward backup=$backup_path"
          else
            record_stage MIGRATION_STATUS_NEEDS_RECONCILIATION
            echo "database_reconciliation=required backup=$backup_path" >&2
          fi
        else
          record_stage ROLLED_BACK
        fi
        echo "backend_rollback=healthy previous_sha=$previous_sha"
        if [ -e "$candidate_dir" ] && [ "$candidate_dir" != "$(dirname "$old_cwd")" ]; then
          git -C "$SRC_DIR" worktree remove --force "$candidate_dir" || true
        fi
      else
        echo "backend_rollback=failed previous_sha=$previous_sha journal=$journal_file" >&2
        pm2 describe "$PM2_NAME" || true
        pm2 logs "$PM2_NAME" --lines 100 --nostream || true
      fi
    else
      record_stage ROLLED_BACK
    fi
    set -e
  fi
  cleanup_sensitive_snapshots
  exit "$status"
}
trap restore_old_release EXIT

cd "$SRC_DIR"
git fetch origin "$BRANCH"
test "$(git rev-parse "origin/$BRANCH")" = "$RELEASE_SHA"
git cat-file -e "$RELEASE_SHA^{commit}"
test ! -e "$candidate_dir"

pm2_snapshot="$journal_root/$release_id-pm2.json"
pm2_values="$journal_root/$release_id-pm2.env"
pm2 jlist > "$pm2_snapshot"
chmod 600 "$pm2_snapshot"
LIVE_BACKEND="$live_backend" CANDIDATE_ROOT="$release_root" PM2_NAME="$PM2_NAME" BRANCH="$BRANCH" \
  SNAPSHOT_PATH="$pm2_snapshot" OUTPUT_PATH="$pm2_values" node <<'NODE'
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const rows = JSON.parse(fs.readFileSync(process.env.SNAPSHOT_PATH, 'utf8'));
const matches = rows.filter((row) => row.name === process.env.PM2_NAME);
if (matches.length !== 1) throw new Error('PM2 process must be unique');
const row = matches[0];
const env = row.pm2_env || {};
const cwd = path.resolve(String(env.pm_cwd || ''));
const live = path.resolve(process.env.LIVE_BACKEND);
const candidateRoot = `${path.resolve(process.env.CANDIDATE_ROOT)}${path.sep}`;
if (env.status !== 'online' || env.exec_mode !== 'fork_mode' || Number(env.instances || 1) !== 1 || env.watch) {
  throw new Error('PM2 process shape is unsupported');
}
if (cwd !== live && !(cwd.startsWith(candidateRoot) && cwd.endsWith(`${path.sep}backend`))) {
  throw new Error('PM2 cwd is not an approved immutable release');
}
const execPath = path.resolve(String(env.pm_exec_path || ''));
if (![path.join(cwd, 'dist/src/main.js'), path.join(cwd, 'dist/main.js')].includes(execPath)) {
  throw new Error('PM2 entrypoint is unexpected');
}
const args = Array.isArray(env.args) ? env.args.map(String) : [];
const envArg = args.length === 0 ? false : args.length === 1 && args[0] === '--env=production';
if (args.length && !envArg) throw new Error('PM2 arguments are unsupported');
const nodeEnv = String(env.NODE_ENV || '');
if (process.env.BRANCH === 'main' ? nodeEnv !== 'production' : !['staging', 'production'].includes(nodeEnv)) {
  throw new Error('PM2 NODE_ENV is unexpected');
}
const interpreter = String(env.exec_interpreter || '');
if (!/(^|\/)node(?:js)?$/.test(interpreter)) throw new Error('PM2 interpreter is unsupported');
const nodeArgs = Array.isArray(env.node_args) ? env.node_args : env.node_args ? [env.node_args] : [];
if (nodeArgs.length > 0) throw new Error('PM2 node_args must be empty');
const repoRoot = path.resolve(cwd, '..');
const previousSha = execFileSync('git', ['-C', repoRoot, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
if (!/^[0-9a-f]{40}$/.test(previousSha)) throw new Error('PM2 release SHA is invalid');
const healthService = [
  path.join(cwd, 'dist/src/modules/health/health.service.js'),
  path.join(cwd, 'dist/modules/health/health.service.js'),
].find((file) => fs.existsSync(file));
const healthMode = healthService && fs.readFileSync(healthService, 'utf8').includes('releaseSha') ? 'release' : 'legacy';
const values = [
  `OLD_PM_ID=${Number(row.pm_id)}`,
  `OLD_EXEC=${execPath}`,
  `OLD_CWD=${cwd}`,
  `OLD_ENV_ARG=${envArg}`,
  `OLD_NODE_ENV=${nodeEnv}`,
  `OLD_INTERPRETER=${interpreter}`,
  `OLD_HEALTH_MODE=${healthMode}`,
  `PREVIOUS_SHA=${previousSha}`,
].join('\n');
fs.writeFileSync(process.env.OUTPUT_PATH, `${values}\n`, { mode: 0o600 });
NODE
# 文件内容只来自上面的严格路径、整数和布尔校验。
source "$pm2_values"
old_pm_id="$OLD_PM_ID" old_exec="$OLD_EXEC" old_cwd="$OLD_CWD" old_env_arg="$OLD_ENV_ARG" \
  old_node_env="$OLD_NODE_ENV" old_interpreter="$OLD_INTERPRETER" old_health_mode="$OLD_HEALTH_MODE" \
  previous_sha="$PREVIOUS_SHA"
rm -f -- "$pm2_snapshot" "$pm2_values"
pm2_snapshot=''
pm2_values=''
record_stage PM2_VERIFIED

git worktree prune
git worktree add --detach "$candidate_dir" "$RELEASE_SHA"
test "$(git -C "$candidate_dir" rev-parse HEAD)" = "$RELEASE_SHA"
test -f "$live_backend/.env"
ln -s "$live_backend/.env" "$candidate_backend/.env"
if [ -d "$live_backend/certs" ] && [ ! -e "$candidate_backend/certs" ]; then
  ln -s "$live_backend/certs" "$candidate_backend/certs"
fi
mkdir -p "$live_backend/uploads"
[ ! -d "$candidate_backend/uploads" ] || mv "$candidate_backend/uploads" "$candidate_backend/uploads.packaged"
ln -s "$live_backend/uploads" "$candidate_backend/uploads"

cd "$candidate_backend"
install_backend_dependencies
npx --no-install prisma generate
npx --no-install prisma validate
build_backend
test -f dist/src/main.js -o -f dist/main.js
node --test ../scripts/__tests__/production-delivery-exclusion.test.mjs
record_stage PREPARED

pm2_stopped=true
pm2 stop "$old_pm_id"
stopped_snapshot="$journal_root/$release_id-pm2-stopped.json"
pm2 jlist > "$stopped_snapshot"
chmod 600 "$stopped_snapshot"
PM2_NAME="$PM2_NAME" OLD_PM_ID="$old_pm_id" SNAPSHOT_PATH="$stopped_snapshot" node -e '
  const fs = require("node:fs");
  const rows = JSON.parse(fs.readFileSync(process.env.SNAPSHOT_PATH, "utf8"));
  const row = rows.find((item) => item.name === process.env.PM2_NAME && String(item.pm_id) === process.env.OLD_PM_ID);
  if (!row || row.pm2_env?.status !== "stopped") process.exit(1);
'
stopped_port=$(sed -n 's/^PORT=//p' "$live_backend/.env" | tail -n 1 | tr -d '\r"')
case "$stopped_port" in ''|*[!0-9]*) stopped_port=3000 ;; esac
if curl --fail --silent --max-time 2 "http://127.0.0.1:${stopped_port}/api/v1/products?page=1&pageSize=1" >/dev/null 2>&1; then
  echo "backend_maintenance=failed_port_still_serving port=$stopped_port" >&2
  exit 1
fi
rm -f -- "$stopped_snapshot"
stopped_snapshot=''
record_stage PM2_STOPPED

if [ "$BRANCH" = main ]; then
  backup_result=$(DATABASE_BACKUP_LABEL="$(date -u +%Y%m%dT%H%M%SZ)-${previous_sha:0:12}-before-${RELEASE_SHA:0:12}" \
    node scripts/create-production-database-backup.cjs)
  printf '%s\n' "$backup_result"
  backup_path=$(BACKUP_RESULT="$backup_result" node -e "const r=JSON.parse(process.env.BACKUP_RESULT); if(r.database_backup!=='verified'||!r.file)process.exit(1); process.stdout.write(r.file)")
fi
record_stage BACKUP_VERIFIED

migration_started=true
record_stage MIGRATING
npx --no-install prisma migrate deploy
migration_completed=true
record_stage MIGRATED

pm2 delete "$old_pm_id"
entrypoint="$candidate_backend/dist/src/main.js"
[ -f "$entrypoint" ] || entrypoint="$candidate_backend/dist/main.js"
start_release "$entrypoint" "$candidate_backend" "$RELEASE_SHA"
post_start_snapshot="$journal_root/$release_id-pm2-started.json"
pm2 jlist > "$post_start_snapshot"
chmod 600 "$post_start_snapshot"
PM2_NAME="$PM2_NAME" EXPECTED_CWD="$candidate_backend" EXPECTED_EXEC="$entrypoint" \
  EXPECTED_NODE_ENV="$old_node_env" EXPECTED_SHA="$RELEASE_SHA" SNAPSHOT_PATH="$post_start_snapshot" node -e '
  const fs = require("node:fs");
  const path = require("node:path");
  const rows = JSON.parse(fs.readFileSync(process.env.SNAPSHOT_PATH, "utf8"));
  const matches = rows.filter((row) => row.name === process.env.PM2_NAME);
  if (matches.length !== 1) process.exit(1);
  const env = matches[0].pm2_env || {};
  if (env.status !== "online") process.exit(1);
  if (path.resolve(String(env.pm_cwd || "")) !== path.resolve(process.env.EXPECTED_CWD)) process.exit(1);
  if (path.resolve(String(env.pm_exec_path || "")) !== path.resolve(process.env.EXPECTED_EXEC)) process.exit(1);
  if (String(env.NODE_ENV || "") !== process.env.EXPECTED_NODE_ENV) process.exit(1);
  if (String(env.RELEASE_SHA || "") !== process.env.EXPECTED_SHA) process.exit(1);
'
rm -f -- "$post_start_snapshot"
post_start_snapshot=''
record_stage RELEASE_STARTED

health_check false "$RELEASE_SHA"
record_stage LOCAL_READY
public_health_check "$RELEASE_SHA"
record_stage EXTERNAL_READY
assert_public_status GET '/products?page=1&pageSize=1' 200
assert_public_status GET '/cart' 401
assert_public_status GET '/me' 401
assert_public_status GET '/bonus/wallet' 401
assert_public_status GET '/after-sale' 401
assert_public_status POST '/orders/checkout' 401
assert_public_status POST '/orders/vip-checkout' 401
assert_public_status POST '/group-buy/checkout' 401
assert_public_status POST '/auth/login' 400
record_stage APP_COMPAT_SMOKE
pm2 save
record_stage COMPLETE
pm2_stopped=false
deploy_complete=true
cleanup_sensitive_snapshots
echo "backend_deploy=healthy release_sha=$RELEASE_SHA previous_sha=$previous_sha release_dir=$candidate_dir"

# 成功后仅保留最近 5 个不可变 release；绝不删除当前运行目录或刚才的回滚目录。
old_release_dir=$(dirname "$old_cwd")
set +e
find "$release_root" -mindepth 1 -maxdepth 1 -type d -printf '%T@ %p\n' \
  | sort -nr \
  | tail -n +6 \
  | cut -d' ' -f2- \
  | while IFS= read -r old_dir; do
      case "$old_dir" in
        "$release_root"/*)
          if [ "$old_dir" != "$candidate_dir" ] && [ "$old_dir" != "$old_release_dir" ]; then
            git -C "$SRC_DIR" worktree remove --force "$old_dir" \
              || echo "backend_release_cleanup=failed dir=$old_dir" >&2
          fi
          ;;
      esac
    done
set -e
