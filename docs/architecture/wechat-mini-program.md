# 爱买买微信小程序架构与发布边界

> 版本：2026-08-21 production integration
> 权威范围：微信小程序客户端、共享后端适配、微信能力与发布门禁。
> 本文不代表已经上传体验版、通过微信审核或正式发布。

## 1. 产品边界

微信小程序是独立 Taro 客户端，复用爱买买主商城的账号、商品、购物车、订单、支付、退款、售后、奖励和数字资产数据。

首版包含：

- 微信登录、手机号绑定和账号合并。
- 普通商品、VIP 礼包、团购。
- 商城送货上门与到店自提。
- 微信 JSAPI 支付、退款、退货运费支付。
- 微信商家转账提现和确认收款。
- 订单、售后、发票、红包、消费积分、数字资产、客服和推荐。
- 小程序码、订阅消息、微信交易发货信息。
- 自提点选择、买家一次性凭证、商家/平台核销。

首版明确排除：

- 独立 Delivery 产品及其账号、数据库、后台、法律文本和路由。
- React Native `app/delivery/**`、`src/repos/delivery/**`。
- 支付宝支付/提现、Apple 登录和其他原生 App 专用能力。
- App 内新增自提下单入口。

“排除独立 Delivery”不等于关闭商城送货上门。商城 `FulfillmentMode.DELIVERY` 与 `PICKUP` 是订单域的并列履约方式。

## 2. 代码结构

- `miniapp/`：Taro + React + TypeScript 微信小程序。
- `backend/`：App、小程序、Admin、Seller 共用的 NestJS 服务。
- `admin/`：平台自提点、平台统一自提点和核销台。
- `seller/`：企业点位、备货和核销台。
- `website/`：当前保持原有 H5 登录绑定页；未来双入口必须独立审批。
- React Native `app/` 和根 `src/` 不承载小程序页面。

小程序不得引用独立 Delivery 目录或数据库。跨端共享仅限 API 合同、状态枚举、金额规则和设计语义，不复制运行时页面。

## 3. 登录与会话

- 客户端通过 `wx.login` 获取一次性 code，后端调用微信服务端接口换取 openid/unionid。
- 登录身份通过 `AuthIdentity + Session` 管理；refresh token 必须绑定会话。
- 手机号优先账号、微信优先账号和双账号冲突必须走显式合并流程。
- production 必须设置 `WECHAT_MINIAPP_MOCK=false`；缺失和 true 均 fail-closed。
- 退出登录、账号切换或注销后，旧请求响应不能覆盖新会话。

## 4. 结算与支付

普通、VIP 和团购均使用独立的 `/mini-program` checkout 路由；App 原接口保留。

- 创建支付会话时锁定商品、价格、优惠、履约方式、地址/点位和 openid。
- 支付回调必须验证签名、AppID、商户号、场景、订单号和金额。
- 付款成功后原子创建订单；不能产生“已扣款但没有订单”的静默状态。
- 退款、退货运费退款和取消退款按原支付渠道收口。
- 收货和自动退款后的资金/权益副作用使用数据库 outbox，进程中断后可恢复。

## 5. 到店自提

- 普通、VIP、团购均可选择自提，但每个商家必须存在可用覆盖点位。
- 买家凭证由二维码 payload 和 8 位短码组成，只保存摘要/加密材料，不写日志。
- 自提状态：`PREPARING → READY → PICKED_UP`，异常进入 `VOID/CANCELED`。
- 商家或平台必须执行“解析凭证 → 脱敏预览 → 核对人和商品 → 确认核销”。
- 商品/SKU 条码仅用于可选货品核对，不能替代买家取货凭证。
- 自提订单不得创建面单、快递发货、微信物流任务或进入自动确认收货。

## 6. 微信提现

- 使用微信商家转账“佣金报酬”场景 1005。
- 正式配置必须包含固定报备：`岗位类型=平台推广人员`、`报酬说明=AI爱买买平台推广佣金`。
- 新建转账开关和存量查单/回调收口分离；紧急关闭新提现不能冻结已有处理中资金。
- 回调、主动查单、用户确认收款和补偿任务均按幂等状态机处理。

## 7. 推荐 H5

当前生产继续保留原有手机号/微信 H5 登录绑定页。双入口 InviteChoice 已完成设计验证但不进入本批发布，原因是现有 App 仍展示 H5 登录/绑定漏斗，且本批明确禁止 App 源码改动。

后续双入口方案需要独立批准：

1. 打开爱买买小程序：后端验证邀请码和 landing session 后生成受控 URL Link。
2. 下载爱买买 App：跳转前写入普通/VIP 对应推荐口令。
3. 同时修改 App 漏斗口径/自提只读显示，或补齐小程序与 App 的 landingSession 归因。

## 8. 环境与发布

- staging API：`https://test-api.ai-maimai.com/api/v1`。
- production API：`https://api.ai-maimai.com/api/v1`。
- production WSS：`wss://api.ai-maimai.com`。
- `MINIAPP_RELEASE_CHANNEL=staging` 校验最新 `origin/staging`。
- `MINIAPP_RELEASE_CHANNEL=production` 校验最新 `origin/main`。
- 脏工作区、旧目标分支、Mock、测试域名或未显式选择 channel 均阻止发布。
- CI 的 production artifact 不是微信体验版或正式版；上传微信仍需独立操作与记录。
- App 源码保持不变时，小程序自提订单在当前 App 中可能被按普通待发货订单展示；这是跨端已知限制，不是已完成兼容。

生产发布顺序：

```text
后端兼容与迁移
  → 现有 App 生产冒烟
  → Admin/Seller
  → 微信 production 体验版
  → 真机支付/退款/自提/提现
  → 微信审核
  → 正式发布
```

## 9. 自动与外部验收

自动门禁：

- lint 0 warning、TypeScript。
- Vitest 全量。
- staging + production 双构建。
- 72 页、主包/分包体积和正式域名产物校验。
- Delivery 目录和测试域名扫描。

外部验收：

- 新微信用户、手机号账号合并、退出重登和注销。
- 普通/VIP/团购的配送与自提支付。
- 支付恢复、主动查单、退款和退货运费。
- 微信提现、确认收款和失败补偿。
- 商家备货、二维码/短码核销、重复核销、错企业拒绝。
- 商品详情与 VIP 礼包的微信原生 Swiper 滑动、current/onChange、侧边距和返回恢复。
- 平台统一自提点。
- 推荐码、小程序码，以及当前生产 H5 登录绑定链路的兼容回归。
- 订阅消息及微信交易发货。

## 10. 当前状态

2026-08-21 production-integration 本地验证：

- 55 个测试文件、303 个测试通过；设置页不暴露没有实际可管理授权记录的微信原生授权入口。
- 34 个核心商城 Service 的 Git blob 与已验收 `staging@acc0e08c` 精确一致；9 个生产允许差异均有 manifest 说明与 Delivery 排除断言。
- staging/production 双构建和 72 页 artifact 通过。
- 总包 2.41 MiB，主包 1.262 MiB。
- production artifact 仅含正式 API/WSS。
- 小程序地址、默认地址、发票抬头和个人资料的 4 个 `PUT` 兼容路由与前端调用保持一致；App 原有 `PATCH` 路由并列保留。
- Swiper 覆盖到 12.1.2，已消除对应 Critical；Taro 的 Vite/esbuild/webpack/uuid 构建工具链仍有 1 high + 12 moderate，需独立升级。
- H5 InviteChoice 与 App 只读兼容均延期，不在本批 commit。
- 候选已推送到 Draft PR #1，但尚未合并 `main`、部署生产后端、执行生产 migration、上传微信体验版或完成真机验收。
