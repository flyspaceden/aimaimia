# 爱买买 Git 分支与版本收敛策略

> 本文是 Git 分支、候选版本、测试版本和生产版本的权威来源。若旧文档或历史命令与本文冲突，以本文为准。
>
> 核心目标：任何时刻都能回答“哪一个 SHA 是生产、哪一个 SHA 在测试、这次准备发布哪些改动、如何回退”。

## 一、唯一真相源

| 对象 | 定义 | 允许的用途 |
|---|---|---|
| `main` | 生产代码唯一真相源 | 只接收已审查、已在测试环境验证的候选；不直接开发 |
| `staging` | 测试环境当前候选的指针 | 只承载本轮明确批准的 release train；不作为长期开发主干 |
| `staging-next` | 分支收敛期间的临时测试指针 | 在不移动旧 `staging` 的前提下部署待验证候选；验收结束后必须收敛或删除，不得成为第二个长期主干 |
| `feature/*` / `codex/*` | 短期开发分支 | 必须从最新 `origin/main` 创建；一个分支只处理一个需求或一组不可拆分改动 |
| `hotfix/*` | 生产紧急修复 | 必须从最新 `origin/main` 创建；上线后立即同步到当前测试候选 |
| `archive/*` 或 tag | 历史保护点 | 在重写或替换分支指针前保存旧 SHA，禁止继续开发 |

`main` 是唯一长期代码基线。`staging` 是可部署的测试快照，不是另一个长期产品，也不能隐藏只存在于它上面的功能。尚未发布的功能必须保留在独立 feature 分支中。

GitHub 必须用 ruleset/branch protection 禁止删除和普通强推：`main` 要求 PR、Required Checks 和 review；`delivery/staging` 禁止删除和强推。当前旧 `staging` 已设为 locked、禁止删除/强推且管理员不绕过，GitHub `staging` environment 只允许临时 `staging-next`；旧 workflow `Deploy Sites & Backend`（ID `255149831`）已全局停用，避免历史 staging ref 绕过新门禁写共享测试服务器。`Digital Asset Backfill`（ID `297985401`）在本次验收窗口也已停用，避免维护任务造成源码锁或测试数据漂移。当前发布统一走新 `.github/workflows/deploy-release.yml`。代码中的规范不能替代 GitHub 服务端保护。

## 二、客户端边界

本仓库同时包含 App、小程序、后台和共享后端。路径相邻不代表必须一起发布。

| 改动范围 | 必须验证 | 禁止顺带做的事 |
|---|---|---|
| `miniapp/` | 小程序 lint/typecheck/tests、staging/production build、微信开发者工具和真机 | 不修改 `app/`、`src/`，除非需求明确包含 App |
| `app/`、根 `src/` | App TypeScript、Expo/EAS/OTA 对应门禁和真机 | 不以“小程序共用后端”为理由顺带发布 App |
| `backend/` | Prisma、Nest build、真实 PostgreSQL 测试、API/E2E；资金/状态/鉴权需并发与失败路径 | 不把独立 Delivery 数据库或门户夹带进商城生产候选 |
| `admin/`、`seller/` | 类型、lint、build、权限和 API 契约、浏览器测试 | 不把未批准的独立后台一起发布 |
| migration/资金/支付/退款/提现 | 备份、克隆库迁移演练、幂等/回滚方案、exact SHA attestation | 不把本地编译成功当成生产可发布 |

## 三、固定目录与工作目录

- 写代码：在从最新远端基线创建的短期干净 worktree 中完成。
- 微信开发者工具固定打开：`/Users/jamesheden/Desktop/农脉 - AI赋能农业电商平台-staging/miniapp`。
- 上述固定 staging 目录只用于编译和真机测试，不作为开发源；只能通过仓库同步脚本更新到已验证的 `origin/staging`。分支收敛期间可显式选择已部署并批准的 `origin/staging-next`，但必须记录目标分支和 exact SHA。
- 原始主项目目录存在脏改动或历史分叉时，不得作为发布源。
- 同步前后必须证明固定目录 `HEAD == origin/<选定测试分支>`、工作树干净；失败时停止，不允许用复制文件掩盖版本差异。

## 四、标准发布流程

### 1. 建立候选

1. `git fetch --prune origin`。
2. 记录 `origin/main`、`origin/staging` 和线上运行 SHA。
3. 从最新 `origin/main` 建立短期 worktree 和 feature/candidate 分支。
4. 只引入本需求文件；先做路径清单和 `main...candidate` diff 审查。
5. 一个逻辑改动一个 commit，数据库 migration 与相应代码同一可追踪发布批次。

### 2. 本地与 CI 门禁

1. 按受影响端执行类型、lint、单测、build、契约/E2E。
2. 资金、认证、状态转换、库存与 migration 执行安全/并发/失败回滚检查。
3. 创建 PR；Required Checks 全绿，且至少一次独立代码审查无未解决 Critical/High。
4. 测试后不得 squash、rebase 或补提交却沿用旧测试结果；SHA 变化就重新验证。

### 3. 测试环境

1. 只把本轮批准的候选以 fast-forward 方式提升到 `staging`，禁止直接在 `staging` 编码；若 `staging` 不是候选祖先，先停止并重建候选，禁止现场 merge 制造未审查的新 SHA。
2. 记录候选 SHA、staging 部署 SHA、Git tree、migration 数量、构建产物 digest 和 CI run；正常情况下 candidate SHA 必须等于 staging SHA。
3. 同步固定 staging 目录，在微信开发者工具、浏览器和真实设备完成对应验收。
4. 测试发现问题时回候选分支修复，再重新经过 PR、CI 和 staging；不能只在固定目录热改。

### 4. 进入生产

1. 确认 `main...staging` 只包含本轮发布清单；发现 Delivery、App 或其他未批准路径立即停止。
2. 生产 PR 保留已测试提交历史；不得用“整体 merge staging”代替路径与语义审查。若 GitHub 生成新的 main merge SHA，必须证明其 tree 与已测试 staging tree 相同；base 变化或 tree 不同就退回 staging 重测。
3. 合入 `main` 不等于生产已部署。无论 main 是否保留候选 SHA，最终 `origin/main` exact SHA 都必须重新运行 production CI/E2E/build，并重新签发该 SHA 的 migration attestation；通过后才能手动触发 production approval。
4. 按后端 → 管理/卖家后台 → H5/小程序体验版的依赖顺序验证；每阶段保留回滚点。
5. 线上验证运行 SHA、health、关键业务探针和数据库 migration，再记录为完成。

### 5. 发布后收敛

- 若 `staging` 本轮所有内容都已进入 `main`，立即把 `main` 同步回 `staging`，最终要求二者业务 diff 为 0。
- 若下一轮候选已经开始，`staging` 可以暂时等于 `main + 下一轮明确 release train`；未发布功能仍必须有独立 feature 分支，不能只剩在 staging。
- `main` 出现 hotfix 后，必须在同一发布窗口同步到 staging/当前 release 分支并重跑门禁。
- 禁止长期保持双向分叉；每次发布后保存 `main..staging` 与 `staging..main` 审计结果。

## 五、当前旧 staging 的一次性收敛（2026-08-22）

当前 `origin/staging@acc0e08c` 与 `origin/main@aa8f5daa` 已长期双向分叉，并且 staging 包含尚未批准进入生产的独立 Delivery 系统。因此：

在候选 `7627a54f` 的只读审计快照中，staging 与候选左右独有 commit object 为 `647 / 389`，共同 merge-base 仍是 `15f05427`，模拟 merge 有 118 处冲突；旧 staging 至少包含 343 个直接 Delivery 文件及多处共享 wiring。该规模已经不能用普通“同步一下”处理。

1. **现在不能**整体 merge staging → main。
2. **现在不能**直接用 main 覆盖 staging，否则会丢失 Delivery 和其他未发布工作。
3. 先完成当前“小程序选择性进入生产”PR，只把审查清单内的商城后端、后台和小程序提交带入 main。
4. 在任何 staging 指针变更前，把 `acc0e08c` 同时保存为远端 `archive/staging-pre-main-20260822`、annotated tag 和受保护的 `delivery/staging`；三个引用都必须复验为同一 SHA。该三重保全已在 2026-08-22 完成，`origin/staging` 本身仍保持 `acc0e08c` 未移动。
5. 从新的 main 创建 `codex/staging-v2-from-main`。`delivery/staging` 先保留全部旧 Delivery 工作；后续再从新 main 建立干净 Delivery reintegration 分支，按直接文件和共享 wiring 清单逐批移植、解决语义冲突并验证。
6. 当前获批方案是不替换 `origin/staging`：先把 GitHub `staging` environment 的允许分支收口为仅 `staging-next`，冻结旧 staging 对共享测试环境的部署权；再建立临时 `staging-next` 指向生产候选 exact SHA并部署，创建后立即启用禁止删除/强推和 Required Checks 的分支保护。只有测试 API/两个后台 release marker 都等于该 SHA 后，才将固定微信目录受控重绑到 `staging-next` 做差异回归。旧 `staging@acc0e08c`、三重保护引用和 Delivery lane 全部保留。
7. 只有 `staging-next` 完整验收、候选进入 `main` 且用户再次单独批准后，才讨论将通用 `staging` 收敛到新 `main`。Delivery 不重新夹入通用 staging；它在受保护的 `delivery/staging` 独立保留并单独回归。
8. 若未来确需替换 `origin/staging`，必须另行批准并使用明确旧 SHA 的 `--force-with-lease`；当前 `staging-next` 测试不修改 `origin/staging`。固定微信目录通过 `scripts/sync-staging-test-checkout.mjs --rebind` 的显式旧/新 SHA、目标分支、确认短语和旁路克隆流程切换，普通同步仍只允许 fast-forward。

这是一项独立的分支治理任务，不与生产 PR 合并动作绑在一起，也不在本次审查中自动执行。

## 六、Hotfix

1. 从最新 `origin/main` 创建 `hotfix/*`。
2. 只修生产故障，完成最小充分测试和 PR。
3. 手动发布 exact SHA，验证线上后记录回滚点。
4. 立即把同一补丁同步到 `staging` 和所有仍活跃的 release/feature 分支；有冲突必须人工解决并复测。
5. 禁止为“省事”把整个 staging 合入 hotfix。

## 七、禁止事项

- 禁止直接在 `main`、`staging` 或固定微信测试目录写业务代码。
- 禁止 `git add -A` 后不检查 staged files 就提交。
- 禁止用脏工作区、旧 checkout 或未拉取远端的目录发布。
- 禁止把 CI 绿灯、PR 合并、服务器 health 200、微信体验版上传中的任意一个单独称为“上线完成”。
- 禁止无 archive、无用户批准重写远端分支。
- 禁止在已验证 SHA 上补提交后复用旧 attestation、旧 migration 演练或旧真机结论。

## 八、每次交付必须报告

- 基线 SHA、候选 SHA、目标分支和 PR。
- 精确文件/路径范围，以及明确排除的 App/Delivery/其他系统。
- 本地测试、CI、测试部署、数据库演练、真机、生产部署分别处于什么状态。
- migration/资金/第三方密钥等不可仅靠代码 revert 回退的事项。
- 回滚 commit、数据库恢复点、静态产物和服务器旧版本目录。
