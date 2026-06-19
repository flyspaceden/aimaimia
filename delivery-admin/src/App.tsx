import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { lazy, Suspense, type ReactNode } from 'react';
import { Spin } from 'antd';
import AdminLayout from '@/layouts/AdminLayout';
import useAuthStore from '@/store/useAuthStore';

const LoginPage = lazy(() => import('@/pages/login/index'));
const DashboardPage = lazy(() => import('@/pages/delivery-admin/dashboard'));
const UsersPage = lazy(() => import('@/pages/delivery-admin/users'));
const UserDetailPage = lazy(() => import('@/pages/delivery-admin/user-detail'));
const UnitsPage = lazy(() => import('@/pages/delivery-admin/units'));
const UnitDetailPage = lazy(() => import('@/pages/delivery-admin/unit-detail'));
const MerchantsPage = lazy(() => import('@/pages/delivery-admin/merchants'));
const MerchantDetailPage = lazy(() => import('@/pages/delivery-admin/merchant-detail'));
const MerchantApplicationsPage = lazy(() => import('@/pages/delivery-admin/merchant-applications'));
const MerchantApplicationDetailPage = lazy(() => import('@/pages/delivery-admin/merchant-application-detail'));
const ProductsPage = lazy(() => import('@/pages/delivery-admin/products'));
const PricingRulesPage = lazy(() => import('@/pages/delivery-admin/pricing-rules'));
const OrdersPage = lazy(() => import('@/pages/delivery-admin/orders'));
const OrderDetailPage = lazy(() => import('@/pages/delivery-admin/order-detail'));
const ShippingRecordsPage = lazy(() => import('@/pages/delivery-admin/shipping-records'));
const AbnormalPaymentsPage = lazy(() => import('@/pages/delivery-admin/abnormal-payments'));
const ManifestsPage = lazy(() => import('@/pages/delivery-admin/manifests'));
const SettlementsPage = lazy(() => import('@/pages/delivery-admin/settlements'));
const CustomerServicePage = lazy(() => import('@/pages/delivery-admin/customer-service'));
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
  if (!token) {
    return <Navigate to="/login" replace />;
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
            <Route index element={<DashboardPage />} />
            <Route path="users" element={<UsersPage />} />
            <Route path="users/:id" element={<UserDetailPage />} />
            <Route path="units" element={<UnitsPage />} />
            <Route path="units/:id" element={<UnitDetailPage />} />
            <Route path="merchants" element={<MerchantsPage />} />
            <Route path="merchants/:id" element={<MerchantDetailPage />} />
            <Route path="merchant-applications" element={<MerchantApplicationsPage />} />
            <Route path="merchant-applications/:id" element={<MerchantApplicationDetailPage />} />
            <Route path="products" element={<ProductsPage />} />
            <Route path="pricing-rules" element={<PricingRulesPage />} />
            <Route path="orders" element={<OrdersPage />} />
            <Route path="orders/:id" element={<OrderDetailPage />} />
            <Route path="shipping-records" element={<ShippingRecordsPage />} />
            <Route path="abnormal-payments" element={<AbnormalPaymentsPage />} />
            <Route path="manifests" element={<ManifestsPage />} />
            <Route path="settlements" element={<SettlementsPage />} />
            <Route path="customer-service" element={<CustomerServicePage />} />
            <Route path="customer-service/:id" element={<CustomerServiceDetailPage />} />
            <Route path="audit" element={<AuditPage />} />
            <Route path="config" element={<ConfigPage />} />
            <Route path="account-security" element={<AccountSecurityPage />} />
          </Route>

          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Suspense>
    </BrowserRouter>
  );
}
