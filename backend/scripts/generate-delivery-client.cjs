#!/usr/bin/env node

const { spawnSync } = require('node:child_process');
const path = require('node:path');

const schemaPath = path.join(__dirname, '..', 'prisma-delivery', 'schema.prisma');
const prismaBin = path.join(
  __dirname,
  '..',
  'node_modules',
  '.bin',
  process.platform === 'win32' ? 'prisma.cmd' : 'prisma',
);
const env = {
  ...process.env,
  DELIVERY_DATABASE_URL:
    process.env.DELIVERY_DATABASE_URL ||
    'postgresql://placeholder:placeholder@127.0.0.1:5432/delivery_placeholder?schema=public',
};

const result = spawnSync(prismaBin, ['generate', '--schema', schemaPath], {
  stdio: 'inherit',
  env,
});

if (result.error) {
  throw result.error;
}

process.exit(result.status ?? 1);
