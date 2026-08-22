#!/usr/bin/env node

const { createHash } = require('node:crypto');
const { execFileSync, spawnSync } = require('node:child_process');
const { readFileSync, readdirSync, statSync } = require('node:fs');
const path = require('node:path');

function required(key) {
  const current = String(process.env[key] || '').trim();
  if (!current) throw new Error(`${key} is missing`);
  return current;
}

function sha256(filePath) {
  const result = spawnSync('sha256sum', ['--', filePath], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 15 * 60_000 });
  if (result.error || result.status !== 0) throw new Error('sha256sum failed');
  const digest = result.stdout.trim().split(/\s+/)[0];
  if (!/^[0-9a-f]{64}$/.test(digest)) throw new Error('sha256sum returned an invalid digest');
  return digest;
}

function migrationTreeSha256(root) {
  const hash = createHash('sha256');
  const visit = (current, relative = '') => {
    for (const entry of readdirSync(current, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name))) {
      const childRelative = relative ? `${relative}/${entry.name}` : entry.name;
      const child = path.join(current, entry.name);
      if (entry.isDirectory()) visit(child, childRelative);
      else if (entry.isFile()) {
        hash.update(childRelative);
        hash.update('\0');
        hash.update(readFileSync(child));
        hash.update('\0');
      }
    }
  };
  visit(root);
  return hash.digest('hex');
}

function main() {
  const releaseSha = required('RELEASE_SHA');
  if (!/^[0-9a-f]{40}$/.test(releaseSha)) throw new Error('RELEASE_SHA must be a full commit SHA');
  const currentSha = execFileSync('git', ['-C', path.resolve(process.cwd(), '..'), 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  if (currentSha !== releaseSha) throw new Error('candidate checkout does not match RELEASE_SHA');

  const attestationPath = `/www/backup/releases/miniapp-rehearsal/attestations/${releaseSha}.json`;
  const mode = statSync(attestationPath).mode & 0o777;
  if ((mode & 0o077) !== 0) throw new Error('rehearsal attestation permissions are too broad');
  const attestation = JSON.parse(readFileSync(attestationPath, 'utf8'));
  if (attestation.version !== 1 || attestation.status !== 'complete' || attestation.candidateSha !== releaseSha) {
    throw new Error('rehearsal attestation identity is invalid');
  }
  if (!/^[0-9a-f]{64}$/.test(String(attestation.sourceIdentityHash || ''))) {
    throw new Error('rehearsal source database identity is invalid');
  }
  const createdAt = Date.parse(attestation.createdAt);
  if (!Number.isFinite(createdAt) || createdAt > Date.now() + 5 * 60_000 || Date.now() - createdAt > 14 * 24 * 60 * 60_000) {
    throw new Error('rehearsal attestation is older than 14 days');
  }
  const migrationSha256 = migrationTreeSha256(path.resolve(process.cwd(), 'prisma/migrations'));
  const migrationTreeGitObject = execFileSync(
    'git',
    ['-C', path.resolve(process.cwd(), '..'), 'rev-parse', `${releaseSha}:backend/prisma/migrations`],
    { encoding: 'utf8' },
  ).trim();
  if (attestation.migrationTreeGitObject !== migrationTreeGitObject) {
    throw new Error('rehearsal migration Git tree does not match the release candidate');
  }
  if (attestation.migrationTreeSha256 !== migrationSha256) {
    throw new Error('rehearsal migration tree does not match the release candidate');
  }
  if (!String(attestation.backupPath || '').startsWith('/www/backup/database/aimaimai/')) {
    throw new Error('rehearsal backup path is outside the approved root');
  }
  if (sha256(attestation.backupPath) !== attestation.backupSha256) {
    throw new Error('rehearsal backup checksum no longer matches');
  }
  if (
    !String(attestation.backupManifestPath || '').startsWith('/www/backup/database/aimaimai/')
    || sha256(attestation.backupManifestPath) !== attestation.backupManifestSha256
  ) {
    throw new Error('rehearsal backup source manifest no longer matches');
  }
  const backupManifest = JSON.parse(readFileSync(attestation.backupManifestPath, 'utf8'));
  if (
    backupManifest.version !== 1
    || backupManifest.backupSha256 !== attestation.backupSha256
    || backupManifest.sourceIdentityHash !== attestation.sourceIdentityHash
    || Number(backupManifest.sourceMigrationCount) !== Number(attestation.baselineMigrationCount)
    || backupManifest.sourceMigrationHead !== attestation.baselineMigrationHead
  ) {
    throw new Error('rehearsal backup source manifest content is invalid');
  }
  if (
    Number(attestation.rehearsalMigrationCount) !== 120
    || Number(attestation.rehearsalFailedMigrationCount) !== 0
    || Number(attestation.stableTableFingerprints) < 23
    || attestation.migrationChecksumsVerified !== true
  ) {
    throw new Error('rehearsal attestation result is incomplete');
  }
  process.stdout.write(`rehearsal_attestation=verified candidate_sha=${releaseSha}\n`);
}

try {
  main();
} catch (error) {
  process.stderr.write(`rehearsal_attestation=failed reason=${error instanceof Error ? error.message : 'unknown'}\n`);
  process.exit(1);
}
