import { useState, useMemo } from 'react';
import { Outlet, useNavigate, useLocation } from 'react-router-dom';
import { ProLayout } from '@ant-design/pro-components';
import type { ProLayoutProps } from '@ant-design/pro-components';
import { Dropdown, message } from 'antd';
import { isGlobalDirty } from '@/hooks/useUnsavedChanges';
import {
  DashboardOutlined,
  UserOutlined,
  FileTextOutlined,
  ShopOutlined,
  GiftOutlined,
  AuditOutlined,
  SettingOutlined,
  TeamOutlined,
  SafetyCertificateOutlined,
  LogoutOutlined,
  ApartmentOutlined,
  TagsOutlined,
  MessageOutlined,
} from '@ant-design/icons';
import useAuthStore from '@/store/useAuthStore';
import { logout } from '@/api/auth';
import { PERMISSIONS } from '@/constants/permissions';

// 侧边栏菜单配置（6 大分组，见 admin-frontend.md Section 4）
const menuRoutes: ProLayoutProps['route'] = {
  path: '/',
  routes: [
    {
      path: '/',
      name: '工作台',
      icon: <DashboardOutlined />,
      permission: PERMISSIONS.DASHBOARD_READ,
    },
    {
      path: '/user-bonus',
      name: '用户与奖励',
      icon: <UserOutlined />,
      permission: PERMISSIONS.BONUS_READ,
      routes: [
        { path: '/users', name: '用户管理', permission: PERMISSIONS.USERS_READ },
        { path: '/bonus/members', name: 'VIP 会员' },
        { path: '/bonus/withdrawals', name: '提现审核' },
        { path: '/bonus/vip-tree', name: 'VIP 奖励树', icon: <ApartmentOutlined /> },
        { path: '/bonus/normal-tree', name: '普通奖励树', icon: <ApartmentOutlined /> },
        { path: '/bonus/vip-config', name: 'VIP 系统配置', icon: <SettingOutlined /> },
        { path: '/bonus/normal-config', name: '普通系统配置', icon: <SettingOutlined /> },
        { path: '/vip-gifts', name: '购买VIP赠品', icon: <GiftOutlined />, permission: PERMISSIONS.VIP_GIFT_READ },
      ],
    },
    {
      path: '/merchant',
      name: '商家与商品',
      icon: <ShopOutlined />,
      permission: PERMISSIONS.PRODUCTS_READ,
      routes: [
        { path: '/companies', name: '企业管理', permission: PERMISSIONS.COMPANIES_READ },
        { path: '/categories', name: '分类管理', permission: PERMISSIONS.CATEGORIES_READ },
        { path: '/products', name: '商家商品' },
        { path: '/reward-products', name: '奖励商品', permission: PERMISSIONS.REWARD_PRODUCTS_READ },
        { path: '/tags', name: '标签管理', icon: <TagsOutlined />, permission: PERMISSIONS.TAGS_READ },
        { path: '/trace', name: '溯源批次', permission: PERMISSIONS.TRACE_READ },
      ],
    },
    {
      path: '/trade',
      name: '交易与售后',
      icon: <FileTextOutlined />,
      permission: PERMISSIONS.ORDERS_READ,
      routes: [
        { path: '/orders', name: '订单管理' },
        { path: '/invoices', name: '发票管理', permission: PERMISSIONS.INVOICES_READ },
        { path: '/after-sale', name: '售后仲裁', permission: PERMISSIONS.AFTER_SALE_READ },
        { path: '/shipping-rules', name: '运费规则', permission: PERMISSIONS.SHIPPING_READ },
      ],
    },
    {
      path: '/operations',
      name: '运营活动',
      icon: <GiftOutlined />,
      routes: [
        { path: '/coupons', name: '红包管理', permission: PERMISSIONS.COUPON_READ },
        { path: '/lottery', name: '抽奖管理', permission: PERMISSIONS.LOTTERY_READ },
      ],
    },
    {
      path: '/customer-service',
      name: '客服中心',
      icon: <MessageOutlined />,
      permission: PERMISSIONS.CS_READ,
      routes: [
        { path: '/cs/workstation', name: '对话工作台' },
        { path: '/cs/tickets', name: '工单管理' },
        { path: '/cs/faq', name: 'FAQ 管理' },
        { path: '/cs/quick-entries', name: '快捷入口配置' },
        { path: '/cs/quick-replies', name: '坐席快捷回复' },
        { path: '/cs/dashboard', name: '数据看板' },
      ],
    },
    {
      path: '/system',
      name: '系统管理',
      icon: <SettingOutlined />,
      routes: [
        { path: '/config', name: '平台设置', icon: <SettingOutlined />, permission: PERMISSIONS.CONFIG_READ },
        { path: '/config/discovery-filters', name: '发现页筛选', icon: <TagsOutlined />, permission: PERMISSIONS.CONFIG_READ },
        { path: '/admin/users', name: '管理员账号', icon: <TeamOutlined />, permission: PERMISSIONS.ADMIN_USERS_READ },
        { path: '/admin/roles', name: '角色权限', icon: <SafetyCertificateOutlined />, permission: PERMISSIONS.ADMIN_ROLES_READ },
        { path: '/audit', name: '审计日志', icon: <AuditOutlined />, permission: PERMISSIONS.AUDIT_READ },
      ],
    },
  ],
};

export default function AdminLayout() {
  const navigate = useNavigate();
  const location = useLocation();
  const admin = useAuthStore((s) => s.admin);
  const clearAuth = useAuthStore((s) => s.clearAuth);
  const hasPermission = useAuthStore((s) => s.hasPermission);
  const [collapsed, setCollapsed] = useState(false);

  const handleLogout = async () => {
    try {
      await logout();
    } catch {
      // 登出失败也清除本地状态
    }
    clearAuth();
    message.success('已退出登录');
    navigate('/login', { replace: true });
  };

  // 按权限过滤菜单项（深拷贝，不修改原引用）
  type MenuRoute = NonNullable<NonNullable<ProLayoutProps['route']>['routes']>[number];
  const filteredRoute = useMemo(() => {
    const filterMenuByPermission = (routes: MenuRoute[] | undefined): MenuRoute[] => {
      if (!routes) return [];
      return routes.reduce<MenuRoute[]>((acc, route) => {
        const perm = (route as MenuRoute & { permission?: string }).permission;
        if (perm && !hasPermission(perm)) return acc;
        const filtered = { ...route };
        if (route.routes) {
          filtered.routes = filterMenuByPermission(route.routes);
          if (filtered.routes.length === 0) return acc;
        }
        acc.push(filtered);
        return acc;
      }, []);
    };
    return {
      ...menuRoutes,
      routes: filterMenuByPermission(menuRoutes?.routes || []),
    };
  }, [hasPermission]);

  return (
    <ProLayout
      title="爱买买管理后台"
      logo={null}
      menuHeaderRender={() => (
        <div style={{ color: '#fff', fontWeight: 600, fontSize: 16, padding: '16px 0 8px 20px' }}>
          爱买买管理后台
        </div>
      )}
      layout="side"
      fixSiderbar
      collapsed={collapsed}
      onCollapse={setCollapsed}
      route={filteredRoute}
      location={{ pathname: location.pathname }}
      token={{
        sider: {
          colorMenuBackground: '#001529',
          colorTextMenu: 'rgba(255,255,255,0.75)',
          colorTextMenuSelected: '#fff',
          colorBgMenuItemSelected: '#1E40AF',
          colorTextMenuActive: '#fff',
          colorTextMenuItemHover: '#fff',
          colorBgMenuItemHover: 'rgba(255,255,255,0.08)',
          colorTextMenuTitle: '#fff',
        },
        header: {
          colorBgHeader: '#fff',
          colorHeaderTitle: '#fff',
        },
      }}
      menuItemRender={(item, dom) => (
        <a onClick={() => {
          if (!item.path) return;
          if (isGlobalDirty()) {
            // eslint-disable-next-line no-restricted-globals
            const confirmed = confirm('你有未保存的更改，确定离开吗？离开后更改将丢失。');
            if (!confirmed) return;
          }
          navigate(item.path);
        }}>
          {dom}
        </a>
      )}
      avatarProps={{
        src: undefined,
        icon: <UserOutlined />,
        size: 'small',
        title: admin?.realName || admin?.username || '管理员',
        render: (_props, dom) => (
          <Dropdown
            menu={{
              items: [
                {
                  key: 'logout',
                  icon: <LogoutOutlined />,
                  label: '退出登录',
                  onClick: handleLogout,
                },
              ],
            }}
          >
            {dom}
          </Dropdown>
        ),
      }}
      // 底部
      footerRender={() => (
        <div style={{ textAlign: 'center', padding: '16px 0', color: '#999', fontSize: 12, lineHeight: 1.8 }}>
          <div>爱买买管理后台 &copy; 2026 深圳华海农业科技集团有限公司</div>
          <div>
            <a
              href="https://beian.miit.gov.cn/"
              target="_blank"
              rel="noopener noreferrer"
              style={{ color: '#999' }}
            >
              粤ICP备2023047684号-5
            </a>
          </div>
        </div>
      )}
    >
      <Outlet />
    </ProLayout>
  );
}
