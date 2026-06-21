import { useMemo, useState } from 'react';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import type { ProLayoutProps } from '@ant-design/pro-components';
import { ProLayout } from '@ant-design/pro-components';
import { App, Dropdown } from 'antd';
import {
  AuditOutlined,
  ContainerOutlined,
  DashboardOutlined,
  DollarOutlined,
  LogoutOutlined,
  BarChartOutlined,
  SafetyOutlined,
  SettingOutlined,
  ShopOutlined,
  ShoppingCartOutlined,
  SolutionOutlined,
  SwapOutlined,
  TruckOutlined,
  UserOutlined,
} from '@ant-design/icons';
import { isGlobalDirty } from '@/hooks/useUnsavedChanges';
import { logout } from '@/api/auth';
import useAuthStore from '@/store/useAuthStore';

const appEnv = import.meta.env.VITE_APP_ENV || import.meta.env.MODE;
const isProduction = appEnv === 'production';
const switchToAdminUrl = isProduction
  ? 'https://admin.ai-maimai.com'
  : 'https://test-admin.ai-maimai.com';

const menuRoutes: ProLayoutProps['route'] = {
  path: '/',
  routes: [
    { path: '/', name: '工作台', icon: <DashboardOutlined /> },
    { path: '/stats', name: '数据看板', icon: <BarChartOutlined /> },
    {
      path: '/delivery-users',
      name: '用户与单位',
      icon: <UserOutlined />,
      routes: [
        { path: '/users', name: '配送用户' },
        { path: '/units', name: '配送单位', icon: <SolutionOutlined /> },
      ],
    },
    {
      path: '/delivery-commerce',
      name: '商家与商品',
      icon: <ShopOutlined />,
      routes: [
        { path: '/merchants', name: '商家档案' },
        { path: '/merchant-applications', name: '入驻审核' },
        { path: '/products', name: '商品审核' },
        { path: '/pricing-rules', name: '定价规则', icon: <ShoppingCartOutlined /> },
      ],
    },
    {
      path: '/delivery-fulfillment',
      name: '订单与履约',
      icon: <TruckOutlined />,
      routes: [
        { path: '/orders', name: '订单管理' },
        { path: '/shipping-records', name: '发货记录' },
        { path: '/abnormal-payments', name: '异常支付' },
        { path: '/settlements', name: '结算管理' },
        { path: '/manifests', name: '清单模板' },
      ],
    },
    {
      path: '/delivery-service',
      name: '客服中心',
      icon: <ContainerOutlined />,
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
      path: '/delivery-system',
      name: '系统管理',
      icon: <SettingOutlined />,
      routes: [
        { path: '/config', name: '配置中心' },
        { path: '/audit', name: '审计日志', icon: <AuditOutlined /> },
        { path: '/account-security', name: '账号安全', icon: <SafetyOutlined /> },
      ],
    },
  ],
};

type MenuRoute = NonNullable<NonNullable<ProLayoutProps['route']>['routes']>[number];

function flattenRoutes(routes: MenuRoute[]): string[] {
  return routes.reduce<string[]>((all, route) => {
    const current = route.path ? [route.path] : [];
    const children = route.routes ? flattenRoutes(route.routes as MenuRoute[]) : [];
    return [...all, ...current, ...children];
  }, []);
}

export default function AdminLayout() {
  const { message } = App.useApp();
  const navigate = useNavigate();
  const location = useLocation();
  const admin = useAuthStore((state) => state.admin);
  const clearAuth = useAuthStore((state) => state.clearAuth);
  const [collapsed, setCollapsed] = useState(false);
  const routeItems = (menuRoutes?.routes ?? []) as MenuRoute[];

  const selectedKeys = useMemo(() => {
    const all = flattenRoutes(routeItems);
    const matches = all.filter((path) => path === location.pathname || (path !== '/' && location.pathname.startsWith(`${path}/`)));
    if (!matches.length) {
      return [];
    }
    return [matches.reduce((longest, path) => (path.length > longest.length ? path : longest), matches[0])];
  }, [location.pathname, routeItems]);

  const handleLogout = async () => {
    try {
      await logout();
    } catch {
      // ignore
    }
    clearAuth();
    message.success('已退出登录');
    navigate('/login', { replace: true });
  };

  const handleSwitchToAdmin = () => {
    if (isGlobalDirty()) {
      const confirmed = confirm('你有未保存的更改，确定离开吗？离开后更改将丢失。');
      if (!confirmed) return;
    }
    window.location.href = switchToAdminUrl;
  };

  return (
    <ProLayout
      title="配送管理后台"
      logo={null}
      route={menuRoutes}
      layout="side"
      fixSiderbar
      collapsed={collapsed}
      onCollapse={setCollapsed}
      location={{ pathname: location.pathname }}
      menuProps={{ selectedKeys }}
      menuHeaderRender={() => (
        <div style={{ color: '#0F3B66', fontWeight: 700, fontSize: 16, padding: '16px 0 8px 20px' }}>
          配送管理后台
        </div>
      )}
      token={{
        sider: {
          colorMenuBackground: '#E6F4FF',
          colorTextMenu: '#1F4E79',
          colorTextMenuSelected: '#0B5CAD',
          colorBgMenuItemSelected: '#BAE0FF',
          colorTextMenuActive: '#0B5CAD',
          colorTextMenuItemHover: '#0B5CAD',
          colorBgMenuItemHover: '#D6EEFF',
          colorTextMenuTitle: '#0F3B66',
        },
        header: {
          colorBgHeader: '#fff',
          colorHeaderTitle: '#0F3B66',
        },
      }}
      menuItemRender={(item, dom) => (
        <a
          onClick={() => {
            if (!item.path) {
              return;
            }
            if (isGlobalDirty()) {
              const confirmed = confirm('你有未保存的更改，确定离开吗？离开后更改将丢失。');
              if (!confirmed) {
                return;
              }
            }
            navigate(item.path);
          }}
        >
          {dom}
        </a>
      )}
      avatarProps={{
        icon: <UserOutlined />,
        size: 'small',
        title: admin?.realName || admin?.username || '管理员',
        render: (_props, dom) => (
          <Dropdown
            menu={{
              items: [
                {
                  key: 'switch-admin',
                  icon: <SwapOutlined />,
                  label: '切换爱买买管理后台',
                  onClick: handleSwitchToAdmin,
                },
                { type: 'divider' },
                {
                  key: 'account-security',
                  icon: <SafetyOutlined />,
                  label: '账号安全',
                  onClick: () => navigate('/account-security'),
                },
                { type: 'divider' },
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
      actionsRender={() => [<DollarOutlined key="pricing-boundary" title="金额边界已分栏展示" />]}
      footerRender={() => (
        <div style={{ textAlign: 'center', padding: '16px 0', color: '#999', fontSize: 12, lineHeight: 1.8 }}>
          <div>配送管理后台 &copy; 2026 深圳华海农业科技集团有限公司</div>
          <div>
            <a href="https://beian.miit.gov.cn/" target="_blank" rel="noopener noreferrer" style={{ color: '#999' }}>
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
