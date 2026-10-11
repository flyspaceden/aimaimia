# 小程序快线兼容入口

2026-10-10 用户将快线扩展到 App 与小程序的简单前端改动。现行范围、一次审查、定向 CI、直接合入 main 的持续授权及发布边界见 [App 与小程序简单前端快速 PR](frontend-fast-pr.md)。本文原规则由该文档替代，main 保护继续保留。

原自动化导入 `scripts/ci-ui-syntax.mjs` 保留兼容入口；实际判定共用 `scripts/ci-frontend-syntax.mjs`，既有 `miniapp-ui` 模式仍可用。
