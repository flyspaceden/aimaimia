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
    { path: '/', name: '工作台', icon: <DashboardOutlined />, permission: 'delivery:dashboard:read' },
    { path: '/stats', name: '数据看板', icon: <BarChartOutlined />, permission: 'delivery:dashboard:read' },
    {
      path: '/delivery-users',
      name: '用户与单位',
      icon: <UserOutlined />,
      permissionAny: ['delivery:users:read'],
      routes: [
        { path: '/users', name: '配送用户', permission: 'delivery:users:read' },
        { path: '/units', name: '配送单位', icon: <SolutionOutlined />, permission: 'delivery:users:read' },
      ],
    },
    {
      path: '/delivery-commerce',
      name: '商家与商品',
      icon: <ShopOutlined />,
      permissionAny: ['delivery:merchants:read', 'delivery:products:read', 'delivery:config:read'],
      routes: [
        { path: '/merchants', name: '商家档案', permission: 'delivery:merchants:read' },
        { path: '/merchant-applications', name: '入驻审核', permission: 'delivery:merchants:read' },
        { path: '/products', name: '商品审核', permission: 'delivery:products:read' },
        { path: '/pricing-rules', name: '定价规则', icon: <ShoppingCartOutlined />, permission: 'delivery:config:read' },
      ],
    },
    {
      path: '/delivery-fulfillment',
      name: '订单与履约',
      icon: <TruckOutlined />,
      permissionAny: ['delivery:orders:read', 'delivery:settlements:read', 'delivery:manifests:read'],
      routes: [
        { path: '/orders', name: '订单管理', permission: 'delivery:orders:read' },
        { path: '/shipping-records', name: '发货记录', permission: 'delivery:orders:read' },
        { path: '/abnormal-payments', name: '异常支付', permission: 'delivery:orders:read' },
        { path: '/settlements', name: '结算管理', permission: 'delivery:settlements:read' },
        { path: '/manifests', name: '清单模板', permission: 'delivery:manifests:read' },
      ],
    },
    {
      path: '/delivery-service',
      name: '客服中心',
      icon: <ContainerOutlined />,
      permissionAny: ['delivery:customer-service:read'],
      routes: [
        { path: '/cs/workstation', name: '对话工作台', permission: 'delivery:customer-service:read' },
        { path: '/cs/tickets', name: '工单管理', permission: 'delivery:customer-service:read' },
        { path: '/cs/faq', name: 'FAQ 管理', permission: 'delivery:customer-service:read' },
        { path: '/cs/quick-entries', name: '快捷入口配置', permission: 'delivery:customer-service:read' },
        { path: '/cs/quick-replies', name: '坐席快捷回复', permission: 'delivery:customer-service:read' },
        { path: '/cs/dashboard', name: '数据看板', permission: 'delivery:customer-service:read' },
      ],
    },
    {
      path: '/delivery-system',
      name: '系统管理',
      icon: <SettingOutlined />,
      routes: [
        { path: '/config', name: '配置中心', permission: 'delivery:config:read' },
        { path: '/audit', name: '审计日志', icon: <AuditOutlined />, permission: 'delivery:config:read' },
        { path: '/account-security', name: '账号安全', icon: <SafetyOutlined /> },
      ],
    },
  ],
};

type MenuRoute = NonNullable<NonNullable<ProLayoutProps['route']>['routes']>[number];
type DeliveryMenuRoute = MenuRoute & {
  permission?: string;
  permissionAny?: string[];
  routes?: DeliveryMenuRoute[];
};

function flattenRoutes(routes: DeliveryMenuRoute[]): string[] {
  return routes.reduce<string[]>((all, route) => {
    const current = route.path ? [route.path] : [];
    const children = route.routes ? flattenRoutes(route.routes) : [];
    return [...all, ...current, ...children];
  }, []);
}

export default function AdminLayout() {
  const { message } = App.useApp();
  const navigate = useNavigate();
  const location = useLocation();
  const admin = useAuthStore((state) => state.admin);
  const clearAuth = useAuthStore((state) => state.clearAuth);
  const hasPermission = useAuthStore((state) => state.hasPermission);
  const [collapsed, setCollapsed] = useState(false);

  const filteredRoute = useMemo(() => {
    const filterMenuByPermission = (routes: DeliveryMenuRoute[] = []): DeliveryMenuRoute[] => (
      routes.reduce<DeliveryMenuRoute[]>((all, route) => {
        if (route.permission && !hasPermission(route.permission)) {
          return all;
        }
        if (route.permissionAny?.length && !route.permissionAny.some(hasPermission)) {
          return all;
        }

        const nextRoute: DeliveryMenuRoute = { ...route };
        if (route.routes) {
          nextRoute.routes = filterMenuByPermission(route.routes);
          if (nextRoute.routes.length === 0) {
            return all;
          }
        }

        all.push(nextRoute);
        return all;
      }, [])
    );

    return {
      ...menuRoutes,
      routes: filterMenuByPermission((menuRoutes?.routes ?? []) as DeliveryMenuRoute[]),
    };
  }, [hasPermission]);
  const routeItems = (filteredRoute.routes ?? []) as DeliveryMenuRoute[];

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
      route={filteredRoute}
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
