# 微信小程序自提履约实施清单

> 设计权威来源：[2026-08-14-miniapp-pickup-fulfillment-design.md](../specs/2026-08-14-miniapp-pickup-fulfillment-design.md)

- [x] A1：Prisma `FulfillmentMode`、`PickupFulfillmentStatus`、`PickupPoint`、`PickupFulfillment` 和历史数据默认回填。
- [x] A2：自提点卖家 CRUD、管理端只读/停用、权限和审计。
- [x] A3：普通商品、团购、VIP 的判别式履约 DTO、点位可用性和预结算校验。
- [x] B1：普通 checkout、团购 checkout、VIP checkout 在支付成功后从冻结快照创建自提履约。
- [x] B2：短码/二维码签发、串行核销、幂等结果、取消/退款作废与事件审计。
- [x] B3：自提与顺丰、物流、自动收货、订单取消、售后、团购返还、VIP 权益、数字资产的隔离和回归。
- [x] C1：小程序普通、团购、VIP 结算页；自提点选择、自提人、支付成功和取货凭证页。
- [x] C2：小程序 / App 订单列表和详情的履约状态、按钮矩阵、跨端兼容。
- [x] C3：卖家备货/核销，自提点管理；管理端筛选、异常处理和审计展示。
- [x] D1a：后端 Prisma/build/关键状态机与权限测试；小程序、App 与 Web TypeScript/build 验证。
- [ ] D1b：真实 PostgreSQL 并发核销、核销与取消竞态、多商户部分退款补偿集成测试。
- [ ] D2：体验版与真实微信支付-备货-核销验收；staging/main 发布按独立授权执行。
