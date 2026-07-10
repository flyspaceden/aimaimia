import { Prisma, PrismaClient } from '@prisma/client';
import { resolveOrCreateNormalTreeNode } from './normal-tree-resolver';
import { isNormalTreeEnrollmentConflict } from '../order/checkout.service';

function assertNormalTreeTestDatabaseUrl(rawUrl: string): { databaseName: string } {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error('NORMAL_TREE_POSTGRES_TEST_URL 必须是有效的 PostgreSQL 专用测试库 URL');
  }
  const databaseName = decodeURIComponent(parsed.pathname.replace(/^\//, ''));
  if (!/(^|[_-])test($|[_-])/i.test(databaseName)) {
    throw new Error('NORMAL_TREE_POSTGRES_TEST_URL 必须指向库名含 test 的专用测试库');
  }
  return { databaseName };
}

describe('normal-tree PostgreSQL test database guard', () => {
  it('rejects default and non-test database names', () => {
    expect(() => assertNormalTreeTestDatabaseUrl(
      'postgresql://postgres@127.0.0.1:5432/postgres?schema=public',
    )).toThrow('专用测试库');
    expect(() => assertNormalTreeTestDatabaseUrl(
      'postgresql://postgres@127.0.0.1:5432/nongmai?schema=public',
    )).toThrow('专用测试库');
  });

  it('accepts an explicitly named test database', () => {
    expect(assertNormalTreeTestDatabaseUrl(
      'postgresql://postgres@127.0.0.1:5432/nongmai_test?schema=public',
    ).databaseName).toBe('nongmai_test');
  });
});

const databaseUrl = process.env.NORMAL_TREE_POSTGRES_TEST_URL;
const databaseConfig = databaseUrl ? assertNormalTreeTestDatabaseUrl(databaseUrl) : null;
const describePostgres = databaseUrl ? describe : describe.skip;

describePostgres('resolveOrCreateNormalTreeNode PostgreSQL concurrency', () => {
  let prisma: PrismaClient;
  let preexistingNodeIds = new Set<string>();
  const userId = `normal-tree-postgres-buyer-${Date.now()}`;

  beforeAll(async () => {
    prisma = new PrismaClient({ datasourceUrl: databaseUrl });
    await prisma.$connect();
    const current = await prisma.$queryRawUnsafe<Array<{ database_name: string }>>(
      'SELECT current_database() AS database_name',
    );
    if (current[0]?.database_name !== databaseConfig?.databaseName) {
      throw new Error('普通树并发测试连接的数据库与专用测试库 URL 不一致');
    }
    const preexistingNodes = await prisma.normalTreeNode.findMany({ select: { id: true } });
    preexistingNodeIds = new Set(preexistingNodes.map((node) => node.id));
    if (preexistingNodeIds.size > 0) {
      throw new Error('普通树并发测试要求专用测试库的 NormalTreeNode 为空');
    }
  });

  afterAll(async () => {
    if (!prisma) return;
    try {
      await prisma.normalProgress.deleteMany({ where: { userId } });
      await prisma.memberProfile.deleteMany({ where: { userId } });
      const createdNodes = (await prisma.normalTreeNode.findMany({
        select: { id: true, level: true },
      }))
        .filter((node) => !preexistingNodeIds.has(node.id))
        .sort((a, b) => b.level - a.level);
      for (const node of createdNodes) {
        await prisma.normalTreeNode.delete({ where: { id: node.id } });
      }
      await prisma.user.deleteMany({ where: { id: userId } });
    } finally {
      await prisma.$disconnect();
    }
  });

  it('converges two fixed-snapshot first enrollments after retrying in a new transaction', async () => {
    await prisma.user.create({
      data: {
        id: userId,
        memberProfile: { create: { tier: 'NORMAL' } },
      },
    });

    let initialReads = 0;
    let releaseInitialReads!: () => void;
    const bothSnapshotsEstablished = new Promise<void>((resolve) => {
      releaseInitialReads = resolve;
    });
    const observedConflictCodes: string[] = [];

    const enrollWithRetry = async () => {
      for (let attempt = 1; attempt <= 3; attempt += 1) {
        try {
          return await prisma.$transaction(async (tx) => {
            const wrappedProgress = {
              findUnique: async (args: any) => {
              const result = await tx.normalProgress.findUnique(args);
              if (attempt === 1 && result === null) {
                initialReads += 1;
                if (initialReads === 2) releaseInitialReads();
                await bothSnapshotsEstablished;
              }
              return result;
              },
              upsert: (args: any) => tx.normalProgress.upsert(args),
              update: (args: any) => tx.normalProgress.update(args),
            };
            const wrappedTx = {
              normalProgress: wrappedProgress,
              normalTreeNode: tx.normalTreeNode,
              memberProfile: tx.memberProfile,
              $executeRawUnsafe: (...args: any[]) => (tx.$executeRawUnsafe as any)(...args),
            };
            return resolveOrCreateNormalTreeNode(wrappedTx as any, userId, 3);
          }, {
            isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
            maxWait: 5_000,
            timeout: 15_000,
          });
        } catch (error: any) {
          observedConflictCodes.push(String(error?.code ?? 'unknown'));
          if (
            !(error?.code === 'P2034' || isNormalTreeEnrollmentConflict(error))
            || attempt === 3
          ) {
            throw error;
          }
        }
      }
      throw new Error('normal tree enrollment retry exhausted');
    };

    const [first, second] = await Promise.all([enrollWithRetry(), enrollWithRetry()]);

    expect(first.id).toBe(second.id);
    await expect(prisma.normalTreeNode.count({ where: { userId } })).resolves.toBe(1);
    await expect(prisma.normalProgress.findUnique({ where: { userId } })).resolves.toMatchObject({
      treeNodeId: first.id,
    });
    await expect(prisma.memberProfile.findUnique({ where: { userId } })).resolves.toMatchObject({
      normalTreeNodeId: first.id,
    });
    expect(observedConflictCodes.some((code) => ['P2002', 'P2034'].includes(code))).toBe(true);

    let duplicateError: any;
    try {
      await prisma.normalTreeNode.create({
        data: {
          rootId: first.rootId,
          userId,
          parentId: first.parentId,
          level: first.level,
          position: first.position + 100,
        },
      });
    } catch (error) {
      duplicateError = error;
    }
    expect(duplicateError?.code).toBe('P2002');
    expect(duplicateError?.meta?.modelName).toBe('NormalTreeNode');
    expect(isNormalTreeEnrollmentConflict(duplicateError)).toBe(true);
  });
});
