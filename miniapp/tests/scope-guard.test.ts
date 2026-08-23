import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { featureManifest } from '@/features/manifest';
import { MINIAPP_LEGAL_DOCUMENTS } from '@/legal/documents';

const sourceRoot = path.resolve(__dirname, '../src');

function sourceFiles(directory: string): string[] {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) return entry.name === '__tests__' ? [] : sourceFiles(absolute);
    if (!/\.(ts|tsx|scss)$/.test(entry.name)) return [];
    if (absolute.endsWith(path.join('features', 'manifest.ts'))
      || absolute.endsWith(path.join('features', 'page-parity.ts'))) return [];
    return [absolute];
  });
}

describe('miniapp channel scope guard', () => {
  it('keeps delivery and Alipay disabled', () => {
    expect(featureManifest.delivery).toBe(false);
    expect(featureManifest.alipayPayment).toBe(false);
    expect(featureManifest.alipayWithdraw).toBe(false);
    expect(featureManifest.wechatPayment).toBe(true);
    expect(featureManifest.wechatWithdraw).toBe(true);
  });

  it('does not add excluded routes, imports, or user-facing copy', () => {
    const source = sourceFiles(sourceRoot)
      .map((file) => fs.readFileSync(file, 'utf8'))
      .join('\n');
    expect(source).not.toMatch(/\/(?:delivery)(?:\/|['"])/i);
    expect(source).not.toMatch(/from\s+['"][^'"]*delivery/i);
    expect(source).not.toMatch(/alipay/i);
    expect(source).not.toContain('支付宝');
  });

  it('checks the actual legal documents rendered by the mini program', () => {
    const renderedLegalSource = JSON.stringify(MINIAPP_LEGAL_DOCUMENTS);

    expect(renderedLegalSource).toContain('微信小程序');
    expect(renderedLegalSource).toContain('微信零钱');
    expect(renderedLegalSource).not.toMatch(/支付宝|\bapp\b|expo|react native|opensdk/i);
  });
});
