# GitHub 日常操作指南

> 分支角色和版本收敛原则以 `docs/operations/branch-strategy.md` 为准。本文只提供安全操作步骤。历史“直接在 staging 开发”“整体 merge staging 到 main”“main push 自动部署生产”的命令已废止。

仓库：`https://github.com/flyspaceden/aimaimia.git`

## 一、开始任何任务前

```bash
git fetch --prune origin
git rev-parse origin/main
git rev-parse origin/staging
git status --short --branch
git rev-list --left-right --count origin/main...origin/staging
```

先确认远端事实，再从 `origin/main` 建立短期干净 worktree。不要在脏的原始目录或固定微信测试目录开发。

```bash
git worktree add -b codex/<task>-<date> /private/tmp/aimaimai-<task>-<date> origin/main
cd /private/tmp/aimaimai-<task>-<date>
```

## 二、提交前

```bash
git status --short
git diff --check
git diff --name-status origin/main...HEAD
```

只暂存本需求文件：

```bash
git add path/to/file-a path/to/file-b
git diff --cached --name-status
git diff --cached --check
git commit -m "fix(scope): 简短说明"
```

一个 commit 一个逻辑改动。涉及 migration、资金、鉴权、状态机或并发时，在 PR 中显式写出不可仅靠 `git revert` 回退的部分。

## 三、候选 PR

```bash
git push -u origin codex/<task>-<date>
gh pr create --base main --head codex/<task>-<date> --draft
gh pr checks <PR号> --watch
```

PR 初始以 Draft 保存。Required Checks、独立审查和测试环境验收未完成前，不转 Ready、不合并。

## 四、进入 staging 测试

- `staging` 只接收本轮已批准候选，禁止在其上直接写代码。
- 先审查 `origin/main...candidate` 与 `origin/staging...candidate`，确认没有夹带 App、Delivery 或其他未批准内容。
- 当前旧 staging 尚未完成一次性收敛前，禁止按旧命令整体合并；按 `branch-strategy.md §五` 单独处理。
- 部署后记录测试环境实际 SHA，不以“Actions 绿色”替代服务器和页面验证。
- 微信开发者工具固定目录只能在远端测试分支已部署并验证后同步；同步后必须干净且 `HEAD == origin/<选定测试分支>`。

当前一次性收敛在任何 staging 指针变化前，必须先执行并核验远端三重保全。以下 SHA 只适用于本次已审查基线；若远端 tip 已变化，立即停止并重新审查：

```zsh
set -euo pipefail
readonly OLD_STAGING_SHA=acc0e08c303eef76af3bb4ca9d3e9a8c95c4ebb2
readonly ARCHIVE_BRANCH=refs/heads/archive/staging-pre-main-20260822
readonly DELIVERY_BRANCH=refs/heads/delivery/staging
readonly ARCHIVE_TAG=refs/tags/archive/staging-pre-main-20260822

git fetch --prune origin
[[ "$(git rev-parse origin/staging)" = "$OLD_STAGING_SHA" ]]
git push origin "${OLD_STAGING_SHA}:${ARCHIVE_BRANCH}"
git push origin "${OLD_STAGING_SHA}:${DELIVERY_BRANCH}"
if git show-ref --verify --quiet "$ARCHIVE_TAG"; then
  [[ "$(git rev-parse "$ARCHIVE_TAG^{}")" = "$OLD_STAGING_SHA" ]]
else
  git tag -a "${ARCHIVE_TAG#refs/tags/}" "$OLD_STAGING_SHA" -m "Archive legacy staging before main convergence"
fi
git push origin "$ARCHIVE_TAG"

verify_remote_ref() {
  local ref="$1"
  local actual
  actual="$(git ls-remote origin "$ref" | awk 'NR == 1 {print $1}')"
  [[ "$actual" = "$OLD_STAGING_SHA" ]]
}
verify_remote_ref "$ARCHIVE_BRANCH"
verify_remote_ref "$DELIVERY_BRANCH"
verify_remote_ref "$ARCHIVE_TAG^{}"
```

三个远端 SHA 均须等于 `OLD_STAGING_SHA`，任一步失败会立即停止。该三重保全已于 2026-08-22 执行并复验；`origin/staging` 仍是旧 SHA，没有被重写。

### 当前获批路径：保留 staging，使用 staging-next 测试

本轮不执行下面的 staging 替换命令。生产候选 CI 全绿后，将同一 exact SHA 创建为临时 `staging-next`。旧 staging 已 locked；GitHub `staging` environment 只允许 `staging-next`；历史 `.github/workflows/deploy-website.yml` 对应 workflow ID `255149831` 已全局停用。会操作同一测试源码目录/数据库的 `Digital Asset Backfill`（ID `297985401`）也已在验收窗口暂时停用。当前测试与后续生产发布统一由新的 `.github/workflows/deploy-release.yml` 承担，因此旧 staging ref 即使保留历史 workflow 文件也拿不到可执行入口。

第一阶段只推分支并等待 exact-SHA 部署成功，不得在此阶段 rebind。分支创建后必须立即设置临时 branch protection：禁止删除/强推，要求 `e2e` 与 `checks`；后续变化只能重新走候选和 CI，不得把它当开发分支直接推送。

```zsh
set -euo pipefail
readonly OLD_STAGING_SHA=acc0e08c303eef76af3bb4ca9d3e9a8c95c4ebb2
readonly NEW_STAGING_SHA=请替换为已验证的40位候选SHA
[[ "$NEW_STAGING_SHA" =~ ^[0-9a-f]{40}$ ]]
git push origin "${NEW_STAGING_SHA}:refs/heads/staging-next"
git fetch origin staging staging-next
[[ "$(git rev-parse origin/staging)" = "$OLD_STAGING_SHA" ]]
[[ "$(git rev-parse origin/staging-next)" = "$NEW_STAGING_SHA" ]]

readonly DEPLOY_RUN_ID="$(gh run list \
  --workflow deploy-release.yml \
  --branch staging-next \
  --limit 20 \
  --json databaseId,headSha \
  --jq ".[] | select(.headSha == \"$NEW_STAGING_SHA\") | .databaseId" | head -n 1)"
[[ "$DEPLOY_RUN_ID" =~ ^[0-9]+$ ]]
gh run watch "$DEPLOY_RUN_ID" --exit-status

readonly READY_BODY="$(curl --fail --silent --show-error \
  "https://test-api.ai-maimai.com/api/v1/health/ready?release=$NEW_STAGING_SHA")"
HEALTH_BODY="$READY_BODY" EXPECTED_SHA="$NEW_STAGING_SHA" node -e '
  const body = JSON.parse(process.env.HEALTH_BODY);
  const data = body?.data && typeof body.data === "object" ? body.data : body;
  if (data.releaseSha !== process.env.EXPECTED_SHA) process.exit(1);
'
[[ "$(curl --fail --silent --show-error "https://test-admin.ai-maimai.com/release-sha.txt?release=$NEW_STAGING_SHA")" = "$NEW_STAGING_SHA" ]]
[[ "$(curl --fail --silent --show-error "https://test-seller.ai-maimai.com/release-sha.txt?release=$NEW_STAGING_SHA")" = "$NEW_STAGING_SHA" ]]
```

第二阶段只有在 Actions 成功、API `releaseSha` 和两个后台 release marker 都精确等于候选 SHA 后才能运行：

```zsh
set -euo pipefail
readonly OLD_STAGING_SHA=acc0e08c303eef76af3bb4ca9d3e9a8c95c4ebb2
readonly NEW_STAGING_SHA=请替换为上一步已部署的40位候选SHA

AIMAI_STAGING_TEST_BRANCH=staging-next \
AIMAI_STAGING_EXPECTED_OLD_BRANCH=staging \
AIMAI_STAGING_EXPECTED_OLD_SHA="$OLD_STAGING_SHA" \
AIMAI_STAGING_EXPECTED_NEW_SHA="$NEW_STAGING_SHA" \
AIMAI_STAGING_REBIND_CONFIRM=RECREATE_STAGING_TEST_CHECKOUT_FROM_ARCHIVED_REMOTE \
node scripts/sync-staging-test-checkout.mjs --rebind
```

切换脚本还会自行重复核验测试 API 与两个后台的 exact SHA，防止跳过第一阶段。它随后核验 archive branch、annotated tag、`delivery/staging` 三个恢复引用仍等于旧 SHA，在旁路 clone 中完成 `npm ci`、release-context、staging build 和 clean 检查；准备移动目录前还会再次读取远端分支和部署 markers，任何漂移都会停止且旧目录不动。全部通过后才保留原固定目录并原子换到固定路径。后续日常同步必须继续显式设置 `AIMAI_STAGING_TEST_BRANCH=staging-next`，且只能 fast-forward。`staging-next` 是临时验收指针，不是新的长期开发分支。

未来若 `staging-next` 全量验收后仍决定替换 `staging`，必须再次单独获批。执行时由操作者先把已验证的 40 位 SHA 显式写入 `NEW_STAGING_SHA`；下面命令会用旧 tip 作 lease，远端已漂移时自动拒绝：

```zsh
set -euo pipefail
readonly OLD_STAGING_SHA=acc0e08c303eef76af3bb4ca9d3e9a8c95c4ebb2
readonly NEW_STAGING_SHA=请替换为已验证的40位staging-next-SHA
[[ "$NEW_STAGING_SHA" =~ ^[0-9a-f]{40}$ ]]
git cat-file -e "$NEW_STAGING_SHA^{commit}"
git push --force-with-lease="refs/heads/staging:$OLD_STAGING_SHA" \
  origin "${NEW_STAGING_SHA}:refs/heads/staging"
git fetch origin staging
[[ "$(git rev-parse origin/staging)" = "$NEW_STAGING_SHA" ]]

AIMAI_STAGING_EXPECTED_OLD_SHA="$OLD_STAGING_SHA" \
AIMAI_STAGING_EXPECTED_NEW_SHA="$NEW_STAGING_SHA" \
AIMAI_STAGING_REBIND_CONFIRM=RECREATE_STAGING_TEST_CHECKOUT_FROM_ARCHIVED_REMOTE \
node scripts/sync-staging-test-checkout.mjs --rebind
```

`--rebind` 先在旁路目录克隆并验证新 staging，再把旧固定目录改名为带旧 SHA 的备份，最后才把新目录放到原路径；不会 reset 或删除旧目录。日常更新不得使用该参数，只运行普通同步脚本。

若新 staging 验收失败，按下面的反向流程先三重保存当前坏 tip，再以坏 tip 为 lease 恢复旧 staging。日期后缀必须按实际事故时间更新；任一步失败立即停止：

```zsh
set -euo pipefail
git fetch --prune origin
readonly BROKEN_STAGING_SHA="$(git rev-parse origin/staging)"
readonly LEGACY_STAGING_SHA="$(git rev-parse origin/archive/staging-pre-main-20260822)"
readonly ROLLBACK_BRANCH=refs/heads/archive/staging-before-rollback-20260822
readonly RECOVERY_BRANCH=refs/heads/recovery/staging-before-rollback-20260822
readonly ROLLBACK_TAG=refs/tags/archive/staging-before-rollback-20260822

git push origin "${BROKEN_STAGING_SHA}:${ROLLBACK_BRANCH}"
git push origin "${BROKEN_STAGING_SHA}:${RECOVERY_BRANCH}"
git tag -a "${ROLLBACK_TAG#refs/tags/}" "$BROKEN_STAGING_SHA" -m "Archive broken staging before rollback"
git push origin "$ROLLBACK_TAG"
for ref in "$ROLLBACK_BRANCH" "$RECOVERY_BRANCH" "$ROLLBACK_TAG^{}"; do
  [[ "$(git ls-remote origin "$ref" | awk 'NR == 1 {print $1}')" = "$BROKEN_STAGING_SHA" ]]
done

git push --force-with-lease="refs/heads/staging:$BROKEN_STAGING_SHA" \
  origin "${LEGACY_STAGING_SHA}:refs/heads/staging"
git fetch origin staging
[[ "$(git rev-parse origin/staging)" = "$LEGACY_STAGING_SHA" ]]

AIMAI_STAGING_EXPECTED_OLD_SHA="$BROKEN_STAGING_SHA" \
AIMAI_STAGING_EXPECTED_NEW_SHA="$LEGACY_STAGING_SHA" \
AIMAI_STAGING_ARCHIVE_REF="$ROLLBACK_BRANCH" \
AIMAI_STAGING_DELIVERY_REF="$RECOVERY_BRANCH" \
AIMAI_STAGING_ARCHIVE_TAG_REF="$ROLLBACK_TAG^{}" \
AIMAI_STAGING_REBIND_CONFIRM=RECREATE_STAGING_TEST_CHECKOUT_FROM_ARCHIVED_REMOTE \
node scripts/sync-staging-test-checkout.mjs --rebind
```

## 五、进入 main 与生产

1. 在 GitHub 审查 PR 文件清单、commit、Required Checks 和 approvals。
2. 合并前重新 fetch，确认 PR base 仍为预期 `origin/main`；base 变化则重跑受影响门禁。
3. 合入 `main` 后只表示生产代码分支已更新。若 GitHub 生成新的 merge SHA，先比较 main 与已测试 staging 的 Git tree；tree 不同就回 staging 重测，tree 相同也必须在 exact main SHA 上重跑 production CI/E2E/build 和 migration attestation。
4. 生产发布通过新的 `Deploy Release Train`（`.github/workflows/deploy-release.yml`）的 `workflow_dispatch` 手动触发，并填写显式生产确认；workflow 绑定 exact SHA 和 production environment approval。旧 `Deploy Sites & Backend` 已停用，禁止重新启用。

Website-only 生产发布允许一个严格例外：如果 readiness 返回的线上后端 SHA 与候选 SHA 不同，workflow 必须在完整 Git 历史中解析两者的 `backend/` tree；只有 tree SHA 完全相同才允许继续构建和发布 Website。线上 SHA 无效、对象不可解析或 backend tree 不同均 fail-closed。Admin/Seller 仍要求线上后端 exact SHA，不适用此例外。
5. 后端成功后才允许发布依赖它的 admin/seller/H5；小程序另走 production artifact、体验版、审核和发布。
6. 核对线上 SHA、PM2、health、migration 与业务探针后，才能记录“生产完成”。

## 六、发布后同步

```bash
git fetch --prune origin
git log --oneline origin/staging..origin/main
git log --oneline origin/main..origin/staging
git diff --stat origin/main...origin/staging
```

正常发布结束时，应把 main 的已发布提交同步回 staging。若 staging 仍有下一轮 release train，差异必须与一张明确清单逐项相符；不能存在“以后再看”的匿名提交。

## 七、Hotfix

```bash
git fetch --prune origin
git worktree add -b hotfix/<task>-<date> /private/tmp/aimaimai-hotfix-<date> origin/main
```

修复、测试、PR、手动 exact-SHA 发布完成后，把同一补丁同步到 staging 和仍活跃的候选分支。禁止把 staging 上的其他功能带进 hotfix。

## 八、回退

代码回退优先创建新 commit：

```bash
git revert <bad-commit>
git push origin <reviewed-branch>
```

注意：migration、已执行资金动作、第三方回调/密钥、App Store/OTA、小程序已发布版本都不能只靠 `git revert` 回退，必须使用发布前保存的数据库备份、旧静态产物、服务器旧版本目录和平台侧版本记录。

远端分支重写只允许用于已经批准的一次性治理：先将旧 SHA 同时保存在远端 archive 分支、annotated tag 和需要继续开发的独立 lane（当前为 `delivery/staging`），确认恢复路径，再按 §四的精确 lease 命令执行。不得使用裸 `--force`。

## 九、状态用语

| 表述 | 必须具备的证据 |
|---|---|
| 本地完成 | clean diff + 本地测试 |
| 已推送 | 远端 commit SHA |
| CI 通过 | 对应 SHA 的 workflow conclusion |
| staging 已部署 | 测试服务器/静态产物运行 SHA + health |
| 真机通过 | 设备、版本、场景和结果记录 |
| main 已合并 | `origin/main` 包含候选 SHA |
| 生产已部署 | production approval + 线上 SHA/migration/业务探针 |
| 小程序已上线 | 微信后台已发布版本，而非仅上传体验版 |
