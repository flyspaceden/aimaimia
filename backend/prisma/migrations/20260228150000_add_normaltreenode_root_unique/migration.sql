-- 安全版：先清理可能的重复根节点，再确保唯一索引存在
-- 防止历史库多根导致迁移在本步骤失败

-- 1. 删除重复的 level=0 根节点（保留最早创建的一个）
DELETE FROM "NormalTreeNode"
WHERE "level" = 0
  AND "id" NOT IN (
    SELECT "id" FROM "NormalTreeNode"
    WHERE "level" = 0
    ORDER BY "createdAt" ASC
    LIMIT 1
  );

-- 2. 创建唯一索引（IF NOT EXISTS 兼容重复执行）
CREATE UNIQUE INDEX IF NOT EXISTS "NormalTreeNode_root_unique"
  ON "NormalTreeNode"("level")
  WHERE "level" = 0;
