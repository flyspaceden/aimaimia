import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const script = fileURLToPath(new URL('../../backend/scripts/verify-miniapp-production-config.cjs', import.meta.url));
const { privateKey, publicKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  publicKeyEncoding: { type: 'spki', format: 'pem' },
});

const validEnv = {
  NODE_ENV: 'production',
  DATABASE_URL: 'postgresql://prod-user:prod-pass@db.internal:5432/aimaimai',
  DELIVERY_DATABASE_URL: 'postgresql://prod-user:prod-pass@db.internal:5432/aimaimai_delivery',
  REDIS_URL: 'redis://redis.internal:6379',
  JWT_SECRET: 'ci-buyer-jwt-secret-000000000001',
  ADMIN_JWT_SECRET: 'ci-admin-jwt-secret-000000000002',
  SELLER_JWT_SECRET: 'ci-seller-jwt-secret-000000000003',
  DELIVERY_USER_JWT_SECRET: 'ci-delivery-user-jwt-secret-000004',
  DELIVERY_ADMIN_JWT_SECRET: 'ci-delivery-admin-jwt-secret-000005',
  DELIVERY_SELLER_JWT_SECRET: 'ci-delivery-seller-jwt-secret-000006',
  DATA_ENCRYPTION_KEY: 'ci-independent-data-encryption-secret-000007',
  CORS_ORIGINS: 'https://admin.ai-maimai.com,https://seller.ai-maimai.com',
  TRUST_PROXY: '1',
  WECHAT_MOCK: 'false',
  WECHAT_MINIAPP_MOCK: 'false',
  WECHAT_MINIAPP_APP_ID: 'wx1b33112db0d5267b',
  WECHAT_MINIAPP_APP_SECRET: 'ci-only-miniapp-secret-never-log',
  WECHAT_MINIAPP_SUBSCRIBE_STATE: 'formal',
  WECHAT_MINIAPP_CODE_ENV_VERSION: 'release',
  WECHAT_MINIAPP_CODE_CHECK_PATH: 'true',
  WECHAT_PAY_APP_ID: 'wx0000000000000001',
  WECHAT_PAY_MCH_ID: '1603917538',
  WECHAT_PAY_API_V3_KEY: '12345678901234567890123456789012',
  WECHAT_PAY_MERCHANT_CERT_SERIAL: 'ABC123456789',
  WECHAT_PAY_MERCHANT_CERT: publicKey,
  WECHAT_PAY_MERCHANT_PRIVATE_KEY: privateKey,
  WECHAT_PAY_PUBLIC_KEY_ID: 'PUB_KEY_ID_123456789',
  WECHAT_PAY_PUBLIC_KEY: publicKey,
  WECHAT_PAY_NOTIFY_URL: 'https://api.ai-maimai.com/api/v1/payments/wechat/notify',
  WECHAT_TRANSFER_ENABLED: 'true',
  WECHAT_TRANSFER_NOTIFY_URL: 'https://api.ai-maimai.com/api/v1/bonus/withdraw/wechat/notify',
  WECHAT_TRANSFER_SCENE_ID: '1005',
  WECHAT_TRANSFER_USER_RECV_PERCEPTION: '劳务报酬',
  PICKUP_FULFILLMENT_ENABLED: 'true',
  PICKUP_TOKEN_SECRET: 'ci-only-pickup-secret-at-least-32-bytes',
  SMS_MOCK: 'false',
  SMS_ACCESS_KEY_ID: 'ci-sms-access-key-id',
  SMS_ACCESS_KEY_SECRET: 'ci-sms-access-key-secret',
  SMS_SIGN_NAME: 'AI爱买买',
  SMS_TEMPLATE_CODE: 'SMS_123456789',
  DELIVERY_SMS_MOCK: 'false',
  DELIVERY_WECHAT_MOCK: 'false',
  SF_ENV: 'PROD',
  SF_API_URL: 'https://sfapi.sf-express.com/std/service',
  SF_CLIENT_CODE: 'ci-client-code',
  SF_CHECK_WORD: 'ci-check-word',
  SF_MONTHLY_ACCOUNT_PROD: 'ci-monthly-account',
  SF_PUSH_SECRET: '0123456789abcdef0123456789abcdef',
  SF_TEMPLATE_CODE: 'AIMAI_WAYBILL_ci-client-code',
  SF_CALLBACK_URL: 'https://api.ai-maimai.com/api/v1/shipments/sf/callback/0123456789abcdef0123456789abcdef',
};

function run(overrides = {}) {
  return spawnSync(process.execPath, [script], {
    encoding: 'utf8',
    env: { ...validEnv, ...overrides },
  });
}

test('miniapp production preflight rejects missing or mock provider configuration', () => {
  const missing = spawnSync(process.execPath, [script], {
    encoding: 'utf8',
    env: { NODE_ENV: 'production' },
  });
  assert.notEqual(missing.status, 0);
  assert.doesNotMatch(`${missing.stdout}${missing.stderr}`, /ci-only-miniapp-secret/);

  const mockLogin = run({ WECHAT_MINIAPP_MOCK: 'true' });
  assert.notEqual(mockLogin.status, 0);

  const unsafeCodeEnvironment = run({ WECHAT_MINIAPP_CODE_ENV_VERSION: 'develop' });
  assert.notEqual(unsafeCodeEnvironment.status, 0);

  const missingRedis = run({ REDIS_URL: '' });
  assert.notEqual(missingRedis.status, 0);

  const missingSmsCredential = run({ SMS_TEMPLATE_CODE: '' });
  assert.notEqual(missingSmsCredential.status, 0);

  const sandboxSfEndpoint = run({ SF_API_URL: 'https://sfapi-sbox.sf-express.com/std/service' });
  assert.notEqual(sandboxSfEndpoint.status, 0);

  const mismatchedSfTemplate = run({ SF_TEMPLATE_CODE: 'AIMAI_WAYBILL_other-client' });
  assert.notEqual(mismatchedSfTemplate.status, 0);

  const stagingCallback = run({
    WECHAT_PAY_NOTIFY_URL: 'https://test-api.ai-maimai.com/api/v1/payments/wechat/notify',
  });
  assert.notEqual(stagingCallback.status, 0);
});

test('miniapp production preflight accepts a complete release configuration without printing secrets', () => {
  const result = run();
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /miniapp_production_config=valid/);
  assert.doesNotMatch(`${result.stdout}${result.stderr}`, /ci-only-miniapp-secret|12345678901234567890123456789012/);
});
