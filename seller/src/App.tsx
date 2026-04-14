import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { lazy, Suspense, type ReactNode } from 'react';
import { Spin } from 'antd';
import useAuthStore from '@/store/useAuthStore';
import SellerLayout from '@/layouts/SellerLayout';

// N17修复：路由级代码拆分，减小首屏包体
const LoginPage = lazy(() => import('@/pages/login/index'));
const DashboardPage = lazy(() => import('@/pages/dashboard/index'));
const ProductListPage = lazy(() => import('@/pages/products/index'));
const ProductEditPage = lazy(() => import('@/pages/products/edit'));
const OrderListPage = lazy(() => import('@/pages/orders/index'));
const OrderDetailPage = lazy(() => import('@/pages/orders/detail'));
const AnalyticsPage = lazy(() => import('@/pages/analytics/index'));
const CompanySettingsPage = lazy(() => import('@/pages/company/index'));
const StaffManagementPage = lazy(() => import('@/pages/company/staff'));
const TracePage = lazy(() => import('@/pages/trace/index'));
const AfterSaleListPage = lazy(() => import('@/pages/after-sale/index'));
const AfterSaleDetailPage = lazy(() => import('@/pages/after-sale/detail'));

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

/** 路由守卫：角色权限检查 */
type StaffRole = 'OWNER' | 'MANAGER' | 'OPERATOR';
function RequireRole({ roles, children }: { roles: StaffRole[]; children: ReactNode }) {
  const seller = useAuthStore((s) => s.seller);
  if (!seller || !roles.includes(seller.role as StaffRole)) {
    return <Navigate to="/" replace />;
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

          {/* 卖家后台（需登录） */}
          <Route
            element={
              <RequireAuth>
                <SellerLayout />
              </RequireAuth>
            }
          >
            <Route index element={<DashboardPage />} />
            <Route path="products" element={<ProductListPage />} />
            <Route path="products/create" element={<ProductEditPage />} />
            <Route path="products/:id/edit" element={<ProductEditPage />} />
            <Route path="orders" element={<OrderListPage />} />
            <Route path="orders/:id" element={<OrderDetailPage />} />
            <Route path="after-sale" element={<AfterSaleListPage />} />
            <Route path="after-sale/:id" element={<AfterSaleDetailPage />} />
            <Route path="analytics" element={<RequireRole roles={['OWNER', 'MANAGER']}><AnalyticsPage /></RequireRole>} />
            <Route path="company/settings" element={<RequireRole roles={['OWNER', 'MANAGER']}><CompanySettingsPage /></RequireRole>} />
            <Route path="company/staff" element={<RequireRole roles={['OWNER']}><StaffManagementPage /></RequireRole>} />
            <Route path="trace" element={<TracePage />} />
          </Route>

          {/* 兜底 */}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Suspense>
    </BrowserRouter>
  );
}
