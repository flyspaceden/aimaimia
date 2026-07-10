import { Prisma } from '@prisma/client';
import { MAX_TREE_DEPTH, NORMAL_ROOT_ID } from '../bonus/engine/constants';

export interface NormalTreeNodeSnapshot {
  id: string;
  rootId: string;
  userId: string | null;
  parentId: string | null;
  level: number;
  position: number;
}

async function findExistingNode(
  tx: Prisma.TransactionClient,
  userId: string,
): Promise<NormalTreeNodeSnapshot | null> {
  const progress = await tx.normalProgress.findUnique({ where: { userId } });
  if (progress?.treeNodeId) {
    const progressNode = await tx.normalTreeNode.findUnique({
      where: { id: progress.treeNodeId },
    });
    if (progressNode) return progressNode;
  }

  const existingNode = await tx.normalTreeNode.findUnique({ where: { userId } });
  if (!existingNode) return null;

  await tx.normalProgress.upsert({
    where: { userId },
    create: { userId, treeNodeId: existingNode.id },
    update: { treeNodeId: existingNode.id },
  });
  await tx.memberProfile.updateMany({
    where: { userId },
    data: {
      normalTreeNodeId: existingNode.id,
      normalJoinedAt: new Date(),
    },
  });
  return existingNode;
}

export async function resolveOrCreateNormalTreeNode(
  tx: Prisma.TransactionClient,
  userId: string,
  branchFactor: number,
): Promise<NormalTreeNodeSnapshot> {
  const fastPathNode = await findExistingNode(tx, userId);
  if (fastPathNode) return fastPathNode;

  // Only first enrollment takes the global placement lock. Lock waiters must
  // re-read because another transaction may have inserted this user's node.
  await tx.$executeRawUnsafe('SELECT pg_advisory_xact_lock(2026022801)');
  const lockedNode = await findExistingNode(tx, userId);
  if (lockedNode) return lockedNode;

  await tx.normalProgress.upsert({
    where: { userId },
    create: { userId },
    update: {},
  });

  let rootNode = await tx.normalTreeNode.findFirst({
    where: { rootId: NORMAL_ROOT_ID, level: 0 },
  });
  if (!rootNode) {
    rootNode = await tx.normalTreeNode.create({
      data: {
        rootId: NORMAL_ROOT_ID,
        userId: null,
        level: 0,
        position: 0,
      },
    });
  }

  for (let level = 1; level <= MAX_TREE_DEPTH; level += 1) {
    const parents = await tx.normalTreeNode.findMany({
      where: { rootId: NORMAL_ROOT_ID, level: level - 1 },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      select: { id: true },
    });
    if (parents.length === 0) break;

    const childPositions = await tx.normalTreeNode.findMany({
      where: {
        parentId: { in: parents.map((parent) => parent.id) },
        level,
      },
      select: { parentId: true, position: true },
    });
    const usedByParent = new Map<string, Set<number>>(
      parents.map((parent) => [parent.id, new Set<number>()]),
    );
    for (const child of childPositions) {
      if (child.parentId) usedByParent.get(child.parentId)?.add(child.position);
    }

    const parent = parents.reduce<(typeof parents)[number] | null>((best, candidate) => {
      const usedCount = usedByParent.get(candidate.id)?.size ?? 0;
      if (usedCount >= branchFactor) return best;
      if (!best) return candidate;
      const bestUsedCount = usedByParent.get(best.id)?.size ?? 0;
      return usedCount < bestUsedCount ? candidate : best;
    }, null);
    if (!parent) continue;

    const used = usedByParent.get(parent.id) ?? new Set<number>();
    let position = 0;
    while (used.has(position)) position += 1;

    const node = await tx.normalTreeNode.create({
      data: {
        rootId: NORMAL_ROOT_ID,
        userId,
        parentId: parent.id,
        level,
        position,
      },
    });
    await tx.normalTreeNode.update({
      where: { id: parent.id },
      data: { childrenCount: { increment: 1 } },
    });
    await tx.memberProfile.updateMany({
      where: { userId },
      data: {
        normalTreeNodeId: node.id,
        normalJoinedAt: new Date(),
      },
    });
    await tx.normalProgress.update({
      where: { userId },
      data: { treeNodeId: node.id },
    });
    return node;
  }

  throw new Error(`Normal tree has no available placement for user ${userId}`);
}
