import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

const source = readFileSync(new URL('../src/utils/productVisualRecovery.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText;
const { readVisualRecovery, visualExecutionNeedsQuery, visualQuoteExpired, confirmWithRecoveryPointer, freeTuneEligibility } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);

test('lost confirmation response preserves original quote before any network activity', async () => {
  let saved;
  let submissions = 0;
  await assert.rejects(confirmWithRecoveryPointer('quote-1', (id) => { saved = id; }, async () => {
    assert.equal(saved, 'quote-1');
    submissions++;
    throw new Error('response lost');
  }));
  const restored = await readVisualRecovery(saved, {
    quote: async (id) => ({ quote: { id, sourceAssetRef: 'server-source' } }),
    asset: async (id) => ({ id }), optimization: async () => { throw new Error('unexpected'); },
  });
  assert.equal(restored.source.id, 'server-source');
  assert.equal(saved, 'quote-1');
  assert.equal(submissions, 1);
});

test('recovery gets server source without unsaved product file list; failed candidate read can retry', async () => {
  let reads = 0;
  const readers = {
    quote: async () => ({ quote: { sourceAssetRef: 'original-a' }, optimization: { id: 'result-a', status: 'SUCCEEDED' } }),
    asset: async (id) => ({ id, displayUrl: 'fresh-signed-url' }),
    optimization: async (id) => { if (++reads === 1) throw new Error('503'); return { id }; },
  };
  await assert.rejects(readVisualRecovery('quote-a', readers), /503/);
  assert.equal(visualExecutionNeedsQuery('SUCCEEDED', 'result-a'), true);
  const recovered = await readVisualRecovery('quote-a', readers);
  assert.equal(recovered.source.id, 'original-a');
  assert.equal(recovered.optimization.id, 'result-a');
  assert.equal(visualExecutionNeedsQuery('SUCCEEDED', 'result-a', recovered.optimization.id), false);
});

test('closing UI does not change query eligibility; completed loaded candidate is not force-opened', () => {
  for (const status of ['QUEUED', 'RUNNING', 'VERIFYING', 'ALREADY_BOUND', 'RECONCILING', 'PENDING_REVIEW']) assert.equal(visualExecutionNeedsQuery(status), true);
  assert.equal(visualExecutionNeedsQuery('SUCCEEDED', 'o-1', 'o-1'), false);
  for (const status of ['RELEASED', 'REJECTED']) assert.equal(visualExecutionNeedsQuery(status), false);
});

test('quote must be renewed at expiration, including invalid timestamps', () => {
  const deadline = '2026-09-04T12:00:00Z';
  assert.equal(visualQuoteExpired(deadline, Date.parse(deadline) - 1), false);
  assert.equal(visualQuoteExpired(deadline, Date.parse(deadline)), true);
  assert.equal(visualQuoteExpired('invalid', Date.now()), true);
});

test('v2 local tuning needs no OCR even on protected goods; disabled or unknown contract cannot inherit legacy permission', () => {
  const plan = { sourceAssetId: 'source-a', riskProfile: 'STRICT_FACTS', allowedModes: [], processingPlan: { freeTunePolicy: { contractVersion: 'local-photometric-v2', available: true } } };
  assert.equal(freeTuneEligibility(plan, null), true);
  assert.equal(freeTuneEligibility({ ...plan, processingPlan: { freeTunePolicy: { contractVersion: 'local-photometric-v2', available: false } } }, { sourceAssetId: 'source-a', freeTuneEligible: true }), false);
  assert.equal(freeTuneEligibility({ ...plan, processingPlan: { freeTunePolicy: { contractVersion: 'future-version', available: true } } }, null), false);
});

test('legacy tuning still requires eligible scan of the same source, without inventing empty facts', () => {
  const plan = { sourceAssetId: 'source-a', riskProfile: 'STANDARD_FACTS', allowedModes: ['PRESERVE_REAL_SCENE'] };
  assert.equal(freeTuneEligibility(plan, null), false);
  assert.equal(freeTuneEligibility(plan, { sourceAssetId: 'source-b', freeTuneEligible: true }), false);
  assert.equal(freeTuneEligibility(plan, { sourceAssetId: 'source-a', freeTuneEligible: false }), false);
  assert.equal(freeTuneEligibility(plan, { sourceAssetId: 'source-a', freeTuneEligible: true }), true);
  assert.equal(freeTuneEligibility({ ...plan, riskProfile: 'STRICT_FACTS' }, { sourceAssetId: 'source-a', freeTuneEligible: true }), false);
});
