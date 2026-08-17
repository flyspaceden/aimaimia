import { Prisma, PrismaClient } from '@prisma/client';
import { ProductPricingService } from '../src/modules/product/product-pricing.service';
import { ProfitSafetyService } from '../src/modules/profit/profit-safety.service';

const prisma = new PrismaClient();

async function buildPlan() {
  const pricing = new ProductPricingService(prisma as any);
  const markupRate = await pricing.getCurrentMarkupRate(prisma as any);
  return prisma.$transaction(
    (tx) => pricing.buildMarkupRepricePlan(tx, markupRate),
    {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      maxWait: 5_000,
      timeout: 120_000,
    },
  );
}

async function executeReprice(expectedMarkup: number, expectedPreviewToken: string) {
  const pricing = new ProductPricingService(prisma as any);
  const profitSafety = new ProfitSafetyService(prisma as any);
  let executionPlan: Awaited<ReturnType<typeof pricing.buildMarkupRepricePlan>> | undefined;
  const output = await profitSafety.withCandidateChange(async (tx) => {
    const markupRate = await pricing.getCurrentMarkupRate(tx);
    if (Math.abs(markupRate - expectedMarkup) > 0.000001) {
      throw new Error(`当前加价率已变化：expected=${expectedMarkup} actual=${markupRate}`);
    }
    executionPlan = await pricing.buildMarkupRepricePlan(tx, markupRate);
    if (executionPlan.preview.previewToken !== expectedPreviewToken) {
      throw new Error('dry-run 价格清单已过期，请重新生成预览并使用新的 preview token');
    }
    return {
      skuUpserts: executionPlan.profitSafetySkus,
      changeNote: `one-time product reprice at markup ${markupRate}`,
    };
  }, async (tx) => {
    if (!executionPlan) throw new Error('商品价格执行计划缺失');
    return pricing.applyMarkupReprice(tx, executionPlan);
  });
  return { plan: executionPlan!, result: output.result, ruleVersion: output.ruleVersion };
}

function printPlan(
  plan: Awaited<ReturnType<typeof buildPlan>>,
  mode: 'dry-run' | 'execute',
) {
  const affected = plan.items.filter(
    (item) => Math.abs(item.currentPrice - item.nextPrice) > 0.000001,
  );
  console.log(JSON.stringify({ mode, ...plan.preview }));
  for (const item of affected) {
    const escapedSkuId = item.skuId.replace(/'/g, "''");
    console.log(JSON.stringify({
      productId: item.productId,
      productTitle: item.productTitle,
      skuId: item.skuId,
      skuTitle: item.skuTitle,
      cost: item.cost,
      currentPrice: item.currentPrice,
      nextPrice: item.nextPrice,
      rollbackSql: `UPDATE \"ProductSKU\" SET \"price\" = ${item.currentPrice.toFixed(2)} WHERE \"id\" = '${escapedSkuId}';`,
    }));
  }
  if (affected.length > 0) {
    const rollbackProductIds = [...new Set(affected.map((item) => item.productId))]
      .map((id) => `'${id.replace(/'/g, "''")}'`)
      .join(', ');
    console.log(JSON.stringify({
      rollbackFinalizeSql: `UPDATE \"Product\" AS p SET \"basePrice\" = r.min_price, \"cost\" = r.min_cost FROM (SELECT \"productId\", MIN(\"price\") AS min_price, MIN(\"cost\") AS min_cost FROM \"ProductSKU\" WHERE \"status\" = 'ACTIVE' GROUP BY \"productId\") AS r WHERE p.\"id\" = r.\"productId\" AND p.\"id\" IN (${rollbackProductIds});`,
    }));
  }
  return affected;
}

export async function runRepriceProducts(execute = process.argv.includes('--execute')) {
  const expectedMarkupArg = process.argv.find((arg) => arg.startsWith('--expected-markup='));
  const previewTokenArg = process.argv.find((arg) => arg.startsWith('--preview-token='));
  const expectedMarkup = expectedMarkupArg
    ? Number(expectedMarkupArg.slice('--expected-markup='.length))
    : undefined;
  const expectedPreviewToken = previewTokenArg?.slice('--preview-token='.length);
  if (!execute) {
    const initialPlan = await buildPlan();
    printPlan(initialPlan, 'dry-run');
    return initialPlan.preview;
  }
  if (!Number.isFinite(expectedMarkup) || !expectedPreviewToken) {
    throw new Error('执行模式必须同时传入 --expected-markup=<当前值> 和 --preview-token=<dry-run token>');
  }

  const execution = await executeReprice(Number(expectedMarkup), expectedPreviewToken);
  printPlan(execution.plan, 'execute');
  const verification = await buildPlan();
  if (verification.preview.affectedSkuCount !== 0) {
    throw new Error(`售价重算后仍有 ${verification.preview.affectedSkuCount} 个 SKU 不一致`);
  }
  console.log(JSON.stringify({
    mode: 'verified',
    updatedSkuCount: execution.result.affectedSkuCount,
    remainingMismatchCount: verification.preview.affectedSkuCount,
  }));
  return execution.result;
}

if (require.main === module) {
  runRepriceProducts()
    .catch((error) => {
      console.error('[reprice-products] failed', error);
      process.exitCode = 1;
    })
    .finally(() => prisma.$disconnect());
}
