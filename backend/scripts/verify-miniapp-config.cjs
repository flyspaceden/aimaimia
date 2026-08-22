#!/usr/bin/env node

// Shared implementation; profile wrappers set MINIAPP_CONFIG_PROFILE before loading this file.

const fs = require('node:fs');
const path = require('node:path');
const { createPrivateKey, createPublicKey, X509Certificate } = require('node:crypto');

try {
  require('dotenv').config({ path: path.resolve(process.cwd(), '.env'), override: false });
} catch {
  // CI 通过进程环境注入配置；dotenv 不可用时仍继续执行显式校验。
}

const errors = [];
const value = (key) => String(process.env[key] ?? '').trim();
const profile = value('MINIAPP_CONFIG_PROFILE') || 'production';
if (!['production', 'staging'].includes(profile)) {
  console.error('miniapp_config=invalid');
  console.error('- MINIAPP_CONFIG_PROFILE 只允许 production 或 staging');
  process.exit(1);
}
const isProduction = profile === 'production';
const apiHost = isProduction ? 'api.ai-maimai.com' : 'test-api.ai-maimai.com';
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
const requireHttpsUrl = (key, expectedHost, expectedPath, allowPathSuffix = false) => {
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
      || (
        allowPathSuffix
          ? !parsed.pathname.startsWith(expectedPath)
          : parsed.pathname !== expectedPath
      )
    ) {
      errors.push(`${key} 必须使用正式 HTTPS 域名和约定路径`);
    }
    return parsed;
  } catch {
    errors.push(`${key} 不是合法 URL`);
    return null;
  }
};

requireExact('NODE_ENV', isProduction ? 'production' : 'staging');
for (const key of ['DATABASE_URL', 'REDIS_URL']) {
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
      if (key === 'DATABASE_URL') {
        const expectedDatabase = isProduction ? '/aimaimai' : '/testaimaimai';
        if (parsed.pathname !== expectedDatabase) {
          errors.push(`DATABASE_URL 必须指向 ${expectedDatabase.slice(1)} 数据库`);
        }
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
];
const jwtSecrets = jwtKeys.map((key) => {
  const secret = requireValue(key);
  if (secret && Buffer.byteLength(secret, 'utf8') < 24) errors.push(`${key} 不得少于 24 字节`);
  return secret;
});
if (jwtSecrets.filter(Boolean).length !== new Set(jwtSecrets.filter(Boolean)).size) {
  errors.push('各端 JWT Secret 必须彼此独立');
}
const dataEncryptionKey = isProduction ? requireValue('DATA_ENCRYPTION_KEY') : value('DATA_ENCRYPTION_KEY');
if (dataEncryptionKey) {
  if (Buffer.byteLength(dataEncryptionKey, 'utf8') < 32) errors.push('DATA_ENCRYPTION_KEY 不得少于 32 字节');
  if (jwtSecrets.includes(dataEncryptionKey)) errors.push('DATA_ENCRYPTION_KEY 不得复用 JWT Secret');
}
const corsOrigins = requireValue('CORS_ORIGINS');
if (corsOrigins) {
  for (const origin of corsOrigins.split(',').map((item) => item.trim()).filter(Boolean)) {
    try {
      const parsed = new URL(origin);
      if (parsed.protocol !== 'https:' || parsed.origin !== origin || parsed.username || parsed.password) {
        errors.push('CORS_ORIGINS 只能包含无路径的 HTTPS Origin');
        break;
      }
    } catch {
      errors.push('CORS_ORIGINS 包含非法 Origin');
      break;
    }
  }
}
if (isProduction) requireValue('TRUST_PROXY');
if (!isProduction && corsOrigins) {
  const origins = new Set(corsOrigins.split(',').map((item) => item.trim()).filter(Boolean));
  for (const origin of [
    'https://test-api.ai-maimai.com',
    'https://test-admin.ai-maimai.com',
    'https://test-seller.ai-maimai.com',
  ]) {
    if (!origins.has(origin)) errors.push(`CORS_ORIGINS 缺少 ${origin}`);
  }
}
requireFalse('WECHAT_MOCK');
requireFalse('WECHAT_MINIAPP_MOCK');
requireExact('WECHAT_MINIAPP_APP_ID', 'wx1b33112db0d5267b');
const miniappSecret = requireValue('WECHAT_MINIAPP_APP_SECRET');
if (miniappSecret && miniappSecret.length < 16) {
  errors.push('WECHAT_MINIAPP_APP_SECRET 长度异常');
}
if (isProduction) requireExact('WECHAT_MINIAPP_SUBSCRIBE_STATE', 'formal');
else if (!['developer', 'develop'].includes(value('WECHAT_MINIAPP_SUBSCRIBE_STATE'))) {
  errors.push('WECHAT_MINIAPP_SUBSCRIBE_STATE 与测试环境约定不一致');
}
requireExact('WECHAT_MINIAPP_CODE_ENV_VERSION', isProduction ? 'release' : 'develop');
if (isProduction) requireTrue('WECHAT_MINIAPP_CODE_CHECK_PATH');
else requireFalse('WECHAT_MINIAPP_CODE_CHECK_PATH');
const subscriptionTemplates = {
  ORDER_SHIPPED: {
    templateId: 'AaefuI_Uqp1qvX7fNuGbEe3w6Qe4b4M5SUpboeLXvNQ',
    fields: { reference: 'character_string6', status: 'phrase18', remark: 'thing5', time: 'date4' },
  },
  AFTER_SALE_RESULT: {
    templateId: 'sAQM7NcmYHH6x1nxlqr_Fy2EBushICGBCt42XPsG04Q',
    fields: { reference: 'character_string7', status: 'thing2', remark: 'thing5', time: 'time12' },
  },
  WITHDRAW_RESULT: {
    templateId: '2zKL7siL8vg7U8t31koS272-CQBxTz9ePaXoi1vXAYU',
    fields: { status: 'phrase2', remark: 'thing4', time: 'time3' },
  },
};
for (const [key, expected] of Object.entries(subscriptionTemplates)) {
  requireExact(`WECHAT_MINIAPP_SUBSCRIBE_${key}_TEMPLATE_ID`, expected.templateId);
  const rawFields = requireValue(`WECHAT_MINIAPP_SUBSCRIBE_${key}_FIELDS`);
  if (!rawFields) continue;
  try {
    const fields = JSON.parse(rawFields);
    const expectedEntries = Object.entries(expected.fields).sort();
    const actualEntries = Object.entries(fields).sort();
    if (JSON.stringify(actualEntries) !== JSON.stringify(expectedEntries)) {
      errors.push(`WECHAT_MINIAPP_SUBSCRIBE_${key}_FIELDS 与微信模板字段约定不一致`);
    }
  } catch {
    errors.push(`WECHAT_MINIAPP_SUBSCRIBE_${key}_FIELDS 不是合法 JSON`);
  }
}

const payAppId = requireValue('WECHAT_PAY_APP_ID');
if (payAppId && !/^wx[0-9A-Za-z]{16}$/.test(payAppId)) errors.push('WECHAT_PAY_APP_ID 格式无效');
const mchId = requireValue('WECHAT_PAY_MCH_ID');
if (mchId && !/^\d{8,15}$/.test(mchId)) errors.push('WECHAT_PAY_MCH_ID 格式无效');
const apiV3Key = requireValue('WECHAT_PAY_API_V3_KEY');
if (apiV3Key && Buffer.byteLength(apiV3Key, 'utf8') !== 32) {
  errors.push('WECHAT_PAY_API_V3_KEY 必须为 32 字节');
}
const certSerial = requireValue('WECHAT_PAY_MERCHANT_CERT_SERIAL');
if (certSerial && !/^[0-9A-Fa-f:]+$/.test(certSerial)) {
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
  const merchantCertificate = merchantCert ? new X509Certificate(merchantCert) : null;
  const merchantCertKey = merchantCertificate?.publicKey ?? null;
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
  if (merchantCertificate && certSerial) {
    const normalizeSerial = (serial) => serial
      .replace(/[:\s]/g, '')
      .replace(/^0+/, '')
      .toUpperCase();
    if (normalizeSerial(merchantCertificate.serialNumber) !== normalizeSerial(certSerial)) {
      errors.push('WECHAT_PAY_MERCHANT_CERT_SERIAL 与商户证书序列号不匹配');
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
  apiHost,
  '/api/v1/payments/wechat/notify',
);

requireTrue('WECHAT_TRANSFER_ENABLED');
requireHttpsUrl(
  'WECHAT_TRANSFER_NOTIFY_URL',
  apiHost,
  '/api/v1/bonus/withdraw/wechat/notify',
);
requireExact('WECHAT_TRANSFER_SCENE_ID', '1005');
requireExact('WECHAT_TRANSFER_USER_RECV_PERCEPTION', '劳务报酬');
const transferSceneReportInfosJson = requireValue('WECHAT_TRANSFER_SCENE_REPORT_INFOS_JSON');
if (transferSceneReportInfosJson) {
  try {
    const reportInfos = JSON.parse(transferSceneReportInfosJson);
    const reportMap = new Map(
      Array.isArray(reportInfos)
        ? reportInfos.map((item) => [item?.info_type, item?.info_content])
        : [],
    );
    if (
      !Array.isArray(reportInfos)
      || reportInfos.length !== 2
      || reportMap.size !== 2
      || reportMap.get('岗位类型') !== '平台推广人员'
      || reportMap.get('报酬说明') !== 'AI爱买买平台推广佣金'
    ) {
      errors.push('WECHAT_TRANSFER_SCENE_REPORT_INFOS_JSON 与佣金报酬场景约定不一致');
    }
  } catch {
    errors.push('WECHAT_TRANSFER_SCENE_REPORT_INFOS_JSON 不是合法 JSON');
  }
}

requireTrue('PICKUP_FULFILLMENT_ENABLED');
const pickupSecret = requireValue('PICKUP_TOKEN_SECRET');
if (pickupSecret && Buffer.byteLength(pickupSecret, 'utf8') < 32) {
  errors.push('PICKUP_TOKEN_SECRET 不得少于 32 字节');
}

for (const mockKey of ['SMS_MOCK']) {
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

requireExact('SF_ENV', isProduction ? 'PROD' : 'UAT');
requireExact(
  isProduction ? 'SF_API_URL' : 'SF_API_URL_UAT',
  isProduction
    ? 'https://sfapi.sf-express.com/std/service'
    : 'https://sfapi-sbox.sf-express.com/std/service',
);
for (const key of ['SF_CLIENT_CODE', 'SF_CHECK_WORD', isProduction ? 'SF_MONTHLY_ACCOUNT_PROD' : 'SF_MONTHLY_ACCOUNT_UAT']) {
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
  apiHost,
  '/api/v1/shipments/sf/callback/',
  true,
);
if (sfCallback && sfPushSecret && !sfCallback.pathname.endsWith(`/${sfPushSecret}`)) {
  errors.push('SF_CALLBACK_URL 必须携带与 SF_PUSH_SECRET 相同的路径令牌');
}

const resultLabel = isProduction ? 'miniapp_production_config' : 'miniapp_staging_config';
if (errors.length > 0) {
  console.error(`${resultLabel}=invalid`);
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

console.log(`${resultLabel}=valid`);
