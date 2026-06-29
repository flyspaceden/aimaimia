const ONE_DAY_MS = 24 * 60 * 60 * 1000;

export function getGroupBuyCountdownState(
  expiresAt?: string | null,
  now: Date | number = Date.now(),
) {
  const nowMs = typeof now === 'number' ? now : now.getTime();
  const expiresMs = expiresAt ? new Date(expiresAt).getTime() : Number.NaN;
  const remainingMs = expiresMs - nowMs;

  if (!Number.isFinite(remainingMs) || remainingMs <= 0) {
    return { expired: true, urgent: false };
  }

  return {
    expired: false,
    urgent: remainingMs < ONE_DAY_MS,
  };
}
