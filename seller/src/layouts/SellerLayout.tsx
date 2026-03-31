import { useState } from 'react';
import { Outlet, useNavigate, useLocation } from 'react-router-dom';
import { ProLayout } from '@ant-design/pro-components';
import type { ProLayoutProps } from '@ant-design/pro-components';
import { Dropdown, message } from 'antd';
import { isGlobalDirty } from '@/hooks/useUnsavedChanges';
import {
  DashboardOutlined,
  ShoppingOutlined,
  FileTextOutlined,
  SwapOutlined,
  BarChartOutlined,
  ShopOutlined,
  TeamOutlined,
  UserOutlined,
  LogoutOutlined,
  BranchesOutlined,
} from '@ant-design/icons';
import useAuthStore from '@/store/useAuthStore';
import { logout } from '@/api/auth';

// 侧边栏菜单
const menuRoutes: ProLayoutProps['route'] = {
  path: '/',
  routes: [
    {
      path: '/',
      name: '工作台',
      icon: <DashboardOutlined />,
    },
    {
      path: '/products',
      name: '商品管理',
      icon: <ShoppingOutlined />,
    },
    {
      path: '/orders',
      name: '订单管理',
      icon: <FileTextOutlined />,
    },
    // 退款记录暂时隐藏，当前售后以换货为主，后续需要时恢复
    // { path: '/refunds', name: '退款记录', icon: <RollbackOutlined /> },
    {
      path: '/after-sale',
      name: '售后管理',
      icon: <SwapOutlined />,
    },
    {
      path: '/analytics',
      name: '数据报表',
      icon: <BarChartOutlined />,
      roles: ['OWNER', 'MANAGER'],
    },
    {
      path: '/trace',
      name: '溯源管理',
      icon: <BranchesOutlined />,
    },
    {
      path: '/company',
      name: '企业管理',
      icon: <ShopOutlined />,
      routes: [
        { path: '/company/settings', name: '企业设置', icon: <ShopOutlined /> },
        { path: '/company/staff', name: '员工管理', icon: <TeamOutlined />, roles: ['OWNER'] },
      ],
    },
  ],
};

export default function SellerLayout() {
  const navigate = useNavigate();
  const location = useLocation();
  const seller = useAuthStore((s) => s.seller);
  const clearAuth = useAuthStore((s) => s.clearAuth);
  const hasRole = useAuthStore((s) => s.hasRole);
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

  // 按角色过滤菜单
  type MenuRoute = NonNullable<NonNullable<ProLayoutProps['route']>['routes']>[number];
  const filterMenuByRole = (routes: MenuRoute[] | undefined): MenuRoute[] => {
    if (!routes) return [];
    return routes.reduce<MenuRoute[]>((acc, route) => {
      const roles = (route as MenuRoute & { roles?: string[] }).roles;
      if (roles && !hasRole(...(roles as Array<'OWNER' | 'MANAGER' | 'OPERATOR'>))) return acc;
      const filtered = { ...route };
      if (route.routes) {
        filtered.routes = filterMenuByRole(route.routes);
        if (filtered.routes.length === 0) return acc;
      }
      acc.push(filtered);
      return acc;
    }, []);
  };

  const filteredRoute = {
    ...menuRoutes,
    routes: filterMenuByRole(menuRoutes?.routes),
  };

  return (
    <ProLayout
      title="爱买买卖家中心"
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
          colorBgMenuItemSelected: '#2E7D32',
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
        title: `${seller?.company.name || '卖家'} · ${seller?.user.nickname || ''}`,
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
      footerRender={() => (
        <div style={{ textAlign: 'center', padding: '16px 0', color: '#999', fontSize: 12 }}>
          爱买买卖家中心 &copy; 2026
        </div>
      )}
    >
      <Outlet />
    </ProLayout>
  );
}
