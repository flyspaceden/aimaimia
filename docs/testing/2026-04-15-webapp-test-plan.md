# 爱买买 Web 端自动化测试计划

**版本**：v0.1
**创建日期**：2026-04-15
**作者**：heyiqin13
**状态**：已确认，待实施

---

## 1. 目标与范围

- **范围**：管理后台（admin, :5173）+ 卖家后台（seller, :5174）
- **不在范围**：买家 App（React Native，需 Detox/Maestro 另立计划）、真实支付 / SMS / 微信沙箱
- **目标**：v1.0 上线前提供回归保护网，覆盖核心业务链路 + 关键权限边界 + 防止 UI 样式回归

## 2. 测试分层

| 层级 | 覆盖范围 | 频率 | 失败影响 |
|------|---------|------|---------|
| L0 Smoke | 登录 + 首页能加载 + 无 console error | 每次 PR | 阻塞合并 |
| L1 Critical Path | 7 条核心业务链路（见 §4） | 每次 PR | 阻塞合并 |
| L2 Regression | 权限矩阵 + 表单边界 + 视觉 diff | 每日定时 | 告警，不阻塞 |
| L3 Cross-System | Socket.IO 客服双端、跨商户隔离 | 每次发布前 | 阻塞发布 |

## 3. 测试基础设施

- **运行环境**：本地 dev（`@playwright/test` + TypeScript），CI 在 GitHub Actions 跑 headless
- **技术栈**：`@playwright/test`（自带 runner、HTML 报告、trace viewer、并发、retry），与 backend 的 Jest/TS 栈一致
- **工作区**：独立 `tests/` 目录 + `tests/package.json`，不污染 backend / admin / seller / app（买家 App）
- **服务器编排**：`playwright.config.ts` 的 `webServer` 字段同时拉起 backend(3000) + admin(5173) + seller(5174)
- **测试数据**：每次跑前 `prisma migrate reset --force` + seed，保证幂等（dev 库，无真实数据）
- **验证码绕过**：后端 `captcha.service.ts` 的 `verify()` 方法内加双重守卫 —— `NODE_ENV === 'test'` 且输入 == `CAPTCHA_BYPASS_TOKEN`；生产 `NODE_ENV !== 'test'` 时该分支永不进入
- **认证态复用**：登录一次后保存 `storageState.json`，后续测试直接 reuse，不重复登录
- **报告**：Playwright HTML 报告 + 失败截图 + trace + network 存到 `tests/test-results/`

## 4. L1 Critical Path（7 条）

| ID | 链路 | 端 | 关键断言 |
|----|------|----|----|
| C01 | 商户入驻审核 | admin | 待审 → 通过 → 商户登录 seller 成功 |
| C02 | 商品上架 | seller | 创建 SKU → 自动定价 → 上架 → admin 商品池可见 |
| C03 | 订单流转 | seller + admin | 发货 → 物流单号下发 → 状态同步 |
| C04 | 退换货 | admin | 创建售后 → 审核通过 → 退款流转 |
| C05 | 红包活动 | admin | 创建 → 发放 → 用户结算抵扣（需 mock 买家） |
| C06 | VIP 多档位配置 | admin | 新建档位 → 配比校验 → 启用 |
| C07 | 智能客服接管 | admin | 新会话进入 → 客服接管 → 回复 → 关单 |

## 5. L2 Regression（每日跑）

- **权限矩阵**：4 角色（OWNER / MANAGER / OPERATOR / 超管）× 主要菜单 → 隐藏 / 可点 / API 拒绝三态正确
- **表单边界**：金额 < 0、超长字符串（>500 字）、特殊字符、SQL 注入字符、必填漏填
- **视觉回归**：管理端 12 主页面 + 卖家端 8 主页面 baseline 截图，diff 阈值 > 1% 告警
- **Console 健康度**：累计 error / warning 数量趋势

## 6. L3 Cross-System（发布前）

- **客服 Socket.IO**：两个 browser context（买家页 + 客服页），验证消息 < 500ms 双向到达
- **跨商户隔离**：商户 A 登录 seller，强行访问 B 商户订单/商品 URL → 期望 403 或空数据
- **状态机一致性**：seller 改订单状态后 admin 立即可见

## 7. 进度规划

| Phase | 工作量 | 内容 | 产出物 |
|-------|--------|------|--------|
| P1 | 半天 | 基建：playwright.config.ts + 验证码 bypass + DB reset + storageState 复用 + demo smoke | `tests/playwright.config.ts` + `tests/e2e/smoke/admin-login.spec.ts` 跑通 |
| P2 | 2 天 | L0+L1：登录 smoke + 7 条 critical path | `tests/e2e/critical/*.spec.ts` |
| P3 | 1 天 | L2：权限矩阵 + 视觉 baseline | `tests/e2e/regression/*.spec.ts` + baseline 截图 |
| P4 | 1 天 | L3：Socket.IO + 跨商户 | `tests/e2e/cross-system/*.spec.ts` |
| P5 | 半天 | CI 集成 | `.github/workflows/e2e.yml` |

## 8. 进入与退出条件

- **进入条件**：后端 dev 启动成功、Prisma seed 完成、admin/seller dev server 监听、验证码 bypass 配置就绪
- **L1 退出**：7 条 critical path 全绿
- **发布退出**：L0 + L1 + L3 全绿，L2 视觉 diff 已人工 review

## 9. 风险与缓解

| 风险 | 缓解措施 |
|------|---------|
| 验证码 bypass 误进生产 | 双闸：环境变量 + `NODE_ENV` 检查；CI 校验 production build 不含 bypass 分支 |
| 第三方占位（支付 / 物流）回调不可控 | 用 backend mock service 模拟回调，由测试脚本主动触发 |
| seed 数据漂移 | 每次跑前强制 reset，禁止依赖测试残留状态 |
| 测试不稳定（flaky） | 强制 `wait_for_load_state('networkidle')`，禁用固定 `sleep > 1s`，使用显式 `wait_for_selector` |
| React Native 客服买家端无法 E2E | 用 HTTP + WebSocket 客户端脚本模拟买家行为，不走 RN App |

## 10. 后续扩展（v0.2+）

- 买家 App Detox/Maestro 测试计划
- 负载测试（k6 / Artillery）
- 安全扫描（OWASP ZAP 自动化）
- 可访问性（axe-core 集成）
