# 微信小程序生产集成与可回退发布清单（2026-08-21）

> 本文是本次“小程序 + 自提 + 微信支付/提现 + 必要后台”进入生产的执行真相源。推荐 H5 双入口已在 2026-08-24 获得独立批准，必须作为 main-based 独立候选发布，不得回并旧 staging 或混入 App 自提 OTA。

## 1. 冻结基线

| 项目 | 冻结值 |
|---|---|
| production integration 基线 | `origin/main@aa8f5daa6c8990369ba1671f2f662af0e57384c5` |
| staging 参考快照 | `origin/staging@053f385eb5bf539902c33686b1f2cba9aef067c7` |
| 当前生产后端已部署版本 | `a0f4781069951ec3c89f9ac3c858f6c1e550c163` |
| 当前 staging 后端已部署版本 | `4ff68e6e`（`053f385e` 仅追加文档） |
| 集成分支 | `codex/miniapp-production-integration-20260821` |
| 集成目录 | `/private/tmp/aimaimai-miniapp-production-integration-20260821` |

`main` 与 `staging` 长期双向分叉，禁止直接 merge、禁止使用 `ours/theirs` 批量解冲突、禁止从原始脏工作区发布。集成始终以最新 `origin/main` 为底，按完整功能切片移植并要求生产旧 API 路由零删除。

## 2. 本次包含范围

- 微信小程序完整客户端与 production 构建门禁。
- 微信小程序登录、普通/VIP/团购 JSAPI 结算、主动查单、退款与退货运费支付。
- 微信提现、确认收款、通知收件箱与补偿任务。
- 商城普通送货上门与到店自提并列履约；平台/企业自提点、备货、凭证、核销和审计。
- 小程序码、推荐落地页、订阅消息和微信交易发货信息。
- 原小程序生产集成批次未修改 website；2026-08-24 起推荐 H5 双入口进入独立候选、独立测试和独立静态发布。
- 小程序按购物车行更新和稳定排序；App 旧购物车与结算接口必须继续兼容。
- 平台管理后台、卖家后台中支撑上述功能的最小页面与权限。
- App 不新增自提下单入口；只允许加入避免跨端订单误显示的最小只读兼容。

## 3. 明确排除独立配送系统

本次不得进入 `main`：

- `delivery-admin/**`
- `delivery-seller/**`
- `backend/prisma-delivery/**`
- `backend/src/delivery-prisma/**`
- `backend/src/modules/delivery/**`
- `app/delivery/**`
- `src/repos/delivery/**`、Delivery 专用 store/theme/utils
- Delivery 专用法律文本、官网页面、后台登录入口和 CI/CD 部署任务
- `DeliveryModule`、`DELIVERY_DATABASE_URL`、Delivery JWT/SMS/微信配置及配送库 migration

不得按关键字粗暴删除所有“delivery”代码。商城原有的 `ShipmentModule`、顺丰发货、物流轨迹、普通送货上门和售后物流属于现有 App/小程序共同履约能力，必须保留。共享文件必须逐行拆分独立配送系统 wiring，不能整文件照搬或整文件丢弃。

## 4. 分批门禁与回退点

### Batch 0：发布安全门禁（不含业务与 Schema）

目标：`main` push 不再自动发布；生产只能手动触发并经过 production approval；审批、测试和服务器部署锁定同一个不可变 `github.sha`；同批变更先部署后端，成功后才允许发布后台/H5。

门禁：workflow 静态测试、YAML 解析、E2E workflow 可调用性、无 Delivery 路径、主库+Redis readiness、当前生产代码不发生部署。静态站点发布前生成归档，发布后必须读取本次 SHA marker 和本次构建资源；服务器归档每站保留最近 20 份。

回退：`git revert <batch-0-sha>`。本批无数据库、服务器、App 或微信平台状态变化。

### Batch 1：后端兼容与 19 条主库 migration

目标：在保留全部 main 旧路由的前提下，加入小程序认证/支付/提现/自提/通知/购物车/收货副作用闭包。

生产前门禁：

1. 生产 PostgreSQL 完整备份并校验可恢复。
2. 用该备份恢复隔离副本，执行全部 migration。
3. 预检 `(userId, groupId)` 重复 Booking、多个默认地址、孤儿外键和 enum 使用情况。
4. 对比 migration checksum，禁止修改已经在 staging 执行过的 migration。
5. 后端全量测试、真实 PostgreSQL 并发测试、路由零删除测试、App 旧接口契约测试全部通过。
6. 手动生产发布输入的 `migration_rehearsal_sha` 必须与候选完整 SHA 完全相同，否则 workflow fail-closed。
7. 正式环境在执行 `prisma migrate deploy` 前自动运行 `pg_dump` custom-format 备份、`pg_restore --list` TOC 校验和二次读取 SHA-256 一致性校验；任何一步失败都禁止 migration。本机保留最近 10 份，正式发布前还必须确认 PITR/离机备份。
8. Batch 1 正式 migration 必须安排维护停写窗口，或已经具备经验证的 PITR；仅有在线 `pg_dump` 不足以保证整库恢复后的新订单/支付零丢失。
9. 后端候选必须在不可变版本目录完成 `npm ci`、Prisma generate/validate、build 和 Delivery 排除检查；PM2 停止后才备份/migrate，再从候选绝对路径启动。不得在 PM2 live checkout 中原地覆盖 `node_modules/dist`。
10. 部署脚本必须以服务器 `flock` 防并发，校验旧 PM2 唯一、online、fork-mode、cwd/entrypoint/args，持久化阶段 journal；新版本通过本机 readiness、Nginx readiness 和 App 旧 `/cart`、`/orders/checkout` 路由 smoke 后才 `pm2 save`。
11. 迁移回退采用 expand/fail-forward：新版本失败时恢复旧 PM2 的原始绝对 cwd/entrypoint，保留新表/新枚举；任何非向后兼容 migration 都不得进入本批。若克隆演练发现必须整库恢复，则上线前另行配置维护门禁/PITR，不得依靠运行中自动恢复覆盖新交易。

回退：

- 代码通过独立 revert commit 回到“能容忍新表/新枚举”的兼容版本，再由 workflow 重载；服务器自动恢复的也是部署开始时记录的精确旧 SHA。
- 新 enum 值和已执行的数据修复按 fail-forward 处理，不承诺自动删除。
- 若默认地址或 Booking 数据修复错误，停止写入并从发布前备份恢复；不得边运行边手工修正式库。
- 未得到生产备份、迁移演练和用户再次确认前，不得运行正式 `prisma migrate deploy`。

### Batch 2：平台后台与卖家后台

目标：发布自提点管理、备货、短码/扫码枪/摄像头核销、微信提现展示和权限控制。

门禁：新后台必须等待 Batch 1 后端健康；Node/ZXing 版本一致；构建、权限和浏览器 E2E 全绿。

回退：部署前保存当前静态产物目录的带 SHA 归档；失败时恢复旧归档。后台回退不得回滚已经进入履约中的订单数据。

### Batch 3：微信小程序

目标：从干净 `main` 构建 production 小程序，上传微信体验版并完成真机闭环；本批不发布 H5、不执行 App OTA。

门禁：production artifact 只能包含 `api.ai-maimai.com`/生产 WSS；不得包含测试域名或 Mock；真实设备完成普通/VIP/团购、配送/自提、退款、微信提现和核销闭环。

回退：

- 小程序先使用体验版；提交审核前不影响线上用户。
- 已发布版本异常时使用微信公众平台版本管理回退至上一正式版本；后端仍保持向后兼容。
- 本批不执行 App OTA/EAS Build；App 发布继续走独立批准流程。

## 5. 发布顺序

```text
production integration PR 全绿
  -> 生产配置只读预检
  -> 生产数据库备份与克隆迁移演练
  -> 手动批准 Batch 1 后端
  -> 现有 App / 支付 / 退款 / 购物车生产冒烟
  -> 手动批准 Batch 2 admin + seller
  -> 小程序 production 体验版与真机闭环
  -> 提交微信审核
```

任一步失败立即停止，不允许在失败批次上追加“再试一次”的生产提交。修复必须回到 integration 分支形成新的独立 commit，重新走该批全部门禁。

## 6. 每次提交/发布必须记录

- 基线 SHA、候选 SHA、受影响文件、明确排除文件。
- 测试命令、测试数量、CI run URL、部署服务器实际 SHA。
- 数据库备份标识、克隆演练结果、migration 前后核对结果。
- 生产配置只报告“存在/缺失与非敏感摘要”，禁止输出密钥和证书内容。
- 对应代码回滚 SHA、静态产物归档、数据库 fail-forward/恢复方案。
- 实际服务器、Nginx、PM2、数据库或第三方平台动作同步写入被 gitignore 的 `docs/operations/阿里云部署.md`。

## 7. GitHub 发布环境状态

2026-08-21 已完成不触碰服务器的可回退安全设置：

- `production` environment：只允许 `main`，required reviewer 为 `flyspaceden`（GitHub user id `96812865`），允许本人审核以避免单管理员仓库永久锁死。
- `staging` environment：只允许 `staging`，不设置 reviewer，保留测试环境自动发布能力。
- `main` branch protection 已启用：要求 PR、`e2e` + `checks`、对话解决，禁止删除/强推且管理员不绕过；单管理员仓库 required approval 为 0，避免自锁。
- `staging` branch protection 已启用：要求同两项检查与线性历史，禁止删除/强推且管理员不绕过；保留已通过检查的同 SHA fast-forward promotion。

环境设置回退（不会修改代码或服务器）：

```bash
gh api --method DELETE repos/flyspaceden/aimaimia/environments/production
gh api --method DELETE repos/flyspaceden/aimaimia/environments/staging
```

## 8. Batch 1 集成证据（Draft PR #1 已 push / 未合并 main / 未部署）

截至 2026-08-21，本地生产集成分支已完成后端兼容切片，但没有连接或修改生产数据库，也没有触发服务器部署：

- 18 条 staging-derived 主库 migration 与冻结的 `origin/staging@053f385e` 对应 SQL 对象哈希逐条一致；另有 1 条本次生产集成新增的自动退款副作用 outbox migration，合计 19 条；没有复制配送库 migration。
- Prisma schema validate / client generate、Nest production build 通过。
- staging 语义收口后的后端全量 Jest：260 suites / 3134 tests 通过；另 4 suites / 7 tests 按真实数据库配置跳过，并已在独立 PostgreSQL 18 临时库按 120 条 migration 全量部署后执行 5 suites / 9 tests 全部通过。
- `npm audit --omit=dev --audit-level=high` 为 0；图片处理升级后编译和上传/图片扫描冒烟通过。
- 固化 `origin/main@aa8f5daa` 的 627 条 HTTP 路由，并纳入 Batch 0 新增的 `/health/live`、`/health/ready`，合计 629 条生产集成基线路由；当前候选零删除，小程序登录、普通/VIP/团购结算、自提凭证、平台/卖家核销路由均以并列接口增加。
- Delivery 排除测试确认：无 `DeliveryModule`、配送数据库、配送门户、配送 JWT/SMS/微信配置；商城 `ShipmentModule`、顺丰和送货上门仍保留。
- 正式服务器候选在 build 和 migration 前运行主商城专用生产配置检查；该检查只要求小程序/微信支付与提现/自提/短信/顺丰，不要求独立配送系统配置。
- 自动退款达到 `REFUNDED` 时，数字资产扣回和非 V3 旧团长佣金冲回任务与退款状态同一 Serializable 事务进入 `RefundSideEffectOutbox`；租约/CAS/指数退避/cron 可在进程崩溃后恢复，migration 会幂等回填历史成功自动退款。
- 微信商家转账生产门禁严格校验 1005 佣金报酬场景的两项 `WECHAT_TRANSFER_SCENE_REPORT_INFOS_JSON`，避免部署成功但微信提现运行时 fail-closed。
- 微信支付/提现回调必须精确匹配正式路径；商户材料必须是可解析的 X.509 证书、RSA 私钥且公钥和证书序列号均匹配，裸公钥或虚构序列号不能通过门禁。

本节只证明本地代码闭包。Batch 1 仍不得发布，直到生产备份恢复到隔离 PostgreSQL 后完成全部 19 条 migration 演练、真实数据库并发套件、生产 PM2 只读预检、PITR/离机备份确认和用户再次批准。

本地补充证据：PostgreSQL 18 临时空库已完整执行当前 120 条主库 migration；售后退款、购物车数量、普通树、利润安全和卖家面单租约五组真实数据库并发测试 9/9。临时库使用明确测试库名，测试完成后已删除；正式库未连接、未迁移。

2026-08-22 生产只读/隔离演练证据（候选已 push，仍未合并 main、未部署、未迁移生产库）：

- SSH 核对生产后端仍运行 `a0f478106995...`，PM2 `aimaimai-api-prod` 为 `online`、`NODE_ENV=production`，现网源目录无已跟踪修改；Node.js `20.20.2` 满足候选 `>=20.9.0` 门禁。
- 生产库有 101 条成功 migration、0 条失败 migration；Booking 重复组为 0；多个活跃默认地址为 0；有活跃地址但无默认地址的用户为 0；活跃地址共 85 条。
- 已生成 custom-format 生产备份 `20260822T000600Z-a0f478106995-before-2879f7c7de98-rehearsal.dump`，并通过 `pg_restore --list` 与双重 SHA-256 校验；备份目录权限 700、文件权限 600。
- 已从该备份恢复 rehearsal 库 `aimaimai_rehearsal_2879f7c7_20260822`，且数据库所有者/恢复执行者使用正式应用数据库账号，以保证权限与正式 migration 一致。该库位于生产 PostgreSQL 同一集群，只隔离数据库名、不隔离主机资源；本次源库约 34 MB、操作前 `/www` 可用约 65 GB，未观察到 PM2 或公网商品接口异常。后续同集群演练必须显式确认并通过至少 5 GB / 源库 5 倍可用空间门禁，发布后按明确目标清理。
- 宝塔 PostgreSQL CLI 位于 `/www/server/pgsql/bin` 而不在默认 PATH；备份、只读预检与 rehearsal 脚本已增加受控二进制定位、数据库级只读查询、目标前缀/备份 checksum/空间门禁和负向行为测试。
- 隔离库已用候选锁文件安装 Prisma 工具，`prisma validate` 通过；迁移前准确识别 19 条待执行 migration，`migrate deploy` 全部成功，迁移后为 120 条完成、0 条失败、`migrate status` 无待执行项。
- 早期 flat dump 只保留为初步证据，不参与最终 attestation。最终候选已重新生成目录级原子 manifest 备份 `20260822T030000Z-a0f478106995-before-ca5e945f665a-final-rehearsal/database.dump`；manifest 绑定正式库 source identity、dump SHA-256、101 条 migration 基线和最新 migration。
- 同一最终备份分别恢复 `aimaimai_rehearsal_baseline_ca5e945f_20260822` 与 `aimaimai_rehearsal_target_ca5e945f_20260822`，两库 provenance 均精确匹配该备份。target 的 19 条新增 migration 全部成功，最终为 120 条完成、0 条失败。
- 最终严格核对通过：23 张表主键集合与去除预期新增列后的整行哈希一致；旧数据新增字段保持 `APP`/`DELIVERY`/null；10 个退款副作用任务按退款 ID、订单 ID、金额、类型、来源和状态逐条一致；target 120 条 checksum 等于最终候选，baseline 101 条为其合法子集。
- `ca5e945f` 中间候选的 Git HEAD/tracked-clean/migration tree、备份 manifest/SHA/source identity、双库 provenance 和数据守恒曾全部绑定，600 权限 attestation 已创建并验证。此后候选 HEAD 已变化，因此该 attestation **不能**授权当前最终部署；最终 SHA 确定后必须复用同一可信备份/双库 provenance 重新运行数据 verifier 并签发 exact-head attestation。生产部署缺少、不匹配或超过有效期时必须 fail-closed。
- 演练后反查正式库仍为 101 条完成、0 条失败 migration，生产 Git SHA 仍为 `a0f478106995...`，PM2 为 `online`，正式商品接口 HTTP 200；本轮没有迁移正式库、没有重启 PM2、没有部署候选代码。
- 生产备份、rehearsal 库和受限 rehearsal 目录暂时保留到最终基线核对与正式发布完成，便于复核；清理必须在发布完成后按明确目标单独执行。
- 生产 `.env` 已先做目录级原子备份，再补齐正式订阅状态/3 组模板、代码路径检测、微信提现 1005 场景、自提开关和独立随机自提密钥；实际 `dotenv` round-trip 与完整 production preflight 均通过。该动作没有重启 PM2，现网仍运行旧进程；发布时由不可变候选再次执行相同 preflight。
- 微信支付 APIv3 密钥虽然当前格式和既有支付链可用，但密码本已记录其历史暴露风险；正式放量前必须在微信商户平台完成轮换并同步生产配置。这是外部 provider 门禁，不能由代码测试替代。

## 9. Batch 2 后台证据（Draft PR #1 已 push / 未合并 main / 未部署）

- 平台后台新增跨企业自提点管理、平台统一自提点、到店核销台、订单自提筛选/详情/备货/核销、微信提现与微信交易发货状态；页面和菜单按独立权限控制。
- 卖家后台新增企业自提点管理、到店核销台、订单自提队列/详情/备货/核销；OWNER/MANAGER 管点位，OPERATOR 可核销但不可管理点位。
- 两端均支持 8 位短码、扫码枪/粘贴二维码内容和浏览器摄像头；商品/SKU 条码只用于可选货品核对，不能替代买家一次性取货凭证。
- 所有“切换配送管理后台/配送中心”入口已排除；本批没有 `delivery-admin`、`delivery-seller` 或独立 Delivery 配置。
- 扫码依赖固定为 `@zxing/browser@0.1.5` + `@zxing/library@0.21.3`，支持现有 Node 20 CI；两份 lock 只新增 4 个 ZXing 节点并把 `path-to-regexp 8.2.0→8.4.0`，没有顺带升级 Axios、React Router、Vite、Rollup 或 esbuild。
- Admin production CI 契约 12/12、build、修改文件定向 ESLint 通过；Seller production CI 契约 12/12、build、修改文件 `--max-warnings=0` 通过。Node 24 本地扩展源文件契约为 Admin 28/28、Seller 35/35。Seller 全量 lint 从“无配置无法启动”恢复为 0 error，仍有 28 个既有 warning 待独立治理。两端 `npm test` 已进入 production deploy job 并在 build 前执行。
- 卖家核销台将解析成功的凭证保存为不可变 `resolvedCredentialRef`，以 resolve session 丢弃过期响应；确认核销只提交产生当前预览的凭证，输入框后续变化不能造成“展示 A、核销 B”。
- 为控制现有后台回归面，本批没有同时解决 main 已存在的全部依赖漏洞；最小 lock 下 production audit 仍为 Admin 12 high、Seller 10 high。该债务必须通过独立依赖提交 + 全后台浏览器 E2E 治理，或由生产发布决策明确接受现有基线，不能在本批声称 audit 0。

Batch 2 只完成本地静态产物验证。必须等待 Batch 1 后端生产健康后，再登录 staging/production 角色账号完成浏览器摄像头权限、短码、错企业凭证、重复核销和无权限拒绝的真实 HTTP E2E。

## 10. Batch 3 小程序证据（Draft PR #1 已 push / 未合并 main / 未上传微信）

- `miniapp/` 从冻结的 staging 快照逐文件移植；正式构建只使用独立 Taro 页面，不修改 React Native `app/` 或根 `src/`。
- release-context 必须显式选择 channel：production 只允许 fetch/校验 `origin/main`；测试产物允许显式选择 `origin/staging` 或临时 `origin/staging-next`。脏工作区、错误目标分支或未显式指定 channel 均 fail-closed。
- 小程序 CI 在 main/staging/staging-next 的 miniapp 变更上执行 npm ci、typecheck、lint、test，并分别构建 staging/production artifact；CI artifact 不等于微信上传、体验版或正式发布。
- 本地 `npm run verify`：lint、TypeScript、55 个测试文件/303 个测试、staging+production 双构建和 72 页产物校验全部通过；总包 2.41 MiB，主包 1.262 MiB；已吸收 `origin/staging@acc0e08c` 删除无实际管理能力微信授权入口的最新小程序修复。
- production artifact 只包含 `https://api.ai-maimai.com/api/v1` 与 `wss://api.ai-maimai.com`，未发现 test-api、test-ws、localhost、Delivery portal/module/config。
- Swiper 从受影响的 11.1.15 最小覆盖为 12.1.2，Critical 审计项归零且小程序双构建通过。当前仍有 Vite 1 high + 12 moderate，来自 Taro 的 Vite/esbuild/webpack/uuid 构建工具链；不得用破坏性 `npm audit fix --force` 改变 Taro 主版本，需独立升级并做微信运行时回归。

Batch 3 仍未上传微信开发者工具。必须在后端生产兼容层上线并通过现有 App 冒烟后，才可从干净 main commit 生成 production 体验版并进行真机支付/自提/提现验收。

原生产集成批次曾延期推荐 H5 双入口。2026-08-24 用户已单独批准上线无登录 `InviteChoiceLanding`：新页面只记录扫码落地，用户显式选择小程序或 App；小程序 URL Link 与落地会话、推荐码绑定，App 入口先保存对应类型的推荐交接口令。推荐关系仍在目标客户端登录后按既有不可覆盖规则核验。App 推荐中心同步移除“H5 已登录/已绑定”旧漏斗语义，但该 App 源码变化必须与 App 自提只读兼容一并经过独立 OTA 验收；website 测试/发布不等于 App OTA。

该 H5 发布不修改 `backend/`。Website-only workflow 先读取生产 readiness：线上 release SHA 等于候选时直接通过；不等时只允许在完整 Git 历史中证明两者 `backend/` tree SHA 完全一致后继续。该例外只避免为纯网页变化无意义重启后端，不放宽 Admin/Seller 或任何 backend 变化的 exact-SHA 门禁。

App 源码 0 还有一个必须显式接受的跨端限制：同一账号在小程序创建到店自提订单后，当前生产 App 不识别 `fulfillmentMode=PICKUP`，可能继续显示普通 PAID 的待发货、物流或取消语义。它不会改变小程序订单的后端状态，但属于用户可见误导。生产发布前必须由用户明确接受，或另批批准只读兼容 OTA；本项目不得写成“App 完全不受影响”。

## 11. staging 已验收业务语义收口（2026-08-22）

用户明确要求保留此前在 staging 已完成的微信支付、微信提现、购买/付款/发货/收货/退款、分润和推荐测试价值，不接受生产集成重新形成另一套业务实现。为此完成以下收口：

- 逐路由比较确认候选曾遗漏 4 个微信小程序 `PUT` 兼容接口：修改地址、设默认地址、修改发票抬头、修改个人资料；已恢复并加入 route compatibility 守卫，App 原 `PATCH` 路由并列保留。
- 42 个核心商城/后台 Service 或 DTO 以 Git blob 固定为 `origin/staging@acc0e08c` 的精确内容，覆盖登录、结算、订单、微信支付适配器、提现、售后退款、利润、普通推荐、购物车、地址、预约/参团、商品/组合商品、推荐、客服、个人资料、数字资产、团长、团购返还、成长、溯源/关注、团购后台、商品后台、商城物流和任务奖励关闭策略。
- 允许不同的 21 个生产运行时表面由 Git diff 自动枚举并在 manifest 逐项解释：Payment service/controller/module/DTO 删除独立 Delivery 路由并增加自动退款 outbox；CompanyService 在 staging 行为上保留检测报告防御；App/Health/SF/Shipment 删除 Delivery 模块、数据库和回调；AuthController 保留 main 的 H5 邀请登录；Prisma schema 增加退款副作用 outbox；MiniProgramSubscriptionService 把历史 `develop` 安全归一为微信 `developer`，避免测试消息回退到 formal；另有 4 个纯格式/注释差异和 App 微信注销 DTO 兼容。
- `scripts/__tests__/miniapp-staging-semantic-parity.json` 固定来源 SHA、42 个 blob 和允许差异清单；CI 使用完整 Git 历史，逐项验证 manifest blob 确实来自该 staging commit，并自动计算所有非 Delivery/非测试运行时差异必须精确等于 allowlist。未来改 JSON、漏列文件或核心 Service 偏离都会直接失败，不能再靠人工记忆。
- 恢复 staging 已有的地址默认并发、预约/参团权限、客服资源归属、头像 URL/头像框、组合商品库存/返回结构、微信提现渠道查询、注销账号资金受益人围栏、团购返还、推荐来源、订单/支付/退款等测试；候选特有的可靠收货/退款 outbox 测试继续保留。

验证证据：后端 260 suites / 3134 tests；真实 PostgreSQL 120 migrations + 5 suites / 9 tests；App TypeScript + 30 suites / 127 tests；Admin 12/12 + build；Seller 12/12 + build；小程序 55 files / 303 tests + 双构建 + 72 页产物；根脚本 256/256。App/根 `src` 与独立 Delivery 路径改动为 0。

## 12. staging-next 隔离验收通道（2026-08-22）

- 旧 `origin/staging@acc0e08c` 已同时保存在受保护 archive branch、annotated tag 和 `delivery/staging`，且原 staging 指针保持不动。
- 当前生产候选通过临时 `staging-next` 部署到测试环境；该分支只承载 exact candidate SHA，不接受直接开发，也不代表已经合入 main 或发布生产。
- 测试环境的后端、Admin、Seller 与小程序 staging 构建均可选择 `staging-next`；GitHub 测试 environment 在验收窗口只允许该分支写入共享测试服务器，旧 staging 已 locked，旧 deployment workflow 已全局停用；新 `Deploy Release Train` 是唯一发布入口。Production 构建仍强制只来自 `main`。
- 固定微信目录仅在 `staging-next` Actions 成功、API `releaseSha` 与 Admin/Seller release marker 均精确等于候选 SHA 后，通过受控 `--rebind` 切换；依赖安装、release-context 和构建先在旁路 clone 完成，原目录按旧 SHA 保留，可恢复。
- 验收失败时删除或废弃 `staging-next` 即可，旧 staging 和 Delivery lane 不受影响；验收通过后仍需单独完成 main 合入、exact-SHA attestation、生产 approval 和微信正式发布。

## 13. 推荐 H5 无登录双入口正式发布（2026-08-24）

- 主线候选经 Draft PR #10 的 `checks` 与 E2E required checks 全绿后，以 rebase 合入 `main@98511babd53bac270d5ec73328afd71bd5acc319`。
- 本次只选择 `deploy_target=website`，GitHub Actions run `32754481192` 在 production environment 人工批准后成功；Backend、数据库、Admin、Seller、华海站点、App OTA 和微信小程序上传全部跳过。
- Website-only 门禁读取生产 readiness，确认线上后端仍为 `6ca27f5c664b6c6139bfef4cc6bf19bce5b97582`；再以完整 Git 历史证明线上 SHA 与新 main 的 `backend/` tree 均为 `43b1c0d830f6ce0c96a38d492a08c3ecb439d1b0`，因此未为纯网页变化重启后端。
- 静态部署前创建回滚快照 `/www/backup/releases/website/20260824T170559Z-98511babd53b.tar.gz`；部署后 marker `https://app.ai-maimai.com/release-sha.txt` 精确返回本次 main SHA，远端静态资源校验通过。
- 线上入口资源为 `InviteChoiceLanding-CF7XIZEh.js`，入口 bundle 不再引用 `InviteAuthLanding`；实际产物包含手机端“小程序 / App”按钮、桌面“按需生成小程序二维码 / App 推荐交接二维码”，且不包含手机号登录、验证码或旧 H5 Auth 端点字符串。
- `https://app.ai-maimai.com/`、`/invite/SABC1234` 与生产 readiness 均返回 HTTP 200；生产 API 组件状态为 database/redis up。`SABC1234` 为无效测试码，只验证错误路径，不代表普通/VIP 真实推荐绑定验收完成。
- 待完成：使用真实有效 VIP 推荐码（如仍保留普通分享码，再补普通码）在真实微信中验证 URL Link 打开已发布小程序页面、App 下载交接、客户端登录绑定和已有关系不可覆盖；通过后再关闭 `H5-INV07`。

## 14. 小程序跨端微信账号防重复修复（2026-08-25）

- 生产体验版发现同一自然人使用 App 微信与小程序微信时，小程序 `code2Session` 未返回 `unionId`，因此 App `openid` 与小程序 `openid` 无法自动归并，测试人员误点“作为新用户继续”后生成第二个 `User`。
- 修复后的后端仍先按小程序 `appId + openid` 和全部 `unionId` 候选查找既有用户：命中直接登录；未命中且有 `unionId` 时允许明确的微信新建；未命中且无 `unionId` 时只签发手机号绑定 ticket，旧客户端的新建端点也不能消费该 ticket。
- 新小程序页面以手机号验证为主操作，显示清晰输入框与“绑定手机号并登录”；只有后端明确返回 `allowWechatOnlyRegistration=true` 才显示低层级微信建号按钮。
- 账号数据修复必须单独备份、校验主账号与误建账号业务关系后执行；禁止物理删除用户或覆盖原 App 订单、余额、VIP、提现和推荐关系。
- 2026-08-25 已完成首例生产误建账号修复：主账号 `AIMM00000000000001` 保持 ACTIVE，误建账号 `AIMM00000000000217` 经只读全外键审计确认无订单、支付、提现、Reward、数字资产、VIP、推荐或售后记录后标记为 DELETED；小程序微信身份迁移到主账号并与 App 微信身份使用同一 `unionId`。误建账号的未使用新人红包撤回、未消费中奖记录过期、购物车/小程序场景清理、全部会话撤销，原账号既有业务数据不变。
- 数据修复前完整生产库备份为 `/root/aimaimai-account-repair-backups/aimaimai-before-duplicate-account-repair-20260825T1200CST.dump`，权限 `0600`，SHA-256 `20140d2f634dcca66aea3d745075905649b788a7b93853716c5f51c98d40c189`；`pg_restore --list` 校验通过。相同 SQL 先以强制 ROLLBACK 干跑，再以 fail-closed 前置/后置断言提交；修复后 API health 正常、主账号拥有 PHONE + App WECHAT + Mini Program WECHAT 三个身份、误建账号无身份和活跃会话。
