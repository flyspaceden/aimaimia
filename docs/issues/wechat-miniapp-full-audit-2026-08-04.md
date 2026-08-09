# 微信小程序全面代码审查报告（2026-08-04）

## 1. 结论

本轮已按“App 页面对标、微信官方规则、API Contract、资金与并发安全、隐私与日志、构建产物”六条主线完成代码级审查，并修复所有能够确定的问题。当前没有遗留的、已确认且可仅靠代码解决的 Critical / High 功能缺陷。

这个结论只覆盖源码、自动化测试和 Taro 构建产物，不代表已经发布或通过微信真机验收。真实 AppID 已配置；合法域名、隐私保护指引、订阅消息模板、微信支付/商家转账/交易发货权限、后端环境、微信开发者工具和真实资金闭环仍是外部验收门槛。

## 2. 审查方法

1. 以 `docs/architecture/wechat-mini-program.md`、`docs/architecture/frontend.md` 和当前 App 路由为产品范围，扫描页面映射、路由注册和首版排除项。
2. 逐项核对 Taro 4.2.1 生成方式与微信官方 API/组件约束，覆盖请求、分享、隐私、扫码、录音、地图、支付、商家转账、订阅消息、上传下载、Socket、路由和分包。
3. 对登录、刷新、退出、支付、退款、提现、售后、结算、账号注销和资产写入做状态机、身份绑定、幂等、竞态和 fail-closed 审查。
4. 对 Repo、DTO、HTTP method、路径、枚举、页面读取状态和错误态做前后端 Contract 对齐。
5. 不只检查源码；重新构建 staging/production，并直接扫描最终 `dist` 中的页面、分享能力、隐私事件、polyfill、生产域名、禁用能力和包体积。
6. 运行小程序、根 App、后端聚焦及全量回归；任何失败先定位根因，再修复并重跑。

## 3. 已修复问题

| 编号 | 级别 | 问题 | 修复结果 |
|------|------|------|----------|
| WX01 | High | `wx.request` 官方 method 集合不包含 `PATCH` | 小程序 Repo 统一改为 `PUT`，后端为对应接口增加兼容别名，保留 App 原有 `PATCH` |
| WX02 | High | 隐私同意按钮使用普通点击，无法完成微信隐私授权协议 | 改为 `openType=agreePrivacyAuthorization`、专用回调和匹配的 `buttonId`，并检查最终 WXML 事件绑定 |
| WX03 | High | React Query 依赖 `AbortController`，部分微信运行时没有该全局对象；最初 polyfill 入口又被 Webpack 替换为只读取现有全局对象 | 改为打包独立实现，并新增构建产物断言，确认生产 `app.js` 内含真实实现且在 App 初始化前执行 |
| WX04 | Medium | 使用分享 Hook 的两个页面漏开 Taro 分享能力标记 | 补齐页面配置；最终产物六个分享页均包含对应好友/朋友圈能力标记 |
| WX05 | Medium | 扫小程序码仍读取普通二维码文本字段 | `WX_CODE` 读取官方 `result.path`，普通二维码读取 `result.result`；目标仅允许受信 scene 中转页 |
| WX06 | Medium | 录音音源、地图 Marker、Modal 按钮文字存在微信兼容风险 | 录音改为 `audioSource=auto`，Marker 改为本地 PNG，所有 Modal 操作文字限制在 4 字以内 |
| UX01 | High | 换货订单确认收货没有严格绑定“已发货换货单” | 增加售后状态类型和精确资格判断，通过统一售后 Repo 完成确认 |
| UX02 | High | 支付成功页可能根据 URL 参数展示未经服务端确认的成功结果 | 页面重新查询当前用户真实订单；VIP、单订单、多订单分别进入对应已确认结果页 |
| UX03 | Medium | “我的”页接口失败时可能把失败伪装成余额 0、非 VIP 或非团长 | 资金和身份状态改为 fail-closed，失败展示错误态而不伪造业务结果 |
| UX04 | Medium | 售后退货运费读取复用了错误的结算 Repo | 新增专用类型和 Repo 方法，按后端真实售后运费 Contract 读取 |
| SEC01 | High | 退出登录与正在进行的 Token 刷新竞态，旧刷新结果可能在退出后重新写回会话 | 加入 logout generation，退出先同步清本地凭据，再撤销服务端旋转会话；旧刷新结果被丢弃 |
| SEC02 | Critical | 注销与红包发放、成长兑换、提现等资产写入之间仍有遗漏的并发窗口 | 相关事务统一接入用户 advisory lock、`ACTIVE + deletionExecutedAt IS NULL` 复核和 Serializable/P2034 重试 |
| SEC03 | High | 支付通知日志可能输出完整通知对象或完整业务单号 | 移除完整 payload，所有相关单号脱敏，失败日志不再输出不必要金额 |
| SEC04 | Medium | 钱包流水 API 向买家端返回内部 `meta/refId/sourceLedgerId` | 服务端改为公开字段 allowlist，App/小程序类型同步移除内部 ID |
| FUND01 | Critical | 微信退款通知只靠退款单号或部分字段可能串单；校验与状态收口分离还存在 TOCTOU | 售后退款、自动退款、退货运费退款均校验退款单号、原支付单号、退款金额、原支付总额和已有微信退款 ID；校验与状态转换放入同一 Serializable 事务，异常通知不恢复库存、不回收奖励、不推进资金状态 |
| FUND02 | Critical | 现用微信支付 SDK 的 HTTP 层丢弃 `Wechatpay-*` 应答头，主动查单/退款/关单结果无法按 APIv3 要求验签 | 注入固定微信支付域名的自定义传输层；显式请求公钥 ID，保留原始 body 并在解析前完成公钥 ID、时间窗、SIGNTEST 与 RSA-SHA256 验证；伪造 `SUCCESS` 和未签名错误均 fail-closed |
| FUND03 | Critical | SDK 不可用、非法商户单号或未定义的 HTTP 200 关单响应可能被当成远端未支付终态 | 这些情况全部改为 non-terminal；只有已验签的 204 或明确 `ORDER_NOT_EXIST/ORDER_CLOSED` 才允许本地释放，错误码兼容下划线写法 |
| FUND04 | High | 提现补偿固定取前 20 条造成饥饿，人工查单与 Cron 可能并发访问同一转账 | 新增到期时间与阶梯退避，按到期时间公平扫描；Cron 和人工查单均先 CAS 抢占再访问 Provider，微信未知/未找到达到阈值只告警不退款 |
| FUND05 | High | 微信交易发货可能发送退款/取消前生成的旧快照，并把两个拒绝码误当成功 | Worker 发送前重建权威订单/包裹快照并用 generation+lease 替换旧记录；退款/取消停止发送，payload hash 再校验；只有 `10060023` 可视作远端已完成 |
| SEC05 | Medium | 无 `sessionId` 的历史买家 JWT 可借同用户其他活跃会话通过校验 | 买家端不再降级到用户级会话；旧 Token 返回 401，由现有 refresh 流程换取精确绑定 Session 的新 Token |
| TEST01 | Medium | 新增活跃用户屏障后，微信提现专项旧事务 mock 没有数据库锁/查询方法 | 补齐 mock 后聚焦用例和后端全量回归重新通过 |

## 4. 微信官方规则核对结果

- `request/uploadFile/downloadFile/connectSocket`、路由与生命周期、下拉刷新、扫码、录音、相机/相册/保存图片均按微信/Taro 对应能力调用。
- 好友分享和朋友圈分享使用 Taro Hook，并在页面编译结果中开启对应能力。
- 隐私授权监听、隐私协议打开和同意按钮使用微信专用接口与事件。
- `Map`、`Picker`、`Button`、`Image`、`ScrollView` 的已使用属性未发现剩余确定性错误。
- 小程序支付使用 JSAPI 参数；客户端返回只表示调起结果，订单最终状态只以后端通知/主动查单为准。
- 所有当前调用的微信支付 APIv3 JSON 应答先验签原始 body，再解析业务字段；公钥模式请求显式携带 `Wechatpay-Serial` 公钥 ID。文件上传和账单文件下载不复用该 JSON transport，未来新增时必须单独设计原始字节校验。
- 微信关单只有签名验证通过的 204 或明确远端终态错误码可释放本地会话；未知 2xx、网络、超时和验签异常均保持 non-terminal。
- 商家转账确认返回不代表到账，客户端只负责调起，提现终态只以后端验签回调/主动查单为准。
- 订阅消息只在用户主动点击链路申请，单次模板数不超过微信限制。
- 生产包注册 71 个运行时页面，3 个主包页、14 个分包；无配送路由、分包或业务引用。

## 5. 构建产物证据

- 71 个注册页面均生成 WXML。
- 六个分享页面的最终 JS 均带正确的好友/朋友圈分享能力标记。
- 最终 WXML 含 `bindagreeprivacyauthorization`，App 产物含专用 `openType` 和回调。
- 生产产物无 `PATCH`、`voice_recognition`、ICO Marker、测试 API 或测试 WebSocket。
- 生产 API 为 `https://api.ai-maimai.com`，WebSocket 为 `wss://api.ai-maimai.com`。
- 主包 1.235 MiB，总包 2.293 MiB，最大分包 `packages/benefits` 为 0.194 MiB。
- 新增 `miniapp/scripts/verify-weapp-artifact.mjs`，以后本地 `npm run verify` 和 CI production 构建都会自动复查这些条件，包括真实 AppID 断言。

说明：Taro 通用运行时自身带有 `ALIPAY` 平台枚举字符串，头像上传结果校验也允许识别 localhost 开发 URL；它们不是爱买买小程序的支付宝入口或生产请求地址。业务路由、功能清单、页面文案和调用链仍保持“无支付宝、无配送”。

## 6. 自动化验证

- 小程序：ESLint 0 警告、TypeScript 通过、37 个 Vitest 文件 210/210；staging/production 构建与生产产物检查通过。
- 后端：聚焦微信提现 22/22；Payment 16 套件 282/282；After-sale 11 套件 177/177（另有 2 个既有跳过项）；2026-08-09 合并 `origin/staging` 后全量 302 套件 3234/3234（另有 2 套件/5 个既有跳过项）；Nest 构建、主库与配送库 Prisma validate 通过。
- 根 App：TypeScript 通过、39 个 Jest 套件 152/152、源码与合规测试 208/208；配送管理端 25/25、配送卖家端 30/30 合同测试及两端生产构建通过。小程序首版仍静态排除配送。
- `git diff --check` 作为最终交付检查执行；变更只保存在本地功能分支提交中，未推送、未部署。

## 7. 仍需外部验收

1. `project.config.json` 已配置真实小程序 AppID `wx1b33112db0d5267b`；仍需在测试/生产后端环境配置同一 AppID/AppSecret，并完成微信支付商户号绑定。支付环境还必须配置微信支付公钥 ID 与 PEM 公钥；AppSecret、APIv3 Key、商户私钥和公钥材料均不得进入前端或 Git。
2. 配置生产/测试 request、upload、download、socket 合法域名，并把后端实际返回的 OSS/CDN/PDF 域名加入 download 白名单。
3. 在微信公众平台填写隐私保护指引，覆盖相机、相册、麦克风、扫码、保存图片和头像等用途。
4. 配置三个订阅消息模板，开通小程序支付、商家转账和交易发货能力及对应通知地址。
5. 用微信开发者工具和 iOS/Android 真机验证隐私同意/拒绝、录音中断恢复、最多 10 张售后凭证、小程序码、地图、支付/取消/查单、微信提现、客服断线重连、订阅消息和 SVG 图形验证码。
6. 用真实小额交易完成支付、退款、提现和交易发货对账后，才能把 `WMP00-F` 标记完成。

## 8. 已知非代码阻塞

`miniapp` 的生产依赖审计仍报告 14 条 Taro/构建链上游公告（3 critical、1 high、10 moderate）。2026-08-08 已将可独立安全升级的间接依赖 `nanoid` 从 3.3.16 更新到 3.3.18，消除该项 High；当前生产包不含剩余公告涉及的 Swiper JS，开发服务器不得暴露公网。其余自动修复会破坏 Taro 4.2.1 锁定依赖，因此继续按 `WMPF08` 跟踪，禁止使用 `npm audit fix --force`。

## 9. 官方依据

- 微信隐私授权：<https://developers.weixin.qq.com/miniprogram/dev/api/open-api/privacy/wx.onNeedPrivacyAuthorization.html>
- 微信分包：<https://developers.weixin.qq.com/miniprogram/dev/framework/subpackages.html>
- 微信 JavaScript 支持：<https://developers.weixin.qq.com/miniprogram/dev/framework/runtime/js-support.html>
- 微信官方 API typings：<https://github.com/wechat-miniprogram/api-typings>
- Taro Hooks：<https://docs.taro.zone/en/docs/hooks>
- 微信小程序支付：<https://pay.wechatpay.cn/doc/v3/merchant/4012791898>
- 微信支付 APIv3 应答验签：<https://pay.wechatpay.cn/doc/v3/merchant/4013053420>
- 微信支付公钥验签：<https://pay.wechatpay.cn/doc/v3/merchant/4013053249>
- 微信支付关闭订单：<https://pay.wechatpay.cn/doc/v3/merchant/4012526915>
- 微信商家转账确认：<https://pay.wechatpay.cn/doc/v3/merchant/4012716430>
