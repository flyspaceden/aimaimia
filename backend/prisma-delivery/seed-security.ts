const MIN_SEED_PASSWORD_LENGTH = 12;

export function resolveDeliverySeedPassword(env: { DELIVERY_SEED_PASSWORD?: string | undefined }): string {
  const password = env.DELIVERY_SEED_PASSWORD?.trim();
  if (!password) {
    throw new Error('DELIVERY_SEED_PASSWORD is required before running delivery seed');
  }
  if (password.length < MIN_SEED_PASSWORD_LENGTH) {
    throw new Error(`DELIVERY_SEED_PASSWORD must be at least ${MIN_SEED_PASSWORD_LENGTH} characters`);
  }
  return password;
}
