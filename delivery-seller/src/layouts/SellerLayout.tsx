import { useState } from 'react';
import { Outlet, useNavigate, useLocation } from 'react-router-dom';
import { ProLayout } from '@ant-design/pro-components';
import type { ProLayoutProps } from '@ant-design/pro-components';
import { App, Dropdown } from 'antd';
import { isGlobalDirty } from '@/hooks/useUnsavedChanges';
import {
  DashboardOutlined,
  ShoppingOutlined,
  FileTextOutlined,
  ExportOutlined,
  ShopOutlined,
  TeamOutlined,
  UserOutlined,
  LogoutOutlined,
  SafetyOutlined,
  SwapOutlined,
  TruckOutlined,
  CustomerServiceOutlined,
  DatabaseOutlined,
} from '@ant-design/icons';
import useAuthStore from '@/store/useAuthStore';
import { logout } from '@/api/auth';

const appEnv = import.meta.env.VITE_APP_ENV || import.meta.env.MODE;
const isProduction = appEnv === 'production';
const switchToSellerCenterUrl = isProduction
  ? 'https://seller.ai-maimai.com'
  : 'https://test-seller.ai-maimai.com';

// 侧边栏菜单
const menuRoutes: ProLayoutProps['route'] = {
  path: '/',
  routes: [
    {
      path: '/',
      name: '工作台',
      icon: <DashboardOutlined />,
      permission: 'orders:read',
    },
    {
      name: '商品管理',
      icon: <ShoppingOutlined />,
      routes: [
        { path: '/products', name: '商品列表', icon: <ShoppingOutlined />, permission: 'products:read' },
        { path: '/products/stock', name: '库存管理', icon: <DatabaseOutlined />, permission: 'inventory:write' },
      ],
    },
    {
      name: '订单管理',
      icon: <FileTextOutlined />,
      routes: [
        { path: '/orders', name: '订单列表', icon: <FileTextOutlined />, permission: 'orders:read' },
        { path: '/orders/logistics', name: '物流跟踪', icon: <TruckOutlined />, permission: 'orders:read' },
      ],
    },
    {
      path: '/exports',
      name: '导出中心',
      icon: <ExportOutlined />,
      permission: 'finance:read',
    },
    {
      name: '企业管理',
      icon: <ShopOutlined />,
      routes: [
        { path: '/company/settings', name: '企业设置', icon: <ShopOutlined />, permission: 'company:read' },
        { path: '/company/staff', name: '员工管理', icon: <TeamOutlined />, permission: 'staff:manage' },
      ],
    },
    {
      path: '/customer-service',
      name: '客服工单',
      icon: <CustomerServiceOutlined />,
      permission: 'customer-service:read',
    },
  ],
};

export default function SellerLayout() {
  const { message } = App.useApp();
  const navigate = useNavigate();
  const location = useLocation();
  const seller = useAuthStore((s) => s.seller);
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

  const handleSwitchToSellerCenter = () => {
    if (isGlobalDirty()) {
      const confirmed = confirm('你有未保存的更改，确定离开吗？离开后更改将丢失。');
      if (!confirmed) return;
    }
    window.location.href = switchToSellerCenterUrl;
  };

  // 按权限码过滤菜单
  type MenuRoute = NonNullable<NonNullable<ProLayoutProps['route']>['routes']>[number];
  const filterMenuByPermission = (routes: MenuRoute[] | undefined): MenuRoute[] => {
    if (!routes) return [];
    return routes.reduce<MenuRoute[]>((acc, route) => {
      const permission = (route as MenuRoute & { permission?: string }).permission;
      if (permission && !hasPermission(permission)) return acc;
      const filtered = { ...route };
      if (route.routes) {
        filtered.routes = filterMenuByPermission(route.routes);
        if (filtered.routes.length === 0) return acc;
      }
      acc.push(filtered);
      return acc;
    }, []);
  };

  const filteredRoute = {
    ...menuRoutes,
    routes: filterMenuByPermission(menuRoutes?.routes),
  };

  return (
    <ProLayout
      title="配送中心"
      logo={null}
      layout="mix"
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
          colorBgMenuItemSelected: '#EA580C',
          colorTextMenuActive: '#fff',
          colorTextMenuItemHover: '#fff',
          colorBgMenuItemHover: 'rgba(255,255,255,0.08)',
        },
        header: {
          colorBgHeader: '#fff',
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
        icon: <UserOutlined />,
        size: 'small',
        title: `${seller?.company.name || '配送商家'} · ${seller?.user.nickname || ''}`,
        render: (_props, dom) => (
          <Dropdown
            menu={{
              items: [
                {
                  key: 'switch-seller-center',
                  icon: <SwapOutlined />,
                  label: '切换爱买买卖家中心',
                  onClick: handleSwitchToSellerCenter,
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
      footerRender={() => (
        <div style={{ textAlign: 'center', padding: '16px 0', color: '#999', fontSize: 12, lineHeight: 1.8 }}>
          <div>配送中心 &copy; 2026 深圳华海农业科技集团有限公司</div>
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
