#!/usr/bin/env node

const fs = require('node:fs');
const path = require('node:path');
const { createPrivateKey, createPublicKey } = require('node:crypto');

try {
  require('dotenv').config({ path: path.resolve(process.cwd(), '.env'), override: false });
} catch {
  // CI 通过进程环境注入配置；dotenv 不可用时仍继续执行显式校验。
}

const errors = [];
const value = (key) => String(process.env[key] ?? '').trim();
const requireValue = (key) => {
  const current = value(key);
  if (!current) errors.push(`${key} 未配置`);
  return current;
};
const requireFalse = (key) => {
  if (value(key).toLowerCase() !== 'false') errors.push(`${key} 必须显式为 false`);
};
const requireTrue = (key) => {
  if (value(key).toLowerCase() !== 'true') errors.push(`${key} 必须显式为 true`);
};
const requireExact = (key, expected) => {
  if (value(key) !== expected) errors.push(`${key} 与正式环境约定不一致`);
};
const readPem = (inlineKey, pathKey) => {
  const inline = value(inlineKey);
  if (inline) return inline.replace(/\\n/g, '\n');
  const configuredPath = value(pathKey);
  if (!configuredPath) return '';
  try {
    return fs.readFileSync(path.resolve(process.cwd(), configuredPath), 'utf8').trim();
  } catch {
    errors.push(`${pathKey} 指向的文件不可读`);
    return '';
  }
};
const requireHttpsUrl = (key, expectedHost, expectedPathPrefix) => {
  const raw = requireValue(key);
  if (!raw) return null;
  try {
    const parsed = new URL(raw);
    if (
      parsed.protocol !== 'https:'
      || parsed.hostname !== expectedHost
      || parsed.username
      || parsed.password
      || parsed.hash
      || !parsed.pathname.startsWith(expectedPathPrefix)
    ) {
      errors.push(`${key} 必须使用正式 HTTPS 域名和约定路径`);
    }
    return parsed;
  } catch {
    errors.push(`${key} 不是合法 URL`);
    return null;
  }
};

requireExact('NODE_ENV', 'production');
for (const key of ['DATABASE_URL', 'DELIVERY_DATABASE_URL', 'REDIS_URL']) {
  const raw = requireValue(key);
  if (raw) {
    try {
      const parsed = new URL(raw);
      const allowedProtocols = key === 'REDIS_URL'
        ? new Set(['redis:', 'rediss:'])
        : new Set(['postgres:', 'postgresql:']);
      if (!allowedProtocols.has(parsed.protocol) || !parsed.hostname) {
        errors.push(`${key} 协议或主机无效`);
      }
    } catch {
      errors.push(`${key} 不是合法连接地址`);
    }
  }
}
const jwtKeys = [
  'JWT_SECRET',
  'ADMIN_JWT_SECRET',
  'SELLER_JWT_SECRET',
  'DELIVERY_USER_JWT_SECRET',
  'DELIVERY_ADMIN_JWT_SECRET',
  'DELIVERY_SELLER_JWT_SECRET',
];
const jwtSecrets = jwtKeys.map((key) => {
  const secret = requireValue(key);
  if (secret && Buffer.byteLength(secret, 'utf8') < 24) errors.push(`${key} 不得少于 24 字节`);
  return secret;
});
if (jwtSecrets.filter(Boolean).length !== new Set(jwtSecrets.filter(Boolean)).size) {
  errors.push('各端 JWT Secret 必须彼此独立');
}
const dataEncryptionKey = requireValue('DATA_ENCRYPTION_KEY');
if (dataEncryptionKey && Buffer.byteLength(dataEncryptionKey, 'utf8') < 32) {
  errors.push('DATA_ENCRYPTION_KEY 不得少于 32 字节');
}
if (dataEncryptionKey && jwtSecrets.includes(dataEncryptionKey)) {
  errors.push('DATA_ENCRYPTION_KEY 不得复用 JWT Secret');
}
const corsOrigins = requireValue('CORS_ORIGINS');
if (corsOrigins) {
  for (const origin of corsOrigins.split(',').map((item) => item.trim()).filter(Boolean)) {
    try {
      const parsed = new URL(origin);
      if (parsed.protocol !== 'https:' || parsed.origin !== origin || parsed.username || parsed.password) {
        errors.push('CORS_ORIGINS 只能包含无路径的正式 HTTPS Origin');
        break;
      }
    } catch {
      errors.push('CORS_ORIGINS 包含非法 Origin');
      break;
    }
  }
}
requireValue('TRUST_PROXY');
requireFalse('WECHAT_MOCK');
requireFalse('WECHAT_MINIAPP_MOCK');
requireExact('WECHAT_MINIAPP_APP_ID', 'wx1b33112db0d5267b');
const miniappSecret = requireValue('WECHAT_MINIAPP_APP_SECRET');
if (miniappSecret && miniappSecret.length < 16) {
  errors.push('WECHAT_MINIAPP_APP_SECRET 长度异常');
}
requireExact('WECHAT_MINIAPP_SUBSCRIBE_STATE', 'formal');
requireExact('WECHAT_MINIAPP_CODE_ENV_VERSION', 'release');
requireTrue('WECHAT_MINIAPP_CODE_CHECK_PATH');

const payAppId = requireValue('WECHAT_PAY_APP_ID');
if (payAppId && !/^wx[0-9A-Za-z]{16}$/.test(payAppId)) errors.push('WECHAT_PAY_APP_ID 格式无效');
const mchId = requireValue('WECHAT_PAY_MCH_ID');
if (mchId && !/^\d{8,15}$/.test(mchId)) errors.push('WECHAT_PAY_MCH_ID 格式无效');
const apiV3Key = requireValue('WECHAT_PAY_API_V3_KEY');
if (apiV3Key && Buffer.byteLength(apiV3Key, 'utf8') !== 32) {
  errors.push('WECHAT_PAY_API_V3_KEY 必须为 32 字节');
}
const certSerial = requireValue('WECHAT_PAY_MERCHANT_CERT_SERIAL');
if (certSerial && !/^[0-9A-Za-z]+$/.test(certSerial)) {
  errors.push('WECHAT_PAY_MERCHANT_CERT_SERIAL 格式无效');
}
const merchantCert = readPem('WECHAT_PAY_MERCHANT_CERT', 'WECHAT_PAY_MERCHANT_CERT_PATH');
const merchantPrivateKey = readPem(
  'WECHAT_PAY_MERCHANT_PRIVATE_KEY',
  'WECHAT_PAY_MERCHANT_PRIVATE_KEY_PATH',
);
const wechatPublicKey = readPem('WECHAT_PAY_PUBLIC_KEY', 'WECHAT_PAY_PUBLIC_KEY_PATH');
if (!merchantCert) errors.push('微信支付商户证书未配置');
if (!merchantPrivateKey) errors.push('微信支付商户私钥未配置');
if (!wechatPublicKey) errors.push('微信支付平台公钥未配置');
try {
  const merchantCertKey = merchantCert ? createPublicKey(merchantCert) : null;
  const merchantPrivate = merchantPrivateKey ? createPrivateKey(merchantPrivateKey) : null;
  if (merchantCertKey && merchantCertKey.asymmetricKeyType !== 'rsa') {
    errors.push('微信支付商户证书必须包含 RSA 公钥');
  }
  if (merchantPrivate && merchantPrivate.asymmetricKeyType !== 'rsa') {
    errors.push('微信支付商户私钥必须为 RSA');
  }
  if (wechatPublicKey && createPublicKey(wechatPublicKey).asymmetricKeyType !== 'rsa') {
    errors.push('微信支付平台公钥必须为 RSA');
  }
  if (merchantCertKey && merchantPrivate) {
    const certificatePublicKey = merchantCertKey.export({ type: 'spki', format: 'der' });
    const privatePublicKey = createPublicKey(merchantPrivate).export({ type: 'spki', format: 'der' });
    if (!certificatePublicKey.equals(privatePublicKey)) {
      errors.push('微信支付商户证书与商户私钥不匹配');
    }
  }
} catch {
  errors.push('微信支付 PEM 材料无法解析');
}
if (!/^PUB_KEY_ID_\d+$/.test(requireValue('WECHAT_PAY_PUBLIC_KEY_ID'))) {
  errors.push('WECHAT_PAY_PUBLIC_KEY_ID 格式无效');
}
requireHttpsUrl(
  'WECHAT_PAY_NOTIFY_URL',
  'api.ai-maimai.com',
  '/api/v1/payments/wechat/notify',
);

requireTrue('WECHAT_TRANSFER_ENABLED');
requireHttpsUrl(
  'WECHAT_TRANSFER_NOTIFY_URL',
  'api.ai-maimai.com',
  '/api/v1/bonus/withdraw/wechat/notify',
);
requireExact('WECHAT_TRANSFER_SCENE_ID', '1005');
requireExact('WECHAT_TRANSFER_USER_RECV_PERCEPTION', '劳务报酬');

requireTrue('PICKUP_FULFILLMENT_ENABLED');
const pickupSecret = requireValue('PICKUP_TOKEN_SECRET');
if (pickupSecret && Buffer.byteLength(pickupSecret, 'utf8') < 32) {
  errors.push('PICKUP_TOKEN_SECRET 不得少于 32 字节');
}

for (const mockKey of ['SMS_MOCK', 'DELIVERY_SMS_MOCK', 'DELIVERY_WECHAT_MOCK']) {
  requireFalse(mockKey);
}
for (const key of [
  'SMS_ACCESS_KEY_ID',
  'SMS_ACCESS_KEY_SECRET',
  'SMS_SIGN_NAME',
  'SMS_TEMPLATE_CODE',
]) {
  requireValue(key);
}

requireExact('SF_ENV', 'PROD');
requireExact('SF_API_URL', 'https://sfapi.sf-express.com/std/service');
for (const key of ['SF_CLIENT_CODE', 'SF_CHECK_WORD', 'SF_MONTHLY_ACCOUNT_PROD']) {
  requireValue(key);
}
const sfClientCode = value('SF_CLIENT_CODE');
const sfTemplateCode = requireValue('SF_TEMPLATE_CODE');
if (sfTemplateCode && sfClientCode && !sfTemplateCode.endsWith(`_${sfClientCode}`)) {
  errors.push('SF_TEMPLATE_CODE 必须以 _<SF_CLIENT_CODE> 结尾');
}
const sfPushSecret = requireValue('SF_PUSH_SECRET');
if (sfPushSecret && !/^[0-9a-fA-F]{32,}$/.test(sfPushSecret)) {
  errors.push('SF_PUSH_SECRET 必须为至少 32 位十六进制随机值');
}
const sfCallback = requireHttpsUrl(
  'SF_CALLBACK_URL',
  'api.ai-maimai.com',
  '/api/v1/shipments/sf/callback/',
);
if (sfCallback && sfPushSecret && !sfCallback.pathname.endsWith(`/${sfPushSecret}`)) {
  errors.push('SF_CALLBACK_URL 必须携带与 SF_PUSH_SECRET 相同的路径令牌');
}

if (errors.length > 0) {
  console.error('miniapp_production_config=invalid');
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

console.log('miniapp_production_config=valid');
