# AI爱买买微信小程序

Taro 4 + React 18 + TypeScript 买家小程序。业务数据与买家 App 共用同一套 NestJS API 和数据库；配送中心、支付宝支付与支付宝提现不进入本小程序产物。

## 本地命令

```bash
npm ci
npm run dev:weapp
npm run verify
```

`npm run verify` 会依次执行 ESLint、TypeScript、Vitest、staging 构建和 production 构建。生产构建会拒绝 Mock、HTTP API 或非 WSS WebSocket 配置。

## 微信开发者工具

开发者工具导入当前目录，`miniprogramRoot` 已指向 `dist/`。项目已配置 AI爱买买真实小程序 AppID `wx1b33112db0d5267b`；登录、支付、微信提现、订阅消息、隐私接口、小程序码和交易发货仍必须在体验版及真机验证。

AppID 是公开的项目标识，已提交到工程配置；AppSecret、微信支付密钥、商家转账配置和 CI 上传私钥属于秘密，只能存放在本地私密配置、部署环境变量或 Secrets，不能提交到仓库。

## 变更规则

- 后端 Contract 变化时，同时检查 App 与小程序调用方。
- 页面或文案变化时，按同一验收口径分别修改两套前端。
- 新增微信隐私接口前，先更新微信后台隐私保护指引，再补授权拒绝与同意测试。
- 资金结果只以后端回调或主动查询为准，不能把前端 API 的成功回调当作支付或转账成功。
- 配送能力未来必须经过单独评审并以独立分包接入。

完整范围和发布门槛见 `docs/architecture/wechat-mini-program.md`。
