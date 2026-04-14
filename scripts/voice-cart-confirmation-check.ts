import { buildVoiceCartConfirmation } from '../src/utils/voiceCartConfirmation';

function assertEqual(actual: unknown, expected: unknown, label: string) {
  if (actual !== expected) {
    throw new Error(`${label}: expected ${String(expected)}, got ${String(actual)}`);
  }
}

const named = buildVoiceCartConfirmation({ productName: '信阳毛尖' });
assertEqual(named.message, '已将信阳毛尖加入购物车', 'named.message');
assertEqual(named.toastDurationMs, 4200, 'named.toastDurationMs');
assertEqual(named.overlayDurationMs, 2200, 'named.overlayDurationMs');

const fallback = buildVoiceCartConfirmation({ query: '手撕牛肉' });
assertEqual(fallback.message, '已将手撕牛肉加入购物车', 'fallback.message');

console.log('voice cart confirmation ok');
