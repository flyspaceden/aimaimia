import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { lazy, Suspense, useEffect, type ReactNode } from 'react';
import { Spin } from 'antd';
import AdminLayout from '@/layouts/AdminLayout';
import useAuthStore from '@/store/useAuthStore';
import { getProfile } from '@/api/auth';

const LoginPage = lazy(() => import('@/pages/login/index'));
const DashboardPage = lazy(() => import('@/pages/delivery-admin/dashboard'));
const StatsPage = lazy(() => import('@/pages/delivery-admin/stats'));
const UsersPage = lazy(() => import('@/pages/delivery-admin/users'));
const UserDetailPage = lazy(() => import('@/pages/delivery-admin/user-detail'));
const UnitsPage = lazy(() => import('@/pages/delivery-admin/units'));
const UnitDetailPage = lazy(() => import('@/pages/delivery-admin/unit-detail'));
const MerchantsPage = lazy(() => import('@/pages/delivery-admin/merchants'));
const MerchantDetailPage = lazy(() => import('@/pages/delivery-admin/merchant-detail'));
const MerchantApplicationsPage = lazy(() => import('@/pages/delivery-admin/merchant-applications'));
const MerchantApplicationDetailPage = lazy(() => import('@/pages/delivery-admin/merchant-application-detail'));
const ProductsPage = lazy(() => import('@/pages/delivery-admin/products'));
const CategoriesPage = lazy(() => import('@/pages/delivery-admin/categories'));
const PricingRulesPage = lazy(() => import('@/pages/delivery-admin/pricing-rules'));
const OrdersPage = lazy(() => import('@/pages/delivery-admin/orders'));
const OrderDetailPage = lazy(() => import('@/pages/delivery-admin/order-detail'));
const ShippingRecordsPage = lazy(() => import('@/pages/delivery-admin/shipping-records'));
const FreightCenterPage = lazy(() => import('@/pages/delivery-admin/freight-center'));
const PickupBatchesPage = lazy(() => import('@/pages/delivery-admin/pickup-batches'));
const AbnormalPaymentsPage = lazy(() => import('@/pages/delivery-admin/abnormal-payments'));
const ManifestsPage = lazy(() => import('@/pages/delivery-admin/manifests'));
const SettlementsPage = lazy(() => import('@/pages/delivery-admin/settlements'));
const CsWorkstationPage = lazy(() => import('@/pages/delivery-admin/cs-workstation'));
const CsTicketsPage = lazy(() => import('@/pages/delivery-admin/cs-tickets'));
const CsFaqPage = lazy(() => import('@/pages/delivery-admin/cs-faq'));
const CsQuickEntriesPage = lazy(() => import('@/pages/delivery-admin/cs-quick-entries'));
const CsQuickRepliesPage = lazy(() => import('@/pages/delivery-admin/cs-quick-replies'));
const CsDashboardPage = lazy(() => import('@/pages/delivery-admin/cs-dashboard'));
const CustomerServiceDetailPage = lazy(() => import('@/pages/delivery-admin/customer-service-detail'));
const AuditPage = lazy(() => import('@/pages/delivery-admin/audit'));
const ConfigPage = lazy(() => import('@/pages/delivery-admin/config'));
const AccountSecurityPage = lazy(() => import('@/pages/account-security/index'));

const PageLoading = () => (
  <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: 220 }}>
    <Spin size="large" />
  </div>
);

function RequireAuth({ children }: { children: ReactNode }) {
  const token = useAuthStore((state) => state.token);
  const refreshToken = useAuthStore((state) => state.refreshToken);
  const admin = useAuthStore((state) => state.admin);
  const setAuth = useAuthStore((state) => state.setAuth);
  const clearAuth = useAuthStore((state) => state.clearAuth);
  useEffect(() => {
    if (!token || admin) {
      return;
    }

    let active = true;
    getProfile()
      .then((profile) => {
        if (!active) return;
        const currentAccessToken = localStorage.getItem('delivery_admin_token') || token;
        const currentRefreshToken = localStorage.getItem('delivery_admin_refresh_token') || refreshToken;
        if (!currentRefreshToken) {
          clearAuth();
          return;
        }
        setAuth(currentAccessToken, currentRefreshToken, profile);
      })
      .catch(() => {
        if (active) clearAuth();
      });

    return () => {
      active = false;
    };
  }, [admin, clearAuth, refreshToken, setAuth, token]);

  if (!token) {
    return <Navigate to="/login" replace />;
  }
  if (!admin) {
    return <PageLoading />;
  }
  return <>{children}</>;
}

function useDefaultAuthorizedPath() {
  const hasPermission = useAuthStore((state) => state.hasPermission);
  if (hasPermission('delivery:dashboard:read')) return '/';
  if (hasPermission('delivery:users:read')) return '/users';
  if (hasPermission('delivery:merchants:read')) return '/merchants';
  if (hasPermission('delivery:products:read')) return '/products';
  if (hasPermission('delivery:config:read')) return '/config';
  if (hasPermission('delivery:orders:read')) return '/orders';
  if (hasPermission('delivery:settlements:read')) return '/settlements';
  if (hasPermission('delivery:manifests:read')) return '/manifests';
  if (hasPermission('delivery:customer-service:read')) return '/cs/workstation';
  return '/account-security';
}

function RequirePermission({ permission, children }: { permission: string; children: ReactNode }) {
  const hasPermission = useAuthStore((state) => state.hasPermission);
  const fallbackPath = useDefaultAuthorizedPath();
  if (!hasPermission(permission)) {
    return <Navigate to={fallbackPath} replace />;
  }
  return <>{children}</>;
}

function GuestOnly({ children }: { children: ReactNode }) {
  const token = useAuthStore((state) => state.token);
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
          <Route
            path="/login"
            element={(
              <GuestOnly>
                <LoginPage />
              </GuestOnly>
            )}
          />

          <Route
            element={(
              <RequireAuth>
                <AdminLayout />
              </RequireAuth>
            )}
          >
            <Route index element={<RequirePermission permission="delivery:dashboard:read"><DashboardPage /></RequirePermission>} />
            <Route path="stats" element={<RequirePermission permission="delivery:dashboard:read"><StatsPage /></RequirePermission>} />
            <Route path="users" element={<RequirePermission permission="delivery:users:read"><UsersPage /></RequirePermission>} />
            <Route path="users/:id" element={<RequirePermission permission="delivery:users:read"><UserDetailPage /></RequirePermission>} />
            <Route path="units" element={<RequirePermission permission="delivery:users:read"><UnitsPage /></RequirePermission>} />
            <Route path="units/:id" element={<RequirePermission permission="delivery:users:read"><UnitDetailPage /></RequirePermission>} />
            <Route path="merchants" element={<RequirePermission permission="delivery:merchants:read"><MerchantsPage /></RequirePermission>} />
            <Route path="merchants/:id" element={<RequirePermission permission="delivery:merchants:read"><MerchantDetailPage /></RequirePermission>} />
            <Route path="merchant-applications" element={<RequirePermission permission="delivery:merchants:read"><MerchantApplicationsPage /></RequirePermission>} />
            <Route path="merchant-applications/:id" element={<RequirePermission permission="delivery:merchants:read"><MerchantApplicationDetailPage /></RequirePermission>} />
            <Route path="products" element={<RequirePermission permission="delivery:products:read"><ProductsPage /></RequirePermission>} />
            <Route path="categories" element={<RequirePermission permission="delivery:products:read"><CategoriesPage /></RequirePermission>} />
            <Route path="pricing-rules" element={<RequirePermission permission="delivery:config:read"><PricingRulesPage /></RequirePermission>} />
            <Route path="orders" element={<RequirePermission permission="delivery:orders:read"><OrdersPage /></RequirePermission>} />
            <Route path="orders/:id" element={<RequirePermission permission="delivery:orders:read"><OrderDetailPage /></RequirePermission>} />
            <Route path="shipping-records" element={<RequirePermission permission="delivery:orders:read"><ShippingRecordsPage /></RequirePermission>} />
            <Route path="freight-center" element={<RequirePermission permission="delivery:orders:read"><FreightCenterPage /></RequirePermission>} />
            <Route path="pickup-batches" element={<RequirePermission permission="delivery:orders:read"><PickupBatchesPage /></RequirePermission>} />
            <Route path="abnormal-payments" element={<RequirePermission permission="delivery:orders:read"><AbnormalPaymentsPage /></RequirePermission>} />
            <Route path="manifests" element={<RequirePermission permission="delivery:manifests:read"><ManifestsPage /></RequirePermission>} />
            <Route path="settlements" element={<RequirePermission permission="delivery:settlements:read"><SettlementsPage /></RequirePermission>} />
            <Route path="customer-service" element={<Navigate to="/cs/workstation" replace />} />
            <Route path="customer-service/:id" element={<RequirePermission permission="delivery:customer-service:read"><CustomerServiceDetailPage /></RequirePermission>} />
            <Route path="cs/workstation" element={<RequirePermission permission="delivery:customer-service:read"><CsWorkstationPage /></RequirePermission>} />
            <Route path="cs/tickets" element={<RequirePermission permission="delivery:customer-service:read"><CsTicketsPage /></RequirePermission>} />
            <Route path="cs/faq" element={<RequirePermission permission="delivery:customer-service:read"><CsFaqPage /></RequirePermission>} />
            <Route path="cs/quick-entries" element={<RequirePermission permission="delivery:customer-service:read"><CsQuickEntriesPage /></RequirePermission>} />
            <Route path="cs/quick-replies" element={<RequirePermission permission="delivery:customer-service:read"><CsQuickRepliesPage /></RequirePermission>} />
            <Route path="cs/dashboard" element={<RequirePermission permission="delivery:customer-service:read"><CsDashboardPage /></RequirePermission>} />
            <Route path="audit" element={<RequirePermission permission="delivery:config:read"><AuditPage /></RequirePermission>} />
            <Route path="config" element={<RequirePermission permission="delivery:config:read"><ConfigPage /></RequirePermission>} />
            <Route path="account-security" element={<AccountSecurityPage />} />
          </Route>

          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Suspense>
    </BrowserRouter>
  );
}
