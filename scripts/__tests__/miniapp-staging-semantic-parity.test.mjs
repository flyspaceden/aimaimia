import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const root = new URL('../../', import.meta.url);
const rootPath = fileURLToPath(root);
const manifest = JSON.parse(
  await readFile(new URL('./miniapp-staging-semantic-parity.json', import.meta.url), 'utf8'),
);

const read = (relativePath) => readFile(new URL(relativePath, root));
const readText = async (relativePath) => (await read(relativePath)).toString('utf8');
const gitBlob = (content) => createHash('sha1')
  .update(`blob ${content.length}\0`)
  .update(content)
  .digest('hex');

test('tested mini-program marketplace services remain byte-identical to the frozen staging baseline', async () => {
  assert.equal(manifest.sourceStagingCommit, 'acc0e08c303eef76af3bb4ca9d3e9a8c95c4ebb2');
  assert.ok(manifest.exactFiles.length >= 42);
  for (const entry of manifest.exactFiles) {
    const sourceBlob = execFileSync(
      'git',
      ['rev-parse', `${manifest.sourceStagingCommit}:${entry.path}`],
      { cwd: rootPath, encoding: 'utf8' },
    ).trim();
    assert.equal(entry.gitBlob, sourceBlob, `${entry.path} manifest source`);
    assert.equal(gitBlob(await read(entry.path)), entry.gitBlob, entry.path);
  }
});

test('intentional production differences strengthen marketplace behavior without importing Delivery', async () => {
  const paymentService = await readText('backend/src/modules/payment/payment.service.ts');
  const paymentController = await readText('backend/src/modules/payment/payment.controller.ts');
  const paymentModule = await readText('backend/src/modules/payment/payment.module.ts');
  const companyService = await readText('backend/src/modules/company/company.service.ts');
  const appModule = await readText('backend/src/app.module.ts');
  const healthService = await readText('backend/src/modules/health/health.service.ts');
  const shipmentController = await readText('backend/src/modules/shipment/shipment.controller.ts');
  const shipmentModule = await readText('backend/src/modules/shipment/shipment.module.ts');
  const taskService = await readText('backend/src/modules/task/task.service.ts');
  const authController = await readText('backend/src/modules/auth/auth.controller.ts');
  const schema = await readText('backend/prisma/schema.prisma');

  assert.match(paymentService, /RefundSideEffectsService/);
  assert.doesNotMatch(paymentService, /DeliveryPaymentsService|isDeliveryMerchantOrderNo/);
  assert.doesNotMatch(paymentController, /DeliveryPaymentsService|isDeliveryMerchantOrderNo/);
  assert.match(paymentModule, /RefundSideEffectsService/);
  assert.doesNotMatch(paymentModule, /DeliveryModule/);

  assert.match(companyService, /async list\(tagId\?: string, keyword\?: string\)/);
  assert.match(companyService, /companyIsPublic && this\.uploadService\.canPreviewCompanyDocument/);
  assert.doesNotMatch(appModule, /DeliveryModule/);
  assert.doesNotMatch(healthService, /DeliveryPrismaService|deliveryDatabase/);
  assert.match(healthService, /releaseSha: process\.env\.RELEASE_SHA \|\| null/);
  assert.doesNotMatch(shipmentController, /DeliverySfCallbackService/);
  assert.doesNotMatch(shipmentModule, /DeliverySfCallbackService/);
  assert.match(taskService, /TASK_CLAIM_UNAVAILABLE/);
  assert.doesNotMatch(taskService, /taskCompletion\.create/);

  assert.match(authController, /oauth\/wechat-miniapp/);
  assert.match(authController, /h5-wechat\/invite-login/);
  for (const symbol of [
    'enum FulfillmentMode',
    'model PickupPoint',
    'model PickupFulfillment',
    'model MiniProgramSubscriptionConsent',
    'model WechatShippingOutbox',
    'model RefundSideEffectOutbox',
  ]) assert.match(schema, new RegExp(symbol));
});

test('the parity manifest documents every intentional non-identical production surface', () => {
  const paths = manifest.intentionalCandidateDifferences.map((entry) => entry.path);
  const runtimeDiffPaths = execFileSync(
    'git',
    [
      'diff', '--name-only', manifest.sourceStagingCommit, '--',
      'backend/src', 'backend/prisma/schema.prisma',
    ],
    { cwd: rootPath, encoding: 'utf8' },
  )
    .trim()
    .split('\n')
    .filter(Boolean)
    .filter((path) => !path.endsWith('.spec.ts'))
    .filter((path) => !path.startsWith('backend/src/modules/delivery/'))
    .filter((path) => !path.startsWith('backend/src/delivery-prisma/'))
    .filter((path) => !path.startsWith('backend/src/generated/delivery-client/'))
    .sort();
  assert.deepEqual(runtimeDiffPaths, paths);
  assert.deepEqual(paths, [
    'backend/prisma/schema.prisma',
    'backend/src/app.module.ts',
    'backend/src/main.ts',
    'backend/src/modules/auth/auth.controller.ts',
    'backend/src/modules/auth/dto/change-password.dto.ts',
    'backend/src/modules/auth/dto/wechat-deletion-proof.dto.ts',
    'backend/src/modules/cart/cart.controller.ts',
    'backend/src/modules/company/company.service.ts',
    'backend/src/modules/health/health.module.ts',
    'backend/src/modules/health/health.service.ts',
    'backend/src/modules/mini-program/mini-program-subscription.service.ts',
    'backend/src/modules/payment/dto/payment-callback.dto.ts',
    'backend/src/modules/payment/payment.controller.ts',
    'backend/src/modules/payment/payment.module.ts',
    'backend/src/modules/payment/payment.service.ts',
    'backend/src/modules/payment/refund-side-effects.service.ts',
    'backend/src/modules/profit/money-allocation.ts',
    'backend/src/modules/shipment/delivery-sf-callback.service.ts',
    'backend/src/modules/shipment/sf-express.service.ts',
    'backend/src/modules/shipment/shipment.controller.ts',
    'backend/src/modules/shipment/shipment.module.ts',
  ]);
  for (const entry of manifest.intentionalCandidateDifferences) {
    assert.ok(entry.reason.length >= 20, `${entry.path} must explain why it differs`);
  }
});
