import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

describe('WeChat DevTools runtime audit resilience', () => {
  const source = readFileSync(resolve(process.cwd(), 'scripts/audit-weapp-runtime.cjs'), 'utf8');

  it('bounds navigation and screenshot operations so one route cannot block the full audit', () => {
    expect(source).toContain('MINIAPP_RUNTIME_NAVIGATION_TIMEOUT_MS');
    expect(source).toContain('MINIAPP_RUNTIME_SCREENSHOT_TIMEOUT_MS');
    expect(source).toMatch(/withTimeout\(miniProgram\.reLaunch\(url\)/);
    expect(source).toMatch(/withTimeout\(\s*miniProgram\.screenshot/);
  });

  it('records a screenshot timeout as a warning and keeps the route result', () => {
    expect(source).toContain('截图未生成');
    expect(source).toContain('screenshotError');
    expect(source).toContain('navigationError || screenshotError ? undefined : screenshot');
  });
});
