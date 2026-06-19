import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readLegalDocument, renderLegalPage } from '../../scripts/lib/legal-static-renderer.mjs';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const websiteRoot = resolve(scriptDir, '..');
const publicRoot = resolve(websiteRoot, 'public');

function writeStaticPage(route, html) {
  const dir = resolve(publicRoot, route);
  mkdirSync(dir, { recursive: true });
  writeFileSync(resolve(dir, 'index.html'), html);
  writeFileSync(resolve(publicRoot, `${route}.html`), html);
}

const privacy = readLegalDocument(resolve(websiteRoot, 'src/content/legal/privacyPolicy.ts'), 'PRIVACY_POLICY');
const terms = readLegalDocument(resolve(websiteRoot, 'src/content/legal/termsOfService.ts'), 'TERMS_OF_SERVICE');
const deliveryTerms = readLegalDocument(resolve(websiteRoot, 'src/content/legal/deliveryTerms.ts'), 'DELIVERY_TERMS');
const deliveryPrivacy = readLegalDocument(resolve(websiteRoot, 'src/content/legal/deliveryPrivacy.ts'), 'DELIVERY_PRIVACY_POLICY');
const deliverySellerAgreement = readLegalDocument(
  resolve(websiteRoot, 'src/content/legal/deliverySellerAgreement.ts'),
  'DELIVERY_SELLER_AGREEMENT',
);

writeStaticPage('privacy', renderLegalPage(privacy, 'privacy'));
writeStaticPage('terms', renderLegalPage(terms, 'terms'));
writeStaticPage('legal/delivery-terms', renderLegalPage(deliveryTerms, 'delivery-terms'));
writeStaticPage('legal/delivery-privacy', renderLegalPage(deliveryPrivacy, 'delivery-privacy'));
writeStaticPage(
  'legal/delivery-seller-agreement',
  renderLegalPage(deliverySellerAgreement, 'delivery-seller-agreement'),
);
