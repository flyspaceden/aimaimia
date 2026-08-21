# 微信小程序生产集成与可回退发布清单（2026-08-21）

> 本文是本次“小程序 + 自提 + 微信支付/提现 + 必要后台”进入生产的执行真相源。推荐 H5 双入口已移出当前发布批次，任何代码、数据库或外部平台动作都必须按批次记录证据。

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
- 推荐 H5 双入口仅保留为后续方案，本批不修改或发布 website。
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
- `main` branch protection 尚未开启；必须等 production integration PR 首次跑出稳定 check context 后再启用，避免 required check 名称错误锁死 main。

环境设置回退（不会修改代码或服务器）：

```bash
gh api --method DELETE repos/flyspaceden/aimaimia/environments/production
gh api --method DELETE repos/flyspaceden/aimaimia/environments/staging
```

## 8. Batch 1 本地集成证据（未 push / 未部署）

截至 2026-08-21，本地生产集成分支已完成后端兼容切片，但没有连接或修改生产数据库，也没有触发服务器部署：

- 18 条 staging-derived 主库 migration 与冻结的 `origin/staging@053f385e` 对应 SQL 对象哈希逐条一致；另有 1 条本次生产集成新增的自动退款副作用 outbox migration，合计 19 条；没有复制配送库 migration。
- Prisma schema validate / client generate、Nest production build 通过。
- 后端全量 Jest：239 suites / 2937 tests 通过；2 suites / 5 tests 仅因需要显式真实 PostgreSQL 并发环境而跳过。
- `npm audit --omit=dev --audit-level=high` 为 0；图片处理升级后编译和上传/图片扫描冒烟通过。
- 固化 `origin/main@aa8f5daa` 的 627 条 HTTP 路由，并纳入 Batch 0 新增的 `/health/live`、`/health/ready`，合计 629 条生产集成基线路由；当前候选零删除，小程序登录、普通/VIP/团购结算、自提凭证、平台/卖家核销路由均以并列接口增加。
- Delivery 排除测试确认：无 `DeliveryModule`、配送数据库、配送门户、配送 JWT/SMS/微信配置；商城 `ShipmentModule`、顺丰和送货上门仍保留。
- 正式服务器候选在 build 和 migration 前运行主商城专用生产配置检查；该检查只要求小程序/微信支付与提现/自提/短信/顺丰，不要求独立配送系统配置。
- 自动退款达到 `REFUNDED` 时，数字资产扣回和非 V3 旧团长佣金冲回任务与退款状态同一 Serializable 事务进入 `RefundSideEffectOutbox`；租约/CAS/指数退避/cron 可在进程崩溃后恢复，migration 会幂等回填历史成功自动退款。
- 微信商家转账生产门禁严格校验 1005 佣金报酬场景的两项 `WECHAT_TRANSFER_SCENE_REPORT_INFOS_JSON`，避免部署成功但微信提现运行时 fail-closed。
- 微信支付/提现回调必须精确匹配正式路径；商户材料必须是可解析的 X.509 证书、RSA 私钥且公钥和证书序列号均匹配，裸公钥或虚构序列号不能通过门禁。

本节只证明本地代码闭包。Batch 1 仍不得发布，直到生产备份恢复到隔离 PostgreSQL 后完成全部 19 条 migration 演练、真实数据库并发套件、生产 PM2 只读预检、PITR/离机备份确认和用户再次批准。

## 9. Batch 2 本地后台证据（未 push / 未部署）

- 平台后台新增跨企业自提点管理、平台统一自提点、到店核销台、订单自提筛选/详情/备货/核销、微信提现与微信交易发货状态；页面和菜单按独立权限控制。
- 卖家后台新增企业自提点管理、到店核销台、订单自提队列/详情/备货/核销；OWNER/MANAGER 管点位，OPERATOR 可核销但不可管理点位。
- 两端均支持 8 位短码、扫码枪/粘贴二维码内容和浏览器摄像头；商品/SKU 条码只用于可选货品核对，不能替代买家一次性取货凭证。
- 所有“切换配送管理后台/配送中心”入口已排除；本批没有 `delivery-admin`、`delivery-seller` 或独立 Delivery 配置。
- 扫码依赖固定为 `@zxing/browser@0.1.5` + `@zxing/library@0.21.3`，支持现有 Node 20 CI；两份 lock 只新增 4 个 ZXing 节点并把 `path-to-regexp 8.2.0→8.4.0`，没有顺带升级 Axios、React Router、Vite、Rollup 或 esbuild。
- Admin production CI 契约 12/12、build、修改文件定向 ESLint 通过；Seller production CI 契约 12/12、build、修改文件 `--max-warnings=0` 通过。Node 24 本地扩展源文件契约为 Admin 28/28、Seller 35/35。Seller 全量 lint 从“无配置无法启动”恢复为 0 error，仍有 28 个既有 warning 待独立治理。两端 `npm test` 已进入 production deploy job 并在 build 前执行。
- 卖家核销台将解析成功的凭证保存为不可变 `resolvedCredentialRef`，以 resolve session 丢弃过期响应；确认核销只提交产生当前预览的凭证，输入框后续变化不能造成“展示 A、核销 B”。
- 为控制现有后台回归面，本批没有同时解决 main 已存在的全部依赖漏洞；最小 lock 下 production audit 仍为 Admin 12 high、Seller 10 high。该债务必须通过独立依赖提交 + 全后台浏览器 E2E 治理，或由生产发布决策明确接受现有基线，不能在本批声称 audit 0。

Batch 2 只完成本地静态产物验证。必须等待 Batch 1 后端生产健康后，再登录 staging/production 角色账号完成浏览器摄像头权限、短码、错企业凭证、重复核销和无权限拒绝的真实 HTTP E2E。

## 10. Batch 3 小程序本地证据（未 push / 未上传微信）

- `miniapp/` 从冻结的 staging 快照逐文件移植；正式构建只使用独立 Taro 页面，不修改 React Native `app/` 或根 `src/`。
- release-context 必须显式选择 channel：production fetch/校验 `origin/main`，staging fetch/校验 `origin/staging`；脏工作区、旧目标分支或未显式指定 channel 均 fail-closed。
- 小程序 CI 在 main/staging 的 miniapp 变更上执行 npm ci、typecheck、lint、test，并分别构建 staging/production artifact；CI artifact 不等于微信上传、体验版或正式发布。
- 本地 `npm run verify`：lint、TypeScript、55 个测试文件/302 个测试、staging+production 双构建和 72 页产物校验全部通过；总包 2.41 MiB，主包 1.262 MiB。
- production artifact 只包含 `https://api.ai-maimai.com/api/v1` 与 `wss://api.ai-maimai.com`，未发现 test-api、test-ws、localhost、Delivery portal/module/config。
- Swiper 从受影响的 11.1.15 最小覆盖为 12.1.2，Critical 审计项归零且小程序双构建通过。当前仍有 Vite 1 high + 12 moderate，来自 Taro 的 Vite/esbuild/webpack/uuid 构建工具链；不得用破坏性 `npm audit fix --force` 改变 Taro 主版本，需独立升级并做微信运行时回归。

Batch 3 仍未上传微信开发者工具。必须在后端生产兼容层上线并通过现有 App 冒烟后，才可从干净 main commit 生成 production 体验版并进行真机支付/自提/提现验收。

推荐 H5 双入口本批明确延期。原因是现有 App 仍展示“H5 扫码打开 / 已登录 / 已绑定”漏斗，而不登录的双入口页面无法在 App 源码 0 的约束下保持后两项统计语义。生产继续保留当前稳定的手机号/微信 H5 登录绑定页；新 InviteChoice 不进入本批 commit 或静态发布。后续如需上线，必须单独批准 App 统计/自提只读兼容或补全跨客户端 landingSession 归因。

App 源码 0 还有一个必须显式接受的跨端限制：同一账号在小程序创建到店自提订单后，当前生产 App 不识别 `fulfillmentMode=PICKUP`，可能继续显示普通 PAID 的待发货、物流或取消语义。它不会改变小程序订单的后端状态，但属于用户可见误导。生产发布前必须由用户明确接受，或另批批准只读兼容 OTA；本项目不得写成“App 完全不受影响”。
