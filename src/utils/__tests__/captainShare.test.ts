declare const describe: (name: string, fn: () => void) => void;
declare const it: (name: string, fn: () => void) => void;
declare const expect: any;
declare const require: any;
declare const __dirname: string;

const fs = require('fs');
const path = require('path');

describe('captain share link', () => {
  it('declares /c links for Android App Links and iOS Universal Links', () => {
    const repoRoot = path.resolve(__dirname, '../../..');
    const appJson = JSON.parse(fs.readFileSync(path.join(repoRoot, 'app.json'), 'utf8'));
    const intentFilters = appJson.expo.android.intentFilters ?? [];
    const pathPrefixes = intentFilters.flatMap((filter: any) => (
      Array.isArray(filter.data) ? filter.data.map((item: any) => item.pathPrefix) : []
    ));
    expect(pathPrefixes).toContain('/c/');

    const aasa = JSON.parse(
      fs.readFileSync(
        path.join(repoRoot, 'website/public/.well-known/apple-app-site-association'),
        'utf8',
      ),
    );
    const associatedPaths = aasa.applinks.details.flatMap((detail: any) => detail.paths ?? []);
    expect(associatedPaths).toContain('/c/*');
  });

  it('routes /c share links separately from VIP referral links', () => {
    const repoRoot = path.resolve(__dirname, '../../..');
    const websiteSource = fs.readFileSync(path.join(repoRoot, 'website/src/App.tsx'), 'utf8');
    const appLayoutSource = fs.readFileSync(path.join(repoRoot, 'app/_layout.tsx'), 'utf8');

    expect(websiteSource).toContain("location.pathname.startsWith('/c/')");
    expect(websiteSource).toContain('path="/c/:code"');
    expect(appLayoutSource).toContain('isCaptainLandingURL');
    expect(appLayoutSource).toContain("\\/c\\/");
  });
});
