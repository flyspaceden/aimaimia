/**
 * 爱买买生产环境基础数据 Bootstrap 脚本
 *
 * 用途：首次部署生产环境后跑一次，建立后端能正常运行的最小基础数据：
 *   - 60 个权限定义（AdminPermission）
 *   - 3 个默认角色（超级管理员 / 经理 / 员工）+ 角色-权限关联
 *   - 1 个超级管理员账号（admin / 默认密码 123456，**部署后必须立刻改密**）
 *   - 平台系统用户（PLATFORM）+ 平台公司（PLATFORM_COMPANY）
 *   - 普通用户树根节点（NORMAL_ROOT）
 *   - VIP 三叉树根节点 A1-A10
 *   - 60+ 条 RuleConfig（分润比例 / 提现规则 / 抵扣比例 / 退货窗口 / 发票配置等）
 *   - 初始 RuleVersion 快照（version="initial"）
 *
 * 与 seed.ts 的区别：
 *   - seed.ts 含大量 demo 数据（u-001 林青禾 等演示用户、商品、订单）— **绝不能在生产跑**
 *   - 本脚本仅做生产必备的最小集，无 demo 数据
 *
 * 使用方式（首次生产部署，在生产服务器上）：
 *   cd /www/wwwroot/aimaimai-prod-src/backend
 *   npx ts-node prisma/production-bootstrap.ts
 *
 * 自定义初始超管密码（强烈建议）：
 *   ADMIN_BOOTSTRAP_PASSWORD='你的强密码' npx ts-node prisma/production-bootstrap.ts
 *
 * 幂等性：所有 INSERT 都用 upsert，重复运行不会报错也不会重置已有数据。
 *
 * 来源对照（脚本内容必须与 backend/prisma/seed.ts 中对应章节保持一致）：
 *   - permissions（60 条）  : seed.ts:1341-1410
 *   - 3 个默认角色          : seed.ts:1417-1487
 *   - 超级管理员            : seed.ts:1490-1508
 *   - 平台用户/公司/根节点  : seed.ts:1511-1570
 *   - VIP 三叉树根 A1-A10   : seed.ts:1687-1701（扩展自 A1-A3）
 *   - RuleConfig            : seed.ts:1575-1675
 */

import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';

const prisma = new PrismaClient();

// ──────────────────────────────────────────────────────────────
// 1. 权限定义（60 条，源自 seed.ts:1341-1410）
// ──────────────────────────────────────────────────────────────
const PERMISSIONS = [
  { code: 'dashboard:read', module: 'dashboard', action: 'read', description: '查看仪表盘' },
  { code: 'users:read', module: 'users', action: 'read', description: '查看用户列表' },
  { code: 'users:create', module: 'users', action: 'create', description: '创建用户' },
  { code: 'users:update', module: 'users', action: 'update', description: '编辑用户' },
  { code: 'users:ban', module: 'users', action: 'ban', description: '禁用用户' },
  { code: 'products:read', module: 'products', action: 'read', description: '查看商品列表' },
  { code: 'products:create', module: 'products', action: 'create', description: '创建商品' },
  { code: 'products:update', module: 'products', action: 'update', description: '编辑商品' },
  { code: 'products:delete', module: 'products', action: 'delete', description: '删除商品' },
  { code: 'products:audit', module: 'products', action: 'audit', description: '审核商品' },
  { code: 'orders:read', module: 'orders', action: 'read', description: '查看订单列表' },
  { code: 'orders:ship', module: 'orders', action: 'ship', description: '订单发货' },
  { code: 'orders:refund', module: 'orders', action: 'refund', description: '订单退款' },
  { code: 'orders:cancel', module: 'orders', action: 'cancel', description: '取消订单' },
  { code: 'invoices:read', module: 'invoices', action: 'read', description: '查看发票列表' },
  { code: 'invoices:issue', module: 'invoices', action: 'issue', description: '开票/标记失败' },
  { code: 'companies:read', module: 'companies', action: 'read', description: '查看企业列表' },
  { code: 'companies:update', module: 'companies', action: 'update', description: '编辑企业' },
  { code: 'companies:audit', module: 'companies', action: 'audit', description: '审核企业' },
  { code: 'bonus:read', module: 'bonus', action: 'read', description: '查看会员/奖励' },
  { code: 'bonus:approve_withdraw', module: 'bonus', action: 'approve_withdraw', description: '审批提现' },
  { code: 'bonus:manage_rules', module: 'bonus', action: 'manage_rules', description: '管理提现与抵扣规则' },
  { code: 'bonus:adjust', module: 'bonus', action: 'adjust', description: '调整奖励' },
  { code: 'coupon:read', module: 'coupon', action: 'read', description: '查看红包活动与记录' },
  { code: 'coupon:manage', module: 'coupon', action: 'manage', description: '管理红包活动与发放' },
  { code: 'trace:read', module: 'trace', action: 'read', description: '查看溯源信息' },
  { code: 'trace:create', module: 'trace', action: 'create', description: '创建溯源批次' },
  { code: 'trace:update', module: 'trace', action: 'update', description: '编辑溯源批次' },
  { code: 'trace:delete', module: 'trace', action: 'delete', description: '删除溯源批次' },
  { code: 'config:read', module: 'config', action: 'read', description: '查看系统配置' },
  { code: 'config:update', module: 'config', action: 'update', description: '修改系统配置' },
  { code: 'admin_users:read', module: 'admin_users', action: 'read', description: '查看管理员列表' },
  { code: 'admin_users:create', module: 'admin_users', action: 'create', description: '创建管理员' },
  { code: 'admin_users:update', module: 'admin_users', action: 'update', description: '编辑管理员' },
  { code: 'admin_users:delete', module: 'admin_users', action: 'delete', description: '删除管理员' },
  { code: 'admin_roles:read', module: 'admin_roles', action: 'read', description: '查看角色列表' },
  { code: 'admin_roles:create', module: 'admin_roles', action: 'create', description: '创建角色' },
  { code: 'admin_roles:update', module: 'admin_roles', action: 'update', description: '编辑角色' },
  { code: 'admin_roles:delete', module: 'admin_roles', action: 'delete', description: '删除角色' },
  { code: 'audit:read', module: 'audit', action: 'read', description: '查看审计日志' },
  { code: 'audit:rollback', module: 'audit', action: 'rollback', description: '回滚操作' },
  { code: 'lottery:read', module: 'lottery', action: 'read', description: '抽奖管理-查看' },
  { code: 'lottery:create', module: 'lottery', action: 'create', description: '抽奖管理-创建' },
  { code: 'lottery:update', module: 'lottery', action: 'update', description: '抽奖管理-编辑' },
  { code: 'lottery:delete', module: 'lottery', action: 'delete', description: '抽奖管理-删除' },
  { code: 'reward_products:read', module: 'reward_products', action: 'read', description: '奖励商品-查看' },
  { code: 'reward_products:create', module: 'reward_products', action: 'create', description: '奖励商品-创建' },
  { code: 'reward_products:update', module: 'reward_products', action: 'update', description: '奖励商品-编辑' },
  { code: 'reward_products:delete', module: 'reward_products', action: 'delete', description: '奖励商品-删除' },
  { code: 'vip_gift:read', module: 'vip_gift', action: 'read', description: 'VIP赠品方案-查看' },
  { code: 'vip_gift:create', module: 'vip_gift', action: 'create', description: 'VIP赠品方案-创建' },
  { code: 'vip_gift:update', module: 'vip_gift', action: 'update', description: 'VIP赠品方案-编辑' },
  { code: 'shipping:read', module: 'shipping', action: 'read', description: '运费规则-查看' },
  { code: 'shipping:create', module: 'shipping', action: 'create', description: '运费规则-创建' },
  { code: 'shipping:update', module: 'shipping', action: 'update', description: '运费规则-编辑' },
  { code: 'shipping:delete', module: 'shipping', action: 'delete', description: '运费规则-删除' },
  { code: 'replacements:read', module: 'replacements', action: 'read', description: '换货管理-查看' },
  { code: 'replacements:arbitrate', module: 'replacements', action: 'arbitrate', description: '换货管理-仲裁' },
  { code: 'categories:read', module: 'categories', action: 'read', description: '分类管理-查看' },
  { code: 'categories:manage', module: 'categories', action: 'manage', description: '分类管理-增删改' },
  { code: 'digital_assets:read', module: 'digital_assets', action: 'read', description: '数字资产-查看' },
  { code: 'digital_assets:adjust', module: 'digital_assets', action: 'adjust', description: '数字资产-手动调整' },
  { code: 'digital_assets:export', module: 'digital_assets', action: 'export', description: '数字资产-导出' },
  { code: 'digital_assets:settings', module: 'digital_assets', action: 'settings', description: '数字资产-规则占位配置' },
  { code: 'growth:read', module: 'growth', action: 'read', description: '普通成长体系-查看' },
  { code: 'growth:manage_rules', module: 'growth', action: 'manage_rules', description: '普通成长体系-管理行为与等级' },
  { code: 'growth:manage_exchange', module: 'growth', action: 'manage_exchange', description: '普通成长体系-管理积分兑换' },
  { code: 'growth:adjust_user', module: 'growth', action: 'adjust_user', description: '普通成长体系-手动调整积分成长' },
  { code: 'normal_share:read', module: 'normal_share', action: 'read', description: '普通分享码-查看' },
  { code: 'normal_share:manage', module: 'normal_share', action: 'manage', description: '普通分享码-启停管理' },
  { code: 'group_buy:read', module: 'group_buy', action: 'read', description: '团购-查看' },
  { code: 'group_buy:manage', module: 'group_buy', action: 'manage', description: '团购-管理' },
  { code: 'group_buy:export', module: 'group_buy', action: 'export', description: '团购-导出' },
  { code: 'group_buy:settings', module: 'group_buy', action: 'settings', description: '团购-设置' },
];

// ──────────────────────────────────────────────────────────────
// 2. 员工角色权限（只读 + 商品编辑）
// ──────────────────────────────────────────────────────────────
const STAFF_PERMISSIONS = [
  'dashboard:read',
  'users:read',
  'products:read',
  'products:update',
  'orders:read',
  'companies:read',
  'bonus:read',
  'growth:read',
  'normal_share:read',
  'trace:read',
  'config:read',
  'audit:read',
];

// ──────────────────────────────────────────────────────────────
// 3. RuleConfig 初始值（源自 seed.ts:1575-1675）
// ──────────────────────────────────────────────────────────────
const RULE_CONFIGS: Array<{ key: string; value: any; desc: string }> = [
  // VIP 利润七分
  { key: 'VIP_PLATFORM_PERCENT', value: 0.50, desc: 'VIP利润-平台分成比例' },
  { key: 'VIP_REWARD_PERCENT', value: 0.30, desc: 'VIP利润-奖励池比例' },
  { key: 'VIP_DIRECT_REFERRAL_PERCENT', value: 0, desc: 'VIP利润-直推持续佣金比例' },
  { key: 'VIP_INDUSTRY_FUND_PERCENT', value: 0.10, desc: 'VIP利润-产业基金(卖家)比例' },
  { key: 'VIP_CHARITY_PERCENT', value: 0.02, desc: 'VIP利润-慈善基金比例' },
  { key: 'VIP_TECH_PERCENT', value: 0.02, desc: 'VIP利润-科技基金比例' },
  { key: 'VIP_RESERVE_PERCENT', value: 0.06, desc: 'VIP利润-备用金比例' },
  { key: 'NORMAL_BROADCAST_X', value: 20, desc: '@deprecated 普通广播每次分配订单数（已废弃）' },
  { key: 'VIP_MIN_AMOUNT', value: 100.0, desc: 'VIP 有效消费最低金额（元）' },
  { key: 'VIP_MAX_LAYERS', value: 15, desc: 'VIP 最多收取层数' },
  { key: 'VIP_BRANCH_FACTOR', value: 3, desc: '三叉树分叉数' },
  { key: 'BUCKET_RANGES', value: [[0, 10], [10, 50], [50, 100], [100, 500], [500, null]], desc: '@deprecated 普通桶金额区间（已废弃）' },
  { key: 'AUTO_CONFIRM_DAYS', value: 7, desc: '自动确认收货天数' },
  // 普通用户系统
  { key: 'NORMAL_BRANCH_FACTOR', value: 3, desc: '普通树叉数' },
  { key: 'NORMAL_MAX_LAYERS', value: 15, desc: '普通树最大分配层数' },
  { key: 'NORMAL_FREEZE_DAYS', value: 30, desc: '普通树冻结奖励过期天数' },
  { key: 'NORMAL_PLATFORM_PERCENT', value: 0.50, desc: '普通用户利润-平台分成比例' },
  { key: 'NORMAL_REWARD_PERCENT', value: 0.16, desc: '普通用户利润-奖励分成比例' },
  { key: 'NORMAL_INDUSTRY_FUND_PERCENT', value: 0.16, desc: '普通用户利润-产业基金(卖家)比例' },
  { key: 'NORMAL_CHARITY_PERCENT', value: 0.08, desc: '普通用户利润-慈善基金比例' },
  { key: 'NORMAL_TECH_PERCENT', value: 0.08, desc: '普通用户利润-科技基金比例' },
  { key: 'NORMAL_RESERVE_PERCENT', value: 0.02, desc: '普通用户利润-备用金比例' },
  { key: 'VIP_FREEZE_DAYS', value: 30, desc: 'VIP冻结奖励过期天数' },
  // 定价
  { key: 'MARKUP_RATE', value: 1.30, desc: '卖家商品加价率（售价=成本×此值）' },
  // 运费
  { key: 'DEFAULT_SHIPPING_FEE', value: 8.0, desc: '无匹配规则时的默认运费' },
  // 抽奖
  { key: 'LOTTERY_ENABLED', value: true, desc: '抽奖功能开关' },
  { key: 'LOTTERY_DAILY_CHANCES', value: 1, desc: '每日抽奖次数' },
  // 普通会员成长体系
  { key: 'GROWTH_ENABLED', value: false, desc: '普通会员成长系统总开关' },
  { key: 'GROWTH_POINTS_EXPIRE_DAYS', value: 365, desc: '普通积分有效期（天）' },
  { key: 'GROWTH_POINTS_EXPIRE_REMIND_DAYS', value: 30, desc: '普通积分过期提醒提前天数' },
  { key: 'GROWTH_DAILY_POINTS_CAP', value: 300, desc: '单用户每日普通积分获取上限' },
  { key: 'GROWTH_MONTHLY_POINTS_CAP', value: 3000, desc: '单用户每月普通积分获取上限' },
  { key: 'GROWTH_DAILY_SHARE_REWARD_USER_CAP', value: 5, desc: '每日分享奖励人数上限' },
  { key: 'GROWTH_MONTHLY_INVITE_FIRST_ORDER_CAP', value: 20, desc: '每月好友首单奖励人数上限' },
  { key: 'GROWTH_VIP_CHECKIN_POINTS_MULTIPLIER', value: 1.2, desc: 'VIP 签到普通积分加成' },
  { key: 'GROWTH_VIP_SHOPPING_GROWTH_MULTIPLIER', value: 1.5, desc: 'VIP 购物成长值加成' },
  { key: 'GROWTH_REFUND_REVERSAL_ENABLED', value: true, desc: '成长体系退款冲正开关' },
  { key: 'GROWTH_AUTO_SUSPEND_EXCHANGE_RISK', value: false, desc: '异常用户自动暂停兑换开关（v1 默认关闭）' },
  // 售后
  { key: 'RETURN_WINDOW_DAYS', value: 7, desc: '无理由退货窗口（天）' },
  { key: 'NORMAL_RETURN_DAYS', value: 7, desc: '普通退货窗口（天）' },
  { key: 'FRESH_RETURN_HOURS', value: 24, desc: '生鲜退货窗口（小时）' },
  { key: 'RETURN_NO_SHIP_THRESHOLD', value: 50, desc: '免退货退款金额门槛（元）' },
  { key: 'SELLER_REVIEW_TIMEOUT_DAYS', value: 3, desc: '卖家审核超时（天）' },
  { key: 'BUYER_SHIP_TIMEOUT_DAYS', value: 7, desc: '买家退货寄回超时（天）' },
  { key: 'SELLER_RECEIVE_TIMEOUT_DAYS', value: 7, desc: '卖家签收退货超时（天）' },
  { key: 'BUYER_CONFIRM_TIMEOUT_DAYS', value: 7, desc: '买家确认收货超时（天）' },
  // 发票
  { key: 'INVOICE_PROVIDER_MODE', value: 'MOCK', desc: '发票 Provider 模式（v1.0 用 MOCK 占位，对接航天信息/百望后切真实 Provider）' },
  { key: 'INVOICE_AUTO_ISSUE', value: true, desc: '买家申请发票后自动开票' },
  { key: 'INVOICE_AUTO_ISSUE_MAX_ATTEMPTS', value: 3, desc: '自动开票最大重试次数' },
  { key: 'INVOICE_ALLOW_VIP_PACKAGE', value: false, desc: 'VIP 礼包是否允许申请发票' },
  { key: 'INVOICE_LINE_MODE', value: 'ORDER_ITEMS', desc: '发票商品行生成模式' },
  { key: 'INVOICE_DEFAULT_TAX_RATE', value: 0, desc: '发票默认税率' },
  { key: 'INVOICE_DEFAULT_TAX_CLASSIFICATION_CODE', value: '', desc: '发票默认税收分类编码' },
  { key: 'INVOICE_DEFAULT_GOODS_NAME', value: '农产品', desc: '发票合并商品行默认名称' },
  { key: 'INVOICE_REMARK_TEMPLATE', value: '订单号：【订单号】', desc: '发票备注模板' },
  {
    key: 'INVOICE_ISSUER_PROFILE',
    value: {
      companyName: '深圳华海农业科技集团有限公司',
      taxNo: '91440300MA5DRWGW68',
      registeredAddress: '深圳市龙岗区平湖街道白坭坑社区丹荣路1号5#楼5RE2070',
      registeredPhone: '13923710623',
      bankName: '',
      bankAccount: '',
      drawer: '系统开票',
      reviewer: '',
      payee: '',
    },
    desc: '平台开票主体配置（部署后补 bankName / bankAccount）',
  },
  // 消费积分双轨
  { key: 'WITHDRAW_TAX_RATE', value: 0.20, desc: '提现代扣个税比例' },
  { key: 'WITHDRAW_MIN_AMOUNT', value: 10, desc: '提现单笔最低（元）' },
  { key: 'WITHDRAW_MAX_AMOUNT', value: 10000, desc: '提现单笔最高（元）' },
  { key: 'WITHDRAW_DAILY_MAX_COUNT', value: 3, desc: '提现每日最多次数' },
  { key: 'WITHDRAW_COOLDOWN_SECONDS', value: 60, desc: '提现间冷却时间（秒）' },
  { key: 'WITHDRAW_YEARLY_MAX_AMOUNT', value: 50000, desc: '单用户年累计提现上限（元）' },
  { key: 'DEDUCTION_RATIO_NORMAL', value: 0.10, desc: '普通用户抵扣比例上限' },
  { key: 'DEDUCTION_RATIO_VIP', value: 0.15, desc: 'VIP 用户抵扣比例上限' },
  { key: 'DEDUCTION_MIN_ORDER_AMOUNT', value: 0, desc: '最低订单门槛（元）' },
  { key: 'DEDUCTION_ALLOW_COUPON_STACK', value: true, desc: '是否允许与平台红包叠加' },
  { key: 'WITHDRAW_PROVIDER_FEE_AMOUNT', value: 0, desc: '单笔通道手续费（元，v1.0=0）' },
  { key: 'WITHDRAW_YEARLY_ALERT_THRESHOLD', value: 0.80, desc: '年累计达上限多少时告警（0-1）' },
];

async function main() {
  console.log('═══ 爱买买生产环境 Bootstrap ═══\n');

  // ────────────────────────────────────────────────────
  // 1. 创建权限
  // ────────────────────────────────────────────────────
  console.log('[1/8] 创建权限...');
  const permissionIds: Record<string, string> = {};
  for (const p of PERMISSIONS) {
    const rec = await prisma.adminPermission.upsert({
      where: { code: p.code },
      update: {},
      create: p,
    });
    permissionIds[p.code] = rec.id;
  }
  console.log(`     ✅ ${PERMISSIONS.length} 个权限已创建/对齐`);

  // ────────────────────────────────────────────────────
  // 2. 创建 3 个默认角色 + 角色-权限关联
  // ────────────────────────────────────────────────────
  console.log('[2/8] 创建默认角色（超级管理员 / 经理 / 员工）...');
  const superAdminRole = await prisma.adminRole.upsert({
    where: { name: '超级管理员' },
    update: {},
    create: { name: '超级管理员', description: '拥有所有权限，系统角色不可删除', isSystem: true },
  });
  for (const permId of Object.values(permissionIds)) {
    await prisma.adminRolePermission.upsert({
      where: { roleId_permissionId: { roleId: superAdminRole.id, permissionId: permId } },
      update: {},
      create: { roleId: superAdminRole.id, permissionId: permId },
    });
  }

  const managerRole = await prisma.adminRole.upsert({
    where: { name: '经理' },
    update: {},
    create: { name: '经理', description: '大部分业务操作权限，无管理员和角色管理权限', isSystem: true },
  });
  const managerPerms = PERMISSIONS.filter((p) => !p.module.startsWith('admin_')).map((p) => p.code);
  for (const code of managerPerms) {
    await prisma.adminRolePermission.upsert({
      where: { roleId_permissionId: { roleId: managerRole.id, permissionId: permissionIds[code] } },
      update: {},
      create: { roleId: managerRole.id, permissionId: permissionIds[code] },
    });
  }

  const staffRole = await prisma.adminRole.upsert({
    where: { name: '员工' },
    update: {},
    create: { name: '员工', description: '只读访问 + 商品编辑权限', isSystem: true },
  });
  for (const code of STAFF_PERMISSIONS) {
    await prisma.adminRolePermission.upsert({
      where: { roleId_permissionId: { roleId: staffRole.id, permissionId: permissionIds[code] } },
      update: {},
      create: { roleId: staffRole.id, permissionId: permissionIds[code] },
    });
  }
  console.log('     ✅ 3 个默认角色已创建');

  // ────────────────────────────────────────────────────
  // 3. 超级管理员账号
  // ────────────────────────────────────────────────────
  const initPassword = process.env.ADMIN_BOOTSTRAP_PASSWORD || '123456';
  if (initPassword === '123456') {
    console.warn(
      '     ⚠️  使用默认密码 123456。强烈建议用 ADMIN_BOOTSTRAP_PASSWORD env 自定义，或部署后立刻在管理后台改密。',
    );
  }
  console.log('[3/8] 创建超级管理员账号 admin...');
  const passwordHash = await bcrypt.hash(initPassword, 10);
  const superAdmin = await prisma.adminUser.upsert({
    where: { username: 'admin' },
    update: {}, // 已存在时不动密码，防止重跑覆盖用户已改密
    create: {
      username: 'admin',
      phone: '13900000000',
      passwordHash,
      realName: '系统管理员',
      status: 'ACTIVE',
    },
  });
  await prisma.adminUserRole.upsert({
    where: { adminUserId_roleId: { adminUserId: superAdmin.id, roleId: superAdminRole.id } },
    update: {},
    create: { adminUserId: superAdmin.id, roleId: superAdminRole.id },
  });
  console.log(`     ✅ 超级管理员 admin / ${initPassword === '123456' ? '123456（请立即改密）' : '(自定义密码)'}`);

  // ────────────────────────────────────────────────────
  // 4. 平台系统用户 PLATFORM
  // ────────────────────────────────────────────────────
  console.log('[4/8] 创建平台系统用户 PLATFORM...');
  await prisma.user.upsert({
    where: { id: 'PLATFORM' },
    update: {},
    create: {
      id: 'PLATFORM',
      status: 'ACTIVE',
      profile: {
        create: { nickname: '爱买买平台', avatarUrl: null, level: '系统' },
      },
    },
  });
  console.log('     ✅ PLATFORM 用户已创建');

  // ────────────────────────────────────────────────────
  // 5. 平台公司 PLATFORM_COMPANY
  // ────────────────────────────────────────────────────
  console.log('[5/8] 创建平台公司 PLATFORM_COMPANY...');
  await prisma.company.upsert({
    where: { id: 'PLATFORM_COMPANY' },
    update: { name: '爱买买app', isPlatform: true },
    create: {
      id: 'PLATFORM_COMPANY',
      name: '爱买买app',
      shortName: '爱买买',
      description: '爱买买 App 平台官方主体',
      isPlatform: true,
      status: 'ACTIVE',
      address: { text: '平台自营', lat: 0, lng: 0 },
      profile: {
        create: {
          highlights: {
            mainBusiness: '奖励商品、抽奖奖品、VIP 礼包',
          },
        },
      },
    },
  });
  console.log('     ✅ PLATFORM_COMPANY 平台公司已创建');

  // ────────────────────────────────────────────────────
  // 6. 普通用户树根节点 NORMAL_ROOT
  // ────────────────────────────────────────────────────
  console.log('[6/8] 创建普通用户树根节点 NORMAL_ROOT...');
  await prisma.normalTreeNode.upsert({
    where: { id: 'NORMAL_ROOT' },
    update: {},
    create: {
      id: 'NORMAL_ROOT',
      rootId: 'NORMAL_ROOT',
      userId: null,
      parentId: null,
      level: 0,
      position: 0,
      childrenCount: 0,
    },
  });
  console.log('     ✅ NORMAL_ROOT 已创建');

  // ────────────────────────────────────────────────────
  // 7. VIP 三叉树根节点 A1-A10
  // ────────────────────────────────────────────────────
  console.log('[7/8] 创建 VIP 三叉树根节点 A1-A10...');
  for (let i = 1; i <= 10; i++) {
    await prisma.vipTreeNode.upsert({
      where: { id: `sys-a${i}` },
      update: {},
      create: {
        id: `sys-a${i}`,
        rootId: `A${i}`,
        userId: null,
        parentId: null,
        level: 0,
        position: 0,
        childrenCount: 0,
      },
    });
  }
  console.log('     ✅ A1-A10 共 10 个 VIP 系统根节点已创建');

  // ────────────────────────────────────────────────────
  // 8. RuleConfig + 初始快照
  // ────────────────────────────────────────────────────
  console.log('[8/8] 写入 RuleConfig...');
  for (const rc of RULE_CONFIGS) {
    await prisma.ruleConfig.upsert({
      where: { key: rc.key },
      update: {},
      create: { key: rc.key, value: { value: rc.value, description: rc.desc } },
    });
  }
  console.log(`     ✅ ${RULE_CONFIGS.length} 条 RuleConfig 已写入`);

  // 初始 RuleVersion 快照
  const allConfigs = await prisma.ruleConfig.findMany();
  const snapshot: Record<string, any> = {};
  for (const c of allConfigs) snapshot[c.key] = c.value;
  await prisma.ruleVersion.upsert({
    where: { version: 'initial' },
    update: {},
    create: { version: 'initial', snapshot, changeNote: '生产环境初始化默认配置（bootstrap）' },
  });
  console.log('     ✅ 初始 RuleVersion 快照已创建（version="initial"）');

  console.log('\n═══ Bootstrap 完成 ═══');
  console.log('下一步：');
  console.log('  1. 登录管理后台立刻改超管密码（默认 admin / 123456）');
  console.log('  2. 在管理后台「企业管理」入驻第一批商户');
  console.log('  3. 在管理后台「VIP 高管」绑定 A1-A10 实际高管账号');
}

main()
  .catch((e) => {
    console.error('❌ Bootstrap 失败:', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
