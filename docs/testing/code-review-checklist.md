# 代码审查清单

按受影响系统选择检查项；纯文档改动检查规则保留、引用、冲突和敏感信息，不运行无关业务测试。
独立审查只读不写；主 Agent 处理所有 High/Critical，对 Medium 说明决策，Low 可记录暂缓。
与设计逐字段比对限于本次改动涉及的模型和接口。

**后端代码审查**：

- Schema/模型：字段类型、关系双向声明、索引覆盖、枚举值完整性
- 与计划文档（docs/features/plan-treeforuser.md 等）逐字段交叉比对，报告所有偏差
- 并发安全：金额/库存/奖励数据库状态写入是否用 Serializable、CAS 是否在事务内、幂等键设计
- 种子数据：数据格式与 Schema 字段类型一致、JSON 字段结构与业务代码预期一致、新增配置项完整
- 业务逻辑：状态机转换合法性、利润分配比例总和校验、配置回退机制
- TypeScript 编译通过；涉及 Prisma 时 validate 通过，与根规则按影响范围选择检查一致

**买家 App 前端审查**：

- TypeScript 类型与后端 API 响应一致（`src/types/domain/` ↔ 后端 DTO）
- Repository 层方法签名与后端路由匹配（HTTP method + path + 参数）
- Store 状态与新增字段同步（如 CartItem 新增奖品字段）
- 组件：设计令牌使用正确、三态实现完整（Skeleton/Empty/Error）、无硬编码样式
- 导航/路由：新页面在 app/ 下注册且 expo-router 文件路径正确

**卖家后台 / 管理后台前端审查**：

- API 层：请求路径和参数与后端 Controller 路由一致
- ProTable/ProForm 列定义与后端返回字段匹配
- 权限标识与后端 `@Permission()` 装饰器一致
- 菜单/路由配置包含新页面入口

**跨系统一致性审查**：

- 枚举值三端一致（Schema 枚举 ↔ 前端 constants ↔ 后端 DTO）
- 新增 API 端点在对应前端 Repo 中有调用方法
- 文档（plan.md / docs/architecture/data-system.md / docs/issues/tofix-safe.md 等）与代码实际状态同步
