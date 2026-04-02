# GitHub 操作指南

## 首次连接（只需做一次）

```bash
# 1. 安装 GitHub CLI（如果没有）
brew install gh

# 2. 登录 GitHub
gh auth login
# 选择 GitHub.com → HTTPS → 按提示完成登录

# 3. 进入 website 目录



# 4. 初始化 git 仓库
git init
git remote add origin https://github.com/你的用户名/你的仓库名.git
git branch -M main

# 5. 首次推送
git add -A
git commit -m "首次提交"
git push -u origin main
```

## 日常更新（每次改完代码后）

```bash
# 进入 website 目录
cd website

# 暂存所有改动
git add -A

# 提交（写你的描述）
git commit -m "你的提交描述"

# 推送到 GitHub
git push origin main
```

推送后等 1-2 分钟，GitHub Actions 会自动部署网站。

## 注意事项

- `.env` 文件包含密钥，**不要提交**。如果不想提交某些文件，用 `git add 具体文件名` 代替 `git add -A`
- 确保在 `website/` 目录下执行，不是项目根目录
- 如果提示认证失败，重新运行 `gh auth login`
