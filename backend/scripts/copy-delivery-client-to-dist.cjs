#!/usr/bin/env node

const fs = require('node:fs');
const path = require('node:path');

function copyDeliveryClientToDist(rootDir = path.join(__dirname, '..')) {
  const sourceDir = path.join(rootDir, 'src', 'generated', 'delivery-client');
  const targetDir = path.join(rootDir, 'dist', 'src', 'generated', 'delivery-client');

  if (!fs.existsSync(path.join(sourceDir, 'index.js'))) {
    throw new Error(
      `Generated delivery Prisma client not found at ${sourceDir}. Run npm run prisma:delivery:generate first.`,
    );
  }

  fs.rmSync(targetDir, { recursive: true, force: true });
  fs.mkdirSync(path.dirname(targetDir), { recursive: true });
  fs.cpSync(sourceDir, targetDir, { recursive: true });
}

if (require.main === module) {
  copyDeliveryClientToDist();
}

module.exports = { copyDeliveryClientToDist };
