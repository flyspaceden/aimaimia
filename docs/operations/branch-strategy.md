# 爱买买 — 分支维护策略（上线前后通用）

> **本文回答 4 个问题**：开发版/测试版/正式版长什么样？日常什么时候切分支？紧急情况怎么修？怎么防止两个分支越走越远？
>
> **本文不讲**：具体 `git push` 命令（去看 `docs/operations/github操作.md`）/ 上线那一刻的 checklist（去看 `staging-to-production.md`）/ App OTA vs Build 决策（去看 `app-发布与OTA手册.md`）
>
> **配套文档**：
> - `github操作.md` — 日常 push staging / merge main 的具体命令
> - `staging-to-production.md` — 上线 main 那一刻的拍板项 + 验证清单
> - `版本管理.md` — 三个环境的实际清单（域名 / 数据库 / 服务名）
> - `app-发布与OTA手册.md` — App 的 OTA / Build 决策

---

## 一、三个"版本"长什么样

很多人以为"开发版 / 测试版 / 正式版"必须对应三个 GitHub 分支。**不是**。爱买买的三层环境是这样：

| 层 | 在哪 | 对应分支 | 用什么数据库 / 第三方 | 给谁用 |
|---|---|---|---|---|
| **开发层** | 你的 Mac（`localhost:3000`）| 任意分支当前签出的代码 | 本地 PG / SMS_MOCK / 支付宝沙箱 | **只有你自己** |
| **测试层** | `test-*.ai-maimai.com` | `staging` | 测试库 `testaimaimai` / 真实 SMS / 支付宝沙箱 / 顺丰 UAT | 你 + 测试人员 + 蒲公英 APK 测试者 |
| **生产层** | `*.ai-maimai.com` | `main` | 生产库 `aimaimai` / 真实 SMS / 支付宝生产 / 顺丰生产 | 全部真实用户 |

**关键：本地就是"开发版"**。你不需要 dev 分支。多一层分支只会让你心智负担更重——单人 + AI 协作的小项目用不上。

---

## 二、分支结构

```
main（生产，永久，受保护）          ← 真实用户在用
  ↑
  └─ staging（测试，永久）          ← 日常开发主战场
       ↑
       ├─ feature/<名字>（短期）    ← 大功能（>3 天）才切，可选
       └─ hotfix/<名字>（短期）     ← 紧急修复生产 bug
```

| 分支 | 永久/短期 | 谁创建 | 推送后会发生什么 |
|---|---|---|---|
| `main` | 永久 | 仓库已有 | **自动部署到生产**（`api.ai-maimai.com`）|
| `staging` | 永久 | 仓库已有 | **自动部署到测试**（`test-api.ai-maimai.com`）|
| `feature/<名字>` | 短期（1-7 天）| 你按需切 | **不自动部署** |
| `hotfix/<名字>` | 短期（几小时-1 天）| 紧急时切 | **不自动部署** |

---

## 三、日常工作流（4 种典型场景）

### 场景 1：开发新功能（小到中型）

> 例：加一个"商品收藏夹"按钮

```
本地 → staging → main
```

**步骤**：
1. 切到 staging：`git checkout staging && git pull`
2. 在本地改代码 + 跑 `npm run start:dev` 在 `localhost` 测
3. 满意后 commit + `git push origin staging` → 自动部署测试环境
4. 在 `test-*.ai-maimai.com` 真机验证 1-2 天
5. 决定上线时：`git checkout main && git merge --no-ff staging && git push origin main`

**关键**：每个 commit 一个逻辑改动（CLAUDE.md 强制流程 #10）。

### 场景 2：开发大功能（复杂改动，>3 天）

> 例：重做整个支付流程，期间不想阻塞别的小修复上线

```
本地 → feature 分支 → staging → main
```

**步骤**：
1. 从 staging 切 feature 分支：
   ```bash
   git checkout staging
   git checkout -b feature/payment-redesign
   ```
2. 在本地反复改、commit、push 到 `feature/payment-redesign`（不会触发部署）
3. 期间如果有别的小改动要上线 → 直接 staging→main，不影响你的 feature
4. feature 完成后：
   ```bash
   git checkout staging
   git merge --no-ff feature/payment-redesign
   git push origin staging  # 触发测试环境部署
   ```
5. 在 staging 测试 OK 后，按场景 1 第 5 步走 main

**何时该切 feature**：
- 改动跨越多个模块（前后端 + Schema）
- 预计开发周期 > 3 天
- 半成品不想污染 staging（让 staging 始终接近"可上线"状态）

**何时不必切**：
- 单文件小修复
- 文案 / 配置调整
- 紧凑的 bug fix

### 场景 3：紧急修复生产 bug（hotfix）

> 例：上线后 3 天，用户报"VIP 礼包下单白屏"。staging 上还有未测完的新功能，不能直接合 staging→main

```
main → hotfix 分支 → main + staging（双合）
```

**步骤**：
1. 从 main 切 hotfix（**不是从 staging**）：
   ```bash
   git checkout main
   git pull origin main
   git checkout -b hotfix/vip-checkout-white-screen
   ```
2. 修 + 本地测试 + commit
3. 合到 main 紧急上线：
   ```bash
   git checkout main
   git merge --no-ff hotfix/vip-checkout-white-screen
   git push origin main  # 触发生产部署
   ```
4. **★ 关键**：立刻合回 staging，否则两个分支永久分化：
   ```bash
   git checkout staging
   git merge main  # 把 hotfix 拉回 staging
   git push origin staging
   ```
5. 删 hotfix 分支：
   ```bash
   git branch -d hotfix/vip-checkout-white-screen
   git push origin --delete hotfix/vip-checkout-white-screen
   ```

**为什么必须从 main 切**：staging 上可能有还没准备好的新功能，从 staging 切的 hotfix 合到 main 会把那些功能一起带上线。

### 场景 4：只改 App 端 JS（OTA 路径）

> 例：上线一周后想改首页 banner 文案

如果改动**只是 App 端 JS**（页面、文案、Repo 调用方式），可以**完全跳过 main 部署**，直接走 OTA：

```bash
# 在 staging 上改、commit、push
git checkout staging
# 改 app/index.tsx
git add app/index.tsx
git commit -m "update(app): 调整首页 banner 文案"
git push origin staging

# 推 OTA 给 production channel（不走 main 部署）
eas update --branch production --message "调整首页 banner 文案"
```

**只能 OTA 的改动**：
- App 页面 / 文案
- App 内 API 调用
- App 内业务逻辑（不涉及原生模块）

**必须 Build 不能 OTA 的改动**（见 `app-发布与OTA手册.md` 决策表）：
- 改 `app.json` / `eas.json`
- 新依赖
- 改原生权限 / 包名
- 关闭沙箱开关（`EXPO_PUBLIC_ALIPAY_SANDBOX=true → false`）

**重要**：OTA 改动**仍然要 commit 到 staging**，否则下次 staging→main 时这个改动会从 production channel 上"消失"。

---

## 四、切换时机判断（什么时候按按钮）

### staging → main 应该满足

- ✅ staging 上的功能在测试环境真机跑过**至少 48 小时**
- ✅ 没有 P0 / P1 bug
- ✅ 钱链路（付款 / 退款 / 提现 / 分润）至少做过一次端到端验证
- ✅ 已经按 `staging-to-production.md §〇` 的拍板清单逐项过
- ✅ 已经向你自己（或 Claude）口头复述本次上线包含哪些 commit + 回滚路径
- ✅ **当前不是周五下午 / 深夜 / 大促期间**

### 不要 staging → main 的情况

- ❌ staging 上有半成品功能（用 feature 分支隔离它）
- ❌ 大版本改动当天还没准备好回滚 SQL
- ❌ 用户活动期间（618、双十一等）—— 冻结上线窗口
- ❌ 你自己在出差 / 度假 / 没法值守的时段

### 一周节奏建议

| 何时 | 做什么 |
|---|---|
| 周一-周三 | 在 staging 上开发 + 真机测试 |
| 周四 | 上线（staging→main）+ 上午观察 |
| 周五 | 监控 + 处理紧急问题 + **不做新发布** |
| 周末 | 不上线（出问题没人处理） |

紧急 hotfix 不受此节奏限制（按场景 3 走）。

---

## 五、防止 staging 和 main 分化（最容易踩坑）

### 问题怎么产生

```
上线 2 周后假设：
- staging 累积了 3 个新功能 commit（还没上线）
- main 累积了 1 个 hotfix commit（紧急修复）

如果 hotfix 没合回 staging：
→ staging 缺这个 fix
→ 下次合 staging→main 时可能"重新引入这个 bug"
```

### 预防 1：hotfix 流程包含"双合"

场景 3 的步骤 4 是**必做**的——hotfix 修完同时合到 main 和 staging。**不要把它当成可选项**。

### 预防 2：每周 review 一次差异

```bash
# 看 main 上有哪些 staging 没有的 commit（应该是 hotfix）
git log staging..main --oneline

# 看 staging 上有哪些 main 没有的 commit（应该是待上线的新功能）
git log main..staging --oneline
```

如果第一条命令显示**有 commit 是几周前的**而 staging 没有 → 立刻合回。

### 预防 3：每次 staging→main 之前先反向合一次

```bash
# 准备上线前，先把 main 的 hotfix 拉回 staging
git checkout staging
git pull origin staging
git merge main --no-edit  # 把 main 的 hotfix 同步过来
# 在 staging 测试 OK 后再走 main
```

这样能保证 staging 永远 ⊇ main（staging 包含 main 的所有改动 + 自己的新功能）。

---

## 六、上线后第一个月的特殊节奏

### 第 1 周：稳定优先

- ❌ **不开发新功能**——专注稳定，让用户跑一周
- ✅ 每天看一遍 PM2 日志、订单数据、提现状态（见 `staging-to-production.md §十二` 监控清单）
- ✅ 有紧急 bug → 走 hotfix 流程
- ✅ 有小调整 → 在 staging 改，攒着不急上线

### 第 2-4 周：正常迭代

- ✅ 可以开新功能，但保持 staging 接近"可上线"状态
- ✅ 每周一次 staging→main 发布窗口（周二 / 周四）
- ✅ 持续真机验证 + 用户反馈跟进

### 大版本（v1.1+）：考虑 feature 分支

- 当一个版本要包含 5+ 个互不相关的大功能时，**每个大功能切一个 feature 分支**
- 完成的合到 staging，未完成的留在 feature 分支
- 这样上线粒度更细，回滚更精准

---

## 七、应急 / 异常情况

### 情况 1：staging 改坏了想完全重置

```bash
git checkout staging
git fetch origin
git reset --hard origin/main  # 让 staging 回到和 main 一样的状态
git push origin staging --force-with-lease  # 强推（小心，会丢 staging 上未合的改动）
```

**慎用**——会丢失 staging 上所有还没合到 main 的改动。

### 情况 2：刚 push main 发现是错的，没人用到

```bash
git checkout main
git revert -m 1 <MERGE_SHA>  # 用 -m 1 因为是 merge commit
git push origin main  # 自动重新部署
```

详见 `staging-to-production.md §九 回滚预案`。

### 情况 3：main 上有改动忘了同步到 staging

```bash
git checkout staging
git pull origin staging
git merge main --no-edit
git push origin staging
```

**应该每周做一次**作为习惯，不要等到出问题才同步。

### 情况 4：feature 分支落后 staging 太多

```bash
git checkout feature/payment-redesign
git rebase staging  # 把 feature 重新基于 staging 最新
# 或者
git merge staging --no-edit  # 把 staging 合到 feature
```

`rebase` 历史更干净，`merge` 更安全。如果 feature 已经 push 过 + 有别人在看，**只能用 merge**。

---

## 八、常见误区

### 误区 1：以为本地 = 测试环境

❌ 错：在本地（localhost）测过就直接 push main
✅ 对：本地只是开发层，必须先 push staging 跑真机测试，再合 main

### 误区 2：以为 staging→main 不会出错

❌ 错：staging 测过了就一定能上 main
✅ 对：staging 用沙箱第三方（支付宝沙箱 / 顺丰 UAT），切到生产连真实第三方会出新问题——必须按 `staging-to-production.md §八` 验证清单实测

### 误区 3：紧急时直接改 main 跳过 staging

❌ 错：先 push main 救火，过几天再补 staging
✅ 对：永远走 hotfix 分支，修完同时合 main 和 staging，**不留分化**

### 误区 4：以为合并 staging→main 会"覆盖"main

❌ 错：合并就是把 main 替换成 staging
✅ 对：Git merge 是把两个分支的历史合并起来——如果 main 上有 staging 没有的 commit（比如 hotfix），不会丢失

### 误区 5：以为切回 staging 就清空了 main 的改动

❌ 错：`git checkout staging` 把工作目录"切回"staging 的版本
✅ 对：`git checkout staging` 只是切换 HEAD 指针，main 分支的 commit 还在仓库里完整保留

---

## 九、维护规则速查

| 规则 | 强制级别 |
|---|---|
| 永远不直接在 main 写代码 | 🔴 铁律 |
| hotfix 修完必须合回 staging | 🔴 铁律 |
| staging→main 前必须复述改动 + 回滚路径 | 🔴 铁律（CLAUDE.md #10）|
| 一个 commit 一个逻辑改动 | 🔴 铁律（CLAUDE.md #10）|
| 大功能用 feature 分支隔离 | 🟡 强烈建议 |
| 每周 review `git log staging..main` 同步差异 | 🟡 强烈建议 |
| 不在周五下午 / 深夜上线 | 🟡 强烈建议 |
| 上线前先 `git merge main` 反向同步到 staging | 🟢 推荐习惯 |

---

## 十、决策树速查

```
要改代码了，怎么走？

├─ 是否紧急生产 bug？
│   ├─ 是 → 从 main 切 hotfix → 修 → 合 main → 合 staging
│   └─ 否 → 继续
│
├─ 改动周期是否 > 3 天 或跨多模块？
│   ├─ 是 → 从 staging 切 feature 分支
│   └─ 否 → 直接在 staging 上改
│
├─ 改动是否只涉及 App 端 JS（无原生层 / 无 env）？
│   ├─ 是 → commit 到 staging + 立刻 `eas update --branch production`
│   └─ 否 → 走标准 staging → main 部署流程
│
└─ 准备上 main 了？
    ├─ 是 → 走 staging-to-production.md §〇 拍板清单
    └─ 否 → 在 staging 继续打磨

```

每次上线前的最后一步：和 Claude（或自己）口头复述：
1. 本次上线包含哪些 commit（`git log main..staging --oneline`）
2. 是否包含破坏性 migration（如有，反向 SQL 在哪）
3. 回滚命令是什么（`git revert -m 1 <MERGE_SHA>`）
4. 上线后第一时间要验证的 5 件事
