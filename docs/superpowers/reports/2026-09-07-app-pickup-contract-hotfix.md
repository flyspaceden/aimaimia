# App 自提接口契约审查与结账白屏修复

## 问题与根因

用户在正式 Android 1.0.6、OTA 01a07c7c 点击购物车“去结账”后白屏。
后端 `PickupService.listBuyerPoints` 返回 `{ items: [...] }`，App `OrderRepo.getPickupPoints` 未解包。
`usePickupSelection` 将该对象传给 `reconcilePickupSelections`，后者调用 `groups.find` 抛出 TypeError。
请求在结账页初始化时执行，配送模式也受影响；普通、团购、VIP 共用该 hook。
先前原生测试接口错误地返回裸数组，掩盖真实接口差异。编译通过和该测试结果不足以证明真实数据兼容。

## 修复及测试

- 在 Repository 验证并解包 `items`；非法分组/点位数据转换成可展示、可重试的 Result 错误。
- 后端、支付 SDK、原生依赖和数据库不变，可通过 Android 1.0.6 OTA 修复。
- 新增真实 `{ ok: true, data: { items } }` 契约回归并经过实际选择协调函数，包含跨企业平台中心仓。
- 覆盖非法列表/分组/点位和网络错误。新增用例在原代码失败，修复后通过。
- TypeScript 无错误；App 164 项单元测试、274 项脚本检查通过。脚本测试先执行网站既有法律静态页生成步骤。
- 独立审查确认根因，并逐项核对真实后端构造；不以 mock 和 TypeScript 类型代替证据。

## 扩展核对范围

| 链路 | 后端结构及核对结论 |
| --- | --- |
| 自提点 | `{items}`，已修 App 解包及校验 |
| 普通预览 | `{groups, summary, ...}`，App 对齐 |
| 普通/VIP 创建与续付 | 直接 session / paymentParams 对象，App 对齐 |
| 普通/VIP 未付款会话 | 直接 summary 或 null，App 对齐 |
| 状态与主动查单 | 直接状态对象，App 对齐 |
| VIP 赠品选项 | `{packages}`，App 对齐 |
| 团购列表与当前参与 | `{items}` 与 `{current,...}`，App 对齐 |
| 团购预览与创建 | 直接金额/会话对象，App 对齐 |
| 订单列表与详情 | 分页 items 与详情对象，App 对齐 |
| 自提凭证 | 直接凭证对象，App 对齐 |
| 微信参数与待付款金额 | 核对 SDK timestamp 字符串、后端快照数值构造，App 对齐 |

扩展扫描地址、红包、购物车、积分、分类、关注、消息、发票抬头、抽奖、成长、群组、预约、推荐、企业活动、AI会话及客服列表的外层契约，未发现第二个确定漏解包。另修复地图打不开后复制地址失败的 Promise 拒绝未处理，补回归测试。

原生页面复测与最终发布标识在完成后补记。真实付款和商家核销仍需真机验收。
