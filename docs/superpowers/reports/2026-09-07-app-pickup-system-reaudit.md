# App 自提系统复审与候选就绪记录

> 日期：2026-09-07；复审起点：`47b7bce9c18069c0045e8184b2c6e3b35550b8c3`。
> main 基线仍为 `4a8b70e75d2d212b528bd8d3e7484870c7c7023e`；分支 `codex/app-pickup-docs-20260906`。
> 结论：本轮发现的 High/Medium 已修复并独立复核，本地门禁通过，可进入候选 CI 和测试部署准备。尚未推送、部署、OTA、原生真机或真实支付验收。

## 1. 本次范围

复审从 App 自提扩展到其共用的支付建单、VIP 激活、卖家权限、核销/取消、库存退款及收货记账。除检查本次 App 改动外，也检查了 main 已有的共享后端实现。没有改数据表、migration、价格/分润比例、管理员赠 VIP 或累计消费升级的业务规则。

## 2. 确认并修复的问题

| 问题 | 级别 | 根因与修复 |
|---|---|---|
| 团购未知请求阻塞新账号 | P2 | 未知请求签名没有 owner；改为 owner 隔离，换账号重建 key/清理签名，同账号继续保持防重 |
| 普通结算弹窗显示前账号摘要 | P2 | 弹窗状态只存订单；增加 owner，认证变化清理，渲染和跳转双重检查 |
| 核销后仍返回刚生成的旧凭证 | P2 | QR 生成期间状态可能变化；生成后再次查询本人履约与订单 READY/PAID/PICKUP。网络发送后的状态变化仍由核销幂等和 App 刷新处理 |
| 卖家降权后旧 JWT 保留权限 | P2 | Strategy 返回 token.role；改为返回实时 staff.role，保留会话、禁用和企业归属校验 |
| 已付款 VIP 缺失激活记录或卡在 PENDING | P1 | 支付提交与激活之间存在进程中断窗口，重放缺 metadata、cron 不扫描缺失/PENDING；补齐重放上下文和补偿发现 |

VIP 补偿同步收口：两个 Serializable 激活事务均核验 ACTIVE 且未注销的买家及其已付订单/会话、排除取消和退款；包含合法 DELIVERED 状态；失败记录用 CAS 排除 SUCCESS，避免并发输家覆盖赢家；队列在数据库过滤永久无权记录；缺失记录按 `(createdAt,id)` 每 tick 最多 10 条向前扫描，坏元数据也推进。游标在内存中，进程重启会从最早候选重新扫描；已激活订单由数据库条件排除，重复调用仍受唯一约束和激活事务保护。

子 agent 的发现与补丁均由主 agent 查阅具体代码、测试和差异后整合，并经另一 agent 交叉复核。限定本轮范围的最终复核无剩余 High/Medium；不能据此保证整个生产系统绝无问题。

## 3. 验证证据

| 检查 | 结果 |
|---|---|
| App TypeScript | 通过 |
| App Jest | 36 suites / 155 tests 通过 |
| 脚本及兼容门禁 | 274 tests 通过 |
| Prisma validate / 后端 build | 通过 |
| 后端常规全量回归 | 264 suites / 3161 tests 通过；21 个数据库条件测试默认跳过，已另行开启运行；detectOpenHandles=0 |
| 自提专用 PostgreSQL 测试 | 15/15，通过真实 PostgreSQL 18、120 条迁移后的隔离库 |
| 原有数据库并发回归 | 普通树/利润配置 advisory lock/购物车/售后共 8/8，卖家面单另 1/1；均通过 |
| Web 导出与页面回归 | 最新独立依赖构建导出通过；普通/VIP/团购/待支付/凭证在 320/390 宽度浏览器 fixture 中无 pageerror |
| Git diff / workflow YAML | 空白检查与 YAML 解析通过 |

数据库测试独立开关包含安全校验测试，因此上述运行次数不能简单相加当作不同的业务用例总数。常规全量默认跳过的数据库业务用例均已在专用库单独运行，未将 skip 当 pass。

真实 PostgreSQL 用例验证：

1. 五次并发核销只有一次收货历史、六条唯一持久化收货任务。
2. 核销与平台取消竞争，订单/自提状态一致；不会同时收货与创建退款任务。
3. 备货完成与买家取消竞争，取消后不保留可用凭证。
4. 跨企业核销、跨买家取码均拒绝，不改变订单。
5. 实际 DigitalAssetService 冻结、核销入账、重复 worker、退款重复冲回后账户与流水不重复。
6. 重复平台取消只创建一个退款任务、只恢复一次库存。
7. ALIPAY/WECHAT_PAY 已付会话在首次激活配置读取失败后，无需再次回调即可恢复 VIP；回调重放不重复授权益。
8. PENDING 并发激活、DELIVERED PENDING 补偿、取消/退款拒绝、十条坏 metadata 后后续合法订单恢复。
9. QR 生成等待期间执行真实核销，旧取码请求被末次状态复核拒绝。
10. 已注销或禁用用户不被补偿重新授予 VIP/资产权益，已付款订单仍保留 PAID 履约事实。

测试使用人工订单及故障数据，不是生产数据库审计。支付供应商、承运商及与断言无关的部分业务服务使用测试替身；实际使用 PostgreSQL、Prisma、PickupService、OrderService 取消事务、收货 outbox worker、DigitalAssetService、BonusService 和 VIP 补偿服务。没有真实扣款、退款或物流请求，也没有修改线上数据。

## 4. CI 与版本管理

新增 `pickup-system.postgres.spec.ts`，通过显式 `PICKUP_POSTGRES_TEST_URL` 且本机 `pickup_*_test` 库名才运行；不会读取默认生产 DATABASE_URL，也不执行 reset/drop。E2E workflow 在 PostgreSQL 服务中创建独立 `pickup_system_test`、执行真实迁移，再运行该测试，不污染 UI E2E 的 seed 数据库。

受控差异清单登记六个共享后端文件的精确 blob 与 main 来源；保留原 staging 冻结文件校验，不使用整目录放行。修改发生在独立 worktree，原始 staging 工作区未改动。

本机测试证据：`/tmp/app-pickup-audit-*.log`、`/tmp/app-pickup-audit-backend-tests.json`、`/tmp/app-pickup-audit-app-tests.json`、`/tmp/app-pickup-qa/*-audit.*`。测试数据库为单独启动的本机 PostgreSQL 实例，不涉及既有实例。

## 5. 后续四步的就绪判断

- 可以推送当前候选分支运行 CI；本地通过不代替 GitHub exact-SHA 结果。
- CI 通过后部署测试后端，必须包含 App VIP pending、VIP 补偿、凭证末次校验和实时卖家角色读取；核对自提开关、secret、点位及中心仓授权。
- 测试 App 先检查现有安装包 runtime/原生支付能力，再决定 OTA 或新包。当前未执行 EAS。
- 真机覆盖普通/团购/VIP 自提、Android 支付宝/微信、iOS 支付宝、支付中断恢复、后台备货与扫码核销、订单状态、后台账本及配送回归。新断言纳入现场验收，不能用 fixture 替代。

本次未审计生产库是否已经存在历史 VIP 缺失激活或坏 metadata。测试部署及生产发布前需只读核对已付 VIP 无购买记录、长时间 PENDING/FAILED、自提状态与订单终态冲突、运费及退款任务等异常数；有历史坏数据时先明确处理方案，不能把新代码补偿的可恢复范围扩大为所有历史数据都已修好。
