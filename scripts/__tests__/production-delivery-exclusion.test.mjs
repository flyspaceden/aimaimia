import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import test from 'node:test';

const repositoryRoot = new URL('../../', import.meta.url);

async function exists(relativePath) {
  try {
    await access(new URL(relativePath, repositoryRoot));
    return true;
  } catch {
    return false;
  }
}

async function source(relativePath) {
  return readFile(new URL(relativePath, repositoryRoot), 'utf8');
}

const forbiddenPaths = [
  'delivery-admin/',
  'delivery-seller/',
  'backend/prisma-delivery/',
  'backend/src/delivery-prisma/',
  'backend/src/generated/delivery-client/',
  'backend/src/modules/delivery/',
  'backend/src/modules/shipment/delivery-sf-callback.service.ts',
  'backend/src/modules/shipment/delivery-sf-callback.service.spec.ts',
  'backend/src/modules/payment/__tests__/payment.service.delivery-callback.spec.ts',
  'backend/scripts/generate-delivery-client.cjs',
  'backend/scripts/copy-delivery-client-to-dist.cjs',
  'backend/scripts/copy-delivery-client-to-dist.spec.ts',
  'backend/scripts/cleanup-delivery-manifest-customizations.cjs',
  'app/delivery/',
  'src/repos/delivery/',
  'src/store/useDeliveryAuthStore.ts',
  'src/store/useDeliveryCartStore.ts',
  'src/theme/delivery.ts',
];

test('independent Delivery product paths stay out of the production candidate', async () => {
  for (const relativePath of forbiddenPaths) {
    assert.equal(await exists(relativePath), false, `${relativePath} must not enter the production candidate`);
  }
});

test('production runtime wiring has no independent Delivery database or portal', async () => {
  const files = [
    '.github/workflows/deploy-website.yml',
    '.github/workflows/e2e.yml',
    'backend/package.json',
    'backend/src/app.module.ts',
    'backend/src/modules/payment/payment.module.ts',
    'backend/src/modules/shipment/shipment.module.ts',
    'admin/src/layouts/AdminLayout.tsx',
    'admin/src/pages/login/index.tsx',
    'seller/src/pages/login/index.tsx',
    'website/src/App.tsx',
  ];
  const combined = (await Promise.all(files.map(source))).join('\n');
  for (const forbidden of [
    'DeliveryModule',
    'DeliveryPrismaService',
    'generated/delivery-client',
    'DeliveryPaymentsService',
    'DeliverySfCallbackService',
    'isDeliveryMerchantOrderNo',
    'DELIVERY_DATABASE_URL',
    'DELIVERY_USER_JWT_SECRET',
    'DELIVERY_ADMIN_JWT_SECRET',
    'DELIVERY_SELLER_JWT_SECRET',
    'prisma-delivery/schema.prisma',
    'prisma:delivery:',
    'copy-delivery-client-to-dist',
    'delivery-admin.ai-maimai.com',
    'delivery-seller.ai-maimai.com',
  ]) {
    assert.doesNotMatch(combined, new RegExp(forbidden.replaceAll('/', '\\/')));
  }
});

test('excluding Delivery does not remove the existing marketplace shipment path', async () => {
  const shipmentModule = await source('backend/src/modules/shipment/shipment.module.ts');
  const shipmentController = await source('backend/src/modules/shipment/shipment.controller.ts');
  const schema = await source('backend/prisma/schema.prisma');
  assert.match(shipmentModule, /SfExpressService/);
  assert.match(shipmentController, /sf\/callback\/\:token|sf\/callback\/\$\{token\}|sf\/callback\/:token/);
  assert.match(schema, /model Shipment\b/);
  assert.match(schema, /model OrderShippingCost\b/);
});
