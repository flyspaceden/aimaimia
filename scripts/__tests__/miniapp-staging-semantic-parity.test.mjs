import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const root = new URL('../../', import.meta.url);
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
  assert.ok(manifest.exactFiles.length >= 34);
  for (const entry of manifest.exactFiles) {
    assert.equal(gitBlob(await read(entry.path)), entry.gitBlob, entry.path);
  }
});

test('intentional production differences strengthen marketplace behavior without importing Delivery', async () => {
  const paymentService = await readText('backend/src/modules/payment/payment.service.ts');
  const paymentController = await readText('backend/src/modules/payment/payment.controller.ts');
  const paymentModule = await readText('backend/src/modules/payment/payment.module.ts');
  const companyService = await readText('backend/src/modules/company/company.service.ts');
  const shipmentController = await readText('backend/src/modules/shipment/shipment.controller.ts');
  const shipmentModule = await readText('backend/src/modules/shipment/shipment.module.ts');
  const authController = await readText('backend/src/modules/auth/auth.controller.ts');
  const schema = await readText('backend/prisma/schema.prisma');

  assert.match(paymentService, /RefundSideEffectsService/);
  assert.doesNotMatch(paymentService, /DeliveryPaymentsService|isDeliveryMerchantOrderNo/);
  assert.doesNotMatch(paymentController, /DeliveryPaymentsService|isDeliveryMerchantOrderNo/);
  assert.match(paymentModule, /RefundSideEffectsService/);
  assert.doesNotMatch(paymentModule, /DeliveryModule/);

  assert.match(companyService, /async list\(tagId\?: string, keyword\?: string\)/);
  assert.match(companyService, /companyIsPublic && this\.uploadService\.canPreviewCompanyDocument/);
  assert.doesNotMatch(shipmentController, /DeliverySfCallbackService/);
  assert.doesNotMatch(shipmentModule, /DeliverySfCallbackService/);

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
  assert.deepEqual(paths, [
    'backend/src/modules/payment/payment.service.ts',
    'backend/src/modules/payment/payment.controller.ts',
    'backend/src/modules/payment/payment.module.ts',
    'backend/src/modules/company/company.service.ts',
    'backend/src/modules/shipment/sf-express.service.ts',
    'backend/src/modules/shipment/shipment.controller.ts',
    'backend/src/modules/shipment/shipment.module.ts',
    'backend/src/modules/auth/auth.controller.ts',
    'backend/prisma/schema.prisma',
  ]);
  for (const entry of manifest.intentionalCandidateDifferences) {
    assert.ok(entry.reason.length >= 20, `${entry.path} must explain why it differs`);
  }
});
