import { PrismaClient } from '@prisma/client';
import { DigitalAssetService } from '../src/modules/digital-asset/digital-asset.service';

export type BackfillOptions = {
  batchSize: number;
  dryRun: boolean;
};

export function parseBackfillOptions(
  argv = process.argv.slice(2),
  env: NodeJS.ProcessEnv = process.env,
): BackfillOptions {
  const batchArg = argv.find((arg) => arg.startsWith('--batch-size='));
  const parsedBatch = Number(batchArg?.split('=')[1] ?? env.DIGITAL_ASSET_BACKFILL_BATCH_SIZE ?? 100);
  const batchSize = Number.isFinite(parsedBatch)
    ? Math.min(Math.max(Math.floor(parsedBatch), 1), 500)
    : 100;
  return {
    batchSize,
    dryRun: !argv.includes('--execute'),
  };
}

export function buildReceivedOrderBackfillWhere() {
  return {
    status: 'RECEIVED',
    deletedAt: null,
    digitalAssetLedgers: {
      none: {
        type: 'CUMULATIVE_SPEND_CREDIT',
        direction: 'CREDIT',
      },
    },
  };
}

async function run() {
  const options = parseBackfillOptions();
  const prisma = new PrismaClient();
  const digitalAssetService = new DigitalAssetService(prisma as any);
  let scanned = 0;
  let credited = 0;

  try {
    while (true) {
      const orders = await (prisma as any).order.findMany({
        where: buildReceivedOrderBackfillWhere(),
        orderBy: [
          { receivedAt: 'asc' },
          { id: 'asc' },
        ],
        take: options.batchSize,
        select: {
          id: true,
          userId: true,
          totalAmount: true,
          goodsAmount: true,
          shippingFee: true,
          discountAmount: true,
          receivedAt: true,
        },
      });
      if (orders.length === 0) break;

      scanned += orders.length;
      if (options.dryRun) {
        console.log(`[dry-run] would backfill ${orders.length} received orders`);
        console.table(orders.map((order: any) => ({
          id: order.id,
          userId: order.userId,
          totalAmount: order.totalAmount,
          receivedAt: order.receivedAt,
        })));
        break;
      }

      for (const order of orders) {
        await digitalAssetService.creditOrderReceived(order.id, 'BACKFILL');
        credited += 1;
      }
      console.log(`backfilled batch: ${orders.length}, credited total: ${credited}`);
    }

    console.log(`digital asset backfill done: scanned=${scanned}, credited=${credited}, dryRun=${options.dryRun}`);
  } finally {
    await prisma.$disconnect();
  }
}

if (require.main === module) {
  run().catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
}
