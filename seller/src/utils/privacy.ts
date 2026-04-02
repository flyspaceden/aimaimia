export function filterContactInfo(text?: string | null): string {
  if (!text) return text || '';

  return text
    .replace(/1[3-9]\d{9}/g, '***')
    .replace(/\d{3,4}-\d{7,8}/g, '***')
    .replace(/[\w.-]+@[\w.-]+\.\w+/g, '***')
    .replace(/微信[号:：]?\s*\S+/gi, '***')
    .replace(/(?:wx|vx)[号:：]?\s*[a-z][a-z0-9_-]{3,}/gi, '***')
    .replace(/v信[号:：]?\s*\S+/gi, '***')
    .replace(/[Ww]e?[Cc]hat[号:：]?\s*\S+/g, '***')
    .replace(/QQ[号:：]?\s*\d+/gi, '***');
}
