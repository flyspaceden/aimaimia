import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { lazy, Suspense, type ReactNode } from 'react';
import { Spin } from 'antd';
import useAuthStore from '@/store/useAuthStore';
import SellerLayout from '@/layouts/SellerLayout';

// N17修复：路由级代码拆分，减小首屏包体
const LoginPage = lazy(() => import('@/pages/login/index'));
const ForgotPasswordPage = lazy(() => import('@/pages/forgot-password/index'));
const DashboardPage = lazy(() => import('@/pages/dashboard/index'));
const ProductListPage = lazy(() => import('@/pages/products/index'));
const ProductEditPage = lazy(() => import('@/pages/products/edit'));
const StockPage = lazy(() => import('@/pages/products/stock'));
const OrderListPage = lazy(() => import('@/pages/orders/index'));
const OrderDetailPage = lazy(() => import('@/pages/orders/detail'));
const LogisticsPage = lazy(() => import('@/pages/orders/logistics'));
const ExportCenterPage = lazy(() => import('@/pages/exports/index'));
const CompanySettingsPage = lazy(() => import('@/pages/company/index'));
const StaffManagementPage = lazy(() => import('@/pages/company/staff'));
const AccountSecurityPage = lazy(() => import('@/pages/account-security/index'));

const PageLoading = () => (
  <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100%', minHeight: 200 }}>
    <Spin size="large" />
  </div>
);

/** 路由守卫：未登录跳转登录页 */
function RequireAuth({ children }: { children: ReactNode }) {
  const token = useAuthStore((s) => s.token);
  if (!token) {
    return <Navigate to="/login" replace />;
  }
  return <>{children}</>;
}

function useDefaultAuthorizedPath() {
  const hasPermission = useAuthStore((s) => s.hasPermission);
  if (hasPermission('orders:read')) return '/';
  if (hasPermission('products:read')) return '/products';
  if (hasPermission('inventory:write')) return '/products/stock';
  if (hasPermission('finance:read')) return '/exports';
  if (hasPermission('company:read')) return '/company/settings';
  if (hasPermission('staff:manage')) return '/company/staff';
  return '/account-security';
}

/** 路由守卫：配送中心权限码检查 */
function RequirePermission({ permission, children }: { permission: string; children: ReactNode }) {
  const seller = useAuthStore((s) => s.seller);
  const token = useAuthStore((s) => s.token);
  const hasPermission = useAuthStore((s) => s.hasPermission);
  const fallbackPath = useDefaultAuthorizedPath();
  if (token && !seller) {
    return <Spin style={{ display: 'flex', justifyContent: 'center', marginTop: 120 }} />;
  }
  if (!hasPermission(permission)) {
    return <Navigate to={fallbackPath} replace />;
  }
  return <>{children}</>;
}

/** 已登录访问登录页则跳转首页 */
function GuestOnly({ children }: { children: ReactNode }) {
  const token = useAuthStore((s) => s.token);
  if (token) {
    return <Navigate to="/" replace />;
  }
  return <>{children}</>;
}

export default function App() {
  return (
    <BrowserRouter>
      <Suspense fallback={<PageLoading />}>
        <Routes>
          {/* 登录页 */}
          <Route
            path="/login"
            element={
              <GuestOnly>
                <LoginPage />
              </GuestOnly>
            }
          />

          {/* 忘记密码页（未登录访问） */}
          <Route
            path="/forgot-password"
            element={
              <GuestOnly>
                <ForgotPasswordPage />
              </GuestOnly>
            }
          />

          {/* 配送中心（需登录） */}
            <Route
              element={
                <RequireAuth>
                <SellerLayout />
              </RequireAuth>
              }
            >
            <Route index element={<RequirePermission permission="orders:read"><DashboardPage /></RequirePermission>} />
            <Route path="products" element={<RequirePermission permission="products:read"><ProductListPage /></RequirePermission>} />
            <Route path="products/create" element={<RequirePermission permission="products:write"><ProductEditPage /></RequirePermission>} />
            <Route path="products/stock" element={<RequirePermission permission="inventory:write"><StockPage /></RequirePermission>} />
            <Route path="products/:id/edit" element={<RequirePermission permission="products:write"><ProductEditPage /></RequirePermission>} />
            <Route path="orders" element={<RequirePermission permission="orders:read"><OrderListPage /></RequirePermission>} />
            <Route path="orders/logistics" element={<RequirePermission permission="orders:read"><LogisticsPage /></RequirePermission>} />
            <Route path="orders/:id" element={<RequirePermission permission="orders:read"><OrderDetailPage /></RequirePermission>} />
            <Route path="exports" element={<RequirePermission permission="finance:read"><ExportCenterPage /></RequirePermission>} />
            <Route path="company/settings" element={<RequirePermission permission="company:read"><CompanySettingsPage /></RequirePermission>} />
            <Route path="company/staff" element={<RequirePermission permission="staff:manage"><StaffManagementPage /></RequirePermission>} />
            <Route path="account-security" element={<AccountSecurityPage />} />
          </Route>

          {/* 兜底 */}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Suspense>
    </BrowserRouter>
  );
}
