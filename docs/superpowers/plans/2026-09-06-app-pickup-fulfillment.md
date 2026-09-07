# App 自提履约实施清单

> 日期：2026-09-06；基线：`origin/main@4a8b70e75d2d212b528bd8d3e7484870c7c7023e`。
> 设计真相源：[App 自提设计](../specs/2026-09-06-app-pickup-fulfillment-design.md)。2026-09-07：本地实现与验证已完成；后台真实联调、原生真机及发布未完成。

## 1. 工作顺序与文件责任

| 步骤 | 文件 / 责任范围 | 产出和完成条件 |
|---|---|---|
| P1 契约 | `src/types/domain/Fulfillment.ts`（新增）、`Order.ts`、`Checkout.ts`、`GroupBuy.ts`、类型导出入口、`src/repos/OrderRepo.ts`、`GroupBuyRepo.ts` | fulfillment、点位及凭证类型；逐项对齐服务端方法/路径；自提不再强制地址；preview 转发完整 |
| P2 状态与组件 | `src/hooks/usePickupSelection.ts`（页面内状态，不新增持久化）；`src/components/checkout/FulfillmentSelector.tsx`（面板合并在同组件）；`src/utils/pickupOrder.ts` 及独立选择工具 | 点位选择、取货人、加载失败重试、输入校验、地址页/红包页往返保留、退出登录清理；不把敏感凭证放持久 store |
| P3 普通/VIP | `app/checkout.tsx`，必要时 `app/vip/gifts.tsx` | 两分支接入，VIP 真实企业集合，配送回归、报价失效防护、幂等键和原支付分流 |
| P4 团购 | `app/group-buy/checkout.tsx` | 独立 preview/create 带 fulfillment，保留分享与活动规则 |
| P5 支付恢复 | `app/checkout-pending.tsx`、`src/hooks/useConfirmPayment.ts`（仅必要时）、VIP 结算入口、订单 Repo/类型；`backend/src/modules/order/order.controller.ts`、`checkout.service.ts` | App VIP pending 最小入口及服务端恢复，通用 pending 跨端门禁，校验路由目标 sessionId，原会话/原渠道续付；修复 VIP 未安装微信误入通用 pending；未知结果不得重建单 |
| P6 凭证与导航 | `app/orders/pickup-pass/[id].tsx`（新增）、导航辅助工具、路由配置（如项目布局需显式声明） | 有效二维码/短码、刷新失效、账号隔离、前后台生命周期、导航兜底 |
| P7 订单入口 | `app/orders/index.tsx`、`app/orders/[id].tsx`、`src/components/cards/OrderCard.tsx`、`src/utils/pickupOrder.ts`、`app/payment-success.tsx` | 移除跳小程序提示，按状态展示凭证入口，多商家及 VIP 实物入口可达；验证现有通知跳转，必要时才改 `src/utils/notificationRoutes.ts` |
| P8 收口 | 相应测试、`docs/architecture/frontend.md`、`plan.md`、本清单；必要时 `docs/issues/tofix-safe.md` | 按实物证据记录本地验证、联调、真机、发布状态，独立审查通过 |

P1 → P2 → P3/P4 → P5/P6 → P7 → P8。共享 OrderRepo、checkout 页面及 store 的修改需串行整合，不允许并行覆盖。UI 编码前遵循 AGENTS.md 设计指导要求及 `docs/architecture/responsive-design.md`；本次文档编写不调用 UI 生成工具。新后端入口优先复用已存在的场景安全方法，不复制支付实现。

## 2. 可追踪任务

- [x] I01 固定实现基线，检查本工作分支与最新 main 差异，维护只含本需求的变更清单。
- [x] I02 对齐 App Repo/Types 与后端契约，覆盖旧 addressId 配送兼容。
- [x] I03 共用点位/取货人组件及选择状态，输入变化使旧预览失效。
- [x] I04 普通购物车、立即购买接入自提，包含多企业及赠品/排除商品场景。
- [x] I05 VIP 礼包接入自提，保持会员协议、价格、权益生效时点。
- [x] I06 团购接入自提，保持资格、分享和金额规则。
- [x] I07 App VIP pending 后端最小接口，认证/场景/业务类型隔离测试；小程序原接口回归。
- [x] I08 普通/团购/VIP 中断恢复及跨端不可直接续付处理；不覆盖原履约快照。
- [x] I09 凭证页、短码、刷新过期、图片失败、账号及订单切换隔离、导航。
- [x] I10 订单卡片/详情/成功页/消息入口闭环；核销后及时刷新状态与相关缓存。
- [x] I11 本地类型、必要测试、渲染/响应式检查；独立只读审查，处理 High/Critical 及说明 Medium。
- [ ] I12 测试环境的卖家与管理员实际备货/核销、跨端查看及退款异常联调。
- [ ] I13 Android 支付宝/微信、iOS 支付宝及微信禁用真机矩阵，记录版本和支付结果。
- [x] I14 同步文档完成状态；**发布尚未执行**，按单独发布授权及门禁执行。

## 3. 验收矩阵

| 编号 | 场景 | 预期证据 |
|---|---|---|
| A01 | 普通单商家，未配置任何收货地址 | 自提可预览和提交，运费 0；配送仍要求地址 |
| A02 | 多商家，不同门店 / 同一中心仓 | 按企业选择，每单单独核销；相同点不误称多个实际地点 |
| A03 | 某企业无点、点位停用、中心仓授权撤回 | 禁用或刷新选择，旧点位不绕过后端校验 |
| A04 | 快速配送↔自提切换，改手机号、点位、红包、商品剔除 | 旧请求晚到也不恢复旧报价；新价未就绪不能付款 |
| A05 | 地址接口失败、无地址、无定位 | 合法自提不依赖地址或定位权限；无坐标有地址兜底 |
| A06 | 普通商品含赠品、奖励商品、红包及积分 | 商品资格不变，按后端金额计费；不误收运费 |
| A07 | 团购自提，两支付渠道 | 价格/资格/分享规则正确，备货与核销闭环 |
| A08 | VIP 自提，两支付渠道 | 支付后权益开通，实物凭核销完成，禁止积分抵扣 |
| A09 | 普通/团购/VIP：SDK 取消、超时、已扣款回调延迟、App 重启 | 主动查单，原会话恢复，无重复扣款或虚假失败 |
| A10 | 修改选择时仍有旧 VIP 会话 | 先处理原会话；原履约快照不被新输入替换 |
| A11 | 当前用户有小程序创建的待支付会话 | App 不直接调起该场景参数，不自动跨端换单 |
| A12 | PREPARING → READY → PICKED_UP | 三状态入口正确；卖家/管理员核销后订单收货且凭证消失 |
| A13 | 二维码过期、图片失败、网络失败、退后台回来 | 撤旧码、刷新、可用短码兜底，不显示过期缓存 |
| A14 | A/B 用户切换、订单快速切换、越权凭证请求 | 服务端拒绝越权；客户端不残留前用户/前订单码 |
| A15 | 普通备货中取消，READY 受控取消；团购/VIP 限制 | 入口匹配既有规则，退款到账以真实退款状态为准 |
| A16 | 重复核销、取消与核销竞争 | 后端唯一合法终态，订单及收货副作用不重复 |
| A17 | 小程序已付自提订单在 App 查看，反向查看 | 同一已关联买家账户下状态和凭证共用，不产生新订单 |
| A18 | 配送三条原链路，含续付、物流、确认收货 | 行为不退化 |
| A19 | 大字体、窄屏、安全区、键盘、VoiceOver/TalkBack 标签 | 按响应式规范真机检查，二维码保持比例且不裁切 |
| A21 | 带目标 sessionId 打开待支付，最新会话 ID 不同；VIP 未安装微信 | 不续付错误会话；进入正确 VIP 恢复入口，不误报过期 |
| A20 | 备货通知及 VIP/多商家成功页 | 能找到正确自提订单并进入凭证页 |

每项记录：代码 SHA、环境/设备/App 版本、订单/会话引用（不存凭证）、执行结果、失败原因及证据位置。测试订单和实付测试按既有获批环境执行，不能用模拟成功代替真金结果。

## 4. 检查与发布边界

文档阶段仅检查引用、范围一致性与 Git diff，不运行无关业务测试。实现阶段按实际变更运行：

- App：`npx tsc --noEmit`；相关 Jest 行为测试及 `node --test scripts/__tests__/app-pickup-order-visibility.test.mjs`；最终按项目配置执行必要回归。旧可见性测试的“跳小程序”断言应改为 App 凭证行为，不能删除安全限制断言。
- 后端新增 VIP pending：在 backend 运行 `npx prisma validate`、`npm run build` 和对应 Checkout/Controller 测试；共享服务变动增加小程序、App 场景隔离及真实数据库必要回归。
- 凭证鉴权、核销和资金恢复不能只用文本匹配测试，应验证实际返回/状态与失败路径。
- App 渲染与真机按响应式规范检查；发布前读 `docs/operations/app-发布与OTA手册.md` 决定 OTA 或 Build。设计不要求新原生库，但不能提前保证一定可 OTA。
- 文档、本地代码、CI、测试部署、真机支付、main 合并、生产/OTA 分别打状态；不能把文档交付打成实现完成。

回退以 App 前一版本/更新为主；新增只读 VIP pending 保持兼容，可随对应后端提交回退。不删除现有 Pickup 数据、点位或迁移，不能通过关闭共享自提开关回退 App 而误伤小程序。

## 5. 验证状态（2026-09-07）

本地 App 类型检查、151 项 Jest、274 项脚本/兼容检查、Prisma validate、后端 build 及 248 项结算/自提回归通过。浏览器 fixture 覆盖普通/VIP/团购无地址自提、团购配送回归、VIP pending 发现与场景门禁、凭证刷新/失效及 320/390 布局。fixture 创建接口主动截断，无真实扣款或后台核销，不将 A07/A08/A09/A12/A15/A16/A18/A19 的原生或真实联调要求标为完成。完整记录见 [报告](../reports/2026-09-07-app-pickup-implementation-report.md)。
