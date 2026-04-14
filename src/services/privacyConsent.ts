import AsyncStorage from '@react-native-async-storage/async-storage';
import { PRIVACY_POLICY } from '../content/legal/privacyPolicy';
import { TERMS_OF_SERVICE } from '../content/legal/termsOfService';

const CONSENT_KEY = 'privacy_consent_v1';

export interface PrivacyConsentRecord {
  agreed: boolean;
  privacyVersion: string;
  termsVersion: string;
  consentedAt: number; // epoch ms
}

export async function getPrivacyConsent(): Promise<PrivacyConsentRecord | null> {
  try {
    const raw = await AsyncStorage.getItem(CONSENT_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as PrivacyConsentRecord;
  } catch {
    return null;
  }
}

// 是否需要再次弹窗：未同意过 或 版本已更新
export async function needsPrivacyConsent(): Promise<boolean> {
  const record = await getPrivacyConsent();
  if (!record || !record.agreed) return true;
  if (record.privacyVersion !== PRIVACY_POLICY.version) return true;
  if (record.termsVersion !== TERMS_OF_SERVICE.version) return true;
  return false;
}

export async function acceptPrivacyConsent(): Promise<void> {
  const record: PrivacyConsentRecord = {
    agreed: true,
    privacyVersion: PRIVACY_POLICY.version,
    termsVersion: TERMS_OF_SERVICE.version,
    consentedAt: Date.now(),
  };
  await AsyncStorage.setItem(CONSENT_KEY, JSON.stringify(record));
}

export async function revokePrivacyConsent(): Promise<void> {
  await AsyncStorage.removeItem(CONSENT_KEY);
}
