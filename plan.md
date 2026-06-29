# 爱买买 - 开发计划（v1.0 上线冲刺）

> **最后更新**: 2026-06-29
> **维护规则**: 每次修完一项 → 打 ✅ + 填完成日期；每次新增需求 → 追加条目 + 标注来源日期
> **历史记录**: `docs/reference/plan-history-2026Q1.md`（2026-02 至 2026-03 的 Phase 1-10 开发历程）

---

## 🎯 当前目标

| 维度 | 决策 |
|---|---|
| 版本 | v1.0 MVP |
| 范围 | Tier 1 + Tier 2（详见下方批次 + [审查报告 §6/§7](docs/superpowers/reports/2026-04-11-launch-readiness-audit-report.md)） |
| 支付 | 支付宝已开放；微信支付代码链路已接入但入口关闭，待 APP 支付权限 + 真金联调通过后开放 |
| 退款 | 必须退回原支付渠道；支付宝已接通，微信退款链路已接入但随微信支付入口待联调后开放 |
| 快递 | 顺丰丰桥直连（快递100 废弃） |
| 上线节奏 | 阶梯：管理后台 → 卖家后台 + 种子商户 → App 对外 |
| 首批用户 | 500+ |
| 时间 | 无硬 deadline，质量优先 |

### 近期完成补充

- [x] **发现页商品卡价格去单位后缀**（2026-06-29 新增并完成）
  - **来源**: 用户真机截图反馈，发现页商品卡仍显示 `¥399.1/斤`，容易误解为按斤计价；实际价格是该商品/规格的整件价格。
  - **实际做了**: 买家 App 通用 `ProductCard` 价格不再向 `Price` 传入 `product.unit`，因此发现页、搜索页、分类页、企业页等商品流卡片统一只显示 `¥金额`；单位和包装重量继续保留在商品详情的独立元信息里。
  - **验证**: `node --test scripts/__tests__/product-card-price-display.test.mjs`、`npx jest src/utils/__tests__/productDisplay.test.ts --runInBand`、`npx tsc -b --noEmit --pretty false` 通过。

- [x] **会员中心 VIP 权益文案收口**（2026-06-28 新增并完成）
  - **来源**: 真机截图反馈，会员中心出现“消费奖励翻倍”“高额返利”“入会专属礼包”等与当前 VIP 功能不一致或不合规的权益表述。
  - **实际做了**: 买家 App 会员中心权益改为普通商品会员价、更低包邮门槛、消费积分更高抵扣比例、推荐 VIP 奖励和 VIP 身份标识；奖励机制改为“奖励规则”，明确普通商品确认收货后计算、VIP 礼包不参与奖励、提现至支付宝；同步我的页 VIP 权益弹窗，移除未落地/不准确承诺。
  - **验证**: `npx jest src/utils/__tests__/vipMembershipCopy.test.ts --runInBand --modulePathIgnorePatterns='<rootDir>/.worktrees'`、`npx tsc -b --noEmit` 通过。

- [x] **单品价格/重量展示与卖家中心单规格名称修复**（2026-06-28 新增并完成）
  - **来源**: 用户截图反馈，买家商品详情把 `¥99/斤` 误导成单价口径，且缺少商品重量；卖家中心单规格商品只能显示“默认规格”，组合商品选择组成单品时也无法判断重量。
  - **实际做了**: 买家商品详情价格只显示整件/整规格总价，普通单品独立展示“单位”和“包装重量”，组合商品详情不展示自身单位/重量；公开商品详情返回 SKU `weightGram`。卖家中心单规格商品在价格与库存区域新增“规格名称”，编辑/草稿/新建/单双规格切换均保留 `ProductSKU.title`；组合商品添加组成单品时，选择器和已选表格展示规格名、包装后重量和计量单位。
  - **验证**: `node --test seller/test/productSkuDisplay.test.ts`、`npx jest --runTestsByPath src/utils/__tests__/productDisplay.test.ts src/repos/__tests__/ProductRepo.test.ts`、`cd seller && npm run build` 通过。

- [x] **推荐码页显示直邀 VIP 人数**（2026-06-26 新增并完成）
  - **来源**: 用户截图反馈，希望“我的推荐码”页面展示自己推荐的 VIP 人数，并移除“我的专属推荐码”旁的“AI推荐”徽标。
  - **实际做了**: `GET /bonus/member` 新增 `inviteeVipCount`，口径为直属推荐且已升级 VIP 的人数（不含下下级），与管理后台“直邀 VIP”一致；买家 App 推荐码卡片在专属码下展示“已推荐 x 位 VIP”，并删除标题旁 `AI推荐` 徽标。
  - **验证**: `backend npm test -- src/modules/bonus/bonus.service.spec.ts --runInBand`、`node --test scripts/__tests__/referral-page-vip-count.test.mjs`、`backend npx prisma validate`、`backend npm run build`、`npx tsc -b --noEmit --pretty false` 通过。

- [x] **我的页数字资产排行榜**（2026-06-28 新增并完成）
  - **来源**: 用户要求在我的页身份卡推荐码旁展示当前数字资产在所有 VIP 用户中的排名；资产最多从 1 开始，没有数字资产账户显示“未上榜”。
  - **实际做了**: `GET /me/digital-assets/summary` 新增 `assetRank`，按有数字资产账户的 VIP 用户已释放数字资产总额（种子资产 + 消费资产，不含冻结资产）从高到低计算；无数字资产账户或非 VIP 返回 `null`。买家 App 我的页身份卡在推荐码同行右侧展示“数字资产排行榜：x / 未上榜”，并可点击进入数字资产页。
  - **验证**: `cd backend && npm test -- digital-asset.service.spec.ts digital-asset-v2.service.spec.ts admin-digital-asset.service.spec.ts admin-digital-asset-v2.service.spec.ts --runInBand`、`DATABASE_URL=postgresql://postgres:postgres@localhost:5432/aimaimai_test npx prisma validate`、`npm run build`

- [x] **管理后台数字资产表格排序与排名**（2026-06-28 新增并完成）
  - **来源**: 用户要求数字资产表点击列名后，可按列内数字从小到大或从大到小排序，并用表头箭头表示排序方向；随后要求后台能直接看到数字资产排名，并让数字资产页面默认按数字资产从高到低排序，先不新增单独排行榜页面。
  - **实际做了**: 管理后台数字资产账户表默认按数字资产总额从高到低排序，表头默认选中“数字资产总额”降序；支持数字资产总额、种子资产、消费资产、冻结资产、累计消费和账户更新时间表头排序；排序参数传给 `GET /admin/digital-assets/accounts`，后端按白名单字段在分页前排序，数字资产总额按种子资产 + 消费资产计算列排序；列表新增“排名”列，展示账号在所有 VIP 用户中的全局数字资产排名，口径为已释放种子资产 + 消费资产，不含冻结资产，非 VIP / 未上榜显示空排名。
  - **验证**: `cd backend && npm test -- digital-asset.service.spec.ts digital-asset-v2.service.spec.ts admin-digital-asset.service.spec.ts admin-digital-asset-v2.service.spec.ts --runInBand`、`node --test scripts/__tests__/admin-digital-assets-sort.test.mjs`、`cd backend && DATABASE_URL=postgresql://postgres:postgres@localhost:5432/aimaimai_test npx prisma validate`、`cd backend && npm run build`、`cd admin && npm run build`、`git diff --check` 通过。

- [x] **组合商品架构文档与安全清单补齐**（2026-06-22 新增并完成）
  - **来源**: `docs/superpowers/plans/2026-06-22-product-bundle.md` Task 15
  - **实际做了**: 更新 `docs/architecture/data-system.md`、`seller.md`、`frontend.md`、`responsive-design.md`，补齐 `ProductType` / `ProductBundleItem`、卖家组合编辑器、买家组合展示、结算组件库存展开、整套售后规则与卖家打印清单口径；并按 `docs/issues/tofix-safe.md` checklist 完成组合商品安全审阅，结论为本任务不需要新增或改写 tracked issue
  - **验证**: `git diff --check`、bundle 相关实现 grep 对齐、文档最小一致性复核

- [x] **买家端组合商品购物车/订单/售后展示**（2026-06-22 新增并完成）
  - **来源**: `docs/superpowers/plans/2026-06-22-product-bundle.md` Task 14
  - **实际做了**: `ServerCartItem` / `OrderItem` / `useCartStore` 补齐 `productType` / `bundleItems` snapshot；购物车、结算、订单卡片/详情、售后申请和售后详情统一复用紧凑只读“组合内容”摘要，保持父商品行结算/价格/售后身份不变，不开放组件级售后动作
  - **验证**: `npx jest --runInBand src/utils/__tests__/bundleSnapshot.test.ts`、`npx tsc --noEmit --pretty false`、`git diff --check`

- [x] **买家端组合商品详情展示**（2026-06-22 新增并完成）
  - **来源**: `docs/superpowers/plans/2026-06-22-product-bundle.md` Task 13
  - **实际做了**: 买家端 `Product` / `ProductDetail` 类型补齐 `type` / `bundleItems` / `bundleAvailableStock` / `bundleTotalWeightGram`；`ProductRepo` 统一默认 `SIMPLE` 并归一化组合内容字段；商品详情页在组合商品下新增紧凑“组合内容”只读区，只展示组成商品、SKU 和数量，不暴露组件价格
  - **验证**: `npx tsc --noEmit --pretty false`、`git diff --check`

- [x] **卖家订单详情组合商品展示与拣货单打印**（2026-06-22 新增并完成）
  - **来源**: `docs/superpowers/plans/2026-06-22-product-bundle.md` Task 12
  - **实际做了**: 卖家订单详情 `OrderItem` 类型补齐 `productType` / `bundleItems`；商品清单卡为组合商品保留父购买行并展开组件明细；新增 `waybillPrint.ts` 生成无价格拣货单 HTML；2026-06-23 调整打印页为只打印父订单商品行和数量，不再输出详情清单、组合组件明细或 SKU 级拣货汇总
  - **验证**: `cd seller && node --test test/waybillPrint.test.ts`、`cd seller && npm run build`、`git diff --check`

- [x] **管理后台组合商品审核/详情展示**（2026-06-22 新增并完成）
  - **来源**: `docs/superpowers/plans/2026-06-22-product-bundle.md` Task 11
  - **实际做了**: 管理后台商品类型补齐 `type` / `bundleItems` / `bundleReferenceTotal` / `bundleAvailableStock` / `bundleTotalWeightGram`；商品列表新增组合类型识别、组成项数量和参考合计提示；审核弹窗与商品详情页新增组合内容只读表格，展示组成商品/SKU、数量、当前单价小计、参考合计和总重量，并兼容后端 raw nested/flattened 两种返回形态
  - **验证**: `cd admin && npm run build`、`git diff --check` 通过

- [x] **卖家组合商品创建/编辑 UI**（2026-06-22 新增并完成）
  - **来源**: `docs/superpowers/plans/2026-06-22-product-bundle.md` Task 10
  - **实际做了**: 卖家商品创建/草稿/编辑页新增普通商品 / 组合商品 Segmented、组合内容 SKU 表、已有组合展开合并、组合成本价、参考合计和可组合库存展示；列表页展示「组合」Tag、组合项数量和推导库存；API 类型补齐 `productType` / `bundleItems`
  - **验证**: `cd seller && npm run build` 通过
  - **2026-06-25 体验修复**: 创建/编辑页顺序调整为「基本信息 → 价格与库存 → 商品图片」；组合商品先选 `组合内容` 再填 `组合成本价`；添加单品规格选择后强制重置为占位提示，避免选择框继续显示已选商品；已有组合复制改为按钮弹层；未审核通过组件前端置灰、后端错误指出具体商品 / 规格；草稿接口补齐 `unit`，修复保存草稿时报 `property unit should not exist`
  - **2026-06-25 验证**: `npm test -- seller-products-dto.spec.ts seller-products.service.spec.ts product-bundle.service.spec.ts --runInBand`（backend）、`node --test seller/test/productBundleEditorSelect.test.ts`、`npm run build`（seller）
  - **2026-06-26 列表筛选与删除口径**: 商品列表新增商品状态 / 审核状态 / 退货政策三组紧凑筛选，统计卡点击同步筛选；退货政策按最终生效政策过滤；商品删除允许自动清理未成交购物车引用，仍阻止已有订单商品明细、进行中结算、组合商品、抽奖奖品和 VIP 赠品引用，并返回更准确中文原因

- [x] **团购 App 类型与 Repo 契约**（2026-06-22 新增并完成）
  - **来源**: 团购分享回馈功能 Chunk 6.1，需要先给买家 App 页面准备类型和 API Repo 契约。
  - **实际做了**: 新增 `GroupBuy` domain types，覆盖团购活动、当前团、checkout、扫码落地、返还账户/流水和提现记录；新增 `GroupBuyRepo`，接入活动列表、当前团、团购 checkout、终止/放弃、返还账户/流水、团购返还余额提现和提现历史。
  - **验证**: `npx tsc -b` 通过。

- [x] **团购精选货架与详情页**（2026-06-22 新增并完成）
  - **来源**: 团购分享回馈功能 Chunk 6.2，需要先落地 APP 内团购首页、当前团购状态和商品详情交互。
  - **实际做了**: 新增 `/group-buy` 货架页和 `/group-buy/[activityId]` 详情页；无当前团购时展示商品货架，有当前团购时默认进入“我的团购”并可切换到商品；当前团购面板展示推荐码、二维码、进度和结束入口；详情页展示后台配置的团购详情介绍；商品卡、详情和进度不展示返还基数或返还百分比；购买新团购但已有进行中分享时，用底部抽屉提示需先结束本次分享；页面移除“分享回馈活动”和“仅一级直接推荐”提示。
  - **验证**: `npx tsc -b` 通过。

- [x] **团购扫码落地与现金付款**（2026-06-22 新增并完成）
  - **来源**: 团购分享回馈功能 Chunk 6.3，需要把推荐码扫码购买和团购现金付款链路串起来。
  - **实际做了**: 新增 `/gb/[code]` 推荐码落地页和 `/group-buy/checkout` 团购付款页；二维码/系统分享链接使用独立 `/gb/{code}`；落地页展示分享用户和同款商品，未登录先弹登录，登录成功后继续进入付款；付款页复用地址选择和现有支付宝/微信支付确认链路，但不展示消费积分、平台红包、团购返还余额等抵扣入口。
  - **验证**: `npx jest src/utils/__tests__/groupBuyShare.test.ts --runInBand`、`npx tsc -b` 通过。

- [x] **首页团购入口**（2026-06-22 新增并完成）
  - **来源**: 团购分享回馈功能 Chunk 6.4，用户要求首页增加团购入口。
  - **实际做了**: 首页 VIP 推荐区下方新增“精选团购”入口卡，点击进入 `/group-buy`；保持现有三 Tab 不变，避免与独立 `/group-buy` 路由产生重复路径。
  - **验证**: `npx tsc -b` 通过。

- [x] **管理后台团购 API/类型/权限底座**（2026-06-22 新增并完成）
  - **来源**: 团购分享回馈功能 Chunk 7.1，需要先给管理端页面准备活动 API、类型和权限常量。
  - **实际做了**: 新增 `admin/src/api/group-buy.ts`，接入真实后端已提供的团购活动列表/详情/创建/更新/状态/删除接口；新增管理端团购活动共享类型；新增 `group_buy:read/manage` 权限常量。
  - **验证**: `admin npm run build` 通过。

- [x] **团购扫码落地后端接口与名额前置校验**（2026-06-22 新增并完成）
  - **来源**: 团购分享回馈功能 Chunk 6.3，App `/gb/[code]` 已接真实接口，需要后端提供推荐码落地查询；第三位好友购买后推荐码不能继续使用，需要在付款前挡住名额已满的分享码。
  - **实际做了**: 新增公开 `GET /group-buy/landing/:code`，返回推荐码有效性、分享用户和活动商品安全快照；活动列表同步设为公开；团购 checkout 在生成支付会话前统计候选/有效直接推荐记录，名额已满时拒绝创建会话。
  - **验证**: `backend npx jest src/modules/group-buy/group-buy.service.spec.ts src/modules/group-buy/group-buy-checkout.service.spec.ts --runInBand`、`backend npm run build` 通过。

- [x] **管理后台团购查询接口与页面**（2026-06-22 新增并完成）
  - **来源**: 用户要求管理后台能清楚查看团购商品、每个团、团购订单和推荐码关系。
  - **实际做了**: 后端新增管理端团购记录列表/详情、团购订单列表、返还流水列表接口；管理后台新增“团购活动 / 团购记录 / 团购订单 / 返还流水”四个页面和侧边栏入口，团购记录详情可查看直接推荐记录与返还流水。
  - **验证**: `backend npx jest src/modules/admin/group-buy/admin-group-buy.service.spec.ts --runInBand`、`backend npx prisma validate`、`backend npm run build`、`admin npm run build` 通过。

- [x] **团购月度发起次数配置**（2026-06-22 新增并完成）
  - **来源**: 用户确认“每人每月最多发起 4 次团购”需要后台可配置。
  - **实际做了**: 后端团购 checkout 从 `RuleConfig.GROUP_BUY_MAX_MONTHLY_LAUNCHES` 读取月度发起次数上限，缺省为 4；管理端新增 `GET/PUT /admin/group-buy/settings`；管理后台新增“团购设置”页，可配置每个用户每月最多发起次数。
  - **验证**: `backend npx jest src/modules/group-buy/group-buy-checkout.service.spec.ts src/modules/admin/group-buy/admin-group-buy.service.spec.ts --runInBand`、`backend npm run build`、`admin npm run build` 通过。

- [x] **企业详情检测报告前台展示**（2026-06-25 新增并完成）
  - **来源**: 卖家中心已有“检验检测报告”资质文件上传，但 App 企业详情页检测报告卡片仍显示无来源的占位统计且“查看报告”未接真实文件。
  - **实际做了**: 后端公开企业详情返回已验证 `INSPECTION` 资质文件列表；买家 App 企业详情将“检测报告”改为报告列表，展示文件名称、签发机构、上传时间和“查看”入口；待验证/驳回报告不对买家公开，不再展示检测批次、合格率、最近检测等后台未维护字段。
  - **验证**: `backend npm test -- company.service.spec.ts --runInBand`、根目录 `npx tsc --noEmit`、`backend npm run build` 通过。

- [x] **团购补偿扫描、运费和进度口径修正**（2026-06-22 新增并完成）
  - **来源**: 团购代码复审发现售后期满后二次评估缺失、非包邮团购静默 0 运费、候选/有效计数混淆、App 进度固定 3 档、档位合计仍限制 100%。
  - **实际做了**: 新增团购售后期满补偿扫描；扫码落地页按 `GroupBuyReferral` 明细判断名额；候选订单转有效后回算待确认数量；非包邮团购结算接入平台运费规则并锁定运费快照；App 进度按后台档位数动态显示；后台档位合计允许超过 100%。
  - **验证**: `backend npx jest src/modules/group-buy/group-buy.service.spec.ts src/modules/group-buy/group-buy-checkout.service.spec.ts src/modules/group-buy/group-buy-rebate.service.spec.ts src/modules/group-buy/group-buy-lifecycle.service.spec.ts src/modules/group-buy/group-buy-concurrency.spec.ts src/modules/admin/group-buy/admin-group-buy.service.spec.ts --runInBand`、`npx jest src/utils/__tests__/groupBuyProgress.test.ts --runInBand` 通过。

- [x] **团购活动支持多商品组合**（2026-06-23 新增并完成）
  - **来源**: 用户要求团购活动可以像组合商品一样选择多个平台商品，返还金额仍按后台配置的团购活动价计算。
  - **实际做了**: 新增 `GroupBuyActivityItem` 活动组合明细表并回填旧活动；管理后台团购活动新建/编辑支持多商品 SKU + 数量组合，列表展示组合摘要；买家活动接口返回 `items/itemSummary/availableStock/totalWeightGram`；团购 checkout 按组合明细生成多行 `itemsSnapshot`，运费按组合总重量计算，商品行金额分摊后合计等于团购价；奖励商品引用保护同步检查组合明细，避免被使用的非首件商品被下架/删除。
  - **验证**: `backend npx jest src/modules/admin/group-buy/admin-group-buy.service.spec.ts src/modules/admin/reward-product/reward-product.service.spec.ts src/modules/group-buy/group-buy.service.spec.ts src/modules/group-buy/group-buy-checkout.service.spec.ts --runInBand`、`backend npx prisma validate && npx prisma generate`、`admin npx tsc --noEmit`、`npx tsc --noEmit` 通过。

- [x] **数字资产付款冻结与确认释放**（2026-06-21 新增并完成）
  - **来源**: 用户要求普通商品付款后立即在数字资产页看到消费资产记录，但处于冻结状态，并显示“确认收货后释放”；确认收货后再释放为正式消费资产。
  - **实际做了**: 后端新增 `frozenCreditAssetBalance` / `frozenCumulativeSpendAmount` 与冻结、释放、作废三类流水；普通商品支付成功建单后触发冻结消费资产，确认收货优先释放冻结资产，确认前退款/取消作废冻结资产，确认后退款继续扣回已释放资产；数字资产总额仍只统计种子资产 + 已释放消费资产；买家 App 数字资产页和资产流水页展示冻结资产、释放提示和冻结分类；管理后台总览、账户列表、详情、导出和流水来源同步冻结资产口径。
  - **验证**: `cd backend && npm test -- digital-asset-v2.service.spec.ts checkout-digital-asset.spec.ts --runInBand`、`cd backend && DATABASE_URL='postgresql://postgres:postgres@localhost:5432/nongmai?schema=public' npx prisma validate`、`cd backend && DATABASE_URL='postgresql://postgres:postgres@localhost:5432/nongmai?schema=public' npm run build`、`cd admin && npm run build` 通过；根目录目标文件 TypeScript 检查命中既有 `BonusRepo` / `LotteryRepo` / `useAuthStore` 类型问题，资产页自身无新增 TypeScript 报错。

- [x] **资产流水分类 Tab 与类型配色**（2026-06-19 新增并完成）
  - **来源**: 用户要求资产流水里加 Tab 切换不同种类，下面不同类使用不同颜色
  - **实际做了**: 买家 App `/me/consumption-records` 从“消费记录”统一改为“资产流水”，新增横向分类 Tab（全部 / 种子资产 / 消费资产 / 累计消费 / 扣回 / 调整），按选中类型过滤当前已加载流水；列表卡片左侧色条、图标底色、图标和金额按类型使用固定颜色
  - **验证**: `node --test scripts/__tests__/digital-assets-ui.test.mjs`、`npm run test:legal`、`npx tsc -b --noEmit --pretty false` 通过

- [x] **数字资产 App 页面视觉升级与规则隐藏**（2026-06-19 新增并完成）
  - **来源**: 用户确认 App 数字资产页选 C v2 农业科技感，保留种子资产/消费资产分项，但不展示怎么获得数字资产的规则，最近资产流水按类型使用不同颜色
  - **实际做了**: 买家 App `/me/digital-assets` 删除消费资产规则、VIP 种子资产规则、资产说明和所有前台倍率/档位/套餐规则展示；顶部改为农业科技感资产卡，保留数字资产总额、种子资产、消费资产、累计消费金额；最近资产流水改为按类型配色
  - **验证**: `node --test scripts/__tests__/digital-assets-ui.test.mjs`、`npm run test:legal`、`npx tsc -b --noEmit --pretty false`、production Android `expo export --platform android` 通过

- [x] **数字资产页移除长期模块占位**（2026-06-18 新增并完成）
  - **来源**: 用户确认长期/未来权益模块暂时不用，之后规则明确后再加
  - **实际做了**: 买家 App `/me/digital-assets` 删除“长期模块 / 未来权益模块 / 权益规则待开放”占位卡，只保留数字资产总额、种子资产、消费资产、累计消费金额、规则说明和最近消费记录；新增回归测试防止占位模块回归
  - **验证**: `node --test scripts/__tests__/digital-assets-ui.test.mjs` 通过

- [x] **卖家订单打印清单**（2026-06-18 新增并完成）
  - **来源**: 卖家中心订单详情点击打印后只打开面单/异常页面，卖家无法直接看包裹内有哪些货。
  - **实际做了**: 卖家订单详情“打印”改为“打印清单”，新打印页只展示订单号、买家匿名信息、地区、电子面单号、父订单商品、商品名旁 `x数量` 和右侧数量，不输出单价、小计、商品金额等卖家平台价格，不再附电子面单 iframe，避免第二页空白；打印清单整体改大字号，商品名称和数量加大加粗，普通商品不再显示“普通”标签；2026-06-23 起进一步移除商品行内“详情清单”、组合明细和第二页拣货汇总，避免组合商品上线后重复打印；后端打印代理按 Content-Type / PDF 文件头识别 PDF，避免签名下载链接被误当图片处理。

- [x] **卖家中心侧边菜单导航恢复**（2026-06-23 新增并完成）
  - **来源**: 测试版登录卖家中心后页面看起来变暗且侧边菜单点击无反应，需要确认正式版风险。
  - **实际做了**: 排查测试版 DOM 未发现 Ant Design modal/drawer mask 或前端报错；根因收敛为 SellerLayout 菜单项只绑定 `onClick`、没有真实 `href`，点击链路在当前构建中可被吞掉。菜单项已补 `href={item.path || '#'}`，保留未保存更改确认和 SPA `navigate`；正式版同源代码也同步修复。
  - **验证**: `node --test seller/test/waybillPrint.test.ts`、`seller npm run build`、`backend npm test -- seller-shipping.controller.spec.ts --runInBand`、`backend npm run build` 通过。

- [x] **我的页身份卡排版调整**（2026-06-15 新增并完成）
  - **来源**: 真机截图反馈，身份卡顶部“下午好...”问候语与昵称重复，用户编号需要显示 `ID:` 前缀
  - **实际做了**: 买家 App 我的页身份卡移除时段问候语；昵称作为主标题；买家编号展示为 `ID: AIMM...` 并保留复制按钮；推荐码入口下移为独立 chip；右侧“扫一扫/编辑”按钮固定宽度和间距
  - **验证**: `node --test scripts/__tests__/me-identity-card-layout.test.mjs` 通过

- [x] **我的页 VIP 权益文案调整**（2026-06-15 新增并完成）
  - **来源**: 真机截图反馈，我的页 VIP 卡片第三条权益不应直接写“免运费”
  - **实际做了**: 买家 App 我的页 VIP 卡片第三条权益从“免运费”改为“减免运费权益”；仅改展示文案，不改运费计算、会员权益规则或后台配置
  - **验证**: `node --test scripts/__tests__/me-vip-copy.test.mjs`、`npx tsc -b --noEmit --pretty false` 通过

- [x] 买家公开编号：App「我的」页展示并复制 `buyerNo`；管理后台用户相关页面显示/复制并支持按 AIMM 编号查询；卖家中心订单/售后列表与详情显示/复制 `buyerNo`，订单/售后/物流接口支持按用户编号筛选。

- [x] **数字资产累计消费底座**（2026-06-14 新增并完成）
  - **来源**: 用户要求先记录每个用户的累计消费，未来再基于规则设计数字资产、等级、股权/期权/工资/兑换等系统
  - **实际做了**: 新增独立 `DigitalAssetAccount`/`DigitalAssetLedger` 账户流水；确认收货入账、退款/售后成功扣回、历史 dry-run/execute 回填；买家 App 我的页新增“数字资产”入口和 `/me/digital-assets` 累计消费金额页面；管理后台新增数字资产管理页、导出、详情、超管调整和用户详情卡片；明确该体系独立于 Reward 消费积分、Coupon 平台红包和分润计数；审查修复无明细部分退款重复扣回风险
  - **验证**: `backend npx prisma validate`、数字资产/订单/售后/退款/回填/Admin API Jest 9 suites / 93 tests、`backend npm run build`、根目录 `npx tsc -b`、`admin npm run build` 通过

- [x] **数字资产 V2 规则落地与发版收口**（2026-06-17 新增并完成）
  - **来源**: `docs/superpowers/specs/2026-06-17-digital-asset-v2-rules-design.md` / Task 1-6
  - **实际做了**: 数字资产升级为“累计消费 + 种子资产 + 消费资产”三轨语义；买家端按普通/VIP 分流展示，新增消费记录页、最近 5 条记录卡和 VIP 激活引导；后台数字资产总览升级为总额/种子/消费/累计消费口径，支持消费资产倍率档位编辑、VIP 档位种子资产配置和仅对具体 subject 的超管审计调整；退款主链路已成功但数字资产扣回失败时落补偿表并定时幂等重试；法律文案、架构文档、安全检查和发布计划同步 V2 边界，明确数字资产不是现金/证券/可流通权益，未来收益/股权/折现规则待定
  - **验证**: `cd backend && DATABASE_URL='postgresql://placeholder:placeholder@127.0.0.1:5432/placeholder' npx prisma validate`、`cd backend && npx jest src/modules/digital-asset/digital-asset-credit-calculator.spec.ts src/modules/digital-asset/digital-asset-v2.service.spec.ts src/modules/digital-asset/digital-asset-v2-backfill.spec.ts src/modules/bonus/bonus.service.digital-asset-v2.spec.ts src/modules/order/order.service.digital-asset-v2.spec.ts src/modules/admin/digital-asset/admin-digital-asset.service.spec.ts src/modules/admin/digital-asset/admin-digital-asset-v2.service.spec.ts src/modules/admin/digital-asset/admin-digital-asset-v2.controller.spec.ts src/modules/admin/vip-package/vip-package.service.digital-asset.spec.ts --runInBand`、退款扣回失败补偿相关 `digital-asset-v2.service` / `after-sale-refund.service` / `payment.service.refund` Jest、`cd backend && npm run build`、`npx tsc -b`、`cd admin && npm run build`、数字资产旧口径/收益承诺关键字审计、法律审核稿重新导出

- [x] **管理后台抽奖“谢谢参与”次数统计修复**（2026-06-11 新增并完成）
  - **来源**: 管理后台抽奖管理中“谢谢参与”的“已中次数”显示为 0，但实际已有多次未中奖抽奖记录
  - **实际做了**: 后台奖品列表查询在当前页包含 `NO_PRIZE` 行时，从 `LotteryRecord.result=NO_PRIZE` 聚合未中奖记录数并覆盖该行展示用 `wonCount`；统计页“奖品消耗情况”的 `NO_PRIZE` 今日/累计也改走未中奖记录聚合；真实奖品仍使用 `LotteryPrize.wonCount`，不影响限量和并发发奖逻辑
  - **验证**: `npm test -- admin-lottery.service.spec.ts --runInBand`、`npm run build`（backend）、`npx tsc -b --noEmit` 通过

- [x] **抽奖转盘奖品名完整展示与实例配色**（2026-06-11 新增并完成）
  - **来源**: 真机检查发现抽奖转盘奖品信息显示不完整，且扇区背景色按奖品类型固定导致同类奖品难区分
  - **实际做了**: `SpinWheel` 奖品名从固定 5 字截断改为按字符数分行完整展示；扇区背景色改为按奖品 `type + id + index` 从高对比调色板稳定分配；展开的奖品列表取消单行截断
  - **验证**: `node --test scripts/__tests__/spin-wheel-display.test.mjs`、`npm run test:legal`、`npx tsc -b --noEmit`、`git diff --check` 通过

- [x] **vivo 审核：设置页移除未上线帮助客服入口**（2026-06-11 新增并完成）
  - **来源**: vivo 审核指出设置页「帮助与客服」区域出现主要功能未实现/功能未完善风险
  - **实际做了**: 买家 App 设置页移除「帮助与客服」「在线客服」「帮助与反馈」占位卡片，仅保留已可用的账号、通知、隐私合规和关于入口；同步移除隐私政策中已不可用的「我的 > 设置 > 在线客服」联系方式路径，并重新生成华海站法律页与 Word 审核稿；新增合规回归测试防止这些占位入口和失效路径回归
  - **验证**: `node --test --test-name-pattern "settings screen does not expose unfinished help" scripts/__tests__/legal-compliance.test.mjs`、`npm run test:legal`、`npx tsc -b --noEmit` 通过

- [x] **售后申请页拍照入口与详情白屏兜底**（2026-06-02 新增并完成）
  - **来源**: 真机测试发现申请售后上传凭证只能选相册、提交后偶发白屏但后台已创建售后
  - **实际做了**: 上传凭证入口改为拍照/相册二选一；拍照独立申请相机权限，相册保留华为权限说明；提交增加同步防重复保护，成功后直达售后详情；售后详情页对金额、图片和物流轨迹做渲染前归一化，并增加路由级 ErrorBoundary 避免异常数据白屏
  - **验证**: `npm test -- afterSaleDetailSafety.test.ts --runInBand`、`npx tsc --noEmit --pretty false` 通过

- [x] **发票链路收口**（2026-05-15 新增并完成）
  - **来源**: `docs/superpowers/specs/2026-05-15-invoice-chain-closure-design.md` / `docs/superpowers/plans/2026-05-15-invoice-chain-closure.md`
  - **实际做了**: Schema 增加 Provider 字段、开票内容快照、状态历史；买家申请/取消/重申请使用 Serializable + CAS；管理后台新增发票设置、Mock 自动开票、人工 PDF 上传/URL 开票；买家 App 订单详情展示发票状态并可打开 PDF；卖家端仅暴露 `invoiceStatus`
  - **2026-05-15 审查收口**: Provider 开票中记录禁止管理端人工开票/标记失败；人工 PDF URL 增加平台上传/OSS 白名单；管理端增加受保护窗口限制的“重置开票任务”入口；`invoices:read` 详情脱敏、完整开票资料仅 `invoices:issue` / 超管可见；`CLAUDE.md` 补登记发票 spec/plan
  - **验证**: `prisma validate`、后端相关 Jest、后端 build、管理后台 build、卖家后台 build 通过；App 根 `tsc` 仍被既有 `tests/e2e` Playwright/Node 类型缺失阻塞，但无新增发票/订单类型错误

- [x] **发票自动开票**（2026-05-15 新增并完成）
  - **来源**: `docs/superpowers/plans/2026-05-15-invoice-auto-issue.md`
  - **实际做了**: Invoice 加 `failedAttempts`/`lastAutoIssueAttemptAt`；新增 `INVOICE_AUTO_ISSUE` 开关 + `INVOICE_AUTO_ISSUE_MAX_ATTEMPTS`（默认 3）；`AdminInvoicesService.issueInvoice` 支持 `adminId: null` 走 SYSTEM 路径；新增 `markAutoIssueAttemptFailure`（软失败不降级）+ `markAutoIssueRetryExhausted`（重试耗尽强翻 FAILED）；买家 `requestInvoice` 末尾 fire-and-forget 触发；新增 `InvoiceAutoIssueRetryService` @Cron(EVERY_10_MINUTES)；管理后台设置页加开关 + 列表/详情显示失败次数；买家 App 文案改为"系统正在自动开票，预计 10 分钟内出票"
  - **验证**: prisma validate / 后端 Jest（admin invoices 13 个 / invoice service 9 个 / auto issue retry 6 个）/ 后端 build / admin build / App TS（仅既有 e2e 阻塞）通过

- [x] **VIP 礼包订单金额显示修复**（2026-05-18 新增并完成）
  - **来源**: 真机测试发现 399 VIP 礼包订单显示为赠品成本价合计
  - **实际做了**: 支付回调建 VIP_PACKAGE 订单时以 CheckoutSession 礼包实付金额写入 `Order.totalAmount/goodsAmount`，新增历史订单金额修复迁移；买家 App 订单列表/详情赠品行显示“赠品”而非 SKU 单价
  - **验证**: VIP 金额回归 Jest、订单运费锁价 Jest、`prisma validate`、后端 build、订单相关 App 文件定向 TS 检查通过；根目录 App TS 检查仍被既有 `tests/e2e` Node/Playwright 类型缺失阻塞

---

## 📖 审查基线（2026-04-11）

- **审查报告**: [docs/superpowers/reports/2026-04-11-launch-readiness-audit-report.md](docs/superpowers/reports/2026-04-11-launch-readiness-audit-report.md)（1660 行，17 条链路 + 6 项横切关注点）
- **审查方案**: [docs/superpowers/specs/2026-04-11-launch-readiness-audit.md](docs/superpowers/specs/2026-04-11-launch-readiness-audit.md)
- **执行计划**: [docs/superpowers/plans/2026-04-11-launch-readiness-audit.md](docs/superpowers/plans/2026-04-11-launch-readiness-audit.md)
- **链路 draft 目录**: `docs/superpowers/reports/2026-04-11-drafts/`（18 个 draft 文件，按 L01-L17 + X1-X6 编号）
- **累计**: 🔴 14 CRITICAL + 🟡 16 HIGH = **30 个 Tier 1 必修项** + 48 个 Tier 2 待补项

---

## 📐 维护规则（铁律）

1. **每次修完一项**: 立即把对应 `- [ ]` 改为 `- [x]`，填写完成日期，简述实际做了什么（一句话）
2. **每次新增需求**: 在对应批次末尾追加新条目，格式与现有一致，标注 `（YYYY-MM-DD 新增：原因）`
3. **如果新需求改变了批次依赖或顺序**: 整个批次重新校验，更新依赖关系
4. **不在 plan.md 外面单独维护另一份清单**: plan.md 是单一 source of truth
5. **每个批次完成后**: 在批次标题后加 ✅ + 完成日期
6. **修改代码前必须查阅 draft 细节**: plan.md 条目仅为简要摘要，实际修改代码时**必须先打开 `docs/superpowers/reports/2026-04-11-drafts/` 中对应的 draft 文件**，阅读完整的问题描述、代码位置、修复建议后再动手，严禁仅凭 plan.md 的一句话描述就改代码

---

## 🚀 实施路线图

### 第零批：立即启动的线下事项（并行进行，不等代码）

> 这些是用户线下操作，和代码修复完全并行。**ICP 备案 20 个工作日是整个项目的最长阻塞路径**。

- [x] **U01** — 启动域名 ICP 备案
  - **做什么**: ai-maimai.com 的 ICP 备案申请（阿里云备案系统）
  - **现状**: 爱买买.com 已备案完成；ai-maimai.com 备案已通过，主域名正式迁移至英文 ai-maimai.com（中文域名保留做 301 跳转）
  - **周期**: 20 个工作日
  - **交付物**: ai-maimai.com 备案号
  - **状态**: ✅ | 完成日期: 2026-04-17

- [x] **U02** — 申请顺丰月结账号 + 丰桥 API 权限
  - **做什么**: 联系顺丰销售 → 签月结协议 → 拿到 12 位月结号 → 注册丰桥企业认证 → 创建应用 → 审批 5 个 API（下单/查询/推送/取消/面单）
  - **周期**: 3-7 天（月结）+ 1-3 天（丰桥认证）+ 1-3 天（API 审批）
  - **交付物**: 月结号 + clientCode + checkWord + 沙箱 URL
  - **成本**: 5k-20k 元保证金（可退）
  - **状态**: ✅ | 完成日期: 2026-04-11 — 月结卡号 7551253482、丰桥应用已创建、10 个 API 已关联、云打印面单已配置

- [x] **U03** — 核对阿里云 OSS / SMS AccessKey
  - **做什么**: 确认 RAM 子账号 + AccessKey 已创建，OSS Bucket 已建，SMS 签名"爱买买" + 3 个模板（注册/订单/商户审核）已审核通过
  - **交付物**: AK/SK + Bucket 名 + 签名/模板 ID
  - **实际做了**: 阿里云 OSS 和短信服务已开通，详见 `交付包/第三方服务开通指南（操作手册）.md`
  - **状态**: ✅ | 完成日期: 2026-04-13

- [x] **U04** — 核对支付宝商户号 + 证书
  - **做什么**: 确认 APPID + RSA2 证书四件套（app-private / appCert / alipayCert / alipayRoot）已下载，回调地址配置
  - **周期**: 3-5 天（如尚未申请）
  - **状态**: ✅ | 完成日期: 2026-04-13

- [x] **U05** — 购买云服务器
  - **做什么**: 阿里云 ECS 华东杭州 4 核 8G 100GB SSD
  - **成本**: 350-500 元/月
  - **状态**: ✅ | 完成日期: 2026-04-13

- [ ] **U06** — Apple 开发者账号 + 安卓应用商店账号
  - **做什么**: Apple Developer Program ($99/年) + 华为/小米/OPPO/vivo/应用宝（各需企业资质）
  - **状态**: ⬜ | 完成日期: —

---

### 第一批：💰 钱链路修复（14 项 CRITICAL）

> **最高优先级**。支付/退款/分润/奖励——关于钱的链路必须先修。
> **串行依赖**: C01 必须先做（阻塞 C02/C04/C06）。其余大部分可并行。

- [x] **C01** — 支付宝退款 API 真实接通
  - **修改**: `backend/src/modules/payment/payment.service.ts` + `payment.module.ts`
  - **做什么**: PaymentService 构造函数注入 AlipayService → initiateRefund() 按 `payment.channel === 'ALIPAY'` 分发到 `alipayService.refund()` → 微信分支 throw NotImplemented
  - **实际做了**: PaymentService 注入 AlipayService，initiateRefund 按 channel 分发到真实退款 API，微信分支 throw NotImplementedException
  - **状态**: ✅ | 完成日期: 2026-04-13

- [x] **C02** — Order 状态闭环（全退后标 REFUNDED）
  - **修改**: `after-sale-reward.service.ts` + 3 个退款完成点（admin/seller/timeout）
  - **做什么**: 退款成功后检查所有非奖品项(isPrize=false)是否都已退 → 是则 Order.status = REFUNDED
  - **实际做了**: 在 AfterSaleRewardService 新增 checkAndMarkOrderRefunded()，在 admin/seller/timeout 三处退款成功后调用
  - **状态**: ✅ | 完成日期: 2026-04-13

- [x] **C03** — `VIP_PLATFORM_SPLIT` 枚举补齐
  - **修改**: `backend/prisma/schema.prisma` AllocationRuleType 枚举
  - **实际做了**: 补 `VIP_PLATFORM_SPLIT`。确认 `NORMAL_TREE_PLATFORM` 代码中无使用，无需添加。prisma validate 通过
  - **状态**: ✅ | 完成日期: 2026-04-13

- [x] **C04** — 售后退款 Cron 前缀修复
  - **修改**: `backend/src/modules/payment/payment.service.ts`
  - **实际做了**: retryStaleAutoRefunds Cron 用 OR 条件同时扫 AUTO-（需 CANCELED 订单）和 AS-（含 AS-TIMEOUT-）前缀
  - **状态**: ✅ | 完成日期: 2026-04-13

- [x] **C05** — App 退货物流字段名修复
  - **修改**: `src/repos/AfterSaleRepo.ts` + `app/orders/after-sale-detail/[id].tsx`
  - **实际做了**: DTO 字段改为 returnCarrierName/returnWaybillNo，调用方映射修改
  - **状态**: ✅ | 完成日期: 2026-04-13

- [x] **C06** — 退款 setImmediate 补持久化重试
  - **修改**: `after-sale-timeout.service.ts`
  - **实际做了**: 新增 retryStaleRefundingRequests Cron（每 10 分钟），扫 REFUNDING > 10min 的售后申请，重新触发退款+奖励归平台+全退检查
  - **状态**: ✅ | 完成日期: 2026-04-13

- [x] **C07** — 分润 rollbackForOrder TOCTOU 修复
  - **修改**: `backend/src/modules/bonus/engine/bonus-allocation.service.ts`
  - **实际做了**: 将 findMany(allocations) 从事务外移入 $transaction 内部，消除 TOCTOU 竞态
  - **状态**: ✅ | 完成日期: 2026-04-13

- [x] **C08** — rollback 事务 timeout
  - **修改**: `bonus-allocation.service.ts`
  - **实际做了**: rollback 事务加 timeout: 30000, maxWait: 5000。exitedAt 回退不做（用户确认出局不可逆）
  - **状态**: ✅ | 完成日期: 2026-04-13

- [x] **C09** — WITHDRAWN ledger 防御性断言
  - **修改**: `bonus-allocation.service.ts`
  - **实际做了**: WITHDRAWN 场景从 warn 改为 throw InternalServerErrorException（业务上退款时不应出现已提现流水，出现即系统异常）。用户确认：退款 7 天内，奖励 7 天后才可提现，不存在追缴场景
  - **状态**: ✅ | 完成日期: 2026-04-13

- [x] **C10** — R12 超卖卖家补货通知
  - **修改**: `backend/src/modules/order/checkout.service.ts`
  - **实际做了**: stock < 0 时查 companyStaff OWNER，通过 InboxService.send 发送 stock_shortage 通知
  - **状态**: ✅ | 完成日期: 2026-04-13

- [x] **C11** — AlipayService 证书加载失败 production 抛出
  - **修改**: `backend/src/modules/payment/alipay.service.ts`
  - **实际做了**: catch 块中 production 环境 throw err 阻止启动
  - **状态**: ✅ | 完成日期: 2026-04-13

- [x] **C12** — InboxService 钱相关 9 个事件接入
  - **修改**: 6 个 module 文件 + 8 个 service 文件 + 前端 Inbox.ts + inbox/index.tsx
  - **实际做了**: 9 个钱相关事件全部接入 InboxService.send()（reward_credited/reward_unfrozen/reward_expired/withdraw_approved/withdraw_rejected/vip_referral_bonus/refund_credited/coupon_granted/coupon_expired）。前端 InboxType 枚举扩展 12 个新类型 + iconMap 补齐
  - **状态**: ✅ | 完成日期: 2026-04-13

- [x] **C13** — InboxService 改硬依赖
  - **修改**: `backend/src/modules/order/order.module.ts`
  - **实际做了**: OrderModule.onModuleInit 中 InboxService 注入失败时 throw Error 阻止启动
  - **状态**: ✅ | 完成日期: 2026-04-13

- [x] **C14** — 红包退款语义澄清 ✅ 已解决
  - **用户决策（2026-04-13 Q1）**: 红包不退回。退款金额按比例计算——如果订单用了红包，退款只退实付金额（按比例扣除红包抵扣部分），不退原价。当前代码与 refund.md 一致，**不需要改代码**
  - **状态**: ✅ | 完成日期: 2026-04-13

- [x] **C14a** — 冻结奖励过期 Cron + 树递归查询 PG18 兼容性修复（2026-04-19 新增）
  - **修改**:
    - `backend/src/modules/bonus/engine/freeze-expire.service.ts:64` — MAKE_INTERVAL 的 days 参数
    - `backend/src/modules/bonus/engine/vip-upstream.service.ts:221,225` — VIP 树递归 CTE 的 depth 比较
    - `backend/src/modules/bonus/engine/normal-upstream.service.ts:219,223` — 普通树递归 CTE 的 depth 比较
  - **背景**: Staging 迁 Alibaba Cloud Linux 3 + PostgreSQL 18 后，每日 00:00 freezeExpire cron 崩（PM2 error log 暴露）。根因：Prisma 默认把 JS number 映射为 bigint，PG18 函数签名匹配更严格（PG14 宽松隐式转换），报 `function make_interval(days => bigint) does not exist`
  - **影响**: 无 `meta.expiresAt` 的旧冻结奖励无法按 `createdAt + maxFreezeDays` 规则过期解冻/转平台。查询 1（有 expiresAt）不受影响。树递归 CTE 的 depth 比较属运算符场景（operator 比函数签名宽松，实际在 PG18 仍能跑），但为一致性 + 防御性同步加 cast
  - **实际做了**: 3 个文件共 5 处 `${param}::int` 显式 cast；加中文注释说明 PG18 行为变化。审查 Agent 发现同 pattern 的扩展修复（vip-upstream + normal-upstream）
  - **验收**: 后端 tsc 通过；PM2 reload 后 00:00 cron 不再报 `make_interval bigint` 错误（下次凌晨验证）
  - **状态**: ✅ | 完成日期: 2026-04-19

- [x] **C14b** — 消费积分双轨：支付宝提现 + 普通商品抵扣（2026-05-19 新增）
  - **修改**: `backend/prisma/schema.prisma`、`backend/src/modules/bonus/*withdraw*`、`backend/src/modules/bonus/reward-deduction.service.ts`、`backend/src/modules/order/checkout.service.ts`、`backend/src/modules/payment/alipay.service.ts`、`backend/src/modules/payment/payment.controller.ts`、`app/me/wallet.tsx`、`app/me/withdraw.tsx`、`app/checkout.tsx`、`admin/src/pages/bonus/*`
  - **做什么**: 将 Reward 余额对外命名为"消费积分"，同一余额池支持实时提现到支付宝和普通商品结算抵扣；提现按后台规则代扣个税，抵扣按普通 10% / VIP 15% 比例上限；平台红包可叠加，VIP 礼包不可抵扣
  - **实际做了**: 新增提现规则、提现出款、消费积分抵扣服务；支付宝商家转账、transfer notify 和 PROCESSING 查询补偿；结算支付成功确认抵扣、取消/过期/支付失败释放抵扣、售后退款按比例恢复抵扣；管理后台增加提现规则与税务报送；买家 App 钱包、提现、结算接入真实接口
  - **权威文档**: `docs/superpowers/specs/2026-05-19-reward-dual-track-design.md` / `docs/superpowers/plans/2026-05-19-reward-dual-track.md`
  - **状态**: ✅ | 完成日期: 2026-05-20

**第一批完成判定**:
- [x] 支付宝真实退款到账（代码已接通，小额测试需上线后验证）
- [x] Order 状态机闭环（全退 → REFUNDED）
- [x] VIP 分润全链路不崩（VIP_PLATFORM_SPLIT 枚举已补齐，prisma validate 通过）
- [x] rollback 并发无 frozen 漂移（findMany 移入事务内 + timeout 30s）
- [x] 钱相关 9 项 Inbox 事件接入
- [x] 前后端 InboxType 同步（12 个新类型 + iconMap）

---

### 第二批：非钱链路 T1 修复（16 项）

> 大部分可并行。C24 + C25 是第三批（顺丰迁移）的硬前置。

- [x] **C15** — `/admin/replacements` 整条链路 404 清理
  - **修改**: `admin/src/pages/dashboard/` + `admin/src/pages/replacements/` + `admin/src/api/replacements.ts` + `admin/src/App.tsx` 路由 + 菜单 + PERMISSIONS
  - **实际做了**: 删除 replacements 目录/API/路由/菜单/权限常量；Dashboard 去掉换货待处理卡片；audit getTargetUrl 移除 replacement 映射
  - **状态**: ✅ | 完成日期: 2026-04-13

- [x] **C16** — 前端 PERMISSIONS 补 `dashboard:read`
  - **修改**: `admin/src/constants/permissions.ts` + `admin/src/layouts/AdminLayout.tsx`
  - **实际做了**: 新增 `DASHBOARD_READ: 'dashboard:read'` 常量；工作台菜单项加 permission 字段
  - **状态**: ✅ | 完成日期: 2026-04-13

- [x] **C17** — 卖家端补账号密码登录
  - **修改**: Schema CompanyStaff.passwordHash + seller-auth.* + seller-company.* (邀请员工时设密码) + seller 登录页
  - **实际做了**: Schema 加 passwordHash（nullable）；seed cs-001..010 用 bcrypt('seller123')；新增 `SellerPasswordLoginDto` + `loginByPassword`（跨公司 bcrypt 匹配）+ `POST /seller/auth/login-by-password`；`InviteStaffDto` 加 optional password 字段（OWNER创建员工时可设密码）；前端 Tabs 加"密码登录"页
  - **状态**: ✅ | 完成日期: 2026-04-13

- [x] **C18** — 管理端补图形验证码 + 手机号登录
  - **修改**: Schema AdminUser.phone + admin-auth.* + admin-login.dto.ts + admin 登录页
  - **实际做了**: Schema 加 phone（nullable unique）；seed 超管 phone='13900000000'；`GET /admin/auth/captcha` 生成 SVG 验证码；`AdminLoginDto` 加 captchaId/Code，登录前必须验证；新增 `POST /admin/auth/sms/code` 和 `POST /admin/auth/login-by-phone-code`（复用 SmsOtp + CAS 消费 + 防枚举）；前端 Tabs（账号登录 + 手机登录），captcha SVG 点击刷新
  - **状态**: ✅ | 完成日期: 2026-04-13

- [x] **C19** — 卖家商品权限漏洞修复
  - **修改**: `backend/src/modules/seller/products/seller-products.controller.ts`
  - **实际做了**: 4 个写操作端点（create/update/status/skus）加 `@SellerRoles('OWNER', 'MANAGER')`；读操作保持不限制
  - **状态**: ✅ | 完成日期: 2026-04-13

- [x] **C20** — 审核通过自动上架
  - **修改**: `backend/src/modules/admin/products/admin-products.service.ts:223`
  - **用户决策**: 方案 A
  - **实际做了**: audit() 当 auditStatus='APPROVED' 时同步设置 status='ACTIVE'；REJECTED 不改 status
  - **状态**: ✅ | 完成日期: 2026-04-13

- [x] **C21** — 管理端商品 SKU 编辑入口
  - **修改**: admin-products.service/controller + 新增 update-sku.dto.ts + admin/src/api/products.ts + admin/src/pages/products/edit.tsx
  - **实际做了**: 新增 `UpdateProductSkusDto`（支持 id/specText/price/cost/stock 等）；`updateSkus()` 用 Serializable + UPSERT（不删未列出的 SKU）；`PUT /admin/products/:id/skus` 端点加 products:update 权限 + AuditLog；前端 edit.tsx 用 Form.List 可编辑 SKU + "保存规格"按钮
  - **注意**: Schema ProductSKU 无 unit/imageUrl 字段，DTO 接受但不持久化，需要时加 migration
  - **状态**: ✅ | 完成日期: 2026-04-13

- [x] **C22** — 客服 5 个硬编码超时改回生产值
  - **修改**: `cs.service.ts:26` + `cs-cleanup.service.ts:23-34`
  - **实际做了**: SESSION_IDLE=7200000(2h) / AI_IDLE=7200000(2h) / QUEUING=1800000(30m) / AGENT_IDLE=3600000(60m) / Cron=EVERY_10_MINUTES；删除测试 TODO 注释
  - **状态**: ✅ | 完成日期: 2026-04-13

- [x] **C23** — parseChatResponse 补数组包裹解包
  - **修改**: `backend/src/modules/ai/ai.service.ts`
  - **实际做了**: `qwenIntentClassify`(~3246) 和 `callSemanticModel`(~3390) 加 Array.isArray 解包；parseChatResponse 原本已有 Array.isArray 对 suggestedActions/followUpQuestions 的校验
  - **状态**: ✅ | 完成日期: 2026-04-13

- [x] **C24** — addressSnapshot 字段名错位修复（⚠️ 第三批前置）
  - **修改**: `backend/src/modules/seller/shipping/seller-shipping.service.ts:52-78`
  - **做什么**: `parseAddressSnapshot` 改为读 `recipientName` + `regionText` + `detail`（与 checkout.service.ts:363 写入一致）；补真实单测
  - **验收**: 面单收件人/地址不再为空
  - **预估**: 0.25 天
  - **状态**: ✅ | 完成日期: 2026-04-12 — parseAddressSnapshot 兼容 recipientName/receiverName/name 三种字段名，新增 regionText 解析为省市区

- [x] **C25** — Company.address 结构化改造（⚠️ 第三批前置）
  - **修改**: `backend/prisma/schema.prisma` Company.address + 卖家后台企业信息页 + 管理后台商户页 + 数据迁移脚本
  - **做什么**: 扩展为 `{province, city, district, detail, lng?, lat?, text?}`；卖家后台拆分省市区 Cascader；数据迁移 best-effort 解析现有文本
  - **验收**: 卖家发货地址结构化可传入顺丰丰桥
  - **预估**: 0.5 天
  - **状态**: ✅ | 完成日期: 2026-04-12 — DTO 结构化 + 卖家/管理前端省市区输入 + generateWaybill 前置校验

- [x] **C26** — `.env.example` 补齐 5 个关键密钥占位
  - **修改**: `backend/.env.example`
  - **实际做了**: 5 个变量（ADMIN_JWT_SECRET / SELLER_JWT_SECRET / PAYMENT_WEBHOOK_SECRET / LOGISTICS_WEBHOOK_SECRET / WEBHOOK_IP_WHITELIST）补齐，带中文注释说明用途
  - **状态**: ✅ | 完成日期: 2026-04-13

- [x] **C27** — `handleAlipayNotify` 补 WebhookIpGuard
  - **修改**: `backend/src/modules/payment/payment.controller.ts:52`
  - **实际做了**: `handleAlipayNotify` 加 `@UseGuards(WebhookIpGuard)`；生产环境需在 WEBHOOK_IP_WHITELIST 配置支付宝公网 IP 段
  - **状态**: ✅ | 完成日期: 2026-04-13

- [x] **C28** — 前后端 InboxType 枚举同步
  - **修改**: `src/types/domain/Inbox.ts` + `app/inbox/index.tsx`
  - **实际做了**: C12 已同步完成——InboxType 已覆盖 20 个类型（含钱相关 9 种 + 新订单/补货/VIP激活等），iconMap 全部补齐，无需额外改动
  - **状态**: ✅ | 完成日期: 2026-04-13（C12 顺带完成）

- [x] **C29** — 删除 legacy purchaseVip() 方法
  - **修改**: `backend/src/modules/bonus/bonus.service.ts:132-215`
  - **实际做了**: 确认仓库内无其他调用者后，删除整个 84 行的 purchaseVip() 方法；控制器端点已 throw GoneException
  - **状态**: ✅ | 完成日期: 2026-04-13

- [x] **C30** — 旧 Refund 链路下线策略
  - **用户决策**: 方案 B（开发阶段无真实数据，直接全删）
  - **修改**: 后端 admin/refunds + seller/refunds 整个模块删；admin/seller 前端 refunds 页/API/路由/菜单删；admin.module.ts 和 seller.module.ts 移除导入；Dashboard 用"待处理售后"(/after-sale) 替代；权限常量 ORDERS_REFUND 删除
  - **实际做了**: 见 C15+C30 合并 Agent 报告，三端 tsc 全绿
  - **状态**: ✅ | 完成日期: 2026-04-13

- [x] **C31a** — VIP 树 BFS 无底修复（2026-04-13 Q7 新增）
  - **修改**: `backend/src/modules/bonus/engine/constants.ts` + `bonus.service.ts`（assignVipTreeNode + bfsInSubtree）
  - **实际做了**: (a) MAX_BFS_ITERATIONS 10000→100000000；(b) bfsInSubtree 去掉 MAX_TREE_DEPTH 限制；(c) 有邀请人时 BFS 返回 null 直接 throw InternalServerErrorException（不再降级到系统节点）；(d) 无邀请人情况（标准 VIP 购买无推荐人）保留 A1-A20 分配路径；MAX_TREE_DEPTH 常量保留用于其他分润遍历逻辑
  - **状态**: ✅ | 完成日期: 2026-04-13

- [x] **C31b** — 假 AI 数据下线（2026-04-13 Q4 新增）
  - **用户决策**: 只删商品详情页 2 处假数据；搜索摘要是动态拼接的真实内容，保留
  - **修改**: `app/product/[id].tsx`
  - **实际做了**: 删除 getAiScore 函数 + AI 品质评分卡片（原 85-98 哈希伪造）+ 企业"AI 信赖分 96"硬编码块；清理未用的 AiCardGlow 导入和相关样式
  - **状态**: ✅ | 完成日期: 2026-04-13

**第二批完成判定** ✅ 2026-04-13:
- [x] 管理后台首页无 404（C15 旧 replacements 全删）
- [x] 非超管可登录首页（C16 DASHBOARD_READ 已补）
- [x] OPERATOR 无法创建商品（C19 @SellerRoles 已加）
- [x] 客服会话超时正常（C22 5 个值全改生产）
- [x] .env.example 密钥齐全（C26）
- [x] C24 + C25（L8 硬前置）完成（第三批已完成）
- [x] 假 AI 下线（C31b 商品详情页 2 处）
- [x] VIP 树 BFS 无底修复（C31a）
- [x] 管理员 captcha + 手机登录（C18）
- [x] 卖家密码登录（C17）
- [x] 商品审核通过自动上架（C20）
- [x] 管理端 SKU 编辑入口（C21）
- [x] 旧 Refund 链路全删（C30）

---

### 第三批：顺丰丰桥直连迁移（L8） ✅ 2026-04-12

> 依赖: 第二批 C24/C25 完成 + U02 顺丰月结账号拿到。
> 详细实施计划: [docs/superpowers/plans/2026-04-12-sf-express-migration.md](docs/superpowers/plans/2026-04-12-sf-express-migration.md)
> 历史参考: [L08 draft](docs/superpowers/reports/2026-04-11-drafts/L08-sf-migration.md)

- [x] **C31** — 阶段 0 前置修复（C24 addressSnapshot + C25 Company.address）
  - 状态: ✅ 2026-04-12 — 含 rawBody 配置 + Schema 字段重命名 kuaidi100TaskId→sfOrderId

- [x] **C32** — 阶段 1 用户线下申请（月结 + 丰桥认证 + API 审批 + 云打印面单权限）
  - 状态: ✅ 2026-04-11 — clientCode=HHNYKCL5OWXM, 10 个 API 已关联, 云打印面单已配置(同步+丰巢150模板)

- [x] **C33** — 阶段 2 SfExpressService 开发（骨架/签名/createOrder/printWaybill/cancelOrder/queryRoute/parsePushCallback + ≥12 条单测）
  - **修改**: 新建 `backend/src/modules/shipment/sf-express.service.ts` + `sf-express.service.spec.ts`
  - 状态: ✅ 2026-04-12 — 28 个单元测试全通过，含签名算法/下单/取消/查询/推送解析/面单打印/签名验证

- [x] **C34** — 阶段 3 改造上游（SellerShippingService + ShipmentService/Controller + Module + env/doc + 测试对齐）
  - 状态: ✅ 2026-04-12 — 全部切换完成 + 站内通知(发货/签收/异常) + 物流异常监控 cron + 卖家前端隐藏快递选择 + 商家新订单通知

- [x] **C35** — 阶段 4 沙箱联调（发单/查询/推送/取消/云打印审核 6 项 smoke test）
  - 状态: ⏳ 待域名备案完成后联调（代码已就绪，凭证已配置）

- [x] **C36** — 阶段 5 生产切换 + 清理（生产凭证 + smoke test + 删 4 个 kuaidi100 文件 + 文档更新）
  - 状态: ✅ 2026-04-12 — 4 个 kuaidi100 文件已删除 + 371 个测试全通过 + Kuaidi100 零引用 + docs/CLAUDE.md 已更新

**第三批完成判定**:
- [x] `grep Kuaidi100` 零匹配（旧文件已删）— ✅ 2026-04-12
- [x] TypeScript 零错误 + 371 测试全通过 — ✅ 2026-04-12
- [x] **沙箱全通过** — ✅ 2026-05-05（6/22 核心 API 协议级实证 + 真实 waybillNo SF7444703612423）
- [x] **真机端到端 staging 验收** — ✅ 2026-05-06（详见 `docs/issues/app-tofix3.md` § 2026-05-06 真机端到端 staging 验收）
  - PAID → SHIPPED → DELIVERED → RECEIVED 完整状态机
  - WaybillRoute + OrderState 双格式推送解析
  - URL secret token 鉴权（`/sf/callback/:token`）
  - 普通树插入算法重写（容忍位置空隙，修 P2002）
  - VIP_PLATFORM_SPLIT enum migration 补齐
  - 6 笔死信订单全部自动 heal
- [ ] 生产 3-5 单真实发货 OK — ⏳ 待推 main + 切 SF_ENV=PROD + 申请生产月结
- [ ] 稳定 7 天无 incident — ⏳ 待生产上线

---

### 第四批：部署上线准备（L13）

> 依赖: 第一批/第二批代码修复完成 + U01 ICP 备案通过 + U05 服务器到位。
> 详细 11 步见 [L13 draft](docs/superpowers/reports/2026-04-11-drafts/L13-deployment.md)。
> **2026-04-18 重大变更**: 服务器 OS 由 CentOS 7 换为 Alibaba Cloud Linux 3（glibc 2.32+），抛弃 Docker 方案改用 Node 直装 + PM2，详见 `docs/operations/阿里云部署.md` §7。

- [x] **C37** — 云服务器环境安装（Node/PG/Redis/Nginx/PM2/Certbot）
  - 实际做了: Alibaba Cloud Linux 3 + 宝塔面板 + Nginx 1.26 + PostgreSQL 18 + Redis 7 + Node 20.20.2 + PM2 6.0.14（NodeSource 直装，无 Docker）
  - 状态: ✅ | 完成日期: 2026-04-18

- [x] **C38** — 域名 DNS 配置（ai-maimai.com + www/api/admin/seller/app 子域，爱买买.com 保留做 301 跳转）
  - 实际做了: 8 个站点全部配置完成（生产 4 个 + 测试 4 个：test-website/test-admin/test-seller/test-api.ai-maimai.com）
  - 状态: ✅ | 完成日期: 2026-04-18

- [x] **C39** — SSL 证书签发（certbot 自动续期）
  - 实际做了: 8 个 Let's Encrypt 证书全部签发完成（宝塔文件验证），强制 HTTPS 已开启
  - 状态: ✅ | 完成日期: 2026-04-18

- [ ] **C40** — 部署后端（生产 .env + 支付宝证书 + prisma migrate + seed + PM2 + 日志轮转）
  - 测试环境 ✅: `aimaimai-api-test` PM2 进程在线（端口 3001），数据库 `testaimaimai`，env 配置完成，prisma migrate deploy 完成
  - 生产环境 ❌: `aimaimai-api-prod` 未启动（api.ai-maimai.com 当前 502），生产数据库 `aimaimai` 已建库但未初始化，待 staging 测试通过后部署
  - 状态: 🟡 部分完成 | 测试日期: 2026-04-18
  - ⚠️ **部署生产 backend 后必做**（2026-04-22 过渡方案收尾）:
    - [ ] 合并 `staging` → `main`（把 1818 行 backend 改动一次性上）
    - [ ] 服务器上首次 `pm2 start aimaimai-api-prod` + `pm2 save`（按 `docs/operations/阿里云部署.md` Step 9）
    - [ ] 还原 `.github/workflows/deploy-website.yml` 里 `VITE_API_BASE_URL` 的硬编码，改回 `${{ needs.detect-changes.outputs.api_base }}`（文件顶部有 TODO 注释指示）
    - [ ] Actions → Run workflow → `main` + `deploy_target: website` 手动触发一次 website 重建
    - [ ] 改支付宝 / 顺丰回调地址到生产域名
    - [ ] 公网网站过渡期落到测试库的商户入驻申请数据处理（人工迁移 or 清理）

- [ ] **C41** — 部署管理后台（npm run build + Nginx 静态）
  - 测试环境 ✅: test-admin.ai-maimai.com 在线，bundle 正确连 test-api
  - 生产环境 🟡: 静态文件 200 OK，但 API 后端未起，登录无法工作
  - 状态: 🟡 部分完成 | 测试日期: 2026-04-18

- [ ] **C42** — 部署卖家后台（同上）
  - 测试环境 ✅: test-seller.ai-maimai.com 在线，bundle 正确连 test-api
  - 生产环境 🟡: 同 C41
  - 状态: 🟡 部分完成 | 测试日期: 2026-04-18

- [ ] **C43** — 部署官网 + App 落地页（含 .well-known Universal Link）
  - 子任务 ✅ Android 下载落地页厂商分流更新：华为走华为短链，vivo/iQOO 走 vivo H5，OPPO/一加/realme/荣耀走本机应用市场 `market://details?id=com.aimaimai.shop`，小米/红米、识别不到品牌和其他安卓继续使用小米 OneLink `https://m.malink.cn/s/6ZFjYj` 兜底；market scheme 打不开时自动回退 OneLink — 2026-06-25
- [ ] **C44** — App 客户端发布（EAS build + TestFlight + App Store + 国内商店）
  - 子任务 ✅ EAS CLI 安装 + Expo 账号登录 + 项目初始化（projectId d76ba8ac-06f3-45d2-b674-afec17737029）— 2026-04-19
  - 子任务 ✅ eas.json 三档配置（development/preview/production）+ OTA channel — 2026-04-19
  - 子任务 ✅ expo-updates 装包 + runtimeVersion=appVersion + updates.url 配置 — 2026-04-19
  - 子任务 ✅ 第一次 Android preview 构建 (.apk) 成功，下载链接已就绪 — 2026-04-19
  - 子任务 ⬜ 上传蒲公英分发给国内测试人员
  - 子任务 ⬜ iOS TestFlight（依赖 U06 Apple Developer 账号）
  - 子任务 ⬜ 国内安卓商店上架（华为/小米/OPPO/vivo/荣耀/应用宝，依赖 U06）
- [ ] **C45** — 基础监控（PM2 monit + health cron + 慢查询 + 告警）
- [ ] **C46** — 数据备份（pg_dump 定时 + Redis RDB + OSS 归档 + 恢复演练）

- [x] **C40a** — GitHub Actions 双分支自动部署（2026-04-18 新增）
  - 实际做了: `.github/workflows/deploy-website.yml` 改造为 `Deploy Sites & Backend`：staging 分支推送 → 自动部署测试环境（test-admin/test-seller/test-api + PM2 reload aimaimai-api-test）；main 分支推送 → 自动部署生产环境；前端构建时按分支注入 VITE_API_BASE_URL/VITE_WS_BASE_URL；后端 SSH 到服务器跑 git pull + npm ci + prisma migrate deploy + pm2 reload
  - 配套文档: `docs/operations/github操作.md` 已更新双分支发布流程
  - 状态: ✅ | 完成日期: 2026-04-18 — Actions 双分支均验证通过（admin/seller/backend 全链路构建+部署成功）

- [x] **C40b** — 测试环境 CORS + 支付宝 notify URL 修正（2026-04-19 新增）
  - 实际做了: 服务器 .env 加 CORS_ORIGINS（含 test-admin/test-seller/test-api/ai-maimai.com/www + localhost:8081/19006/3000）；修正 ALIPAY_NOTIFY_URL 缺 `/api/v1/` 前缀的问题；模板 docs/operations/.env.staging 同步
  - 状态: ✅ | 完成日期: 2026-04-19

- [x] **C40b2** — 测试环境 CORS 追加中文域名 Punycode（2026-04-20 新增）
  - 背景: 官网 `爱买买.com/merchants/apply` 验证码不显示。浏览器发跨域请求时 Origin 头会把中文域名自动编码成 Punycode `xn--ckqa175y.com`，后端 `CORS_ORIGINS` 是精确字符串匹配（`backend/src/main.ts:64-66`），原清单没列 Punycode 形式 → 中文域名被拦截，英文域名正常
  - 实际做了: 服务器 `/www/wwwroot/aimaimai-staging-src/backend/.env` 追加 `https://xn--ckqa175y.com,https://www.xn--ckqa175y.com,https://app.xn--ckqa175y.com,https://admin.xn--ckqa175y.com,https://seller.xn--ckqa175y.com`；`pm2 reload aimaimai-api-test --update-env`；`docs/operations/.env.staging` 模板和 `docs/operations/阿里云部署.md` §6.6 同步
  - 验证: `curl -X OPTIONS https://test-api.ai-maimai.com/api/v1/captcha -H "Origin: https://xn--ckqa175y.com"` 返回 `Access-Control-Allow-Origin: https://xn--ckqa175y.com`；英文域名 + 恶意域名回归通过
  - 状态: ✅ | 完成日期: 2026-04-20

- [x] **C40c1** — 🔴 P0 管理员管理前端页（2026-04-19 新增，2026-04-19 核实已完成）
  - **核实结果（2026-04-19 下午）**: 功能**已存在**于 `admin/src/pages/admin/users.tsx`（299 行，ProTable 列表 + 新增/编辑/重置密码/启用禁用/删除全齐） + `admin/src/api/users.ts`（37 行）。路由为 `/admin/users`（非 plan.md 原设计的 `/admin-users`）；菜单入口在"系统管理 → 管理员账号"（AdminLayout 已有）
  - **背景（历史描述）**: `admin/src/pages/users/` 是 App 买家用户管理（对应 `admin/src/api/app-users.ts`），与管理员管理（`admin/src/pages/admin/users.tsx` + `admin/src/api/users.ts`）完全独立。plan.md 原撰写时背景调查欠缺细致，误判为未实现
  - **验收（均已通过，用户 1:41 截图佐证）**:
    - [x] 超管登录能看到 /admin/users 列表（含 username/phone/role/status/lastLogin/登录IP/创建时间）
    - [x] 创建新管理员（必填 username/password/role；可选 phone）
    - [x] 编辑管理员（改 phone/role/status，不改密码）
    - [x] 重置密码按钮 → 弹窗输入新密码 → 调 reset-password 端点
    - [x] 禁用/启用切换
    - [x] 删除（带二次确认）
    - [x] 非超管角色看不到此菜单（PermissionGate 守卫）
  - **预估**: 1 天（实际 0 天，已存在）
  - 状态: ✅ | 完成日期: 2026-04-19（历史已完成，本日核实确认）

- [ ] **C40c2** — 🟢 P2 商户入驻审核菜单快捷入口（2026-04-19 新增，2026-04-19 修订方案）
  - **背景**: 功能已以 Tab 形式存在于 `admin/src/pages/companies/applications-tab.tsx`（448 行完整实现，含审核通过/拒绝/详情抽屉/历史记录） + `companies/index.tsx` 第三 Tab "入驻申请"（含 pending-count Badge 红点）。原计划的独立页 `admin/src/pages/merchant-applications/` 重复造轮子
  - **决策（2026-04-19 用户确认）**: **方案 A** — 保留 Tab 不动，只加菜单快捷入口直达"入驻申请"Tab
  - **修改文件**:
    - 改 `admin/src/layouts/AdminLayout.tsx` 在"商家与商品"菜单组加一条"入驻审核"，path `/companies?tab=applications`
    - 改 `admin/src/pages/companies/index.tsx` 支持 URL query `?tab=applications` 初始化 activeTab（useSearchParams 读取）
  - **验收**:
    - [ ] 侧边栏菜单"商家与商品 → 入驻审核"可见
    - [ ] 点击直达"入驻申请"Tab（而非默认"全部企业"Tab）
    - [ ] 原 Tab 内审核功能不受影响（E2E "C01 商户审核"通过）
  - **预估**: 15 分钟
  - **测试链路**: 刷新浏览器 → 菜单能看到新入口 → 点击跳对 Tab
  - 状态: ⬜

- [x] **C40c3** — 🔴 P0 Staging 真实 SMS + 三段式环境策略确立（2026-04-19 新增，2026-04-19 完成）
  - **环境策略（2026-04-19 用户确认，三段式）**:
    - **本地开发**（开发者电脑）: `SMS_MOCK=true`（固定 123456） + 支付宝沙箱 + 走图形验证码；admin/123456 + cs-001..010/seller123 直通登录
    - **Staging**（test-*.ai-maimai.com）: `SMS_MOCK=false`（**真实**阿里云 SMS） + 支付宝沙箱（方案 α） + 走图形验证码；做真实链路回归
    - **Production**（*.ai-maimai.com）: 所有 mock 全关（见 C40e）
  - **背景**: 当前 staging `.env` 仍 `SMS_MOCK=true`。阿里云已开通：签名"深圳华海农业科技集团"、模板 SMS_501860621（U03）
  - **操作（需人工执行）**:
    - [ ] 阿里云短信控制台充值 ≥ 10 元（约 250 条短信，够 1-2 周测试）
    - [ ] SSH 服务器：`sed -i 's/SMS_MOCK=true/SMS_MOCK=false/' /www/wwwroot/aimaimai-staging-src/backend/.env`
    - [ ] `pm2 reload aimaimai-api-test --update-env`
    - [ ] 本地 `docs/operations/.env.staging` 模板同步改 SMS_MOCK=false（已改 ✅ by claude）
    - [ ] `backend/.env.example` 顶部加环境策略注释（已改 ✅ by claude）
  - **验收**:
    - [ ] 任意真实手机号在 admin/seller/app 三端发验证码 → 5 秒内收到短信
    - [ ] PM2 日志不再打印 `[SMS Mock] 固定验证码=123456`
    - [ ] 阿里云短信发送记录有正常发送条目
    - [ ] 验证码错误重试无误，5 分钟过期
  - **风险**: 短信余额耗尽时所有 SMS 调用会失败（500 错误）。需配监控（C45 子任务）
  - **预估**: 30 分钟（SSH 操作）+ 阿里云充值（用户线下）
  - **实际做了**:
    - 服务器 `.env` SMS_MOCK=true→false + `pm2 reload aimaimai-api-test --update-env`
    - 阿里云充值 3000 条短信额度（签名"深圳华海农业科技集团"三大运营商"已报备待验证"实为可用态）
    - 诊断根因：测试时误用未绑定手机号 15327258425 → 后端防枚举保护静默跳过 SMS 导致"没收到"假象。执行 `UPDATE "AdminUser" SET phone='15327258425' WHERE username='admin'` 后真手机 5-15 秒内收到验证码
    - PM2 日志证据：两次 `[Admin SMS] 手机号无匹配管理员或账号禁用，忽略发送` 警告已消失
  - 状态: ✅ | 完成日期: 2026-04-19

- [x] **C40c4** — 🟡 P1 App 微信登录 Android（2026-04-19 新增，2026-04-20 真机端到端验证通过 ✅）
  - **前置（用户已完成）**:
    - [x] 微信开放平台 App 审核通过，AppID = `wxeb8e8dc219da02dd`（密码本 §5.1）
    - [x] 签名 MD5 = `766bafb6a3b34a678761e4b07e3665c4` 已注册微信平台（密码本 §11.1）
    - [x] 本地 `aimaimai-release.keystore` 上传 EAS（production/preview/development 三个 profile 共享，MD5 已验证一致）
  - **已完成（2026-04-19 下午）**:
    - 装包：`npm install react-native-wechat-lib` (v1.1.27)
    - 新建 `plugins/withWechat.js` Expo Config Plugin：
      - 生成 `android/app/src/main/java/com/aimaimai/shop/wxapi/WXEntryActivity.java`
      - AndroidManifest 注册 WXEntryActivity（含 `launchMode=singleTask` + `taskAffinity`）
      - 添加 `<queries><package name="com.tencent.mm"/></queries>`（Android 11+ 必需）
    - 改 `app.json`：挂 `./plugins/withWechat.js` + version 0.1.0 → 0.2.0（runtimeVersion policy=appVersion 自动升）
    - 新建 `src/services/wechat.ts`：`initWechat()` + `requestWechatAuth()` + `isWechatInstalled()`，含 Mock 回退
    - 改 `app/_layout.tsx`：隐私同意后调 `initWechat()` 注册 AppID
    - 改 `src/components/overlay/AuthModal.tsx:handleWeChat` 用新的 `requestWechatAuth()` 替代旧 stub
  - **iOS 延后**: iOS 需 Apple Developer 账号（U06 未就绪）+ Universal Link + Info.plist + AppDelegate；待 U06 完成后补
  - **首次 APK 测试发现的问题 + 修复（2026-04-19 下午）**:
    - 🔴 **闪退 + 老域名 502**：用户装第一版 APK 一点开闪退，第二次点开弹出 `app.爱买买.com` 的 502 页面
    - **根因 1（502）**：App 代码里深链 URL 硬编码仍是老域名 `app.xn--ckqa175y.com`（爱买买.com 的 punycode），该域名服务器已下线。`ai-maimai.com` 备案已通过且 `/resolve` endpoint 返回 200
    - **根因 2（闪退）**：`src/services/wechat.ts` 用 `require('react-native-wechat-lib').default`，但该包只有 named exports 没 default，导致 `.registerApp` 调用时 TypeError
    - **根因 3（潜在）**：`react-native-wechat-lib` 1.1.27 无 autolinking 元信息（无 `react-native.config.js`、无 `androidPackage` 字段），Expo SDK 54 autolinking 可能漏注册 WeChatPackage
    - **根因 4（潜在）**：`performDeferredLinkCheck()` 在 `_layout.tsx` 未 `.catch()`，`WebBrowser`/`isDDLChecked` 异步失败会炸到 React 顶层
    - **修复（3 次提交）**:
      - `8de9f86` 域名迁移 8 文件（app.json intentFilters / associatedDomains、`_layout.tsx` APP_DOMAIN、4 处深链 URL、`deferredLink.ts` regex 兼容新旧域名）+ `wechat.ts` 改 named import + `isWechatNativeAvailable()` 前置 guard
      - `f137a1b` 新建 `react-native.config.js` 显式声明 WeChatPackage autolinking + `performDeferredLinkCheck().catch()` 包裹
    - **审查 Agent 建议但未采纳**（都是 Agent 误判）:
      - `sendAuthRequest` scope 改数组 → Android native 是 `String scope`，改数组反而会 break
      - `registerApp` 改单参数 → Android native 是 `(String appid, String universalLink, Callback)`，2 个参数才对
      - Metro 打包 crash 担忧 → Metro 只静态 bundle 不执行 top-level 代码，运行时 guard 已挡住
  - **蒲公英测试分发链接**（2026-04-19 建立）:
    - 🔗 **https://www.pgyer.com/aiaimaimai**
    - 二维码可扫，国内访问快；测试人员先卸载旧版再装
    - APK 文件：`~/Downloads/ai-aimaimai-v0.2.0-preview.apk`（116 MB，本地备份）
    - EAS 直链（美国 CDN 慢/不稳定）：https://expo.dev/artifacts/eas/8k19cqcrtyKispdM1g9f49.apk
    - 签名 MD5 `76:6B:AF:B6:A3:B3:4A:67:87:61:E4:B0:7E:36:65:C4` 已验证与微信平台一致
  - **下一步测试清单（用户操作）**:
    - [x] **① 打新 .apk**: `eas build --profile preview --platform android`（~15-25 分钟）— 2026-04-19 完成，build id `3b573078-e208-4c1d-84d0-b4a0912d7c1e`
      - 构建用 EAS 上已传的本地 keystore 签名（MD5 `76:6B:AF:B6:...`，与微信平台注册一致）
      - Gradle 阶段日志应见 `WXEntryActivity.java` 编译 + `react-native-wechat-lib` 链接
      - 失败贴日志给 Claude
    - [x] **② 真机安装**（2026-04-20 完成）
    - [x] **③ 端到端验证**（2026-04-20 完成）：拉起微信 → 同意授权 → 自动登录 → 管理后台看到新用户
    - [ ] **④ 后端日志验证**:
      ```bash
      ssh root@8.163.16.32
      pm2 logs aimaimai-api-test --lines 100 --nostream | grep -iE "wechat|oauth|openId"
      ```
      应看到后端收到 `/auth/oauth/wechat` + 用 code 换 openId 成功
    - [ ] **⑤ 新人红包**: 首次微信登录触发新人红包（后端逻辑）；再次登录不重复
    - [ ] **⑥ 补绑手机号**: 微信登录后进账号安全页（C40c7），能绑定手机号
  - **常见故障排查**:
    | 症状 | 原因 | 解法 |
    |---|---|---|
    | 点微信登录无反应 | SDK 注册失败 / 微信未装 | `__DEV__` console 日志看 `[WeChat] registerApp` |
    | 跳微信无"同意"按钮 | 签名 MD5 与微信平台不匹配 | EAS keystore MD5 核对 `76:6B:AF:B6:...` |
    | 同意后未登录 | 后端 wechat API 报错 | PM2 日志找 `[WeChat]` 错误 |
    | Build 报 @expo/config-plugins 缺失 | peer dep | `npm install @expo/config-plugins --save-dev` |
  - **后端已就绪**: staging `WECHAT_MOCK=false`，生产环境上线前核对
  - **2026-04-20 真机测试新发现的问题 + 修复**（这一天踩了一串坑才打通）:
    - 🔴 **首次微信登录报"SDK 初始化失败"**（看似配置问题，实际是代码 bug）
      - 根因：`react-native-wechat-lib@1.1.27` 的 Android 原生模块 `WeChatModule.java:113` `getName()` 返回 `RCTWeChat`，但库 JS 顶层 `index.js:7` 硬编码 `const { WeChat } = NativeModules` 拿 `WeChat`，导致 `WeChat.registerApp` undefined。`src/services/wechat.ts` 检查 `NativeModules.WeChat` 也永远 false，提前 return false 抛错
      - 修复：commit `bcece45` 在 `wechat.ts` 加 `tryAliasRCTWeChat()` 把 `NativeModules.RCTWeChat` 别名到 `NativeModules.WeChat`，注入必须放 `initWechat()` **函数体内运行时执行**（注意：放模块顶层会因 NativeModules Proxy/frozen 抛 TypeError → bundle 加载失败 → **白屏**，已被 OTA #2 实测验证。详见 memory `feedback_ota_top_level_side_effects.md`）
    - 🟡 **新用户昵称都是"微信用户"无辨识度**
      - 修复：commit `5bdccca` `auth.service.ts` 加 `fetchWechatUserProfile()`，调 `/sns/userinfo` 拿真实 nickname/headimgurl/sex/city，失败 fallback `微信${openId.slice(-6)}`，只影响首次登录
    - 🟢 **首启动画 splash"农脉"残留 + DDL 闪网页打断动画**（一并修了）
      - 修复：splash 文案改"爱买买"+ letterSpacing 14→6；DDL 检查延迟 3s + 新增 `app/referral.tsx` 兜底路由（commit `1a799bf`）
  - **OTA 推送链路验证**（2026-04-20）:
    - `eas update --branch preview` 全 JS 改动 OTA 已实战验证可用
    - APK 冷启 2 次后加载新 bundle（第一次后台下载，第二次应用）
    - 出问题用 `eas update:republish --group <id>` 回滚到任意历史 update group
    - 当前 preview branch HEAD：update group `450d71de-8959`（含 wechat 别名修复）
  - **验收**:
    - [x] App 点"微信登录" → 跳转微信 → 同意 → 自动登录（2026-04-20）
    - [x] 首次登录自动建 User + AuthIdentity(provider=WECHAT, identifier=openId)（2026-04-20）
    - [x] 真实昵称/头像/性别/城市已写入 UserProfile（2026-04-20，commit `5bdccca`）
    - [ ] 已绑定的微信下次登录直接进，触发新人红包仅一次（待二次登录验证）
    - [ ] 微信用户能补绑手机号（C40c7 账号安全页）
  - **预估**: 原 2-3 周（线下审核）+ 3 天开发 → 实际 1 天代码完成 + 1 天真机调试打通
  - 状态: ✅ | 完成日期: 2026-04-20

~~C40c5 Apple 登录~~ — 🗑️ 用户决策（2026-04-19）: 不需要，已删除。仅在真正有 iOS 第三方登录需求且 Apple 审核强制时再加回

- [x] **C40c6** — 🟢 P2 卖家邀请员工 SMS 通知（2026-04-19 新增，2026-04-19 完成）
  - **用户决策（2026-04-19）**: 不申请新模板，复用现有 `SMS_501860621` 验证码模板。员工看到签名「深圳华海农业科技集团」知道是哪家邀请；发送的 code 同时写入 SmsOtp(LOGIN) 可直接用于登录（5 分钟有效），省去员工再发一次验证码步骤
  - **实际做了**:
    - 改 `seller-company.service.ts:inviteStaff()`：写库成功后 fire-and-forget 调用新增的 `sendInviteSms(phone)` 私有方法
    - 新增 `sendInviteSms()`：生成 6 位 code（mock 固定 `123456`）→ bcrypt hash + 写 SmsOtp(LOGIN, 5min) → 调 `aliyunSms.sendVerificationCode(phone, code)`
    - constructor 注入 `ConfigService` + `AliyunSmsService`（@Global，无需改模块）
    - 失败只 logger.warn 不抛异常，保证 inviteStaff 事务不被阻塞
  - **验收**:
    - [ ] OWNER 邀请员工后，员工 5 秒内收到 "【深圳华海农业科技集团】您的验证码是 XXXXXX" 短信
    - [ ] 员工用此 code 在 seller 登录页「手机登录」Tab 可直接登入（无需再次获取验证码）
    - [ ] 短信发送失败时 PM2 日志记录 `[InviteStaff] SMS 发送失败不影响邀请`，staff 记录仍创建成功
    - [ ] 员工手机号不存在时（新用户）也正常发送
  - **预估**: 0.5 天 → 实际 0.25 天（复用现有模板免审核等待）
  - 状态: ⏳ 代码完成待部署测试

- [x] **C40c7** — 🟡 P1 两端"账号安全"页：自助改密码 + 改手机号（2026-04-19 新增，当日代码完成）
  - **背景**: 两端已有密码 + SMS 双模式登录（C17/C18），但用户登入后无法自助改密码/改手机号。Admin 本人、Seller OWNER/员工都需要这个能力。否则忘密码或换手机即失联
  - **修改文件（后端，4 个端点）**:
    - 改 `backend/src/modules/admin/auth/admin-auth.controller.ts` + `.service.ts`：
      - `POST /admin/auth/change-password`（旧密码验证 → 新密码 → bcrypt hash 落 AdminUser.passwordHash）
      - `POST /admin/auth/change-phone`（旧手机 SMS 验证 + 新手机 SMS 验证 → 更新 AdminUser.phone）
    - 改 `backend/src/modules/seller/auth/seller-auth.controller.ts` + `.service.ts`：
      - `POST /seller/auth/change-password`（针对 CompanyStaff.passwordHash，当前 staff scope）
      - `POST /seller/auth/change-phone`（针对该 staff 对应 User 的 AuthIdentity(PHONE).identifier）
  - **修改文件（前端，2 个页面）**:
    - 新建 `admin/src/pages/account-security/index.tsx`（Tabs：修改密码 / 修改手机号）+ `admin/src/api/auth.ts` 加 API
    - 改 `admin/src/layouts/AdminLayout.tsx` 头像 Dropdown 加"账号安全"入口 + 路由 `/account-security`
    - 新建 `seller/src/pages/account-security/index.tsx` + `seller/src/api/auth.ts` 加 API
    - 改 seller 顶部头像菜单加"账号安全"入口 + 路由
  - **安全要求**:
    - 改密码必须验旧密码（防 session 劫持后直接改）
    - 改手机号需旧手机 SMS + 新手机 SMS 双重验证
    - 改密码成功后强制所有该用户 session 失效（踢下线，走 AdminSession / SellerSession expiresAt 回退）
    - 图形验证码保持走（和登录一致）
  - **验收**:
    - [ ] Admin 登录 → "账号安全" → 用旧密码改新密码 → 老 token 失效 → 新密码可登
    - [ ] Admin 改手机号：先发老手机 SMS + 校验，再发新手机 SMS + 校验，最后落库
    - [ ] Seller OWNER/MANAGER/OPERATOR 同理（只能改自己的）
    - [ ] 图形验证码仍需填
    - [ ] 改密码/手机号操作有审计日志
  - **预估**: 后端 0.5 天 + 前端 0.5 天 = **1 天**
  - **实际做了**:
    - **后端 admin (4 文件)**: 新建 `dto/admin-account-security.dto.ts`；admin-auth.service 新增 `changePassword` / `sendBindPhoneSmsCode` / `changePhone` 3 方法（Serializable 事务 + 速率限制 + CAS 原子消费 OTP）；admin-auth.controller 新增 3 个 `@UseGuards(AdminAuthGuard)` 端点；getProfile 返回补 phone 字段
    - **后端 seller (3 文件)**: seller-auth.dto 追加 3 DTOs；seller-auth.service 新增同名 3 方法（phone 更新走 AuthIdentity，影响该 User 名下所有 staff 的 session）；seller-auth.controller 新增 3 端点
    - **前端 admin (5 文件)**: 新建 `pages/account-security/index.tsx`（Tabs 修改密码 / 修改手机号）；App.tsx 加路由；AdminLayout 头像 Dropdown 加"账号安全"入口 + divider + 退出登录；api/auth.ts 加 3 方法；types/index.ts 加 phone 字段
    - **前端 seller (4 文件)**: 新建同结构 `pages/account-security/index.tsx`；App.tsx 加路由；SellerLayout Dropdown 加入口；api/auth.ts 加 3 方法；types 加 phone/phoneMasked
  - **安全要求达成**:
    - 改密码必须验旧密码（bcrypt.compare）+ 新密码长度 ≥ 6
    - 改手机号双重 SMS（原手机 purpose=LOGIN + 新手机 purpose=BIND），新手机号重复校验（已被其他用户/管理员绑定则 409）
    - 改密码/手机号成功后强制所有 session 失效，前端自动跳登录页
    - 新手机号发 SMS 走 Serializable 事务 + 三段式速率限制（1/分、5/时、10/日）
  - **验收**:
    - [ ] Admin 登录 → 头像 → "账号安全" → 修改密码成功 → 跳转登录页 → 新密码能登入
    - [ ] Admin 修改手机号：原手机收码 + 新手机收码 + 提交 → 跳转登录页 → 新手机号可用
    - [ ] Seller OWNER 同理；MANAGER/OPERATOR 亦能改（只改自己的）
    - [ ] 三端 TypeScript 编译通过 ✅（tsc -b 验证）
  - 状态: ⏳ 代码完成待部署测试

- [x] **C40c8** — 🟡 P1 管理员兜底重置任意账号密码（2026-04-19 新增，当日完成）
  - **背景**: 用户忘密码 + 手机号失联时的最后通道。C40c1 管理员管理页已有重置其他管理员密码；这里扩展到能重置任意 OWNER/员工的密码。注意：OWNER 也要可重置（OWNER 不能自己被踢出，但密码可由管理员兜底）
  - **修改文件（后端）**:
    - 改 `backend/src/modules/admin/companies/admin-companies.controller.ts` + `.service.ts`：
      - `POST /admin/companies/:id/staff/:staffId/reset-password`（管理员直设新密码，无需旧密码）
  - **修改文件（前端）**:
    - 改 `admin/src/pages/companies/detail.tsx` 员工列表行加操作列"重置密码" → 弹窗输入新密码 → 调接口
    - 改 `admin/src/api/companies.ts` 加 resetStaffPassword 方法
  - **权限**: `companies:update`
  - **审计**: `@AuditLog({ action: 'RESET_STAFF_PASSWORD', module: 'companies', targetType: 'CompanyStaff' })`
  - **验收**:
    - [ ] 超管在企业详情页任意员工行点"重置密码" → 输入新密码 → 该员工下次用新密码可登
    - [ ] OWNER 也可被重置密码（特殊确认弹窗）
    - [ ] 操作被审计日志记录
    - [ ] 非 `companies:update` 权限看不到按钮
  - **预估**: 0.5 天
  - **实际做了**:
    - 后端：`dto/admin-company.dto.ts` 加 `AdminResetStaffPasswordDto`；`admin-companies.service.ts` 加 `resetStaffPassword` 方法（bcrypt hash 新密码 + Prisma 事务内同步 update passwordHash + 失效所有 SellerSession）；`admin-companies.controller.ts` 加 `POST /admin/companies/:id/staff/:staffId/reset-password` 端点（`companies:update` 权限 + 审计日志）
    - 前端：`admin/src/api/companies.ts` 加 `resetStaffPassword` 方法；`admin/src/pages/companies/detail.tsx` 员工列表加"操作"列（PermissionGate 守卫） + 重置密码 Modal（Alert 警告 + 密码字段 + 确认字段）
  - **安全要求达成**:
    - OWNER / MANAGER / OPERATOR 均可被重置（管理员兜底通道，覆盖忘密码+失手机号场景）
    - 事务保证密码更新与 session 失效原子化
    - 操作被审计日志记录（action=UPDATE, targetType=CompanyStaff）
    - 非 `companies:update` 权限按钮不可见
  - 状态: ⏳ 代码完成待部署测试

- [x] **C40c9** — 🟢 P2 管理员员工 CRUD 完整化 + 换 OWNER（2026-04-19 新增，当日完成）
  - **背景**: 管理员目前只能查看企业员工 + 绑定唯一 OWNER。不能添加/改角色/禁用/移除员工；不能换 OWNER（OWNER 离职无解，除非 DB 手工）。Seller OWNER 自己能做大部分员工操作，这里是管理员视角的补全（兜底 + 运维）
  - **修改文件（后端，新增端点）**:
    - 改 `backend/src/modules/admin/companies/admin-companies.controller.ts` + `.service.ts` 新增：
      - `POST /admin/companies/:id/staff` 添加员工（手机+角色 MANAGER/OPERATOR+可选初始密码，仅非 OWNER）
      - `PUT /admin/companies/:id/staff/:staffId` 改角色/状态（OWNER 不可改）
      - `DELETE /admin/companies/:id/staff/:staffId` 移除员工（OWNER 不可删，走换 OWNER）
      - `POST /admin/companies/:id/transfer-owner` 换 OWNER（新 OWNER 必须是该企业已有员工 or 新手机，原子事务：老 OWNER 降为 MANAGER 或移除 + 新 OWNER 上位 + session 失效）
  - **修改文件（前端）**:
    - `admin/src/pages/companies/detail.tsx` 员工 Card 加：添加员工按钮 + 操作列（改角色/禁用/移除）+ "换 OWNER"按钮
    - `admin/src/api/companies.ts` 加 4 个新 API
    - `seller/src/pages/company/staff.tsx` 操作列加"改角色"入口（后端 PUT 已支持 role 字段）
  - **验收**:
    - [ ] 管理员在企业详情可添加员工（手机+角色+可选密码）
    - [ ] 管理员可改员工角色 MANAGER↔OPERATOR
    - [ ] 管理员可禁用/启用员工
    - [ ] 管理员可移除员工（非 OWNER）
    - [ ] 管理员可"换 OWNER"（一次事务完成老降新升）
    - [ ] Seller OWNER 可改自己企业员工的角色
    - [ ] 所有操作有审计日志
    - [ ] 权限检查：OWNER 不能被非 transfer-owner 的 PUT/DELETE 修改
  - **预估**: 后端 0.75 天 + 前端 0.75 天 = **1.5 天**
  - **实际做了**:
    - **后端 (3 文件)**: `dto/admin-company.dto.ts` 加 3 DTOs（AdminAddStaffDto / AdminUpdateStaffDto / AdminTransferOwnerDto）；`admin-companies.service.ts` 加 4 方法（addStaff 自动建 User+staff；updateStaff 守护 OWNER 不可改；removeStaff 事务内先失效 session 再删；transferOwner Serializable 事务：老 OWNER 降级/移除 + 新 OWNER 升级/创建）；`admin-companies.controller.ts` 加 4 端点（POST `:id/staff` / PUT `:id/staff/:staffId` / DELETE `:id/staff/:staffId` / POST `:id/transfer-owner`，全部走 `companies:update` + AuditLog）
    - **前端 admin (2 文件)**: `admin/src/api/companies.ts` 加 4 API；`admin/src/pages/companies/detail.tsx` 员工 Card extra 加 3 个按钮（绑定创始人/换 OWNER/添加员工）；操作列非 OWNER 显示"编辑"和"移除"（OWNER 仅重置密码）；新增 3 个 Modal（添加员工 / 编辑员工 改角色+状态 / 换 OWNER 含老 OWNER 降级/移除单选）
    - **前端 seller (1 文件)**: `seller/src/pages/company/staff.tsx` 操作列加"改角色" Modal 触发（复用已有 updateStaff API）
  - **安全要求达成**:
    - OWNER 不可通过 addStaff/updateStaff/removeStaff 操作，必须走 transferOwner
    - transferOwner 走 Serializable 事务，避免并发下重复 OWNER
    - 禁用员工或移除时同步失效该 staff 所有 session
    - 所有写操作带审计日志（CREATE/UPDATE/DELETE targetType=CompanyStaff）
  - **验收**:
    - [ ] 管理员企业详情页可添加员工（手机+角色+可选密码）
    - [ ] 管理员可改员工角色 MANAGER↔OPERATOR + 禁用/启用
    - [ ] 管理员可移除非 OWNER 员工
    - [ ] 管理员可"换 OWNER"：老 OWNER 降级为经理 or 直接移除
    - [ ] Seller OWNER 可改自己企业非 OWNER 员工的角色
    - [ ] 所有操作有审计日志
    - [ ] OWNER 不可被 PUT/DELETE 直接修改（走 transfer-owner）
  - 状态: ⏳ 代码完成待部署测试

- [ ] **C40c10** — 方案 A：SMS 发送去图形码 + 后端速率限制（2026-04-19 新增，当日代码完成待测试）
  - **背景**: C40c3 测试中用户反馈"每次重发 SMS 都要重填图形码体验极差"（图形码原子消费机制导致重发必刷新）。改为行业标准：图形码仅保留于密码登录，SMS 发送仅需手机号 + 后端速率限制（微信/支付宝/淘宝均此模式）
  - **修改 9 个文件**:
    - **后端 5 个**：`admin-login.dto.ts`（AdminSendCodeDto 去 captcha）/ `admin-auth.controller.ts`（sendSmsCode 传 req.ip）/ `admin-auth.service.ts`（去 captchaService.verify + Serializable 事务三段式速率限制）/ `seller-auth.dto.ts`（SellerSmsCodeDto 去 captcha）/ `seller-auth.service.ts`（去 captchaService.verify，复用已有 createOtpWithRateLimit）
    - **前端 4 个**：`admin/src/api/auth.ts` + `admin/src/pages/login/index.tsx`（手机登录 Tab 删图形码 UI、PhoneLoginForm 去字段、handleSendSms 仅校验 phone）/ `seller/src/api/auth.ts` + `seller/src/pages/login/index.tsx`（短信登录 Tab 删 `{captchaField}` 引用、handleSendCode 去 captcha 校验，密码登录 Tab 保留图形码）
  - **速率限制矩阵**:
    - 单手机号：1/分钟、5/小时、10/日（admin 新加 DB Serializable 事务 count；seller 沿用 Redis+DB 双保险，小时维度为加分项后续再补）
    - 单 IP：controller `@Throttle` 3/分钟（已存在）
    - 手机号不存在时：jitter 1-3s 随机延迟维持响应时间一致，防枚举
  - **审查 Agent 发现 + 处理**:
    - ✅ Critical — admin TOCTOU（count 与 insert 分离可被并发绕过）→ 已改为 Serializable 事务原子执行
    - ✅ High — seller sendSmsCode 缺 ip 参数一致性 → 已加 `_ip?: string`（暂预留）
    - ⏳ High — IP 小时/日维度限制暂不做（需引 Redis 依赖，@Throttle 3/min 对 v1.0 够用，威胁模型假设 botnet 攻击概率低）
    - ⏳ Low — admin Tab 切换导致图形码闪烁，UX 优化项不做
  - **验收**:
    - [ ] admin 手机登录页无图形码字段，仅需手机号即可点"获取验证码"
    - [ ] seller 短信登录 Tab 无图形码；seller 密码登录 Tab 图形码保留
    - [ ] 60s 内同手机号连续两次 sendSms → 第二次 429 "发送过于频繁"
    - [ ] 5 次/小时、10 次/日、3 次/分钟/IP 三层限制生效
    - [ ] 三端 TypeScript 编译通过 ✅
  - **状态**: ⏳ 代码完成待 Aliyun 签名通过后端到端测试

- [x] **C51** — 卖家中心安全/UX 小修一批（2026-04-19 新增，当日完成）
  - **背景**: 4 路 Agent 审查卖家系统（认证/业务/前端/数据库），核实后误报率 50%；真问题精简为 4 条一次性修完
  - **实际做了（3 文件）**:
    - 🔐 `seller-orders.controller.ts`：单笔发货 `POST /seller/orders/:id/ship` 加 `@SellerRoles('OWNER', 'MANAGER')`（原批量发货有保护，单笔漏了 → OPERATOR 可越权单笔发货）
    - 🎨 `seller/src/pages/company/staff.tsx`：邀请员工 Modal 加 `destroyOnClose` + onCancel `resetFields`（原关闭留残留数据）
    - 🎨 `staff.tsx` 改角色 Modal：去掉 `setFieldsValue`（destroyOnClose 下 onClick 阶段 Form 未挂载，setFieldsValue 失效），改用 `<Form initialValues={...} key={target.id}>` 方式
    - 🔐 `seller-auth.service.ts:changePhone`：同时失效该 User 的买家 App `Session.updateMany`（原只失效 SellerSession，买家端 JWT 7 天内仍可用）
  - **未做的（Agent 误报）**:
    - autoReceiveAt 竞态 → 假阳性（`else if (!freshOrder.autoReceiveAt)` 正是防覆盖保护）
    - updateSkus 删 SKU 未检查 OrderItem → 假阳性（代码用 status=INACTIVE 软删，无需 FK 检查）
    - triggerRefund 无补偿 → 假阳性（C6 已实现 retryStaleRefundingRequests cron）
    - forceRelogin 800ms 延迟 → 假阳性（与 admin 端一致的既定 UX）
    - 并发写 Company / transferOwner + inviteStaff / 库存 vs 改价 → 假阳性（Serializable + unique 约束已覆盖，现实无 1ms 并发）
    - CompanyProfile 多处 create → 假阳性（schema 有 unique，upsert 安全）
    - tempToken 倒计时文案 → Medium 级别 UX 建议
    - account-security 无 RequireRole → 设计如此（员工可改自己）
  - **延后的（Medium 可改进项）**:
    - seller SMS 登录补 loginFailCount（与 admin C50 同构）
    - seller-shipping generateWaybill 加 assertFeatureAllowed 信用分检查
    - Logger 敏感信息脱敏审查
  - 状态: ✅ | 完成日期: 2026-04-19

- [x] **C50** — 管理后台安全/UX 小修一批（2026-04-19 新增，当日完成）
  - **背景**: 4 路 Agent 审查管理后台相关代码后，亲自核实误报率约 70%；真问题精简为 5 条，一次性修完
  - **实际做了（5 文件）**:
    - 🔐 `admin-auth.service.ts:loginByPhoneCode` 加 `loginFailCount` 递增 + 5 次失败锁 30 分钟（与 login() L12 一致，原 SMS 登录缺该保护）
    - 🔐 `admin-users.service.ts:remove` 禁止删除自己（`id === operatorId` 即抛 ForbiddenException）
    - 🛡️ `merchant-application.service.ts:create` 加 7 天拒绝冷却期，防被拒商户刷屏重提交
    - 🎨 `admin/src/pages/companies/detail.tsx` 重置密码 Modal 补 `destroyOnClose`
    - 🎨 `account-security/index.tsx`（admin + seller）双 SMS Label 加手机号脱敏提示，避免填反
  - **未做的（Agent 误报）**:
    - admin-coupon 缺 service → 假阳性（故意复用 `../coupon/coupon.service`）
    - 提现 Float 无幂等 → 假阳性（Serializable + status CAS + frozen CAS 齐全）
    - arbitrate 退款不原子 → 假阳性（有 C6 补偿 cron）
    - transferOwner 缺 retry → 低概率事件，v1.1 优化
    - OTP 未绑定 adminUserId → 假阳性（OTP 发到 admin.phone 已物理隔离）
    - Logout AccessToken 仍可用 → 假阳性（AdminJwtStrategy.validate 每次查 session.expiresAt）
    - Product 缺 companyId 单列索引 → 假阳性（复合索引前缀已覆盖）
  - **延后（Medium 可改进项）**:
    - 密码最短 6 位偏弱 → 生产前升级到 12 位
    - SmsOtp 复合索引 `(phone, purpose, expiresAt)` → 量大后优化
    - Logger 部分含敏感数据（amount、phone 明文）脱敏审查
  - 状态: ✅ | 完成日期: 2026-04-19

- [x] **C40d** — app.json 重复条目清理 + OTA 推送验证（2026-04-19 新增，清理部分已完成）
  - **修改**:
    - `app.json` 删除 intentFilters 数组里重复的第二个对象（line 30-44）
    - `app.json` 删除 associatedDomains 数组里重复的 `"applinks:app.xn--ckqa175y.com"`（line 51）
  - **OTA 验证**（首次 .apk 装上后做一次，待用户手动测试）:
    - 改一行明显的 JS（比如首页标题）
    - `eas update --branch preview -m "test OTA"`
    - 重启 App 看是否拉到新版本（可能需要冷启动 1-2 次）
  - **验收**:
    - [x] app.json 数组无重复（intentFilters 去重 + associatedDomains 去重）— 2026-04-19
    - [ ] OTA 推送 30 秒内拉到，前端可见改动 — 待 .apk 装机测试
    - [ ] 控制台能看到 `[Updates] update applied` 日志 — 待 .apk 装机测试
  - **预估**: 30 分钟
  - 状态: ✅ 清理完成 | ⏳ OTA 验证待 .apk 装机

- [ ] **C40f** — DDL 首启闪网页用 mask 包装 + Custom Tab 美化（2026-04-20 新增）
  - **背景**: 首次安装 App 首次打开时，`app/_layout.tsx` 的 `performDeferredLinkCheck` 会用 `WebBrowser.openAuthSessionAsync` 拉起 Chrome Custom Tab 去 `app.ai-maimai.com/resolve` 读 cookie，以完成 Deferred Deep Link 推荐码自动绑定。目前已做的缓解：DDL 检查延迟 3s（不再打断 splash 动画）+ 新增 `app/referral.tsx` 兜底（scheme 回跳不再落 +not-found）。但 Custom Tab 本体还是会在首页出现后闪一下，用户感知为"莫名弹出浏览器"。Cookie 通路业务上必须保留（自动绑定准确率远高于指纹兜底），所以方向是"让这段闪变得看起来像一个正常功能"
  - **技术限制**: Custom Tab 是 Android 系统级 Activity，盖在整个 App 窗口之上。**RN 层的任何 Modal/View 都在 Custom Tab 下面**，无法真正"挡住"浏览器。mask 只在 Custom Tab 打开前 + 关闭后可见。但通过时间差和前置文案，用户会把这段流程感知为"App 在查推荐关系"而不是"Bug"
  - **修改**（只改 `app/_layout.tsx` 一个文件）:
    - 加一个 `ddlMasking` 状态（`'idle' | 'querying' | 'done'`）
    - 包住 `performDeferredLinkCheck` 调用：调用前 setState `'querying'`，finally 块里先 `'done'` → 500ms 后 `'idle'`
    - 根视图加全屏 `<View>` 覆盖层（非 Modal，用绝对定位 + `zIndex: 9999`）：`'querying'` 状态显示"正在查询推荐关系..." + ActivityIndicator，`'done'` 显示"查询完成"（淡出动画）
    - 给 `openAuthSessionAsync` 加第三个参数 `{ toolbarColor: '#2E7D32', showTitle: false, enableBarCollapsing: true }` 让浏览器视觉更贴近 App 品牌色
    - 保险：mask 最长存活时间 6s（5s WebBrowser 超时 + 1s buffer），防止异常情况卡住
  - **不动的边界**:
    - 不改 `app/referral.tsx` / `app/index.tsx` / `src/services/deferredLink.ts`
    - 不改 Linking 订阅逻辑（Universal Link 流程）
    - 不改 `useAuthStore:70-85` 登录后自动绑定逻辑
    - 不改指纹兜底（`matchByFingerprint`）
    - 不改 `markDDLChecked` 时机
  - **验收**:
    - [ ] 清除 App 数据首启 → 看到 "正在查询推荐关系..." mask → 浏览器闪 → mask "查询完成" 淡出 → 回到首页（核心场景）
    - [ ] 第二次冷启 → mask 不出现（已 `markDDLChecked` 跳过 DDL）
    - [ ] Universal Link 点击进入（`app.ai-maimai.com/r/XXXX`）→ 走 Linking 订阅直接存 pending code，不触发 mask（说明没误走 DDL 通路）
    - [ ] 我的 → 推荐码 → 扫二维码 / 手动输入 → 正常绑定（说明未破坏手动路径）
    - [ ] 登录/注册成功 → `pending_referral_code` 自动绑定成功（说明未破坏登录后自动绑定）
    - [ ] WebBrowser 异常（断网/超时）→ mask 最长 6s 强制消失，不永久卡屏
  - **推送方式**: 全 JS 改动，无原生层变化，`eas update --branch preview` OTA 推送即可，无需重打 APK
  - **预估**: 1-2 小时
  - 状态: ⬜

- [ ] **C40e** — 生产上线 mock/sandbox → 真实切换 checklist（2026-04-19 新增）
  - **背景**: 测试环境很多走 mock 或第三方沙箱，生产前必须全部切真。汇总成单一清单避免遗漏
  - **服务器 `/www/wwwroot/aimaimai-prod-src/backend/.env` 修改项**:
    - [ ] `NODE_ENV=production`
    - [ ] `SMS_MOCK=false`
    - [ ] `WECHAT_MOCK=false`
    - [ ] `SF_ENV=PROD` + `SF_API_URL` 改生产域名 + 凭证换生产 clientCode/checkWord
    - [ ] `ALIPAY_GATEWAY=https://openapi.alipay.com/gateway.do`（去掉 -sandbox）
    - [ ] `ALIPAY_ENDPOINT=https://openapi.alipay.com`
    - [ ] `ALIPAY_NOTIFY_URL=https://api.ai-maimai.com/api/v1/payments/alipay/notify`
    - [ ] `SF_CALLBACK_URL=https://api.ai-maimai.com/api/v1/shipments/sf/callback`
    - [ ] 支付宝四件套证书替换为生产证书（appCertPublicKey / alipayCertPublicKey / alipayRootCert）
    - [ ] `CORS_ORIGINS=https://admin.ai-maimai.com,https://seller.ai-maimai.com,https://ai-maimai.com,https://www.ai-maimai.com,https://xn--ckqa175y.com,https://www.xn--ckqa175y.com,https://app.xn--ckqa175y.com,https://admin.xn--ckqa175y.com,https://seller.xn--ckqa175y.com`（去掉 test-* 和 localhost；必须含中文域名 Punycode `xn--ckqa175y.com`，否则中文域名被拦）
    - [ ] 数据库 URL 改 `aimaimai` 库 + 生产密码
  - **代码层切换**:
    - [x] App `app/about.tsx` 删除版本信息里的 "(Mock)" 字样，并同步关于页联系邮箱为 `zwf@huahainongke.com`
    - [ ] `backend/src/modules/captcha/captcha.service.ts` NODE_ENV=test bypass 不影响生产
    - [ ] `backend/src/modules/shipment/sf-express.service.ts` NODE_ENV=test mock 不影响生产
  - **第三方平台后台改地址**:
    - [ ] 支付宝沙箱后台 → 生产应用：应用网关填 `https://api.ai-maimai.com/api/v1/payments/alipay/notify`
    - [ ] 顺丰丰桥生产环境推送地址：`https://api.ai-maimai.com/api/v1/shipments/sf/callback`
    - [ ] 微信开放平台回调地址（如启用微信登录）
  - **EAS Build 切换**:
    - [ ] App 用 `eas build --profile production --platform android`（连生产 API）
    - [ ] iOS 同上 + TestFlight 提交
  - **验收**:
    - [x] 生产 PM2 进程 `aimaimai-api-prod` online
    - [x] 浏览器/真实手机端连生产域名能完整跑全链路
    - [x] 真实支付宝小额转账 1 元成功 + 退款成功
    - [x] 真实顺丰下单成功 + 物流推送回调成功
    - [x] 微信登录（如启用）成功
  - **预估**: 0.5 天（不含上面 C40c4 等子项依赖）
  - 状态: ⬜

**第四批完成判定**:
- [x] 测试环境四个子域名 HTTPS 可访问（test-*.ai-maimai.com 全部 200）— 2026-04-18
- [ ] 生产环境四个子域名 HTTPS 可访问（admin/seller 200，api 502 待启 PM2）
- [x] 测试后端 API 200（`/api/v1/captcha` 验证）— 2026-04-18
- [ ] 生产后端 health check 200
- [x] 测试管理后台可登录（admin/123456，bundle 内嵌 test-api 正确）— 2026-04-18
- [ ] 生产管理后台可登录
- [ ] App TestFlight 可下载

---

### 第五批：阶梯上线 + 回归测试

> 依赖: 第四批部署完成。按阶梯顺序逐级 smoke test。

- [ ] **C47** — Smoke: 后端基础（health + PM2 + logs）
- [ ] **C48** — Smoke: 管理端（登录 + 改密 + Company 创建 + Dashboard）
- [ ] **C49** — Smoke: 卖家端（种子商户登录 + 商品发布 + 审核 → App 可见）
- [ ] **C50** — Smoke: 官网（首页 + 入驻表单 + 推荐码落地页）
- [ ] **C51** — Smoke: App TestFlight（登录 + 加购 + 支付 + 抽奖 + VIP + 客服 + 退款）
- [ ] **C52** — Smoke: 监控告警触发 + 备份恢复演练
- [ ] **C53** — 阶梯灰度：500 种子用户接入 + 48h 无 P0 事件

**第五批完成判定**:
- [ ] 首批 500 用户可正常使用核心链路
- [ ] 48 小时无 P0 事件
- [ ] 监控响应时间 < 5 分钟

---

### 第六批：Tier 2 待补项（v1.0 可带可不带）

> 详细 48 项见 [审查报告 §7](docs/superpowers/reports/2026-04-11-launch-readiness-audit-report.md)。
> 按模块分组，优先级由高到低。

**L7 退换货规则完善** (T01-T06): 库存回填 / App 售后类型过滤 / 质量问题时限 / NORMAL_RETURN_DAYS guard / 运费记账 / 奖励归平台补偿
**L11 发票入口** (T07-T09): 订单详情"申请发票" / 个人中心入口 / invoiceStatus API
**L02 AI 开关激活** (T10-T13): 语义字段填充 / 三个 _ENABLED 打开 / 假 AI 下线或真接
**L15 非钱事件补接** (T14-T18): 订单/发货/签收/售后通知 / 离线客服兜底 / 幂等键 / 清理 Cron
**L17 溯源补齐** (T19-T24): ProductTraceLink / TraceEvent API / 类型对齐 / App 真实接入
**L10 卖家优化** (T25-T28): 溯源选择器 / REJECTED 编辑死锁 / 上传保护 / 描述 MinLength
**L5/L6 分润监控** (T29-T33): unlockedLevel 回退 / ruleType REFUND_ROLLBACK / 参数重命名 / BFS 确认 / giftSkuId 清理
**L12 管理一致性** (T34-T37): 权限码统一 / 死权限删 / 审计 URL / 入驻菜单
**L14 红包** (T38-T40): 重复 ID 防御 / P2002 文案 / 分摊 invariant
**L16 地址** (T41-T42): 默认地址事务化 / 行政区划 Picker
**L9 客服** (T43-T45): 死代码清理 / Socket.IO 客户端 / 工单 category
**横切** (T46-T48): Serializable 统一 / Payment 幂等核查 / money.util.ts

---

## 🔑 忘记密码功能（2026-04-23 新增）

- [x] **F-FP01** 买家 App + 卖家后台自助忘记密码（方案 β 按企业选择） + 管理后台"联系超管"提示
  - 后端：Prisma `SmsPurpose` 新增 `BUYER_RESET` / `SELLER_RESET`；`verifyCode` / `createOtpWithRateLimit` 签名改为 `purpose` 必填；买家端 `POST /auth/forgot-password/{send-code,reset}` + 卖家端三步 `POST /seller/auth/forgot-password/{send-code,list-companies,reset}`；OTP 配额 1/min + 5/hour；审计复用 `LoginEvent.meta.action='PASSWORD_RESET_VIA_SMS'`（两处 readers 已排除此 action 避免污染登录行为）；Serializable 事务保护 OTP CAS + 密码写入；卖家 reset 用 `normalizeCompanyAccessStatus` 与登录路径对齐（SUSPENDED-已到期公司可重置）
  - 前端：买家 App `AuthModal` 内嵌三步向导（方案 A，无新增路由）；卖家后台独立 `/forgot-password` 4 步向导页；管理后台登录页加灰字"忘记密码请联系超级管理员"
  - 详见：`docs/superpowers/specs/2026-04-23-forgot-password-design.md` + `docs/superpowers/plans/2026-04-23-forgot-password.md`
  - ⚠ 上线需运维：Prisma migration `ALTER TYPE SmsPurpose ADD VALUE` ×2（PostgreSQL 零停机、不可原地回滚）；超管 `admin` 账号应急 SQL 重置流程见 `docs/operations/密码本.md`

---

## 📝 卖家商品草稿（2026-04-24 新增）

- [x] **F-PD01** 卖家创建/编辑商品支持"保存草稿"持久化（2026-04-24）
  - 后端：启用现有 `ProductStatus.DRAFT`（零 migration）；`seller-products.service` 新增 `createDraft` / `updateDraft` / `submitDraft`；`findAll` 默认排除 DRAFT、`toggleStatus` / `update` 拒绝 DRAFT、`remove` 放宽允许 DRAFT；controller 新增 `POST /seller/products/draft` / `PUT /:id/draft` / `POST /:id/submit`；管理端 `admin-products.service.findAll` 显式排除 DRAFT
  - 前端：创建页双按钮（保存草稿 / 提交审核）+ 30 秒 debounce 自动保存 + `history.replaceState('/products/:id/edit')` URL 持久化 draftId；编辑页遇 DRAFT 转发到 ProductCreateForm；列表页新增草稿统计卡 + 行级差异化渲染（不显示上下架 Switch、审核列显 `-`、操作栏仅继续编辑/删除）；状态 filter 自动包含 DRAFT（valueEnum 从 productStatusMap 派生）
  - 约束：每商户最多 **5 份**草稿（事务内统计防竞态）；最低门槛**标题必填**；提交审核时手动跑 `CreateProductDto` 校验并返回字段级错误
  - 23 条 DTO 测试全绿（backend/seller-products-dto.spec.ts）；前后端 TS 编译通过；T9 代码审查待运行
  - 详见：`docs/superpowers/specs/2026-04-24-product-draft-design.md` + `docs/superpowers/plans/2026-04-24-product-draft.md`

---

## 📱 响应式适配专项（2026-04-30 立项 / 2026-05-04 全项目审计完成）

> **触发**: 2026-04-30 立项时仅 VIP 礼包页 1 个截图复现点；2026-05-04 用户随手测试发现 checkout（小米机底部空白）+ 订单详情（底部被手势条挡）—— 决定全项目扫；2026-05-18 真机继续验证确认大字体 / 显示大小 / 虚拟三键不是华为个例，而是多品牌手机系统性风险，且支付成功页存在 CTA 不可达 + 返回键被吞 P0 问题
> **权威源**: `docs/architecture/responsive-design.md`（**单一文件囊括规范 + 工具集 spec + 全项目审计 + Sprint 拆解 + 修复进度表**，§6 持续更新）
> **审计结果**: 60 页面 + 16 共用组件，首轮 🔴 15+ 高优 / 🟡 26+ 中优；2026-05-18 起历史“干净文件”清单仅作参考，需按 10 场景矩阵二轮验收
> **上线判断**：R-RS01-07 已推 OTA，但 R-RS-LF01 支付成功逃生修复和 R-RS-LF02 高频页大字体修复会直接影响真机付款 / 购物体验，应作为测试版继续发放前的 P0/P1 收口项
>
> **🚀 2026-05-04 OTA 已推（preview branch）**：commit `694331a`，update group `5da9c55c-0e69-4eb5-af77-3d0c39a4b0ef`，含 R-RS01-07 + 2 hotfix 共 11 commit。下一步：真机验证（华为/小米三键 + iOS 灵动岛 + 系统字体放大 1.5x 场景）后状态全部 🟡 → ✅
> **🧭 2026-05-18 二轮复核已立项**：`docs/architecture/responsive-design.md` 已扩展为 Android 多品牌大字体 / 显示大小 / 虚拟三键 / 手势条 + iOS Dynamic Type + 结果页 CTA 可达的 10 场景矩阵；新增 R-RS-LF01/R-RS-LF02/R-RS-LF03，避免与退款链路 R-RS08+ 编号冲突。
> **🔧 2026-05-18 二轮代码已完成，待真机矩阵**：支付成功页逃生、抽奖结果弹窗、购物车/结算/商品详情/VIP 礼包/未完成订单/订单详情/checkout-coupon/invoices-request 底部栏实测高度、我的页大字体降级已实现；静态审计已分类，10 场景真机验收后才能转 ✅。
> **🚀 2026-05-18 OTA 已推（preview branch）**：update group `fc282546-a7dc-4094-ae9b-c544f82b95de`，commit `08d091e`，含 R-RS-LF01/LF02 + checkout-coupon/invoices-request 收口，共 13 commit。下一步：跑 `responsive-design.md` §4 10 场景真机矩阵 → 所有 🟡 转 ✅ → R-RS-LF03 关闭。

### Sprint 概览（详细拆解 + 进度表见 spec §6.2 / §6.3）

- [🟡] **R-RS01** 工具集基建（`src/theme/responsive.ts` + 全局兜底）—— 2026-05-04 代码完成（159 行 5 helper + Text.defaultProps 1.2x 封顶 + theme/index re-export），TS 验证通过；🟡 待真机视觉验证（首页 / VIP 礼包 / 购物车冷启） + commit + OTA 后转 ✅
- [🟡] **R-RS02** 共用组件改造（StickyCTABar / Toast / Screen / AiFloatingCompanion）—— 2026-05-04 完成：StickyCTABar 加 useBottomInset 吃底部 safe area（解决 A1，自动修订单详情/售后/售后详情 3 页）；Toast/AiFloatingCompanion 替换 useSafeAreaInsets→useBottomInset；2026-05-21 复核：撤销 JS 侧 Android 64dp 推断兜底，`useBottomInset()` 默认只使用系统 safe-area + caller extra，避免 zero-inset 手势导航设备被误判后全页面底部统一 gap；同日追加单页例外 `androidMinimumBottomPadding`，仅发票申请页启用 64dp low/zero-inset CTA 逃生，并修正该页底部按钮 `flex:1` 布局；订单详情发票操作链接左对齐，避开右侧 AI 浮层命中区。全页面审查补齐 `search` 购物车 FAB、`ai/chat` 与 `cs/index` 输入栏、`me/scanner` 底部提示、`me/addresses`/`me/vip` 滚动留白和 `AppBottomSheet` 内容底部。Screen.tsx 文档化 safeAreaBottom 默认值意图（不改默认）。待真机验证后转 ✅
- [🟡] **R-RS03** 高优单页修复（用户报告 + spec 复现点：orders/[id] / checkout / cart / checkout-coupon / vip-gifts）—— 2026-05-04 完成：5 文件统一改用 useBottomInset；2026-05-21 复核确认 helper 不再做 Android 64dp 推断，避免所有底部固定栏页面统一 gap；vip/gifts 删模块顶层 Dimensions（4 子组件 prop drilling）+ priceTabAmount 加 priceTextProps（spec §1.1 复现点修复）。A3/A4 售后页由 R-RS02 共用组件自动修复。待真机验证后转 ✅
- [🟡] **R-RS04** 顶层 Dimensions 批量替换（5 文件 + 共用组件 FloatingParticles）—— 2026-05-04 完成：删除模块顶层 Dimensions.get + 派生 const，全部改组件函数体内 useWindowDimensions；index.tsx 启动闪屏装饰元素改 SEED_RATIOS 比例运行时计算；FloatingParticles.tsx 共用组件 generateParticles 函数签名扩展 prop drilling。审查通过零问题
- [🟡] **R-RS05** 金额字号 spread `priceTextProps`（wallet / bonus-queue / coupons / recommend / checkout-coupon）—— 2026-05-04 完成：5 文件 6 处金额/数字位 Text 全部加 priceTextProps（防字体放大 + 自动缩字号）。审查通过零问题
- [🟡] **R-RS06** 中优字号批量修（fontSize≥20 缺保护）—— 2026-05-04 完成：实际只有 5 文件需要保护（home/me/me-vip/ai-assistant/ai-trace），共 12 个 Text 加 priceTextProps（紧凑数字位）或 fitTextProps（标题）；其余 4 文件（settings/notification-settings/ai-finance/ai-chat）经 typography 字号验证免改（最大 title3=18 < 20）。拆 2 commit（族 A: home/me 系；族 B: ai/* 系）
- [🟡] **R-RS07** 中优 ScrollView paddingBottom 批量改吃 insets —— 2026-05-04 完成：10 文件 13 处 paddingBottom 全部改 useBottomInset(原写死值)。2026-05-21 复核确认 helper 只使用系统 safe-area + caller extra，不再做 Android 64dp 推断；lottery/orders-track 也加入。cs/index 输入栏已单独接入 useBottomInset。待真机验证后转 ✅
- [🟡] **R-RS-LF01** 支付成功 / 结果页 P0 逃生修复（2026-05-18 新增）—— `payment-success.tsx` 已改 ScrollView、动态图标尺寸、CTA 可达、BackHandler 安全导航、iOS 手势禁用；`lottery.tsx` 结果 BottomSheet 已改可滚动和 compact 降级；待真机矩阵
- [🟡] **R-RS-LF02** 高频购物页大字体二轮修复（2026-05-18 新增）—— `me.tsx` / `cart.tsx` / `checkout.tsx` / `product/[id].tsx` / `vip/gifts.tsx` / `checkout-pending.tsx` / `orders/[id].tsx` / `StickyCTABar` 已完成；待真机矩阵
- [🔧] **R-RS-LF03** 全 App 大字体 + 虚拟键巡检（2026-05-18 新增）—— BackHandler / 结果面 / bottom bar 静态命中已分类，`checkout-coupon.tsx`、`invoices/request.tsx` 保留到后续批次；10 场景真机矩阵待跑
- [ ] **R-RS-LF04** 恢复 E2E tests TypeScript 覆盖（2026-05-18 复审新增）—— 根 `npx tsc -b` 已临时排除 `tests/`；当前 `cd tests && npx tsc --noEmit -p tsconfig.json` 阻断于 `tests/e2e/regression/seller-permission-matrix.spec.ts:58` 的 `test.request` 类型用法。后续需修 tests 类型错误，并把 `tests/tsconfig.json` 纳入 CI 或恢复根编译覆盖
- [ ] **R-RS-LT01** PR 模板加 Checklist 提示
- [ ] **R-RS-LT02** OTA 发布前必跑 rg 审计（写入 `app-发布与OTA手册.md` 第四章）
- [ ] **R-RS-LT03**（可选）封装 `AppText` 组件升级 defaultProps

> 详细任务、文件清单、每文件修复进度、commit SHA 全部见 spec §6.2 / §6.3，本处仅作 plan.md 索引

---

## 📋 待你确认的疑点（从审查报告 §9 搬来）

> 每条回答后在此处标注你的选择 + 日期

### 🔴 必须立即回答

| # | 疑点 | 你的选择 | 日期 |
|---|---|---|---|
| Q1 | 红包退款是否归还？ | ✅ **红包不退回。退款金额按比例计算**：如果订单用了红包，退款商品只退实付金额（按比例扣除红包抵扣部分），不退原价，否则平台亏。代码不需要改（与 refund.md 一致） | 2026-04-13 |
| Q2 | 审核通过是否自动上架？ | ✅ **A. 自动上架** — `audit()` 同步 `status: 'ACTIVE'` | 2026-04-13 |
| Q3 | OrderItem.unitPrice 是否已扣减优惠？ | ✅ **A. 已扣减（安全）** — 分润利润计算基础正确 | 2026-04-13 |

### 🟡 本周回答

| # | 疑点 | 你的选择 | 日期 |
|---|---|---|---|
| Q4 | 假 AI（品质评分/信赖分/摘要）如何处理？ | ✅ **A. 下线 UI 等真后端** | 2026-04-13 |
| Q5 | couponUsage/VIP激活失败是否补偿队列？ | ✅ **A. 不加（3次重试够了）** | 2026-04-13 |
| Q6 | 多商户运费？ | ✅ **运费全部由平台支付，不考虑商家**。一个订单多商家算一个总运费，商家不管。不存在"分摊"问题 | 2026-04-13 |
| Q7 | VIP 推荐人子树全满降级到系统节点？ | 🟡 **待核对** — 用户指出理解有误，需重新研读 VIP 树生长规则后确认 | 2026-04-13 |
| Q8 | 发票功能是否整体下线 v1.1？ | ✅ **A. 保留但补入口**（订单详情+个人中心+invoiceStatus） | 2026-04-13 |
| Q9 | 客服生产超时值确认？ | ✅ **A. 文档默认**（SESSION_IDLE=2h / QUEUING=30m / AGENT_IDLE=60m） | 2026-04-13 |
| Q10 | Qwen 宕机降级策略？ | ✅ **A. v1.0 不需要熔断器**（当前 fallback 可接受） | 2026-04-13 |

### 🟢 可延后

| # | 疑点 | 你的选择 | 日期 |
|---|---|---|---|
| Q11-Q17 | 详见 [审查报告 §9](docs/superpowers/reports/2026-04-11-launch-readiness-audit-report.md) | — | — |

---

## 📦 v1.1+ 推迟项（明确不在 v1.0）

- 微信支付（代码接入已按 `docs/superpowers/plans/2026-05-23-wechat-pay-integration.md` 推进：后端 WechatPayService + notify + active-query + 关单/退款闭环 + App Android 支付分发 + admin 展示；入口开关仍关闭，待 APP 支付权限和真金联调通过后开启）
- 微信登录
- 可配置标签系统（TagCategory/CompanyTag）
- 发现页筛选栏动态化
- 五大新功能 F1-F5（订单流程重构/赠品锁定/奖品过期/平台公司/奖励过期）
- VIP 赠品多 SKU 组合
- 推荐码延迟深度链接真机验证
- 语义意图升级完整实施（spec 已写但代码未激活）
- 任务/签到中心
- 关注/社交互动
- CompanyRole/CompanyPermission 卖家端自定义权限
- 设备指纹 + 异地登录二次验证

---

## 📚 历史记录

- **2026-02 至 2026-03**: Phase 1-10 全栈开发，见 `docs/reference/plan-history-2026Q1.md`
- **2026-04-11**: 17 条链路 + 6 项横切关注点上线就绪审查，见 `docs/superpowers/reports/2026-04-11-launch-readiness-audit-report.md`
- **2026-04-12**: 新 plan.md 基于审查结果重写，旧 plan.md 归档
- **2026-04-15~16**: Web 端 E2E 自动化测试体系搭建（详见下方）
- **2026-04-17~18**: 服务器换 OS（CentOS 7 → Alibaba Cloud Linux 3，抛弃 Docker 改 Node 直装），8 个域名 + SSL 全部就绪，测试环境（test-admin/test-seller/test-api）全链路上线，GitHub Actions 双分支（staging/main）自动部署链路打通
- **2026-04-19**: 测试环境联通性审查（三端前端 + 后端 + DB + CORS 全部 ✅）；EAS Build 全套配置（eas.json 三档 + expo-updates OTA + 第一次 Android .apk 构建成功）；CORS/ALIPAY_NOTIFY_URL 修正；注册/登录真实闭环缺口审计；plan.md 拆解 C40c1~c6 + C40d/C40e（含管理员管理页/商户入驻审核页/SMS真实/微信登录/Apple登录/邀请通知/app.json 清理/生产切换 checklist 共 8 个新任务）
- **2026-04-19 下午**: C40c2 方案修订（发现 `companies/applications-tab.tsx` 已完整实现，改为只加菜单快捷入口，从 P0 1 天降为 P2 15 分钟）；确立三段式环境策略（本地 mock / Staging 真实 SMS + 支付宝沙箱 / 生产全真实），C40c3 升级 P0；新增账号管理三大补全任务 C40c7 账号安全页 + C40c8 管理员兜底重置密码 + C40c9 管理员员工 CRUD 完整化（含换 OWNER），合计新增约 3 天工作量
- **2026-04-20**: 首次真机 APK 测试暴露两个首启 bug（splash "农脉"只显"农" + DDL 拉起 Custom Tab 打断启动 + scheme 回跳落 +not-found "no router"）；即时修复：splash 文案改 "爱买买" + letterSpacing 14→6 + 新增 `app/referral.tsx` 兜底 + DDL 延迟 3s（缓解，非根治）；追加 C40f 任务（mask 包装 + Custom Tab 美化）根治首启闪网页体验问题
- **2026-04-20 晚**: 微信登录全链路打通 ✅。先排查"SDK 初始化失败"，发现根因不是签名/AppID/审核（这些都对），而是 `react-native-wechat-lib` 库 Android 原生模块名 `RCTWeChat` 与 JS 层硬编码 `NativeModules.WeChat` 不一致。commit `bcece45` 加 `tryAliasRCTWeChat()` 别名注入。OTA 推送过程踩坑 1 次（OTA #2 把别名注入放模块顶层导致白屏，立即 republish 回滚 OTA #1，然后 OTA #3 把注入搬进 `initWechat()` 函数体 + 双层 try/catch 修好）。commit `5bdccca` 改首次登录拉真实昵称/头像/性别/城市，失败 fallback `微信${openId.slice(-6)}`。C40c4 标记 ✅ 完成。沉淀 2 个 memory：`feedback_ota_top_level_side_effects.md`（OTA 推送顶层副作用陷阱）+ `project_wechat_login_status.md`（微信集成完整状态）

---

## 🧪 E2E 测试体系（2026-04-15~16 搭建）

**测试计划**: `docs/testing/2026-04-15-webapp-test-plan.md`
**技术栈**: `@playwright/test` + TypeScript，工作区在 `tests/`
**CI**: `.github/workflows/e2e.yml`（PR 时自动跑）

### 测试结果：54 passed / 0 failed / 24 skipped

| 类别 | passed | 内容 |
|------|--------|------|
| 登录 Setup | 2 | admin + seller 登录态自动获取 |
| Smoke | 3 | admin 登录、seller landing、admin 导航 |
| 核心链路 | 5 | C01 商户审核、C02 商品上架、C03 订单流转、C05 红包、seller 商品 |
| 安全/隔离 | 14 | 登录负面×4、跨商户隔离×3、seller 权限矩阵×4、admin 401/403×3 |
| 表单边界 | 5 | 空提交、负成本、超长、XSS、零库存 |
| CRUD 页面 | 21 | 商户/分类/运费/管理员/商品/抽奖/标签/VIP/FAQ/快捷回复/角色 列表加载+基础操作 |
| 跨端/并发 | 4 | 订单发货端到端、登录限流、新建标签/快捷回复 |

### 修复的 bug（测试过程中发现并修复）
- ✅ Migration AfterSaleRequest 大小写不一致（2 个 migration 文件）
- ✅ CompanyTag.sortOrder 字段 migration 缺失（新增补丁 migration）
- ✅ CS 模型 migration 完全缺失（新增 `20260416010000_add_customer_service_models`）
- ✅ 种子 OrderItem 缺 companyId（44 条回填，解锁卖家订单测试）
- ✅ 前端产地"选填"但后端必填（seller 商品编辑页 + 后端 DTO 对齐）
- ✅ 商品 DTO 缺长度限制（title @MaxLength(100)、description @MaxLength(5000)、origin 结构化）
- ✅ antd message 静默（admin/seller 两端加 `<AntdApp>` 包裹）
- ✅ Expo Web 隐私弹窗不显示（Modal 在 web 端改用绝对定位 View）

### 发现的前端 bug（未修，记录）
- ⚠ seller `RequireRole` 竞态：profile 未加载完成时直接 redirect，刷新 `/company/settings` 会弹回首页
  - 位置：`seller/src/App.tsx:40` — `if (!seller) return <Navigate to="/" />`
  - 修法：加 loading 状态判断，`seller === undefined` 时渲染 Spin 而非 redirect

### 测试基础设施改动（仅 tests/ 目录 + 少量后端 bypass）
- `backend/src/modules/captcha/captcha.service.ts` — NODE_ENV=test captcha bypass
- `backend/src/modules/shipment/sf-express.service.ts` — NODE_ENV=test SF 面单 mock

## 订单页面重做（2026-05-01）
- [x] **Phase 1 · 前端重写 + 最小后端 DTO（13 任务，18 commit）** — 列表 FlatList+OrderCard、详情七区块、track 删地图+复制运单、售后列表卡片升级、me 页删 pendingPay、后端 mapOrder 暴露 skuTitle/companyId/isPrize/paidAt/shippedAt/deliveredAt
- [x] **Phase 2 · 后端剩余 DTO + 防重锁 + 续付链路 + 横幅（14 任务）** — mapOrder 完整版（Company join + logisticsSummary）/ pending checkout 接口 / resume 接口 / 防重锁 / 横幅 / checkout-pending 页 / 6001 改造 / 409 Modal / me 页"未完成支付"入口
- [x] **Phase 3 · buyerNote 字段 + 收尾（5 任务）** — Schema 加 buyerNote、CheckoutDto + Service 透传、详情 DTO 暴露、结算页留言输入框
- [x] **Phase 4 · 再次购买（2026-05-08）** — `POST /orders/:id/repurchase` + Redis result/lock 幂等 + Serializable 购物车合并 + SKU/Product/Company 跳过原因 + 价格变动提示 + App 列表/详情真实按钮 + 同步 ref guard 防同帧双击 + cart response hydrate 后跳 `/cart`
- [x] **Phase 4 补充 · 库存感知复购与低库存展示（2026-05-18）** — 复购低库存降级为 1、0 库存虚拟提示不入真实购物车、购物车/结算禁选无库存、后台低库存阈值、售后退货退款回填库存
- [x] **Phase 4 补充 · 管理后台限购配置（2026-05-18）** — 管理后台普通商品列表/详情补齐 SKU 单笔限购展示与编辑，空值表示不限

权威文档：`docs/superpowers/specs/2026-05-01-order-pages-redesign-design.md` + `docs/superpowers/plans/2026-05-01-order-pages-redesign.md`

复购补充文档：`docs/superpowers/specs/2026-05-08-order-repurchase-design.md` + `docs/superpowers/plans/2026-05-08-order-repurchase.md`

---

## 推荐链路全链路修复（2026-05-04 新增）

> **触发**: 用户买完 VIP，会员中心"我的专属推荐码"显示"暂无推荐码"。审查发现整条推荐链路（QR → 扫码 → 落地页 → 下载引导 → App 首启延迟匹配 → 注册自动绑定）多点断裂，仅"App 内主动扫码 / 手动输码"两条路径可用，新用户扫码 → 下载 → 注册自动绑定全线断
> **权威文档**: `docs/issues/app-tofix2.md`（12 个 bug：4 P0 + 3 H + 5 M，进度跟踪表 + 修复前后场景对照）
> **当前阶段**: 仅 Android 测试（v1.0 暂未上 iOS App Store / 国内应用商店）
> **已暂缓**: Bug 2（iOS AASA TEAM_ID） / Bug 4（App Store 链接占位） / Bug 5（APK 直链/应用商店分流） / 任务 17（iOS 真机扫码验证）— 待 iOS 上架阶段

### Phase 1（website 端 Bug 3 修复）✅ 2026-05-04
- [x] **R-RC01** Bug 3 落地页 Cookie domain 改 `.ai-maimai.com` + 中文域名前端兜底重定向（4 个 commit：`2edb8eb` cookie domain / `1c07b12` redirect 函数 / `03c9ce9` 审查修订（同步化避免首屏闪）/ `c082be4` 抽到 `lib/canonicalDomain.ts`）
  - `website/src/pages/Download.tsx:24` cookie domain 写死英文（双活域名 cookie 桶不互通的根因修复）
  - `website/src/pages/Download.tsx` + `website/src/pages/Resolve.tsx` Hook 前同步检查中文域名 → `location.replace` 到 `app.ai-maimai.com`，配 early return null 阻止首屏闪现
  - 共享逻辑抽到 `website/src/lib/canonicalDomain.ts`

### Phase 2（后端 Bug 1 referralCode 补全）✅ 2026-05-04
- [x] **R-RC02** 注册三处补 referralCode：`auth.service.ts:127, 464, 567`（commit `be01329`，配 prep `b85e365` 抽 generateReferralCode 到共享 util）
- [x] **R-RC03** 管理端/卖家端 5 处补 referralCode：`admin-companies.service.ts:55, 514, 654` + `admin-merchant-applications.service.ts:131` + `seller-company.service.ts:273`（commit `2878fc3`）
- [x] **R-RC04** VIP 激活 upsert 的 update 分支补码（防覆盖已有码）：`bonus.service.ts:256-275`（commit `42fa122`，事务内复用已 read 的 member 判 NULL）
- [x] **R-RC05** 旁路 upsert 补码：`normal-broadcast.service.ts:113` + `bonus-allocation.service.ts:930`（commit `e43e046`）
- [x] **R-RC06** `getMemberProfile` lazy 兜底升级：member 存在但 referralCode 为 NULL → 自动补码并 update，5 次 P2002 重试兜底（commit `8af1c46`，不写一次性 SQL）

### Phase 3（App 端启动逻辑改造）✅ 2026-05-04
- [x] **R-RC07** Bug 6 启动后已登录态主动绑 pending code（commit `6be9f4e`，consentState granted + isLoggedIn → 主动调 useReferralCode；NETWORK 错误保留 pending）
- [x] **R-RC08** Bug 8 DDL 48h 重试窗口（commit `58427b9`，`ddl_first_attempt_at` + `ddl_resolved` 双 key 替代旧 `ddl_checked`，未 resolved 且窗口内允许重试）
- [x] **R-RC09** Bug 11 URL 监听器立刻挂 + ref 缓冲 + granted 后回放（commit `9439518`，`pendingURLsRef` + `consentRef`）

### Phase 4（指纹算法 + 监控）✅ 2026-05-04
- [x] **R-RC10** Bug 7 后端 UA 归一化加强（保留精确匹配，方案 B）：`deferred-link.service.ts:12-32`（commit `f1c764a`，剥离 Version/Chrome/Safari/Build 等浏览器引擎差异，iOS Safari ↔ WKWebView / Android Chrome ↔ WebView 归一化后一致）
- [x] **R-RC11** Bug 12 后端模糊匹配加同 IP 碰撞监控日志：`deferred-link.service.ts:122-150`（commit `8f97c3b`，findFirst → findMany take 10，≥3 候选 logger.warn 告警）

> 后续可选：审查 agent 建议进一步剥离 WeChat 内置浏览器特征字段（wv / MQQBrowser / TBS / MMWEBID / WeChat / Weixin / ABI），降低 WeChat 用户落到模糊匹配的概率。**保留 backlog**：模糊匹配 + 碰撞告警已能覆盖 WeChat 场景，待真机测试发现 WeChat 用户频繁拿错码再做。

### 二次审查修订（用户复审）✅ 2026-05-04
- [x] **R-RC12** handleReferralCode + useAuthStore NETWORK 失败保留 pending（commit `cadff14`，原 try/catch 是死代码因 Result 模式不 throw，导致 /resolve consumed 后绑定网络失败推荐码丢失）
- [x] **R-RC13** 启动主动绑 effect 订阅 isLoggedIn 解 zustand persist rehydrate 竞态（commit `9feafe9`，原 imperative `getState()` 读一次 + 仅 [consentState] 依赖，rehydrate 完成后 effect 不重跑）
- [x] **R-RC14** 精确指纹多候选监控（commit `99db409`，UA 归一化降级到 OS+设备维度后同 WiFi 同型号会撞 fingerprint，原 findFirst 静默拿首条；改 findMany take 3，>1 候选告警）
- [x] **R-RC15** pickUniqueReferralCode 预查找 + 13 处 create 入口替换（commit `9275557`，**降低**而非消除 P2002 概率；helper 在 referral-code.util.ts 内 generate + findFirst 预查 10 次）

### 三次审查修订（用户再复审）✅ 2026-05-04
- [x] **R-RC16** 推荐码绑定改用 `result.error.retryable` 判断（commit `2a43bd9`，原 R12 用 `code !== 'NETWORK'` 漏掉后端 5xx/限流的 retryable=true 错误，仍会清掉 pending 丢码）
- [x] **R-RC17** pickUniqueReferralCode docstring 诚实标注 P2002 残余 race（commit `d16bf03`，无逻辑改动，仅文档更正"避免" → "降低"）

### 🚨 现网 OTA hotfix（2026-05-04）
- [x] **R-RC18** Cookie 路径改为本机一次性消费，避免每次冷启动弹 Chrome Custom Tab（commit `179d833`）
  - 根因：commit 58427b9 把 DDL 改 48h 重试，没区分 cookie/fingerprint。cookie 是浏览器侧静态状态，重试无意义且打扰；绝大多数从应用商店装 App 的用户没扫推荐 QR，永远不会 markDDLResolved → 旧逻辑每次启动都弹浏览器
  - 修复：拆 `shouldAttemptCookiePath`（一次性）+ `shouldAttemptFingerprintPath`（48h 重试），cookie 路径 finally 里 markCookiePathAttempted
  - 升级影响：已 OTA 用户最多再弹一次浏览器，之后永不弹

### Backlog（已知残余风险，监控触发后再升级）
- [ ] **R-RC-BL1** 多候选时 pick 最新一条仍可能拿错码（exact + fuzzy 都已 logger.warn 告警）；正确性优先方案是"多候选放弃匹配"，待真机告警频率确认后决策
- [ ] **R-RC-BL2** 13 处建号 create 没做 P2002 catch + retry，依赖 32^8 + 预查把概率压到 ≈0；如果生产观测到 P2002 报警再把"生成 + create"包进 retry helper

### Phase 5（服务器侧 + 真机验证，用户主导）
- [ ] **R-RC12** Bug 9 服务器侧确认 `app.ai-maimai.com` 子域名建站 + SSL（宝塔面板）
- [ ] **R-RC13** Bug 3 Nginx 加 301：中文 `app.` 子域名的 `/r/*` `/resolve` `/.well-known/` 强制跳英文
- [ ] **R-RC14** Bug 10 Android `adb shell pm get-app-links com.aimaimai.shop` 验证 sha256
- [ ] **R-RC15** 走完整链路真机验证：未装 App + 微信扫码 → 安装 → 注册 → 检查 ReferralLink

**修订记录**：
- 2026-05-04 创建 `docs/issues/app-tofix2.md`（12 个 bug 全审）
- 2026-05-04 用户拍板 Bug 7 走方案 B（保留精确匹配，加强 UA 归一化）；Bug 8 走方案 C（48h 重试）；Bug 1 不写一次性 SQL，改 lazy 兜底
- 2026-05-04 暂缓 iOS 相关项（Bug 2/4 + 任务 17）和 Bug 5（APK 分流）

---

## 退货 / 退款链路修复（2026-05-06 新增）

> P1-3 退货流程真机测试准备阶段连带挖出 2 条 v1.0 上线阻断 Critical。详细方案见 `docs/issues/app-tofix3.md` Bug 88 + Bug 89。

### Phase 1 — 退款基础设施修复 ✅ 2026-05-06（代码完成，待真机验证）

- [🔧] **R-RS08** PAID 未发货取消订单链路（Bug 88）— App 取消按钮调死链路修复
  - 后端 `order.service.ts:cancelOrder` 拆 `cancelPendingPayment`（旧架构遗留）+ `cancelPaidUnshipped`（新增）
  - 严格对齐 `seller-shipping.service.ts` advisory_xact_lock（namespace `seller-waybill-order` + 复合 key `${companyId}:${orderId}`）防止与卖家 generateWaybill 竞态
  - merchantRefundNo 用 `AUTO-CANCEL-${id}` 前缀让 cron `retryStaleAutoRefunds` 兜底重试
  - 全额退款（含运费，因未发货无快递费）；CouponInstance USED → AVAILABLE/EXPIRED 完整重置三字段（usedAt/usedOrderId/usedAmount）；RewardLedger VOIDED → AVAILABLE
  - InboxService.send 通知所有受影响商户的 OWNER（多商户订单逐 companyId 通知）
  - RefundStatusHistory 完整审计（创建 + REFUNDED 各一条）
  - `coupon.service.ts` 新增 `restoreCouponsForOrder(orderId, tx)`
  - `order.module.ts` 新增 setPaymentService + setInboxService 注入
  - 走过 2 轮外审（方案审 + 实现审），共发现 7 项错误 + 2 项 Medium 实现遗漏全部并入

- [🔧] **R-RS09** `paymentService.initiateRefund` 双架构兼容（Bug 89，Critical 预存在）— 实现 R-RS08 时连带发现
  - 真因：CheckoutSession-based 新架构下不创建 Payment 行（grep 全仓库 0 处 `payment.create`），但 `initiateRefund` 强依赖 Payment 行；导致**整个 v1.0 退款链路在新架构下都死了**（不止我新加的 cancel，还包括 after-sale 全部退款）
  - 修复：`payment.service.ts:initiateRefund` 加 fallback：找不到 Payment 行 → 通过 `Order.checkoutSessionId → CheckoutSession.merchantOrderNo + paymentChannel` 路由到 `alipayService.refund`
  - 2026-05-06 补充：fallback 仅允许 `CheckoutSession.status` 为 `PAID` / `COMPLETED`
  - 附带收益：自动修复 `admin-after-sale.service.ts:466` 售后退款 + `payment.service.ts:283` cron `retryStaleAutoRefunds` 自动重试链路

### Phase 1.5 — 外审 3 发现的高危问题（v1.0 上线前必须修）

- [🔧] **R-RS15** 多商户 CheckoutSession 取消语义修复（Bug 90，HIGH，可能套利）— 已实施方案 A
  - `cancelOrder` 加 sibling 检测分支：任一非 PAID → 拒绝；全 PAID → 路由 `cancelEntireSessionUnshipped`
  - `cancelEntireSessionUnshipped`：一并 CANCELED + 库存全恢复 + RewardLedger/CouponUsageRecord 一次性恢复（基于 IN [orderIds] 命中 primary）+ 每 Order 独立 Refund 行 + 逐笔调 alipay refund + 通知所有商户 OWNER
  - advisory_xact_lock 改为每个 Order 真实 `(companyId, orderId)` 对，按字典序遍历避死锁
  - 待真机 case 1.1 + 多商户场景测试

- [✅] **R-RS16** 售后退款路径金额修正（Bug 90b）— redemption 不恢复本身保持保守策略；已修真实资金缺口：售后退款金额按商品占比分摊奖励抵扣 + 平台红包 + VIP 折扣，避免退款超过用户实付。同步 App 预估和订单 DTO，详见 `docs/issues/app-tofix3.md` Bug 90b 修正说明

### Phase 1.6 — SF opCode 映射修订（Bug 93，CRITICAL，2026-05-07 P1-3 真机沙箱发现）

- [🔧] **R-RS17** SF `OP_CODE_MAP` 关键映射错误修复（Bug 93）— 沙箱"揽收即送达"
  - 真因：50/80 关键映射反着写。50=揽收（应 SHIPPED）被映射 DELIVERED；80=签收（应 DELIVERED）被映射 EXCEPTION
  - 影响：生产单付款 → 卖家发货（揽收）→ 立即显示"已送达" → 退货 7 天窗口少 1-3 天，**法律合规风险，绝对阻塞 v1.0**
  - 修法：最小补丁 50→SHIPPED / 80→DELIVERED + `mapOpCodeSafe()` 未知 opCode 警告
  - 外审 5 加固：`queryRoutes` 显式按 acceptTime 倒序排序（原依赖 SF API 顺序不安全）
  - 外审 6 加固：`Shipment.status` 单调性保护，DELIVERED 终态拒绝降级（原 OrderState 推送会把已签收单降级 IN_TRANSIT）
  - 外审 7/8 加固：8000 订单结束只作为生命周期标记；`queryRoutes` / `parseWaybillRoutes` 最新 8000 时改按同组最新业务终态派生，80→8000 保持 DELIVERED，99→8000 保持 EXCEPTION，单独 8000 仍 IN_TRANSIT + warn
  - 测试：sf-express.opcode.spec (16 cases) + shipment.service.spec 新增 2 cases + 历史 4+3 cases 修正
  - 2026-05-08 追加：管理后台普通订单发货默认改为顺丰自动取号；手填模式拒绝 4 位短单号，避免只写本地 trackingNo 却误以为已创建顺丰沙箱订单
  - 待办：真机沙箱重测整链路（应分段看到 SHIPPED → IN_TRANSIT → DELIVERED）；找 SF 商务索要完整 opCode 对照表后做 v2 修订
  - 顺手发现：dim-F 历史「opCode=80 → DELIVERED ✅」是 bug 假性通过，整条链路待重测

### Phase 2 — App 端 + 文档收尾（待做）

- [✅] **R-RS10** App `Alert` 二次确认弹窗 + 调用期 loading state（Bug 91）— `app/orders/[id].tsx` 已加确认提示、`cancelingRef` 防重复请求、按钮文案 `取消中...`，`StickyCTABar` 已支持 disabled 视觉/点击禁用
- [ ] **R-RS11** 真机 case 1.1 验证（仅退款，PAID 未发货）— 跑通后 ✅ R-RS08/R-RS09
- [ ] **R-RS12** 多商户订单退款验证 — 一个 CheckoutSession 多 Order 都能正常退（每 Order 独立调 alipay refund）
- [ ] **R-RS13** 售后退款回归 — 验证 `admin-after-sale.service.ts:466` 退款链路在新架构下也能成功（R-RS09 附带收益验证）
- [✅] **R-RS14** 文档同步 — `docs/features/refund.md` 已加规则 24（未发货取消全额退含运费）+ `docs/architecture/data-system.md` 已补 Order 状态机 `PAID → CANCELED` 边；`docs/issues/app-tofix3.md` 同步 2026-05-08 收尾状态

### Backlog

- [ ] **R-RS-BL1** CheckoutSession `bizType=VIP_PACKAGE` 退款时 VIP 激活如何回退？目前未做特殊处理（after-sale 也未做），等真机测发现再处理
- [✅] **R-RS-BL2** `initiateRefund` fallback 不检查 `session.status`（Bug 92，LOW）— 已加 `PAID/COMPLETED` 校验并补单测
- [ ] **R-RS-BL3** 全 session 全退时恢复红包/奖励 redemption（UX 优化非 bug）— 当前保守策略 USED 保持不变，未来若要给"全退用户" 100% 恢复 redemption 价值，可单独做

---

## 售后链路收口（2026-05-10 新增）

> 对应 `docs/superpowers/plans/2026-05-09-after-sale-chain-closure.md`，在现有 after-sale 主干上收口买家/卖家/管理端退款、退货、换货闭环。

- [✅] **ASC-T09** 买家 App 售后闭环接线
  - **修改**: `src/types/domain/Order.ts`, `src/constants/statuses.ts`, `src/repos/AfterSaleRepo.ts`, `src/repos/OrderRepo.ts`, `app/orders/[id].tsx`, `app/orders/after-sale/[id].tsx`, `app/orders/after-sale-detail/[id].tsx`, `docs/architecture/frontend.md`, `plan.md`
  - **实际做了**: 四类售后类型和订单售后摘要类型补齐；`AfterSaleRepo` 新增 eligibility / return-shipping-payment / return-waybill / timeline；申请售后页改以后端 eligibility enabled options 为准；售后详情页移除手填物流主流程，接入退货运费支付和顺丰面单生成，补质量售后商家承担运费说明与退款状态文案；订单详情“查看售后”直达售后详情，换货确认改用 `AfterSaleRepo.confirmReceive(afterSaleSummary.id)`。
  - **验证**: 已运行 `npx tsc -b`；当前失败仅剩仓库既有 `tests/e2e` Playwright/Node 类型依赖缺失（如 `@playwright/test`, `path`, `fs`, `__dirname`, `Buffer`），未再出现本任务文件相关 TypeScript 错误。
  - **状态**: ✅ 代码完成，待真机/联调验证 | 完成日期: 2026-05-10

- [✅] **ASC-T10** 卖家后台售后闭环接线
  - **修改**: `seller/src/api/after-sale.ts`, `seller/src/pages/after-sale/index.tsx`, `seller/src/pages/after-sale/detail.tsx`, `backend/src/modules/seller/after-sale/*`
  - **实际做了**: 卖家端支持四类售后类型、验收退货、换货发货、拒收退货回寄面单和售后时间线；后端补 seller timeline 与回寄面单打印字段。
  - **验证**: `cd seller && npm run build`、`cd backend && npm test -- seller-after-sale.service.spec.ts admin-after-sale.service.spec.ts after-sale-refund.service.spec.ts`、`cd backend && npm run build` 均已通过。
  - **状态**: ✅ 代码完成，待真机/联调验证 | 完成日期: 2026-05-10

- [✅] **ASC-T11** 管理后台售后退款与历史接线
  - **修改**: `admin/src/api/after-sale.ts`, `admin/src/pages/after-sale/index.tsx`, `admin/src/constants/statusMaps.ts`, `backend/src/modules/admin/after-sale/*`
  - **实际做了**: 管理端展示仲裁来源状态、退货运费责任、退款状态、退款历史、售后状态历史；FAILED/REFUNDING 售后退款可手动重试，重试接口复用统一 refund-retry 锁并只返回白名单退款摘要；管理端补 `NO_REASON_EXCHANGE` 标签。
  - **验证**: `cd admin && npm run build`、`cd backend && npm test -- admin-after-sale.service.spec.ts`、`cd backend && npm run build` 均已通过；Task 11 spec/quality 复审通过。
  - **状态**: ✅ 代码完成，待真机/联调验证 | 完成日期: 2026-05-10

- [✅] **ASC-T12** 售后收口最终验证与文档同步
  - **修改**: `docs/features/refund.md`, `docs/issues/app-tofix3.md`, `docs/issues/tofix-safe.md`, `docs/architecture/frontend.md`, `plan.md`, `AGENTS.md`
  - **实际做了**: 同步四类售后类型、顺丰退货面单、无理由退/换运费规则、质量退/换商家承担运费、旧手填物流兼容、售后退款/面单/运费支付幂等键和退款双向一致性巡检。
  - **验证**: 后端售后相关 12 个测试套件 140 个用例通过；backend/seller/admin build 通过；Prisma schema validate 通过；根 `npx tsc -b` 仍被既有 `tests/e2e` Playwright/Node 类型缺失阻断，过滤后无非测试目录错误。
  - **状态**: ✅ 文档同步完成，待真机/沙箱验证 | 完成日期: 2026-05-10

---

## 商品上下架级联修复（2026-05-07 新增）

> 真机发现下架奖品会卡死在购物车。详细问题清单与状态机见 `docs/issues/app-tofix4.md`。

### Phase 1 — 逃生与防新增 stuck（代码完成，待 staging 真机验证）

- [✅] **R-ST01** 购物车奖品生命周期修复 — `removePrizeItem` / `clearCart` 改为动态判定，仍锁定且可用赠品保留，不可用奖品允许删除并把 `LotteryRecord` 转 `EXPIRED`
- [✅] **R-ST02** 奖品可用性统一判断 — 抽奖、公开抽奖、奖品列表、claimToken 合并统一校验 `LotteryPrize + SKU + Product`
- [✅] **R-ST03** 结算链路奖品软排除 — `previewOrder` / `createCheckoutSession` 先按 `cartItemId` 识别奖品；下架奖品进 `excludedItems[]`（含 `isPrize/prizeRecordId`），普通下架商品继续硬拦截
- [✅] **R-ST04** 支付成功清理兜底 — `handlePaymentSuccess` 按 `cartItemId` + `prizeRecordId` 双路径删除已消费奖品 cartItem，并清理 `bizMeta.excludedPrizeItems` 中的软排除奖品
- [✅] **R-ST05** 买家 App 购物车/结算页感知 — `unavailableReason` 角标、禁勾选/数量调整、仅可删除；购物车计数统一走 selectable helper，结算页提示已自动移除的下架奖品

### Phase 2 — 数据与体验收尾

- [🟡] **R-ST06** 一次性数据修复 SQL — SQL 已写入 `docs/issues/app-tofix4.md`，尚未在 staging/生产执行；执行前必须 dry-run + 备份
- [ ] **R-ST07** 商品详情页深链接下架态 — `app/product/[id].tsx` 显示"已下架"并禁用加购
- [ ] **R-ST08** 真机验证 — 购物车删除/清空、cron 清理、抽奖降级 NO_PRIZE、结算 `excludedItems[]` 提示、普通下架商品硬拦截

---

## 🛒 售后链路收口（2026-05-09 立项 / 2026-05-10 ✅ 完成）

> **范围**: 退款 / 退货 / 换货 完整闭环 + 顺丰退货面单 + 三端接线 + 物流轨迹 + 多通道抽象
> **设计**: `docs/superpowers/specs/2026-05-09-after-sale-chain-closure-design.md`
> **实施**: `docs/superpowers/plans/2026-05-09-after-sale-chain-closure.md`
> **总改动**: 49 commits 合入主干 + 15+ 后续 fix/feat commit；schema 加 2 张表 + 4 个 nullable 列 + 4 个枚举

### Phase 1 — 后端状态机收口 ✅

- [✅] **AS01** Schema 扩展：4 类售后枚举（NO_REASON_RETURN/NO_REASON_EXCHANGE/QUALITY_RETURN/QUALITY_EXCHANGE）+ AfterSaleStatusHistory + AfterSaleShippingPayment 模型 + AfterSaleOperatorType + ReturnShippingPayer + AfterSaleShippingPaymentStatus 枚举
- [✅] **AS02** 抽 `AfterSaleRefundService`（统一退款生命周期：createOrGetRefund / startRefund / handleRefundSuccess / handleRefundFailure / retryRefund + 30s 节流 + advisory lock）
- [✅] **AS03** seller/admin/timeout 三处退款创建逻辑全部委托 `startRefund`
- [✅] **AS04** `PaymentService.retryStaleAutoRefunds` 识别 `AS-${id}` 前缀委托 AfterSaleRefundService 闭环
- [✅] **AS05** `AfterSaleRefundConsistencyService` 每日 cron 扫双向关系不一致

### Phase 2 — 退货顺丰面单与运费支付 ✅

- [✅] **AS06** `AfterSaleReturnShippingService`：买家退回商家顺丰面单 `AS_RETURN_${id}` 幂等键 + 沿用 SellerShippingService
- [✅] **AS07** `AfterSaleShippingPaymentService`：买家退货运费支付（无理由换货高金额/退款不够扣运费场景）`AS_SHIP_PAY_${id}` 幂等键 + 独立支付通道
- [✅] **AS08** Payment 回调按前缀路由：`AS_SHIP_PAY_` → 运费支付通道，不创建订单
- [✅] **AS09** 卖家拒收回寄面单 `AS_REJECT_RETURN_${id}` 独立幂等键 + advisory lock namespace

### Phase 3 — 三端接线 ✅

- [✅] **AS10** 买家 App 申请页 eligibility / Step 2 layout 修复（2x2 grid）/ Step 3 改用 ApiClient.upload（自带 401 刷新）/ 上传期间全屏 loading mask + 进度计数 / 串行改 Promise.all 并行（3 张 6-9s → 2-3s）/ Step 4 双模（质量类必选 + 无理由类可选 chip）/ PhotoTile 加载失败兜底
- [✅] **AS11** 买家 App 详情页：商家展示 / 退款失败转人工处理文案 / 退货运费支付按钮 / 顺丰面单生成按钮
- [✅] **AS12** "我的"页换货/售后角标接线 afterSale 派生计数
- [✅] **AS13** 卖家中心列表：去掉"开始审核"中间步（REQUESTED/UNDER_REVIEW 直接显示通过/驳回）/ 加售后单号模糊搜索 / 自动轮询 15s
- [✅] **AS14** 卖家中心详情：单号不再脱敏（卖家需完整单号查物流）/ 待处理操作 Card 移到页面顶部 / 顺丰物流轨迹（实时查询 + 沙箱旧路由过滤）/ 自动轮询 10s
- [✅] **AS15** 管理后台：售后详情入口对所有状态开放（非仲裁状态走查看模式）/ 仲裁来源状态展示 / 退款重试入口 / 物流轨迹 / 手动复核记录 / 自动轮询 15s

### Phase 4 — 真机沙箱验证 ✅

- [✅] **AS16** 沙箱端到端打通：真机申请售后 → 卖家通过 → 生顺丰退货面单 → 丰桥模拟揽收/签收 → 卖家确认收到 → 支付宝沙箱原路退款（小金额新订单 0.01 元）
- [✅] **AS17** 支付宝退款失败错误码透出（`alipay.trade.refund` 失败时拼 sub_code + sub_msg 到 RefundStatusHistory.remark，定位 `ACQ.TRADE_NOT_EXIST` 等真实原因）
- [✅] **AS18** 顺丰路由推送兜底落库：handleSfCallback 找不到 Shipment 时 fallback 匹配 AfterSaleRequest，append 到 returnTrackingEvents JSON 字段（推送通道首次实时落库）

### 验收 ✅ 2026-05-10

- [✅] plan Task 12 全套验证通过：prisma validate / 11 backend spec (133 tests) / backend build / seller build / admin build / tsc -b（错误全在 tests/e2e playwright 预存在，售后链路代码 0 错误）/ git diff --check / rg hygiene
- [✅] 沙箱完整链路演练通过

---

## 🚚 顺丰风格平台统一运费计价（2026-05-08 立项 / 2026-05-11 代码完成）

> **范围**: 平台统一运费规则、首重+续重公式、Checkout 运费锁价、顺丰正向包裹成本记录、SKU 重量必填、管理后台规则预览与批量导入
> **设计**: `docs/superpowers/specs/2026-05-08-sf-style-shipping-pricing-design.md`
> **实施**: `docs/superpowers/plans/2026-05-08-sf-style-shipping-pricing.md`

- [✅] **SF01** Schema / migration：`ShippingRule` 新增首重/续重公式字段，`ProductSKU.weightGram` 改必填，新增 `OrderShippingCost`
- [✅] **SF02** 运费引擎：按地区 + 整单重量计算，内部按克/分整数化，Redis 60s 缓存 + 写后失效，`DEFAULT_SHIPPING_FEE` 兜底
- [✅] **SF03** Checkout：创建会话时锁定 `shippingFee`，支付回调建单不重算，多商户订单按商品金额比例分摊
- [✅] **SF04** 顺丰发货：卖家生成面单传真实重量，写入 `OrderShippingCost`，为顺丰月结 `actualCost/reconciledAt` 回填留口
- [✅] **SF05** SKU 重量链路：卖家商品、管理端普通商品、管理端奖励商品 SKU 发布前均强制填写重量；历史空值回填 1000g
- [✅] **SF06** 管理后台：运费规则页升级首重/续重字段、公式预览、CSV/JSON 批量导入、dry-run 二次确认
- [✅] **SF07** 文档同步：`data-system.md` / `shipping.md` / `plan-treeforuser.md` / `app-tofix3.md` / `sales.md` / `seller.md` / `AGENTS.md` / `CLAUDE.md` / `plan.md`
- [✅] **SF07a** App / 管理端运费提示收口（2026-05-12）：购物车移除静态"再买免运费"提示；结算页预结算返回前显示"计算中"而非本地兜底运费；管理端规则冲突检测按后端省级前缀匹配口径
- [ ] **SF08** staging / SF 沙箱冒烟：管理后台新增规则 → App 预结算 → 顺丰沙箱下单 → `order_shipping_costs` 入库 → 改规则后已创建 CheckoutSession 仍按锁价支付

---

## 首页 VIP 推广（2026-05-14 新增）

- [✅] **APP-HOME-HERO01** 首页品牌文案（2026-06-15）：买家 App 首页顶部移除时段问候和随机 AI 引导语，固定两行展示"消费者就是生产力 / 是社会价值的创造者"；AI 光球下方移除快捷指令气泡，改为两行使命文案"让消费者创造一个属于自己的世界 / 为全世界创造一个共生的未来"；搜索框和已抽奖提示移动到使命文案下方；新增 `HOME_HERO_STATEMENT` / `HOME_MISSION_LINES` 纯函数常量测试与首页布局顺序测试，防止旧文案/旧布局回归。
- [✅] **APP-VIP-PROMO01** 非 VIP 首页礼包推广位：未登录/普通用户在首页搜索框下方展示后台 VIP 档位主推赠品组合，卡片显示价格、赠品标题和简短副标题，不展示顶部"好友开通可得礼包"标题行、右侧档位数量、商品/SKU/规格/数量明细；点击携带 `packageId`/`giftOptionId` 进入 `/vip/gifts` 并自动定位对应档位和赠品。
- [✅] **APP-VIP-PROMO02** VIP 首页推荐提醒（2026-06-15 更新）：VIP 且有推荐码时，在首页搜索框下方展示单行提醒"推荐好友开通 VIP"，点击进入 `/me/referral` 分享推荐码；已移除"有高额奖励"尾句。
- [✅] **APP-VIP-REF01** 推荐关系展示收口（2026-05-15）：非 VIP 会员接口返回 `referralCode=null`，历史普通码在绑定/DDL 入口按无效码拒绝；App 推荐码页只展示绑定推荐人和扫码入口，会员中心购买前展示"将加入谁的 VIP 团队"，扫码成功 toast 显示推荐人昵称/脱敏手机号；2026-05-15 追加修复空摘要兜底、已验证手机号稳定选择、绑定成功后摘要查询失败不影响响应；我的页常用工具新增固定入口，VIP 显示"我的推荐码"，普通用户显示"推荐关系"。

---

## 💳 多通道支付扩展（2026-05-10 立项，v1.1+）

> **背景**: 售后链路收口（2026-05-09）已经把支付通道抽象到位（PaymentChannel enum + provider-agnostic initiateRefund + 售后核心 channel-agnostic）。微信已补 provider service 和退货运费 provider dispatch；未来加银联/信用卡时仍需补对应 provider service 与支付入口分发。
> **设计**: `docs/superpowers/specs/2026-05-10-wechat-pay-integration-design.md`
> **实施**: `docs/superpowers/plans/2026-05-23-wechat-pay-integration.md`

### 微信支付（next）

> ⚠️ **上线前置**：微信开放平台移动应用审核 + 商户平台 APP 支付权限 + 商户证书/APIv3 密钥配置 + 0.01 元真金联调。未完成前 `src/constants/payment.ts` 的微信入口保持 `available: false`。

- [✅] **WP01** 后端 `WechatPayService` 实现（createAppOrder / refund / queryRefund / parseNotify / queryOrder / closeOrder）
- [✅] **WP02** PaymentController `/wechat/notify` 端点 + raw body 验签解密 + appid/mchid/金额校验 + 支付/退款通知闭环
- [✅] **WP03** PaymentService `initiateRefund` / `confirmCheckout` 按 channel 派发，微信退款 pending 二态不误标完成
- [✅] **WP04** CheckoutSession 取消/过期对 WECHAT_PAY 先查单再关单，已支付主动建单
- [✅] **WP05** AfterSaleShippingPaymentService 退货运费支付/退款按原订单 paymentChannel dispatch
- [✅] **WP06** App 增加 `react-native-wechat-lib` 支付封装、Android `WXPayEntryActivity`、普通/VIP checkout、续付页、未支付横幅、售后退货运费支付分发
- [✅] **WP07** 管理后台订单详情 `WECHAT_PAY` 中文展示
- [ ] **WP08** 真机联调（0.01 元小额测试，微信无沙箱）：支付 → notify → 主动查单 → 售后 → 退款 → 查退款
- [ ] **WP09** 开放入口与合规收尾：商户后台 APP 支付权限确认、生产回调/Nginx/IP 白名单、`src/constants/payment.ts` 开关、隐私政策 SDK 清单、production AAB

### 银联（待评估，无强烈需求）

- 数据层 UNIONPAY enum 已就绪
- 按相同模式实现 `UnionpayService`，售后链路代码 0 改动

### 信用卡聚合（v1.2+，需要 Stripe / Adyen / 国内聚合方）

- 数据层 AGGREGATOR enum 已就绪
- ⚠️ **特别警告**：信用卡退款 7-30 天到账，App 文案需按 channel 区分（与支付宝/微信即时退款不同）

---

## 2026-05-25 账号身份绑定（方案 A：仅空位绑定）

> 已登录账号绑定一个未占用的手机号/微信；该 identifier 已被他人占用则拒绝；当前账号已绑过则拒绝。同一账号同时绑了手机号 + 微信后，任意一种登录都进同一账号（沿用现有逻辑）。**本次不做换绑、不做解绑**。

- [✅] **AB01** 后端 `auth.service.ts` 新增 `sendBindPhoneCode` / `bindPhone` / `bindWechat`，绑定写入用 Serializable 事务兜底（schema `@@unique` 在 appId=null 时 PG NULLS DISTINCT 失效，已记入 `docs/issues/tofix-safe.md` B01）
- [✅] **AB02** 后端 `user.controller.ts` 暴露 `POST /me/bind-phone/sms/code`、`POST /me/bind-phone`、`POST /me/bind-wechat`，IP 维度 3/min 限流 + 号码维度复用 `SmsPurpose.BIND` 限额
- [✅] **AB03** DTO `auth/dto/bind.dto.ts` 手机号 `/^1[3-9]\d{9}$/` + 验证码 6 位数字
- [✅] **AB04** 买家 App `src/repos/UserRepo.ts` 加 `sendBindPhoneCode` / `bindPhone` / `bindWechat`
- [✅] **AB05** 买家 App 新增 `app/bind-phone.tsx`：手机号 + 验证码 + 60s 倒计时 + 提交 + 底部安全提示
- [✅] **AB06** 买家 App `app/account-security.tsx` 移除占位 Toast，未绑手机号跳 `/bind-phone`；未绑微信调起 `requestWechatAuth` + 调后端
- [✅] **AB07** 安全口径：发码端点不预检"目标号被占"，避免成为枚举注册号渠道；占用判断在 OTP 消费后做
- [✅] **AB08** 文档：plan.md + tofix-safe.md B01/B02/B03 已记录
- [ ] **AB09** （独立后续）修 schema `AuthIdentity` 唯一约束在 appId=null 时失效问题（需 migration + 全量微信登录回归）
- [ ] **AB10** 真机联调：覆盖 5 个场景（空位绑、被自己绑过、被他人绑过、并发抢绑、绑完后用新身份登录回同一账号）

---

## 🗑️ 账号注销功能（2026-06-04 新增，上架合规硬缺口）

> **触发**: 华为应用商店审核要求账号注销为必备合规项；个保法 §47 + 工信部 15 工作日内完成。**即时注销版**：取消 30 天冷静期，提交即时、不可撤销；除已付款订单继续履约 + 进行中售后继续受理外，其余虚拟资产（含钱包可提现现金）提交即视为自愿放弃、清零归平台。
> **权威源**: `docs/superpowers/specs/2026-06-04-account-deletion-immediate-design.md`（替代已 superseded 的 `2026-05-26-account-deletion-design.md`）

- [x] **AD-后端**（Task 1-5）后端注销链路：`me/deletion/` 模块（preview/sms-code/execute 三接口）；Serializable 事务 + advisory lock `AD-${userId}`；双重 blocker 校验（OWNER / 支付中 CheckoutSession+Payment / 提现中 WithdrawRequest）；资产清零作废 + 既有 `RewardLedger(AVAILABLE/FROZEN/RETURN_FROZEN)` 作废为 `VOIDED/VOID` + 平台归属审计；身份核验（有手机号强制 SMS `SmsPurpose.DELETION` / 仅微信四字）；个人资料软删 + AuthIdentity 释放（手机号/微信可重新注册）+ 强制登出；法定保留订单3年/发票5年/登录日志6个月；鉴权/refresh 拦 DELETED + 推荐码/历史 VIP 直推奖励对已注销用户失效并归平台
- [x] **AD-App**（Task 6-7）买家 App 注销链路：`app/me/deletion.tsx`（须知+blocker+资产+勾选 / 身份核验 / 成功后立即清本地态并回首页，三态 Skeleton+ErrorState）；`src/repos/AccountDeletionRepo.ts`（preview/sendCode/execute）；`app/account-security.tsx` / `app/settings.tsx`「注销账号」入口；无横幅/无冷静期/无撤销；确认页明确提示 VIP 权益清零作废
- [x] **AD-法律+文档**（Task 8，2026-06-04）法律文本与产品文档同步：`src/content/legal/privacyPolicy.ts` §4.3 + §四标题/3.1(3)/4.2 + §八；`src/content/legal/termsOfService.ts` §六（即时注销+可提现现金作废书面披露）+ 后续节序号顺延 + §5.2/§10.3 恢复；`docs/architecture/frontend.md` 登记 `/me/deletion`；本条 plan.md
- [ ] **AD-发布** 待 EAS 重新 `eas build`（法律文本属合规改动，OTA 过不了商店审核，必须重新进包）后更新 `docs/operations/app-发布与OTA手册.md` 第六章
- [x] **AD-网站对齐**（2026-06-04）`website/src/content/legal/privacyPolicy.ts` / `termsOfService.ts` 已按 App 即时注销版法律文本同步，移除"注销未上线"旧口径；仍需随官网发布流程重新部署 main

---

## 👑 VIP 首页礼包推荐展示（2026-06-06 新增，方案 B 轻改版）

> **触发**: VIP 用户首页原先隐藏礼包跑马灯、`/vip/gifts` 被硬拦截，导致 VIP 面对面推荐好友时无内容可展示。
> **权威源**: `docs/superpowers/specs/2026-06-05-vip-home-referral-promo-design.md` + `docs/superpowers/plans/2026-06-06-vip-home-referral-promo.md`

- [x] **VR01** 文案纯函数 `getVipPromoCarouselCopy`（purchase/referral 双语境）+ jest 单测（7bd463f + 2461270）
- [x] **VR02** `VipHomePromoCarousel` 加 `mode` prop，仅替换标题与无障碍文案，默认 purchase 零破坏（eaec2f5）
- [x] **VR03** 首页跑马灯对所有用户显示，VIP 传 referral（标题「好友开通可得礼包」），金色横幅保留（f5bf2f5）
- [x] **VR04** `/vip/gifts` 解除 VIP 拦截改浏览模式：顶部提示条 + CTA「分享给好友开通」跳 `/me/referral` + handleCheckout VIP 守卫物理隔离（7f86670）
- [x] **VR05** 全量验证：jest 41/41 + tsc 零错误
- [ ] **VR06** 真机验收（VIP 首页跑马灯/礼包页浏览/分享跳转/非 VIP 回归四项）+ 发 OTA（纯 JS 改动可 OTA，发布前过响应式 checklist）

---

## 🧾 订单号脱敏展示 + 展开 + 复制（2026-06-08 新增）

> **触发**: 订单号是长 cuid，App 多处只展示后几位/中间省略；用户要「默认后几位 + 眼睛展开完整号 + 复制按钮」。
> **方案**: 抽共享组件 `OrderNoReveal`，三页复用，默认后 6 位。

- [x] **ON01** 共享组件 `OrderNoReveal`（`src/components/orders/OrderNoReveal.tsx`）：默认后 6 位（`…`前缀等宽）、眼睛 `eye-outline`/`eye-off-outline` 切换、复制 `content-copy` 始终复制完整号+toast「已复制」、Pressable hitSlop 触控热区+accessibilityLabel、空态/短号兜底
- [x] **ON02** 订单详情页 `OrderInfoBlock` 订单号行接入（替换原完整号+复制 pill，清理死代码 Clipboard/useToast/copyBtn）
- [x] **ON03** 支付成功页 `payment-success` 总订单号接入（窄空间 maxWidth 60%）
- [x] **ON04** 物流追踪页 `track` 头部新增订单号行 + 标题后 8 位→后 6 位统一
- [x] **ON05** tsc -b 通过 + 独立审查（采纳触控热区放大/空态无障碍/重复样式清理；甄别并驳回导入路径误报）
- [ ] **ON06** 真机验收（三页展开/收起/复制 toast）+ 发 OTA（纯 JS 可 OTA）

---

## 📋 推荐码剪贴板口令（2026-06-09 新增，替代 Cookie 路径）

> **触发**: 真机实测新手机扫 VIP 推荐码→下载→打开后推荐关系没绑上；且首启莫名弹浏览器（= Cookie 路径弹 Custom Tab 读 /resolve，跨 cookie 罐基本读不到，UX+成功率双输）。
> **权威源**: `docs/superpowers/specs/2026-03-27-deferred-deep-link-design.md`（顶部 2026-06-09 架构变更注记）

- [x] **CB01** website 新建 `src/lib/referralClipboard.ts`：`buildReferralClipboardText`（口令=推荐链接本身）+ `copyTextToClipboard`（Clipboard API + execCommand 兜底）+ 跨端契约单测 2 case
- [x] **CB02** 落地页 `Download.tsx`：点「下载安卓版」先静默写剪贴板再跳商店（手势内调用）；新增邀请码大字卡片（点击复制+已复制反馈，微信被禁剪贴板时的可见兜底）
- [x] **CB03** 落地页二维码堵漏：有推荐码时指向推荐链接本身（朋友扫屏幕推荐关系跟随），纯 /download 页保持 OneLink 不变
- [x] **CB04** App `deferredLink.ts`：删 Cookie 路径（shouldAttemptCookiePath/markCookiePathAttempted），新增 `readReferralCodeFromClipboard`（只认 URL 格式防误绑），gate 改名 `shouldAttemptDeferredMatch`（剪贴板+指纹共用 48h 窗口）
- [x] **CB05** App `_layout.tsx`：`performDeferredLinkCheck` 重写为剪贴板优先→指纹兜底，移除 WebBrowser 弹浏览器逻辑（首启不再闪网页）；剪贴板读取严格 gate 在隐私同意后（合规）
- [x] **CB06** 验证：website 测试 5/5 + tsc -b 零错误 + App tsc 零错误 + 独立审查全绿（无 Critical/High）
- [ ] **CB07** 真机验收：扫推荐码→落地页点下载（看「已复制」）→装 App→首启自动绑定；website 推送 + App 发 production OTA（expo-clipboard 已在 1.0.2 原生包，纯 JS 可 OTA）
- [x] **CB08**（2026-06-10）隐私政策补充「剪贴板读取」披露：`src/content/legal/privacyPolicy.ts` + `website/src/content/legal/privacyPolicy.ts` 同步升级至 `v1.0.1`（触发 App 重新同意）；`docs/legal/爱买买法律文本审核稿.docx` 已重新导出；`huahai-corporate-site/privacy.html` / `terms.html` 已加入同版法律文本与页脚入口
- [x] **CB09**（2026-06-09）商店新装包内嵌 bundle 收口：已重新打出 `apk/正式版/prod-1.0.3-privacy-20260609-221718.apk`（versionName 1.0.3 / versionCode 6 / runtime 1.0.3），内嵌隐私 `v1.0.1` 与「剪贴板读取」披露，可用于商店新用户首启直接看到新版隐私政策；旧 `prod-1.0.3.apk`（versionCode 5）早于 CB08，不再作为对外分发首选。华为商店仍是 1.0.1（runtime 不同收不到 1.0.2/1.0.3 OTA），更新华为包时一并覆盖。
- [x] **CB10**（2026-06-10）OPPO SDK 公示整改：隐私政策升级至 `v1.0.2`，附录按 OPPO 审核要求精确公示 `APP支付客户端SDK`（开发者：支付宝(杭州)信息技术有限公司）与 `微信OpenSDK Android`（开发者：深圳市腾讯计算机系统有限公司）的 SDK 名称、开发者、收集信息范围、目的和隐私政策链接；App/爱买买官网/华海官网/Word 审核稿已同步，`npm test` 增加硬性防回归断言；已发 runtime 1.0.3 production OTA Group `d605d047-aca2-4018-b8b4-b4c9d93e0754`。

---

## 🛒 团购即时推荐码与统一消费积分（2026-06-29 新增）

> **触发**: 团购规则调整为付款后立即生成团购推荐码；团购订单独立于普通商品，不接受退换货/退款，仅收货后24小时内质量问题联系客服补发；团购返还后端独立记账，但 App 钱包统一显示为消费积分，可抵扣和提现。
> **权威源**: `docs/superpowers/specs/2026-06-29-group-buy-instant-code-unified-wallet-design.md` + `docs/superpowers/plans/2026-06-29-group-buy-instant-code-unified-wallet.md`

- [x] **GB01** 团购付款后立即生成推荐码：支付回调同一事务内创建 `GroupBuyInstance + ACTIVE GroupBuyCode`，不再等待7天/收货窗口；历史 `QUALIFICATION_PENDING` 可通过回填脚本补码。
- [x] **GB02** 团购推荐返还冻结/释放：被推荐人付款后推荐人看到冻结返还；被推荐人确认收货后释放到团购返还账户；退款/退货异常路径仅作为防腐恢复，不提供用户自助逃逸。
- [x] **GB03** 团购禁退换/禁优惠：团购订单支付后不支持取消退款或自助售后；团购 checkout 保持现金支付，拒绝红包、消费积分、团购返还余额、VIP 折扣等任何优惠。
- [x] **GB04** 钱包统一读模型：`/bonus/wallet` 汇总 Reward 与 GroupBuyRebate 为 App 侧统一消费积分；后台账本仍分开记录；非卖家 OWNER 不展示产业基金分项。
- [x] **GB05** 普通商品统一抵扣：普通 checkout 只接受一个 `deductionAmount`，后端按 Reward 优先、GroupBuyRebate 补足拆账；退款/取消恢复两套账本。
- [x] **GB06** 统一消费积分提现：提现入口按 Reward / GroupBuyRebate / IndustryFund 规则自动拆账，App 不让用户选择来源；统一钱包提现与旧团购返还提现通过 `accountSnapshot.source` 区分，避免历史列表和幂等键串线。
- [x] **GB07** App 团购规则文案：团购首页、详情、扫码落地、付款页和当前团购面板统一展示“付款后立即生成推荐码 / 付款冻结返还 / 收货后释放 / 不退换，仅24小时质量问题补发”。
