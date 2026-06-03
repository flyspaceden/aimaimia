import { Page, expect } from '@playwright/test';

/**
 * 已知的非致命 console 警告白名单（antd v5 + React 19 兼容性噪音）
 */
const BENIGN_PATTERNS: (string | RegExp)[] = [
  '[antd: compatible]',
  '[antd: message]',
  '[antd: Spin]',
  '[antd: Card]',
  '[antd: InputNumber]',
  'React DevTools',
  /Warning: \[antd:.+\]\s+.*deprecated/i,
  // 卖家端已知预存在警告（非测试引入）
  'Instance created by `useForm` is not connected to any Form element',
  // antd message "middle" position 在 React 19 下的已知运行时报错
  'Unknown position: middle',
];

export function collectConsoleErrors(page: Page): () => string[] {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(`[pageerror] ${err.message}`));
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(`[console.error] ${msg.text()}`);
  });
  return () => errors;
}

export function filterFatalErrors(errors: string[]): string[] {
  return errors.filter(
    (e) =>
      !BENIGN_PATTERNS.some((p) =>
        typeof p === 'string' ? e.includes(p) : p.test(e),
      ),
  );
}

export function expectNoFatalConsole(errors: string[]) {
  const fatal = filterFatalErrors(errors);
  expect(fatal, `Unexpected console errors:\n${fatal.join('\n')}`).toHaveLength(0);
}
