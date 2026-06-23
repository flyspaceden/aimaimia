declare const describe: (name: string, fn: () => void) => void;
declare const it: (name: string, fn: () => void) => void;
declare const expect: any;
declare const require: any;
declare const __dirname: string;

import { GROUP_BUY_SHARE_URL } from '../../components/group-buy/constants';

const fs = require('fs');
const path = require('path');

describe('group buy share link', () => {
  it('uses the dedicated group-buy landing route', () => {
    expect(GROUP_BUY_SHARE_URL).toBe('https://app.ai-maimai.com/gb');
  });

  it('declares /gb links for Android App Links and iOS Universal Links', () => {
    const repoRoot = path.resolve(__dirname, '../../..');
    const appJson = JSON.parse(fs.readFileSync(path.join(repoRoot, 'app.json'), 'utf8'));
    const intentFilters = appJson.expo.android.intentFilters ?? [];
    const pathPrefixes = intentFilters.flatMap((filter: any) => (
      Array.isArray(filter.data) ? filter.data.map((item: any) => item.pathPrefix) : []
    ));
    expect(pathPrefixes).toContain('/gb/');

    const aasa = JSON.parse(
      fs.readFileSync(
        path.join(repoRoot, 'website/public/.well-known/apple-app-site-association'),
        'utf8',
      ),
    );
    const associatedPaths = aasa.applinks.details.flatMap((detail: any) => detail.paths ?? []);
    expect(associatedPaths).toContain('/gb/*');
  });

  it('routes /gb share links to the download landing page without using VIP referral route only', () => {
    const repoRoot = path.resolve(__dirname, '../../..');
    const appSource = fs.readFileSync(path.join(repoRoot, 'website/src/App.tsx'), 'utf8');
    expect(appSource).toContain("location.pathname.startsWith('/gb/')");
    expect(appSource).toContain('path="/gb/:groupBuyCode"');
  });
});
