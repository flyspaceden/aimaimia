export const MAINLAND_PHONE_PATTERN = /^1[3-9]\d{9}$/;

export const isMainlandPhone = (value: string): boolean =>
  MAINLAND_PHONE_PATTERN.test(value.trim());
