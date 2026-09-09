import { test, expect, type Page } from '@playwright/test';

const A = { id:'company-a', name:'测试丰禾农业', status:'ACTIVE', available:100, frozen:10, reserved:20, recoverable:0, paid:50, accrued:180, lastEntryAt:'2026-09-09T08:00:00Z' };
const B = { id:'company-b', name:'测试待追偿公司', status:'ACTIVE', available:70, frozen:5, reserved:0, recoverable:30, paid:100, accrued:175, lastEntryAt:'2026-09-09T07:00:00Z' };
const PAYMENT = {id:'payment-a',companyId:A.id,company:{id:A.id,name:A.name},amount:20,status:'RESERVED',needsReview:false,createdAt:'2026-09-09T08:00:00Z',items:[],payeeName:A.name,bankAccount:'00000000000001',bankName:'测试开户行',reason:'测试付款'};
const LEDGER = {id:'ledger-a',fundType:'CHARITY_FUND',eventType:'RELEASE',amount:8,direction:'CREDIT',createdAt:'2026-09-09T08:00:00Z',balanceAfter:108,availableAfter:108,frozenAfter:0,reservedAfter:0,sourceType:'NORMAL',orderId:'order-a',profitBase:100,allocationRatio:.08};

async function setup(page:Page, permissions?:string[]) {
  const seen:string[]=[];
  await page.addInitScript(({permissions})=>{
    const admin={id:'ui-fixture',username:'UI测试',roles:permissions?['测试只读角色']:['超级管理员'],permissions:permissions||[]};
    localStorage.setItem('admin_token','ui-fixture-only');
    localStorage.setItem('nongmai-admin-auth',JSON.stringify({state:{token:'ui-fixture-only',refreshToken:'ui-fixture-only',admin},version:0}));
  },{permissions});
  await page.route('**/api/v1/admin/**',async route=>{
    const url=new URL(route.request().url()); seen.push(url.pathname+url.search);
    const prefix='/api/v1/admin'; const path=url.pathname.slice(prefix.length); const q=url.searchParams;
    let data:unknown={items:[],total:0,page:1,pageSize:20};
    if(path.includes('unread-count')) data=0;
    else if(path==='/fund-ledgers/summary')data={funds:[{fundType:'CHARITY_FUND',initialBalance:100,periodIncome:8,periodExpense:0,currentBalance:108},{fundType:'PLATFORM_PROFIT',initialBalance:500,currentBalance:500,periodIncome:0,periodExpense:0}]};
    else if(path==='/industry-funds/companies'){
      const search=q.get('search')||'';let rows=[A,B].filter(c=>c.name.includes(search)&&(!q.get('companyId')||q.get('companyId')===c.id));
      if(q.get('view')==='recovery')rows=rows.filter(c=>c.recoverable>0);
      data={items:rows,total:rows.length,page:1,pageSize:20,summary:{available:rows.reduce((s,c)=>s+c.available,0),frozen:rows.reduce((s,c)=>s+c.frozen,0),reserved:rows.reduce((s,c)=>s+c.reserved,0),recoverable:rows.reduce((s,c)=>s+c.recoverable,0),count:rows.length}};
    }else if(path==='/industry-funds/companies/company-a')data=A;
    else if(path==='/industry-funds/companies/company-b')data=B;
    else if(path.includes('/ledgers'))data={items:[{...LEDGER,companyId:A.id,fundType:'INDUSTRY_FUND'}],total:1,page:1,pageSize:20};
    else if(path==='/industry-funds/payments'&&route.request().method()==='POST')data={...PAYMENT,id:'payment-created',amount:JSON.parse(route.request().postData()||'{}').amount};
    else if(path==='/industry-funds/payments')data={items:[PAYMENT],total:1,page:1,pageSize:20,summary:{pendingCount:1,reviewCount:0,recoveryCount:0}};
    else if(path.startsWith('/industry-funds/payments/'))data={...PAYMENT,id:path.split('/').at(-1)};
    else if(path==='/fund-ledgers/CHARITY_FUND/entries/ledger-a')data=LEDGER;
    else if(path==='/fund-ledgers/CHARITY_FUND/entries')data={items:[LEDGER],total:1,page:1,pageSize:20};
    await route.fulfill({json:{ok:true,data}});
  });
  return seen;
}

test('三个独立入口各自只加载主体列表',async({page})=>{
  const seen=await setup(page);await page.goto('/fund-ledgers');
  await expect(page.getByRole('heading',{name:'基金账本',exact:true})).toBeVisible();
  await expect(page.getByRole('button',{name:'查看流水'}).first()).toBeVisible();
  expect(seen.some(u=>u.includes('/industry-funds/companies'))).toBe(false);
  expect(seen.some(u=>u.includes('/industry-funds/payments'))).toBe(false);
  await page.goto('/fund-ledgers/companies');await expect(page.getByRole('heading',{name:'公司产业基金',exact:true})).toBeVisible();
  await expect(page.getByRole('button',{name:A.name,exact:true})).toBeVisible();
  await page.goto('/fund-ledgers/payments');await expect(page.getByRole('heading',{name:'公对公付款',exact:true})).toBeVisible();
  await expect(page.getByText('payment-a',{exact:true}).first()).toBeVisible();
});

test('公司名称搜索、快捷筛选和关闭详情保留查询',async({page})=>{
  const seen=await setup(page);await page.goto('/fund-ledgers/companies');
  await page.getByRole('textbox',{name:'公司名称搜索'}).fill('丰禾');
  await page.getByRole('button',{name:/^查\s*询$/}).click();
  await expect(page).toHaveURL(/q=.*%/);
  await expect(page.getByRole('button',{name:A.name,exact:true})).toBeVisible();
  await expect(page.getByRole('button',{name:B.name,exact:true})).toHaveCount(0);
  expect(seen.some(u=>u.includes('search=%E4%B8%B0%E7%A6%BE'))).toBe(true);
  await page.getByRole('button',{name:'查看',exact:true}).click();
  await expect(page.getByRole('tab',{name:'资金明细'})).toBeVisible();
  await page.getByRole('button',{name:'关闭',exact:true}).click();
  await expect(page.getByRole('textbox',{name:'公司名称搜索'})).toHaveValue('丰禾');
  await page.getByRole('button',{name:/^重\s*置$/}).click();
  await expect(page).not.toHaveURL(/[?&]q=/);
  await expect(page.getByRole('textbox',{name:'公司名称搜索'})).toHaveValue('');
  await page.getByRole('button',{name:'有待追偿',exact:true}).click();
  await expect(page.getByRole('button',{name:B.name,exact:true})).toBeVisible();
  await expect(page.getByRole('button',{name:A.name,exact:true})).toHaveCount(0);
  await expect(page.getByRole('row').filter({hasText:B.name}).getByRole('button',{name:'登记付款',exact:true})).toBeDisabled();
});

test('流水以抽屉展示并保留搜索条件',async({page})=>{
  await setup(page);await page.goto('/fund-ledgers/CHARITY_FUND?search=order-a');
  await expect(page.getByText('order-a',{exact:true}).first()).toBeVisible();
  await page.getByRole('button',{name:/详情|查看/}).last().click();
  await expect(page.getByText('流水号',{exact:true}).last()).toBeVisible();
  await expect(page).toHaveURL(/entryId=ledger-a/);
  await page.getByRole('button',{name:'关闭',exact:true}).click();
  await expect(page).not.toHaveURL(/entryId=/);
  await expect(page).toHaveURL(/order-a/);
});

test('只读产业基金用户可直接进入公司页且不查询平台总账',async({page})=>{
  const seen=await setup(page,['industry_funds:read']);await page.goto('/fund-ledgers');
  await expect(page).toHaveURL(/fund-ledgers\/companies/);
  await expect(page.getByRole('button',{name:A.name,exact:true})).toBeVisible();
  await expect(page.getByRole('button',{name:'登记付款',exact:true})).toHaveCount(0);
  expect(seen.some(u=>u.includes('/fund-ledgers/summary'))).toBe(false);
});

test('公司快捷登记预选正确主体',async({page})=>{
  await setup(page);await page.goto('/fund-ledgers/companies?q=丰禾');
  await page.getByRole('button',{name:'登记付款',exact:true}).click();
  await expect(page).toHaveURL(/fund-ledgers\/payments.*companyId=company-a/);
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.getByRole('textbox',{name:/对公户名/})).toHaveValue(A.name);
});

async function fillNewPayment(page:Page) {
  await expect(page.getByRole('textbox',{name:/对公户名/})).toHaveValue(A.name);
  await page.getByRole('spinbutton',{name:/预留金额/}).fill('20');
  await page.getByRole('textbox',{name:/开户行/}).fill('测试开户行');
  await page.getByRole('textbox',{name:/对公账号/}).fill('00000000000001');
  await page.getByRole('textbox',{name:/登记原因/}).fill('测试付款登记');
}

test('服务器结果未知时冻结表单并以原幂等键重试',async({page})=>{
  await setup(page);const submissions:unknown[]=[];
  await page.route('**/api/v1/admin/industry-funds/payments',async route=>{
    if(route.request().method()!=='POST')return route.fallback();
    submissions.push(route.request().postDataJSON());
    if(submissions.length===1)return route.fulfill({status:503,json:{ok:false,error:{code:'UNKNOWN',message:'服务暂时不可用'}}});
    return route.fulfill({json:{ok:true,data:{...PAYMENT,id:'payment-created'}}});
  });
  await page.goto('/fund-ledgers/payments?companyId=company-a&create=1');
  await fillNewPayment(page);
  await page.getByRole('button',{name:/创建并预留/}).click();
  await expect(page.getByText('请求结果未知，已冻结本次提交',{exact:true})).toBeVisible();
  await expect(page.getByRole('textbox',{name:/对公账号/})).toBeDisabled();
  await page.getByRole('button',{name:'相同幂等键重试',exact:true}).click();
  await expect(page).toHaveURL(/payments\/payment-created/);
  expect(submissions).toHaveLength(2);expect(submissions[1]).toEqual(submissions[0]);
});

test('更正未付款单先取消原单，创建失败后不重复取消',async({page})=>{
  await setup(page);const actions:string[]=[];
  await page.route('**/api/v1/admin/industry-funds/payments/payment-a/cancel',async route=>{
    actions.push('cancel');return route.fulfill({json:{ok:true,data:{...PAYMENT,status:'CANCELLED'}}});
  });
  await page.route('**/api/v1/admin/industry-funds/payments',async route=>{
    if(route.request().method()!=='POST')return route.fallback();
    actions.push('create');
    if(actions.filter(a=>a==='create').length===1)return route.fulfill({status:409,json:{ok:false,error:{code:'UNKNOWN',message:'可支付余额不足'}}});
    return route.fulfill({json:{ok:true,data:{...PAYMENT,id:'payment-corrected'}}});
  });
  await page.goto('/fund-ledgers/payments?companyId=company-a&correctionId=payment-a&create=1');
  await expect(page.getByRole('dialog',{name:'更正未付款单'})).toBeVisible();
  await page.getByRole('checkbox',{name:'我已核实旧付款单尚未在线下银行付款'}).check();
  await page.getByRole('button',{name:'确认未付款并创建',exact:true}).click();
  await expect(page.getByText('旧付款单已取消，新付款单尚未创建',{exact:true})).toBeVisible();
  expect(actions).toEqual(['cancel','create']);
  await page.getByRole('button',{name:/创建并预留/}).click();
  await expect(page).toHaveURL(/payments\/payment-corrected/);
  expect(actions).toEqual(['cancel','create','create']);
});

test('完整流水详情返回列表时保留查询',async({page})=>{
  await setup(page);await page.goto('/fund-ledgers/CHARITY_FUND?q=order-a');
  await page.getByRole('button',{name:'查看',exact:true}).click();
  await page.getByRole('button',{name:'打开完整详情',exact:true}).click();
  await expect(page).toHaveURL(/entries\/CHARITY_FUND\/ledger-a/);
  await expect(page.getByText('ledger-a',{exact:true}).first()).toBeVisible();
  await page.getByRole('button',{name:/返回/}).first().click();
  await expect(page).toHaveURL(/CHARITY_FUND\?q=order-a/);
});

test('窄屏公司列表保留公司与金额操作',async({page})=>{
  await setup(page);await page.setViewportSize({width:768,height:900});
  await page.goto('/fund-ledgers/companies?q=丰禾');
  await expect(page.getByRole('button',{name:A.name,exact:true})).toBeVisible();
  await expect(page.getByRole('button',{name:'登记付款',exact:true})).toBeVisible();
  await page.screenshot({path:'test-results/fund-pages/company-tablet.png',fullPage:true});
});

test('离开已填写付款单时可继续编辑而不丢失内容',async({page})=>{
  await setup(page);await page.goto('/fund-ledgers/payments?companyId=company-a&create=1');
  await fillNewPayment(page);
  await page.getByRole('button',{name:'关闭',exact:true}).click();
  await expect(page.getByRole('dialog',{name:'放弃未提交的付款单？',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'继续填写',exact:true}).click();
  await expect(page.getByRole('textbox',{name:/对公账号/})).toHaveValue('00000000000001');
});

test('公司计提依据区分整体基金比例与公司分摊金额',async({page})=>{
  await setup(page);
  await page.route('**/api/v1/admin/fund-ledgers/INDUSTRY_FUND/entries/ledger-a',route=>route.fulfill({json:{ok:true,data:{...LEDGER,fundType:'INDUSTRY_FUND',eventType:'ACCRUAL',amount:4,profitBase:100,allocationRatio:.08}}}));
  await page.goto('/fund-ledgers/entries/INDUSTRY_FUND/ledger-a');
  await expect(page.getByText(/利润基数 ¥100.00，基金比例 8.00%；本笔计提 ¥4.00/)).toBeVisible();
  await expect(page.getByText(/100.00.*×.*8.00%.*=.*4.00/)).toHaveCount(0);
});

test('旧搜索书签可以清除，流水号链接打开正确详情',async({page})=>{
  const seen=await setup(page);await page.goto('/fund-ledgers/CHARITY_FUND?search=order-a');
  await page.getByRole('button',{name:/^重\s*置$/}).click();
  await expect(page).not.toHaveURL(/search=/);
  await expect.poll(()=>seen.at(-1)).not.toMatch(/search=order-a/);
  await page.getByRole('link',{name:'ledger-a',exact:true}).click();
  await expect(page).toHaveURL(/entries\/CHARITY_FUND\/ledger-a/);
});

test('手机宽度详情抽屉保持在屏幕内',async({page})=>{
  await setup(page);await page.setViewportSize({width:390,height:844});
  await page.goto('/fund-ledgers/companies?q=丰禾');
  await page.getByRole('button',{name:'查看',exact:true}).click();
  await expect(page.getByRole('tab',{name:'资金明细'})).toBeVisible();
  // Wait for the entrance transform and allow only subpixel measurement noise.
  await expect.poll(async()=>{
    const bounds=await page.getByRole('dialog').boundingBox();
    return bounds ? Math.max(bounds.width-390, -bounds.x, bounds.x+bounds.width-390) : Infinity;
  }).toBeLessThanOrEqual(0.01);
});

const proofPng=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==','base64');
for(const action of [
  {path:'cancel',button:'核实未付款并取消预留',title:'取消付款预留',reason:'核实原因',status:'RESERVED'},
  {path:'reverse',button:'登记错误并冲正',title:'登记错误并冲正',reason:'冲正原因',status:'PAID'},
  {path:'recoveries',button:'登记实际回款',title:'登记实际回款',reason:'回款原因',status:'PAID'},
  {path:'confirm',button:'登记已付款',title:'登记已付款',reason:null,status:'RESERVED'},
]) {
  test(`付款详情${action.title}未知响应保留原请求`,async({page})=>{
    await setup(page);const payloads:unknown[]=[];
    await page.route('**/api/v1/admin/industry-funds/payments/payment-a',route=>route.fulfill({json:{ok:true,data:{...PAYMENT,status:action.status}}}));
    await page.route('**/api/v1/admin/industry-funds/proofs',route=>route.fulfill({json:{ok:true,data:{id:'11111111-1111-4111-8111-111111111111'}}}));
    await page.route(`**/api/v1/admin/industry-funds/payments/payment-a/${action.path}`,async route=>{
      payloads.push(route.request().postDataJSON());
      return payloads.length===1
        ? route.fulfill({status:503,json:{ok:false,error:{code:'UNKNOWN',message:'服务器暂时不可用'}}})
        : route.fulfill({json:{ok:true,data:PAYMENT}});
    });
    await page.goto('/fund-ledgers/payments/payment-a');
    await page.getByRole('button',{name:action.button,exact:true}).click();
    const modal=page.getByRole('dialog',{name:action.title,exact:true});
    if(action.reason)await modal.getByRole('textbox',{name:new RegExp(action.reason)}).fill('测试核实说明');
    if(action.path==='confirm'||action.path==='recoveries') {
      await modal.getByRole('textbox',{name:/银行流水号/}).fill('test-bank-reference');
      if(action.path==='confirm')await modal.getByRole('textbox',{name:/平台付款账户标识/}).fill('test-platform');
      await modal.locator('input[type="file"]').setInputFiles({name:'test-proof.png',mimeType:'image/png',buffer:proofPng});
      await expect(page.getByText('凭证已安全上传',{exact:true})).toBeVisible();
    }
    await modal.getByRole('button',{name:/^确\s*定$/}).click();
    await expect(modal.getByText('请求结果未知，已冻结本次提交',{exact:true})).toBeVisible();
    await expect(modal.getByRole('textbox',{name:action.reason?new RegExp(action.reason):/银行流水号/})).toBeDisabled();
    await modal.getByRole('button',{name:/相同幂等键重试$/}).click();
    await expect(modal).not.toBeVisible();
    expect(payloads).toHaveLength(2);expect(payloads[1]).toEqual(payloads[0]);
  });
}
