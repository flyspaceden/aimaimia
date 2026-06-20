#!/usr/bin/env node

const { PrismaClient, DeliveryManifestTemplateType } = require('../src/generated/delivery-client');

const prisma = new PrismaClient();

const BLOCKED_TERMS = [
  'price',
  'cost',
  'amount',
  'fee',
  'markup',
  'shippingfee',
  '加价',
  '成本',
  '售价',
  '金额',
  '运费',
];

function normalizeText(value) {
  return String(value ?? '')
    .toLowerCase()
    .replace(/[\s_-]+/g, '');
}

function hasMoneyPattern(value) {
  return /(?:[¥￥]\s*\d)|(?:\brmb\b|\bcny\b|\busd\b|\$|\d+(?:\.\d{1,2})?\s*(?:元|块|人民币))/i.test(
    String(value ?? ''),
  );
}

function isAllowedSellerCustomization(entry) {
  const key = String(entry?.key ?? '');
  const label = String(entry?.label ?? '');
  const value = String(entry?.value ?? '');
  const normalized = normalizeText(`${key}${label}${value}`);
  const hasBlockedTerm = BLOCKED_TERMS.some((term) => normalized.includes(term));
  return !(hasBlockedTerm || hasMoneyPattern(value));
}

function sanitizeCustomizations(rawCustomizations) {
  if (!rawCustomizations || typeof rawCustomizations !== 'object' || Array.isArray(rawCustomizations)) {
    return {
      nextCustomizations: rawCustomizations,
      removedEntries: 0,
      removedTargets: 0,
      changed: false,
    };
  }

  const nextCustomizations = {};
  let removedEntries = 0;
  let removedTargets = 0;
  let changed = false;

  for (const [scope, scopeValue] of Object.entries(rawCustomizations)) {
    if (!scopeValue || typeof scopeValue !== 'object' || Array.isArray(scopeValue)) {
      nextCustomizations[scope] = scopeValue;
      continue;
    }

    const nextScope = {};
    for (const [targetId, customization] of Object.entries(scopeValue)) {
      if (!customization || typeof customization !== 'object' || Array.isArray(customization)) {
        nextScope[targetId] = customization;
        continue;
      }

      const rawEntries = Array.isArray(customization.entries) ? customization.entries : [];
      const keptEntries = [];
      for (const entry of rawEntries) {
        if (entry && typeof entry === 'object' && isAllowedSellerCustomization(entry)) {
          keptEntries.push(entry);
        } else {
          removedEntries += 1;
          changed = true;
        }
      }

      if (keptEntries.length > 0) {
        nextScope[targetId] = {
          ...customization,
          entries: keptEntries,
        };
      } else {
        removedTargets += 1;
        changed = true;
      }
    }

    if (Object.keys(nextScope).length > 0) {
      nextCustomizations[scope] = nextScope;
    } else if (Object.prototype.hasOwnProperty.call(rawCustomizations, scope)) {
      changed = true;
    }
  }

  return {
    nextCustomizations,
    removedEntries,
    removedTargets,
    changed,
  };
}

function sanitizeConfig(config) {
  if (!config || typeof config !== 'object' || Array.isArray(config)) {
    return {
      nextConfig: config,
      removedEntries: 0,
      removedTargets: 0,
      changed: false,
    };
  }

  const {
    nextCustomizations,
    removedEntries,
    removedTargets,
    changed: customizationsChanged,
  } = sanitizeCustomizations(config.customizations);

  let nextConfig = config;
  let changed = customizationsChanged;

  if (customizationsChanged) {
    nextConfig = { ...config };
    if (Object.keys(nextCustomizations).length > 0) {
      nextConfig.customizations = nextCustomizations;
    } else {
      delete nextConfig.customizations;
    }
    changed = true;
  }

  return {
    nextConfig,
    removedEntries,
    removedTargets,
    changed,
  };
}

async function main() {
  if (!process.env.DELIVERY_DATABASE_URL) {
    throw new Error('DELIVERY_DATABASE_URL is required');
  }

  const dryRun = process.argv.includes('--dry-run');
  const templates = await prisma.deliveryManifestTemplate.findMany({
    where: { type: DeliveryManifestTemplateType.SELLER_FULFILLMENT },
    select: {
      id: true,
      name: true,
      config: true,
      versions: {
        select: {
          id: true,
          versionNo: true,
          config: true,
        },
      },
    },
  });

  const stats = {
    dryRun,
    templatesScanned: templates.length,
    templatesUpdated: 0,
    versionsUpdated: 0,
    templateRemovedEntries: 0,
    templateRemovedTargets: 0,
    versionRemovedEntries: 0,
    versionRemovedTargets: 0,
  };

  for (const template of templates) {
    const sanitizedTemplate = sanitizeConfig(template.config);
    stats.templateRemovedEntries += sanitizedTemplate.removedEntries;
    stats.templateRemovedTargets += sanitizedTemplate.removedTargets;

    if (sanitizedTemplate.changed) {
      stats.templatesUpdated += 1;
      if (!dryRun) {
        await prisma.deliveryManifestTemplate.update({
          where: { id: template.id },
          data: { config: sanitizedTemplate.nextConfig },
        });
      }
    }

    for (const version of template.versions) {
      const sanitizedVersion = sanitizeConfig(version.config);
      if (!sanitizedVersion.changed) {
        continue;
      }

      stats.versionRemovedEntries += sanitizedVersion.removedEntries;
      stats.versionRemovedTargets += sanitizedVersion.removedTargets;
      stats.versionsUpdated += 1;
      if (!dryRun) {
        await prisma.deliveryManifestVersion.update({
          where: { id: version.id },
          data: { config: sanitizedVersion.nextConfig },
        });
      }
    }
  }

  console.log(JSON.stringify(stats, null, 2));
}

main()
  .catch((error) => {
    console.error('[cleanup-delivery-manifest-customizations] failed');
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
