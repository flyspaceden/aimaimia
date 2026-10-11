import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { classifyReleaseScope, scopeFromGit, e2eGatePassed, frontendGatePassed, affectedClients } from '../ci-release-scope.mjs';
import { presentationSyntaxOnly, miniappRoutes } from '../ci-frontend-syntax.mjs';
import { frontendTestCommand, selectedFrontendFiles, frontendBuildContext, verifyAppExport } from '../ci-frontend-checks.mjs';

const home = 'miniapp/src/pages/home/index.tsx';
test('the small referral entry patch and companion documentation qualify', () => {
  const result = classifyReleaseScope({ files: [home, 'plan.md', 'docs/architecture/wechat-mini-program.md'], syntaxSafe: true, patch: '-{member?.tier === "VIP" ? (\n+{showReferralEntry ? (\n+<Text>推荐好友</Text>' });
  assert.equal(result.mode, 'miniapp-ui');
});
test('presentation styles qualify while financial/account styles do not', () => {
  assert.equal(classifyReleaseScope({ files: ['miniapp/src/pages/home/index.scss'] }).uiOnly, true);
  for (const name of ['miniapp/src/packages/account/login/index.scss', 'miniapp/src/packages/commerce/checkout/index.scss', 'miniapp/src/components/privacy-authorization/index.scss', 'miniapp/src/packages/member/member.scss', 'miniapp/src/packages/after-sales/index.scss']) {
    assert.equal(classifyReleaseScope({ files: [name] }).uiOnly, false);
  }
});
test('syntax accepts readonly presentation and retains existing event handlers', () => {
  const before = 'function Home(){const member=useMember();return <View onClick={share}>{member?.tier === "VIP" && <Text>VIP 分享</Text>}</View>}';
  const after = 'function Home(){const member=useMember();const isVipMember=member?.tier === "VIP";const showReferralEntry=hydrated && loggedIn && (member?.tier === "NORMAL" || (isVipMember && Boolean(member?.referralCode)));return <View onClick={share}>{showReferralEntry && <Text>推荐好友</Text>}</View>}';
  assert.equal(presentationSyntaxOnly(before, after), true);
  assert.equal(presentationSyntaxOnly(before, before.replace('share}', 'purchase}')), false);
});
test('both frontends accept local expand/modal/tab actions without changing business effects', () => {
  for (const platform of ['app','miniapp']) {
    const imports = platform==='app' ? 'import {View,Text,Pressable} from "react-native";' : 'import {View,Text,Button} from "@tarojs/components";';
    const button=platform==='app'?'Pressable':'Button', event=platform==='app'?'onPress':'onClick';
    const before='import {useState} from "react";'+imports+'function Home(){return <View><Text>首页</Text></View>}';
    const after='import {useState} from "react";'+imports+`function Home(){const[helpOpen,setHelpOpen]=useState(false);const openHelp=()=>setHelpOpen(true);return <View><Text>首页</Text><${button} ${event}={openHelp}><Text>帮助</Text></${button}>{helpOpen && <Text>说明</Text>}<${button} ${event}={()=>setHelpOpen(prev=>!prev)}>收起</${button}></View>}`;
    assert.equal(presentationSyntaxOnly(before,after,{platform}),true);
    assert.equal(presentationSyntaxOnly(before,after.replace('setHelpOpen(true)','pay()'),{platform}),false);
    assert.equal(presentationSyntaxOnly(before,after.replace('useState(false)','useState(load())'),{platform}),false);
  }
  const base='import{useState}from"react";import{View,Text}from"react-native";function Home(){return <View/>}';
  const sheet='import{AppBottomSheet}from"../src/components/overlay";'+base.replace('return <View/>','const[helpOpen,setHelpOpen]=useState(false);return <AppBottomSheet open={helpOpen} onClose={()=>setHelpOpen(false)}><Text>帮助</Text></AppBottomSheet>');
  assert.equal(presentationSyntaxOnly(base,sheet,{platform:'app',filePath:'app/about.tsx'}),true);
  assert.equal(presentationSyntaxOnly(base,sheet.replace('../src/components/overlay','./money'),{platform:'app',filePath:'app/about.tsx'}),false);
});
test('UI-looking state is not fast if used by a query, effect, callback or module-level hook', () => {
  const start='import{useState}from"react";import{View,Text,Button}from"@tarojs/components";function Home(){return <View/>}';
  for(const addition of [
    'const[helpOpen,setHelpOpen]=useState(false);useQuery({enabled:helpOpen});',
    'const[helpOpen,setHelpOpen]=useState(false);useEffect(()=>setHelpOpen(true),[]);',
    'const[helpOpen,setHelpOpen]=useState(false);send(helpOpen);',
    'const[quantityOpen,setQuantityOpen]=useState(false);',
  ]) assert.equal(presentationSyntaxOnly(start,start.replace('return <View/>',addition+'return <View/>')),false,addition);
  const moduleHook=start.replace('function Home()', 'const[helpOpen,setHelpOpen]=useState(false);function Home()');
  assert.equal(presentationSyntaxOnly(start,moduleHook),false);
  for(const body of ['if(loggedIn){const[helpOpen,setHelpOpen]=useState(false);return <View/>}return <View/>', 'if(!loggedIn)return <View/>;const[helpOpen,setHelpOpen]=useState(false);return <View/>']) assert.equal(presentationSyntaxOnly(start,start.replace('return <View/>',body)),false);
  const hidden=start.replace('return <View/>','const[helpOpen,setHelpOpen]=useState(false);return <Button onClick={()=>setHelpOpen(prev=><Pay onMount={buy}/>)}>帮助</Button>');
  assert.equal(presentationSyntaxOnly(start,hidden),false);
});
test('navigation is limited to real existing static non-business routes and canonical imports', () => {
  const before='import{router}from"expo-router";import{View,Text,Pressable}from"react-native";function Home(){return <View/>}';
  const to=(route)=>before.replace('<View/>',`<View><Pressable onPress={()=>router.push(${JSON.stringify(route)})}><Text>打开</Text></Pressable></View>`);
  assert.equal(presentationSyntaxOnly(before,to('/about'),{platform:'app',routes:['/about']}),true);
  for(const route of ['/missing','/about?token=x','/checkout','/wallet','/[id]']) assert.equal(presentationSyntaxOnly(before,to(route),{platform:'app',routes:['/about','/checkout','/wallet','/[id]']}),false,route);
  assert.equal(presentationSyntaxOnly(before.replace('expo-router','./router'),to('/about').replace('expo-router','./router'),{platform:'app',routes:['/about']}),false);
  const hookBefore='import{useRouter}from"expo-router";import{View,Pressable}from"react-native";function Home(){return <View/>}';
  const hookAfter=hookBefore.replace('return <View/>','const router=useRouter();return <Pressable onPress={()=>router.push("/about")}/>');
  assert.equal(presentationSyntaxOnly(hookBefore,hookAfter,{platform:'app',routes:['/about']}),true);
  assert.equal(presentationSyntaxOnly(hookBefore,hookAfter.replace('const router=useRouter();','const router=useRouter();store(router);'),{platform:'app',routes:['/about']}),false);
  const existing=hookBefore.replace('return <View/>','const router=useRouter();const buy=()=>router.push("/checkout");return <View onPress={buy}/>');
  const withAbout=existing.replace('<View onPress={buy}/>','<View onPress={buy}><Pressable onPress={()=>router.push("/about")}/></View>');
  assert.equal(presentationSyntaxOnly(existing,withAbout,{platform:'app',routes:['/about','/checkout']}),true);
  const miniBefore='import Taro from"@tarojs/taro";import{View,Button}from"@tarojs/components";function Home(){return <View/>}';
  const miniAfter=miniBefore.replace('<View/>','<Button onClick={()=>Taro.navigateTo({url:"/pages/products/index"})}>商品</Button>');
  assert.equal(presentationSyntaxOnly(miniBefore,miniAfter,{platform:'miniapp',routes:['/pages/products/index']}),true);
  assert.equal(presentationSyntaxOnly(miniBefore,miniAfter,{platform:'miniapp',routes:[]}),false);
  const tabOptions={platform:'miniapp',routes:['/pages/products/index'],tabRoutes:['/pages/products/index']};
  assert.equal(presentationSyntaxOnly(miniBefore,miniAfter,tabOptions),false);
  assert.equal(presentationSyntaxOnly(miniBefore,miniAfter.replace('navigateTo','switchTab'),tabOptions),true);
});
test('App styles and copy qualify but business uses and shadowed primitives stay full', () => {
  const before='import{View,StyleSheet}from"react-native";function Home(){return <View style={styles.card}/>};const styles=StyleSheet.create({card:{padding:12}})';
  assert.equal(presentationSyntaxOnly(before,before.replace('padding:12','padding:16'),{platform:'app'}),true);
  const used=before+';send(styles);';
  assert.equal(presentationSyntaxOnly(used,used.replace('padding:12','padding:16'),{platform:'app'}),false);
  assert.equal(presentationSyntaxOnly(before,before.replace('padding:12','padding:Boolean(<View onPress={perform()}/>)'),{platform:'app'}),false);
  const custom='function View(){send();return <Text/>} function Home(){return <Text>首页</Text>}';
  assert.equal(presentationSyntaxOnly(custom,custom.replace('<Text>首页</Text>','<View/>')),false);
  const foreign='import {Label} from "./business";function Home(){return <Label title="guest"/>}';
  assert.equal(presentationSyntaxOnly(foreign,foreign.replace('guest','admin')),false);
  const foreignIcon='import {FunctionalIcon} from "./business";function Home(){return <FunctionalIcon name="guest"/>}';
  assert.equal(presentationSyntaxOnly(foreignIcon,foreignIcon.replace('guest','admin')),false);
  const actual=readFileSync(new URL('../../app/about.tsx',import.meta.url),'utf8');
  assert.equal(presentationSyntaxOnly(actual,actual.replace('AI 赋能农业，夯实健康之路','AI 赋能农业，共创健康生活'),{platform:'app'}),true);
});
test('App exports require both native bundles, real assets and fonts', (t) => {
  const root=mkdtempSync(path.join(tmpdir(),'aimai-export-test-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
  writeFileSync(path.join(root,'android.hbc'),'bundle');writeFileSync(path.join(root,'ios.hbc'),'bundle');writeFileSync(path.join(root,'font'),'font');
  const entry=(bundle)=>({bundle,assets:[{path:'font',ext:'ttf'}]});
  const good={fileMetadata:{android:entry('android.hbc'),ios:entry('ios.hbc')}};
  writeFileSync(path.join(root,'metadata.json'),JSON.stringify(good));assert.doesNotThrow(()=>verifyAppExport(root));
  for(const m of [{fileMetadata:{android:good.fileMetadata.android}}, {fileMetadata:{...good.fileMetadata,ios:{...entry('ios.hbc'),assets:[]}}}, {fileMetadata:{...good.fileMetadata,ios:entry('missing')}}]) {
    writeFileSync(path.join(root,'metadata.json'),JSON.stringify(m));assert.throws(()=>verifyAppExport(root));
  }
});
test('query authentication, cache policy and setter changes cannot be called presentation', () => {
  const cases = [
    ['const q={queryKey:["profile",authRevision]};', 'const q={queryKey:["profile"]};'],
    ['const q={enabled:hydrated && loggedIn};', 'const q={enabled:true};'],
    ['const q={staleTime:60000};', 'const q={staleTime:Infinity};'],
    ['function stop(){setVoicePhase("idle");}', 'function stop(){setVoicePhase("recording");}'],
    ['const route="/referral"; function share(){go(route)}', 'const route="/payment"; function share(){go(route)}'],
    ['let n=1; n++;', 'const n=1; n--;'],
    ['const b=Boolean; function f(){return b(member)}', 'const b=Boolean; function f(){return b(profile)}'],
    ['const a=true; function f(a){return <Text>{a}</Text>}', 'const a=false; function f(a){return <Text>{a}</Text>}'],
    ['const Boolean=(x)=>audit(x); function f(){return <Text>{Boolean(loggedIn)}</Text>}', 'const Boolean=(x)=>audit(x); function f(){return <Text>{Boolean(hydrated)}</Text>}'],
    ['import Boolean from "./coerce"; function f(){const label=Boolean(loggedIn);return <Text>{label}</Text>}', 'import Boolean from "./coerce"; function f(){const label=Boolean(hydrated);return <Text>{label}</Text>}'],
    ['const {Boolean}=helpers; function f(){return <Text>{Boolean(loggedIn)}</Text>}', 'const {Boolean}=helpers; function f(){return <Text>{Boolean(hydrated)}</Text>}'],
    ['function Home(){const panel=<View onClick={share}/>;return <View>{panel}</View>}', 'function Home(){const panel=<View onClick={purchase}/>;return <View>{panel}</View>}'],
    ['function Home(){const panel=loggedIn ? <View onClick={share}/> : null;return <View>{panel}</View>}', 'function Home(){const panel=loggedIn ? <View onClick={purchase}/> : null;return <View>{panel}</View>}'],
    ['function Home(){return <><View onClick={buy}>A</View><View onClick={share}>B</View></>}', 'function Home(){return <><View onClick={buy}>A<View onClick={share}>B</View></View></>}'],
  ];
  for (const [before, after] of cases) assert.equal(presentationSyntaxOnly(before, after), false, before);
});
test('business gates, UI state controlling business events and new bubbling ancestors stay full', () => {
  const base='import{View,Pressable}from"react-native";function Home(){return <View>{loggedIn && <Pressable onPress={buy}>购买</Pressable>}</View>}';
  assert.equal(presentationSyntaxOnly(base,base.replace('loggedIn &&','true &&'),{platform:'app',filePath:'app/home.tsx'}),false);
  const state='import{useState}from"react";import{View,Pressable}from"react-native";function Home(){const[helpOpen,setHelpOpen]=useState(false);return <View>{helpOpen && <Pressable onPress={buy}>购买</Pressable>}</View>}';
  assert.equal(presentationSyntaxOnly(state,state.replace('useState(false)','useState(true)'),{platform:'app',filePath:'app/home.tsx'}),false);
  const ancestor='import Taro from"@tarojs/taro";import{View,Button}from"@tarojs/components";function Home(){return <View><Button onClick={buy}>买</Button></View>}';
  const nested=ancestor.replace('<View><Button','<View onClick={()=>Taro.navigateTo({url:"/pages/about/index"})}><Button');
  assert.equal(presentationSyntaxOnly(ancestor,nested,{platform:'miniapp',routes:['/pages/about/index']}),false);
  const unknown='import{router}from"expo-router";import{Flow}from"./BusinessFlow";function Home(){return <Flow/>}';
  assert.equal(presentationSyntaxOnly(unknown,unknown.replace('<Flow/>','<Flow onClose={()=>router.push("/about")}/>'),{platform:'app',routes:['/about']}),false);
  const hidden='import{Text,View}from"react-native";function Home(){return <Text title="文案"/>}';
  assert.equal(presentationSyntaxOnly(hidden,hidden.replace('title="文案"','title={Boolean(<View onPress={perform()}/>)}'),{platform:'app'}),false);
  const modal='import{Modal,Pressable}from"react-native";function Home(){const show=true;return <Modal visible={show}><Pressable onPress={buy}>买</Pressable></Modal>}';
  assert.equal(presentationSyntaxOnly(modal,modal.replace('show=true','show=false'),{platform:'app',filePath:'app/home.tsx'}),false);
  const direct=modal.replace('visible={show}','visible={true}');
  assert.equal(presentationSyntaxOnly(direct,direct.replace('visible={true}','visible={false}'),{platform:'app'}),false);
  const styled=modal.replaceAll('Modal','View').replace('visible={show}','style={{display:show?"flex":"none"}}');
  assert.equal(presentationSyntaxOnly(styled,styled.replace('show=true','show=false'),{platform:'app'}),false);
  const sheet='import{AppBottomSheet}from"../src/components/overlay";import{Pressable}from"react-native";function Home(){const show=true;return <AppBottomSheet open={show} onClose={close}><Pressable onPress={buy}>买</Pressable></AppBottomSheet>}';
  assert.equal(presentationSyntaxOnly(sheet,sheet.replace('show=true','show=false'),{platform:'app',filePath:'app/home.tsx'}),false);
});
test('CamelCase business component paths cannot receive the simple UI fast mode', () => {
  for(const name of ['src/components/cards/OrderCard.tsx','src/components/overlay/PendingCheckoutBanner.tsx','src/components/data/VipHomePromoCarousel.tsx','src/components/overlay/PrivacyConsentModal.tsx']) assert.equal(classifyReleaseScope({files:[name],patch:'+<Text>文案</Text>',syntaxSafe:true}).mode,'full',name);
});
test('runtime contracts and release configuration never take the fast path', () => {
  for (const name of ['backend/prisma/schema.prisma', 'backend/src/payment.ts', 'app/_layout.tsx', 'src/repos/BonusRepo.ts', 'miniapp/src/repos/auth.ts', 'miniapp/src/store/auth.ts', 'miniapp/src/types/result.ts', 'miniapp/package.json', 'miniapp/config/env.ts', '.github/workflows/e2e.yml', 'scripts/ci-release-scope.mjs', 'AGENTS.md']) {
    assert.equal(classifyReleaseScope({ files: [home, name], patch: '+<Text>分享</Text>' }).uiOnly, false, name);
  }
});
test('one-line API, auth, mutation, navigation or import changes stay on full validation', () => {
  for (const code of ['ApiClient.post("/order")', 'SomeRepo.get()', 'api.get()', 'wx.login()', 'useQuery({})', 'useAuthStore(s=>s)', 'setSession(session)', 'accessToken = x', 'const price = oldPrice * 0.5', 'quantity = 0', 'requestPayment({})', 'navigateTo({url:"/checkout"})', 'Taro.setStorageSync("x",x)', 'fetch(url)', 'mutation.mutate()', 'import { helper } from "./logic"']) {
    assert.equal(classifyReleaseScope({ files: [home], patch: '+' + code }).uiOnly, false, code);
  }
});
test('empty, documentation-only, broad or unsafe changes fail closed', () => {
  for (const args of [{}, { files: ['plan.md'] }, { files: [home] }, { files: [home], patch: '+x\n'.repeat(121) }, { files: ['miniapp/src/pages/home/index.scss'], unsafeModes: true }, { files: ['miniapp/src/pages/home/index.scss'], forceFull: true }]) {
    assert.equal(classifyReleaseScope(args).uiOnly, false);
  }
});
test('missing comparisons and manual validation remain full', () => {
  assert.equal(scopeFromGit({}).uiOnly, false);
  assert.equal(scopeFromGit({ base: '0'.repeat(40), head: 'a'.repeat(40), event: 'push' }).uiOnly, false);
  assert.equal(scopeFromGit({ base: 'a'.repeat(40), head: 'b'.repeat(40), event: 'workflow_dispatch' }).uiOnly, false);
});
test('the required e2e status cannot hide failed, cancelled or missing validation', () => {
  assert.equal(e2eGatePassed({ scopeResult: 'success', mode: 'miniapp-ui', fullResult: 'skipped' }), true);
  assert.equal(e2eGatePassed({ scopeResult: 'success', mode: 'full', fullResult: 'success' }), true);
  for (const scopeResult of ['failure', 'cancelled', 'skipped', undefined]) {
    assert.equal(e2eGatePassed({ scopeResult, mode: 'miniapp-ui', fullResult: 'skipped' }), false);
  }
  for (const mode of ['full', 'miniapp-ui', '', undefined]) {
    for (const fullResult of ['failure', 'cancelled', undefined]) {
      assert.equal(e2eGatePassed({ scopeResult: 'success', mode, fullResult }), false);
    }
  }
  assert.equal(e2eGatePassed({ scopeResult: 'success', mode: 'full', fullResult: 'skipped' }), false);
});
test('one required checks gate includes every affected client and rejects failures/cancellation/unknown outputs', () => {
  for (const [appRequired, miniappRequired] of [['true', 'false'], ['false', 'true'], ['true', 'true'], ['false', 'false']]) {
    const args = {scopeResult:'success',appRequired,miniappRequired,appResult:appRequired==='true'?'success':'skipped',miniappResult:miniappRequired==='true'?'success':'skipped'};
    assert.equal(frontendGatePassed(args),true);
    for(const scopeResult of ['failure','cancelled','skipped',undefined]) assert.equal(frontendGatePassed({...args,scopeResult}),false);
    for(const field of ['appResult','miniappResult']) for(const result of ['failure','cancelled','',undefined]) assert.equal(frontendGatePassed({...args,[field]:result}),false);
    assert.equal(frontendGatePassed({...args,appRequired:undefined}),false);
    assert.equal(frontendGatePassed({...args,miniappRequired:undefined}),false);
  }
});
test('affected frontends exclude unchanged peers and include both for shared/backend/CI changes', () => {
  assert.deepEqual(affectedClients(['app/about.tsx']),{app:true,miniapp:false});
  assert.deepEqual(affectedClients([home]),{app:false,miniapp:true});
  for(const name of ['backend/src/order.ts','assets/seafood/x.png','scripts/ci-frontend-checks.mjs','.github/workflows/miniapp-ci.yml']) assert.deepEqual(affectedClients([name]),{app:true,miniapp:true});
  const r=classifyReleaseScope({files:['app/about.tsx',home],patch:'+<Text>文案</Text>',syntaxSafe:true});
  assert.equal(r.mode,'frontend-ui');
  for(const mode of ['app-ui','miniapp-ui','frontend-ui']) assert.equal(e2eGatePassed({scopeResult:'success',mode,fullResult:'skipped'}),true);
});
test('related test selection passes filenames as arguments and preserves full client fallback', () => {
  const files=['app/(tabs)/home.tsx',home,'backend/a.ts'];
  assert.deepEqual(selectedFrontendFiles(files,'app'),['app/(tabs)/home.tsx']);
  assert.deepEqual(frontendTestCommand({client:'app',files:['app/(tabs)/home.tsx']}),['node_modules/.bin/jest','--findRelatedTests','app/(tabs)/home.tsx','--runInBand','--passWithNoTests']);
  assert.deepEqual(frontendTestCommand({client:'miniapp',files:[home]}),['node_modules/.bin/vitest','related','--run','src/pages/home/index.tsx','--passWithNoTests']);
  assert.equal(frontendTestCommand({client:'app',full:true}).includes('--findRelatedTests'),false);
});
test('manual build targets must match their exact production or staging branch', () => {
  assert.equal(frontendBuildContext({ref:'refs/heads/main',event:'push'}).environment,'production');
  assert.equal(frontendBuildContext({ref:'refs/pull/1/merge',event:'pull_request'}).releaseSource,false);
  for(const [ref,requested]of [['refs/heads/main','staging'],['refs/heads/staging-next','production'],['refs/heads/codex/x','production']]) assert.throws(()=>frontendBuildContext({ref,event:'workflow_dispatch',requested}));
  assert.equal(frontendBuildContext({ref:'refs/heads/staging-next',event:'workflow_dispatch',requested:'staging'}).environment,'staging');
});
test('real Git comparison handles PR ancestry, renames and symlinks conservatively', (t) => {
  const root = mkdtempSync(path.join(tmpdir(), 'aimai-scope-test-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  git('init'); git('config', 'user.name', 'Scope Test'); git('config', 'user.email', 'scope@example.invalid');
  mkdirSync(path.join(root, 'miniapp/src/pages/home'), { recursive: true });
  writeFileSync(path.join(root, home), '<Text>旧文案</Text>\n');
  git('add', '.'); git('commit', '-m', 'base'); const base = git('rev-parse', 'HEAD');
  writeFileSync(path.join(root, home), '<Text>新文案</Text>\n');
  git('add', '.'); git('commit', '-m', 'copy'); const head = git('rev-parse', 'HEAD');
  assert.equal(scopeFromGit({ base, head, event: 'pull_request', cwd: root }).uiOnly, true);
  mkdirSync(path.join(root, 'backend'), { recursive: true });
  git('mv', home, 'backend/auth.ts'); git('commit', '-m', 'rename'); const moved = git('rev-parse', 'HEAD');
  assert.equal(scopeFromGit({ base: head, head: moved, event: 'push', cwd: root }).uiOnly, false);
  symlinkSync('../../../../backend/auth.ts', path.join(root, home));
  git('add', '.'); git('commit', '-m', 'symlink');
  assert.equal(scopeFromGit({ base: moved, head: git('rev-parse', 'HEAD'), event: 'push', cwd: root }).uiOnly, false);
});
test('real Git mixed frontend changes use registered routes and the affected-client fast mode', (t) => {
  const root=mkdtempSync(path.join(tmpdir(),'aimai-two-frontends-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
  const git=(...args)=>execFileSync('git',args,{cwd:root,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
  git('init');git('config','user.name','Scope Test');git('config','user.email','scope@example.invalid');
  mkdirSync(path.join(root,'app'),{recursive:true});mkdirSync(path.join(root,'miniapp/src/pages/home'),{recursive:true});mkdirSync(path.join(root,'miniapp/src/pages/products'),{recursive:true});
  const app='import{router}from"expo-router";import{View,Text,Pressable}from"react-native";function Home(){return <View><Text>首页</Text></View>}';
  const mini='import Taro from"@tarojs/taro";import{View,Button}from"@tarojs/components";function Home(){return <View/>}';
  writeFileSync(path.join(root,'app/home.tsx'),app);writeFileSync(path.join(root,'app/about.tsx'),'<Text>关于</Text>');
  writeFileSync(path.join(root,home),mini);writeFileSync(path.join(root,'miniapp/src/pages/products/index.tsx'),'<View/>');
  writeFileSync(path.join(root,'miniapp/src/app.config.ts'),'export default defineAppConfig({pages:["pages/home/index","pages/products/index"],tabBar:{list:[{pagePath:"pages/products/index"}]}})');
  git('add','.');git('commit','-m','base');const base=git('rev-parse','HEAD');
  writeFileSync(path.join(root,'app/home.tsx'),app.replace('<Text>首页</Text>','<Text>首页</Text><Pressable onPress={()=>router.push("/about")}><Text>关于</Text></Pressable>'));
  writeFileSync(path.join(root,home),mini.replace('<View/>','<Button onClick={()=>Taro.switchTab({url:"/pages/products/index"})}>商品</Button>'));
  git('add','.');git('commit','-m','simple entries');const head=git('rev-parse','HEAD');
  const good=scopeFromGit({base,head,event:'pull_request',cwd:root});assert.equal(good.mode,'frontend-ui');assert.equal(good.app,true);assert.equal(good.miniapp,true);
  writeFileSync(path.join(root,home),mini.replace('<View/>','<Button onClick={()=>Taro.navigateTo({url:"/pages/products/index"})}>商品</Button>'));
  git('add','.');git('commit','-m','wrong navigation method');
  assert.equal(scopeFromGit({base:head,head:git('rev-parse','HEAD'),event:'push',cwd:root}).mode,'full');
});
test('real Git deletion and rename inside otherwise allowed resources stay full', (t) => {
  const root = mkdtempSync(path.join(tmpdir(), 'aimai-resource-scope-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  git('init'); git('config', 'user.name', 'Scope Test'); git('config', 'user.email', 'scope@example.invalid');
  mkdirSync(path.join(root, 'miniapp/src/assets'), { recursive: true });
  writeFileSync(path.join(root, 'miniapp/src/assets/old.png'), 'fixture');
  git('add', '.'); git('commit', '-m', 'base'); const base = git('rev-parse', 'HEAD');
  git('mv', 'miniapp/src/assets/old.png', 'miniapp/src/assets/new.png'); git('commit', '-m', 'rename'); const head = git('rev-parse', 'HEAD');
  assert.equal(scopeFromGit({ base, head, event: 'push', cwd: root }).uiOnly, false);
  git('rm', 'miniapp/src/assets/new.png'); git('commit', '-m', 'delete');
  assert.equal(scopeFromGit({ base: head, head: git('rev-parse', 'HEAD'), event: 'push', cwd: root }).uiOnly, false);
});
test('real homepage query and state changes stay full even when no import changes', (t) => {
  const root = mkdtempSync(path.join(tmpdir(), 'aimai-home-scope-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  git('init'); git('config', 'user.name', 'Scope Test'); git('config', 'user.email', 'scope@example.invalid');
  mkdirSync(path.join(root, 'miniapp/src/pages/home'), { recursive: true });
  const before = readFileSync(new URL('../../miniapp/src/pages/home/index.tsx', import.meta.url), 'utf8');
  writeFileSync(path.join(root, home), before);
  git('add', '.'); git('commit', '-m', 'base'); const base = git('rev-parse', 'HEAD');
  const changes = [
    ["queryKey: ['home', 'profile', authRevision]", "queryKey: ['home', 'profile']"],
    ['enabled: hydrated && loggedIn', 'enabled: true'],
    ['staleTime: 60_000', 'staleTime: Infinity'],
    ["setVoicePhase('idle')", "setVoicePhase('recording')"],
  ];
  for (const [oldText, newText] of changes) {
    assert.ok(before.includes(oldText));
    writeFileSync(path.join(root, home), before.replace(oldText, newText));
    git('add', '.'); git('commit', '-m', 'logic boundary');
    assert.equal(scopeFromGit({ base, head: git('rev-parse', 'HEAD'), event: 'pull_request', cwd: root }).uiOnly, false, oldText);
  }
});
