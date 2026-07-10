import { Prisma, PrismaClient } from '@prisma/client';
import { resolveOrCreateNormalTreeNode } from './normal-tree-resolver';

const databaseUrl = process.env.NORMAL_TREE_POSTGRES_TEST_URL;
const describePostgres = databaseUrl ? describe : describe.skip;

describePostgres('resolveOrCreateNormalTreeNode PostgreSQL concurrency', () => {
  let prisma: PrismaClient;
  const userId = 'normal-tree-postgres-buyer';

  beforeAll(async () => {
    prisma = new PrismaClient({ datasourceUrl: databaseUrl });
    await prisma.$connect();
  });

  afterAll(async () => {
    if (!prisma) return;
    await prisma.normalProgress.deleteMany({ where: { userId } });
    await prisma.memberProfile.deleteMany({ where: { userId } });
    await prisma.normalTreeNode.deleteMany({});
    await prisma.user.deleteMany({ where: { id: userId } });
    await prisma.$disconnect();
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
          if (!['P2002', 'P2034'].includes(error?.code) || attempt === 3) throw error;
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
  });
});
