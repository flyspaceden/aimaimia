-- 新增 SmsPurpose 枚举值：BUYER_RESET / SELLER_RESET
-- 用于买家 App 和卖家后台的忘记密码流程，彻底隔离两端 SMS scope
-- 详见 docs/superpowers/specs/2026-04-23-forgot-password-design.md

ALTER TYPE "SmsPurpose" ADD VALUE 'BUYER_RESET';
ALTER TYPE "SmsPurpose" ADD VALUE 'SELLER_RESET';
