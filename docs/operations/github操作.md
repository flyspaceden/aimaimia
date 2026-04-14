# GitHub 操作指南

## 项目结构

整个项目是一个 monorepo（单仓库），包含所有子项目：

```
根目录/
├── website/    → 爱买买.com（官网）
├── admin/      → admin.爱买买.com（管理后台）
├── seller/     → seller.爱买买.com（卖家中心）
├── app/        → 买家 App（手机应用，不自动部署）
├── backend/    → 后端 API（不自动部署）
```

GitHub 仓库：https://github.com/flyspaceden/aimaimia.git

## 日常更新（每次改完代码后）

```bash
# 1. 进入项目根目录
cd ~/Desktop/农脉\ -\ AI赋能农业电商平台

# 2. 暂存所有改动
git add -A

# 3. 提交（写你的描述）
git commit -m "你的提交描述"

# 4. 推送到 GitHub
git push origin main
```

推送后等 1-2 分钟，GitHub Actions 会自动检测你改了哪个目录，只部署对应的站点：

| 改动目录 | 自动部署到 |
|---------|-----------|
| `website/` | 爱买买.com |
| `admin/` | admin.爱买买.com |
| `seller/` | seller.爱买买.com |

## 手动触发部署

在 GitHub 仓库 → Actions → Deploy All Sites → Run workflow，选择部署目标：
- `all` — 部署全部三个站点
- `website` — 只部署官网
- `admin` — 只部署管理后台
- `seller` — 只部署卖家中心

## 注意事项

- 所有命令在**项目根目录**执行，不是子目录
- `.env` 文件包含密钥，已被 gitignore 排除，不会提交
- 如果只想提交特定文件，用 `git add 具体文件名` 代替 `git add -A`
- 如果提示认证失败，运行 `gh auth login` 重新登录
- `app/` 和 `backend/` 的改动会推送到 GitHub 但不会自动部署
