-- 撤销头像历史功能（产品决策：不存历史以节省存储 + 简化 UX）
-- 反向操作 20260526010000_add_avatar_history 的 CREATE TABLE
DROP TABLE IF EXISTS "AvatarHistory" CASCADE;
