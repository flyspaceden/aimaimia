# GitHub 操作指南

## 项目结构

整个项目是一个 monorepo（单仓库），包含所有子项目：

```
根目录/
├── website/    → 官网（ai-maimai.com）
├── admin/      → 管理后台（admin.ai-maimai.com）
├── seller/     → 卖家中心（seller.ai-maimai.com）
├── backend/    → 后端 API（api.ai-maimai.com）
├── app/        → 买家 App（手机应用，不自动部署）
```

GitHub 仓库：https://github.com/flyspaceden/aimaimia.git

## 双分支策略（重要）

| 分支 | 部署到 | 用途 |
|------|--------|------|
| `staging` | **测试环境** test-admin/test-seller/test-api.ai-maimai.com | 功能测试、回归验证 |
| `main` | **生产环境** admin/seller/api.ai-maimai.com | 真实用户使用 |

**铁律：所有改动必须先到 staging 测过，再合并到 main。永远不要直接 push main。**

---

## 标准发布流程

### 第 1 步：在本地改代码 + 提交

```bash
# 进入项目根目录
cd ~/Desktop/农脉\ -\ AI赋能农业电商平台

# 确认在 staging 分支（如果不在就切过去）
git checkout staging
git pull origin staging   # 同步远端最新

# 改完代码后
git add -A                # 或 git add 具体文件
git commit -m "feat: 你的改动描述"
```

### 第 2 步：推到 staging → 自动部署到测试环境

```bash
git push origin staging
```

推送后 1-2 分钟，GitHub Actions 自动构建并部署：

- 改了 `website/` → 部署到 https://test-website... （目前生产/测试共用 website）
- 改了 `admin/` → 部署到 **https://test-admin.ai-maimai.com**
- 改了 `seller/` → 部署到 **https://test-seller.ai-maimai.com**
- 改了 `backend/` → SSH 到服务器更新 `aimaimai-api-test`（PM2），自动跑 `prisma migrate deploy` + reload

**前端构建时会注入 API 地址 = `https://test-api.ai-maimai.com/api/v1`，自动连测试后端。**

### 第 3 步：在测试环境验证

打开浏览器：
- 管理后台：https://test-admin.ai-maimai.com（账号 `admin` / `123456`）
- 卖家后台：https://test-seller.ai-maimai.com
- 后端 API：https://test-api.ai-maimai.com/api/v1/captcha（应返回 200）

测出 bug 就在 staging 继续改，重复第 1-3 步。

### 第 4 步：测试通过后，合并到 main → 自动部署到生产

```bash
# 切到 main 分支
git checkout main
git pull origin main

# 把 staging 已验证的改动合并进来
git merge staging --no-edit

# 推到 main → 自动部署到生产环境
git push origin main
```

GitHub Actions 同样会按改动路径分发：

- `admin/` → https://admin.ai-maimai.com
- `seller/` → https://seller.ai-maimai.com
- `backend/` → 服务器 `aimaimai-api-prod`（PM2），自动跑 prisma migrate + reload

**前端构建时会注入 API 地址 = `https://api.ai-maimai.com/api/v1`，连生产后端。**

### 第 5 步：切回 staging 继续下一轮开发

```bash
git checkout staging
```

---

## 手动触发部署（紧急场景）

GitHub 仓库 → **Actions** → **Deploy Sites & Backend** → 右上角 **Run workflow**：

1. **Branch**：选 `staging`（部署到测试）或 `main`（部署到生产）
2. **deploy_target**：
   - `all` — 部署全部（website + admin + seller + backend）
   - `website` / `admin` / `seller` / `backend` — 只部署其中之一

适用于：
- 改了配置文件（如 workflow 自身）但没碰业务代码，路径检测不会触发自动部署
- 服务器异常需要重新跑一遍部署
- 想强制重新构建某个站点

---

## 常见场景速查

### 场景 1：只想紧急修一个生产 bug，跳过测试
**不推荐，但有时必要：**
```bash
git checkout main
# 改代码
git add -A && git commit -m "hotfix: xxx"
git push origin main
# 修完后立即合回 staging
git checkout staging && git merge main && git push origin staging
```

### 场景 2：测试环境改坏了想重置
```bash
git checkout staging
git reset --hard origin/main      # 让 staging 回到 main 的状态
git push origin staging --force-with-lease
```

### 场景 3：查看部署是否成功
- GitHub 网页：仓库 → **Actions** → 看最新一行是绿色 ✅ 还是红色 ❌
- 服务器日志（后端部署失败时）：SSH 到 `8.163.16.32` → `pm2 logs aimaimai-api-test`（或 `-prod`）

### 场景 4：只改了 backend，前端没改
正常 push 即可，workflow 会自动检测只跑 `deploy-backend` job。

---

## 注意事项

- **永远在项目根目录执行命令**，不是子目录
- `.env` 文件包含密钥，已被 gitignore 排除，**不会也不要**提交
- 如果只想提交特定文件，用 `git add 具体文件名` 代替 `git add -A`，避免误提交无关改动
- 如果提示认证失败，运行 `gh auth login` 重新登录
- `app/` 的改动会推送到 GitHub 但**不会自动部署**（买家 App 走 EAS Build / 应用商店审核流程）
- 数据库 migration（`backend/prisma/migrations/`）会随 backend 部署自动执行 `prisma migrate deploy`，**不会有交互提示**，写 migration 时必须保证向后兼容
- 测试库 `testaimaimai` 和生产库 `aimaimai` 完全隔离，测试环境随便造数据无影响
