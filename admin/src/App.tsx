import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { lazy, Suspense, type ReactNode } from 'react';
import { Spin } from 'antd';
import useAuthStore from '@/store/useAuthStore';
import AdminLayout from '@/layouts/AdminLayout';

// N17修复：路由级代码拆分，减小首屏包体
const LoginPage = lazy(() => import('@/pages/login/index'));
const DashboardPage = lazy(() => import('@/pages/dashboard/index'));
const ProductListPage = lazy(() => import('@/pages/products/index'));
const ProductEditPage = lazy(() => import('@/pages/products/edit'));
const OrderListPage = lazy(() => import('@/pages/orders/index'));
const OrderDetailPage = lazy(() => import('@/pages/orders/detail'));
const CompanyListPage = lazy(() => import('@/pages/companies/index'));
const CompanyDetailPage = lazy(() => import('@/pages/companies/detail'));
const UserListPage = lazy(() => import('@/pages/users/index'));
const UserDetailPage = lazy(() => import('@/pages/users/detail'));
const MemberListPage = lazy(() => import('@/pages/bonus/members'));
const WithdrawalListPage = lazy(() => import('@/pages/bonus/withdrawals'));
const TraceListPage = lazy(() => import('@/pages/trace/index'));
const ConfigPage = lazy(() => import('@/pages/config/index'));
const AuditLogPage = lazy(() => import('@/pages/audit/index'));
const AdminUsersPage = lazy(() => import('@/pages/admin/users'));
const RolesPage = lazy(() => import('@/pages/admin/roles'));
const VipTreePage = lazy(() => import('@/pages/bonus/vip-tree'));
const BroadcastWindowPage = lazy(() => import('@/pages/bonus/broadcast-window'));
const MemberDetailPage = lazy(() => import('@/pages/bonus/member-detail'));
const ReplacementListPage = lazy(() => import('@/pages/replacements/index'));
const LotteryPage = lazy(() => import('@/pages/lottery/index'));
const RewardProductsPage = lazy(() => import('@/pages/reward-products/index'));
const RewardProductEditPage = lazy(() => import('@/pages/reward-products/edit'));
const ShippingRulesPage = lazy(() => import('@/pages/shipping-rules/index'));
const NormalTreePage = lazy(() => import('@/pages/bonus/normal-tree'));
const NormalConfigPage = lazy(() => import('@/pages/bonus/normal-config'));
const CouponCampaignsPage = lazy(() => import('@/pages/coupons/campaigns'));
const CouponInstancesPage = lazy(() => import('@/pages/coupons/instances'));
const CouponUsagePage = lazy(() => import('@/pages/coupons/usage'));
const CouponStatsPage = lazy(() => import('@/pages/coupons/stats'));
const RefundListPage = lazy(() => import('@/pages/refunds/index'));
const AfterSaleListPage = lazy(() => import('@/pages/after-sale/index'));
const VipConfigPage = lazy(() => import('@/pages/bonus/vip-config'));
const CouponManagementPage = lazy(() => import('@/pages/coupons/index'));
const VipGiftsPage = lazy(() => import('@/pages/vip-gifts/index'));
const CategoriesPage = lazy(() => import('@/pages/categories/index'));
const InvoiceListPage = lazy(() => import('@/pages/invoices/index'));
const InvoiceDetailPage = lazy(() => import('@/pages/invoices/detail'));
const TagManagementPage = lazy(() => import('@/pages/tags/index'));
const DiscoveryFiltersPage = lazy(() => import('@/pages/config/discovery-filters'));
const CsWorkstationPage = lazy(() => import('@/pages/cs/workstation'));
const CsTicketsPage = lazy(() => import('@/pages/cs/tickets'));
const CsFaqPage = lazy(() => import('@/pages/cs/faq'));
const CsQuickEntriesPage = lazy(() => import('@/pages/cs/quick-entries'));
const CsQuickRepliesPage = lazy(() => import('@/pages/cs/quick-replies'));
const CsDashboardPage = lazy(() => import('@/pages/cs/dashboard'));

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
          {/* 登录页（公开） */}
          <Route
            path="/login"
            element={
              <GuestOnly>
                <LoginPage />
              </GuestOnly>
            }
          />

          {/* 管理后台（需登录） */}
          <Route
            element={
              <RequireAuth>
                <AdminLayout />
              </RequireAuth>
            }
          >
            <Route index element={<DashboardPage />} />
            <Route path="categories" element={<CategoriesPage />} />
            <Route path="products" element={<ProductListPage />} />
            <Route path="products/:id/edit" element={<ProductEditPage />} />
            <Route path="orders" element={<OrderListPage />} />
            <Route path="orders/:id" element={<OrderDetailPage />} />
            <Route path="replacements" element={<ReplacementListPage />} />
            <Route path="companies" element={<CompanyListPage />} />
            <Route path="companies/:id" element={<CompanyDetailPage />} />
            <Route path="users" element={<UserListPage />} />
            <Route path="users/:id" element={<UserDetailPage />} />
            <Route path="bonus/members" element={<MemberListPage />} />
            <Route path="bonus/members/:userId" element={<MemberDetailPage />} />
            <Route path="bonus/withdrawals" element={<WithdrawalListPage />} />
            <Route path="bonus/vip-tree" element={<VipTreePage />} />
            <Route path="bonus/broadcast-window" element={<BroadcastWindowPage />} />
            <Route path="bonus/normal-tree" element={<NormalTreePage />} />
            <Route path="bonus/normal-config" element={<NormalConfigPage />} />
            <Route path="bonus/vip-config" element={<VipConfigPage />} />
            <Route path="vip-gifts" element={<VipGiftsPage />} />
            <Route path="coupons" element={<CouponManagementPage />} />
            <Route path="coupons/campaigns" element={<CouponCampaignsPage />} />
            <Route path="coupons/instances" element={<CouponInstancesPage />} />
            <Route path="coupons/usage" element={<CouponUsagePage />} />
            <Route path="coupons/stats" element={<CouponStatsPage />} />
            <Route path="invoices" element={<InvoiceListPage />} />
            <Route path="invoices/:id" element={<InvoiceDetailPage />} />
            <Route path="refunds" element={<RefundListPage />} />
            <Route path="after-sale" element={<AfterSaleListPage />} />
            <Route path="lottery" element={<LotteryPage />} />
            <Route path="reward-products" element={<RewardProductsPage />} />
            <Route path="reward-products/:id/edit" element={<RewardProductEditPage />} />
            <Route path="shipping-rules" element={<ShippingRulesPage />} />
            <Route path="tags" element={<TagManagementPage />} />
            <Route path="trace" element={<TraceListPage />} />
            <Route path="config" element={<ConfigPage />} />
            <Route path="config/discovery-filters" element={<DiscoveryFiltersPage />} />
            <Route path="cs/workstation" element={<CsWorkstationPage />} />
            <Route path="cs/tickets" element={<CsTicketsPage />} />
            <Route path="cs/faq" element={<CsFaqPage />} />
            <Route path="cs/quick-entries" element={<CsQuickEntriesPage />} />
            <Route path="cs/quick-replies" element={<CsQuickRepliesPage />} />
            <Route path="cs/dashboard" element={<CsDashboardPage />} />
            <Route path="audit" element={<AuditLogPage />} />
            <Route path="admin/users" element={<AdminUsersPage />} />
            <Route path="admin/roles" element={<RolesPage />} />
          </Route>

          {/* 兜底 */}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Suspense>
    </BrowserRouter>
  );
}
