import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import {
  Alert,
  Button,
  Card,
  DatePicker,
  Descriptions,
  Drawer,
  Dropdown,
  Form,
  Input,
  Skeleton,
  Space,
  Table,
  Tag,
  Typography,
} from 'antd';
import type { ColumnsType, TablePaginationConfig } from 'antd/es/table';
import type { Dayjs } from 'dayjs';
import dayjs from 'dayjs';
import { MoreOutlined, PlusOutlined, ReloadOutlined } from '@ant-design/icons';
import {
  getIndustryFundPayment,
  getIndustryFundPayments,
  type IndustryFundPayment,
  type IndustryFundPaymentQuery,
  type IndustryFundPaymentStatus,
  type PageResult,
} from '@/api/fund-ledgers';
import { PERMISSIONS } from '@/constants/permissions';
import { usePermission } from '@/hooks/usePermission';
import { getAdminErrorMessage } from '@/utils/adminErrorMessage';
import PaymentCreateDrawer from './payment-create-drawer';
import { dateTime, eventTag, getRows, money, paymentStatusTag } from './common';
import { FundHeading } from './workspace';
import { fundLink, safeFundReturn, useFundSearch, useFundScroll } from './workspace-state';

const PAYMENT_STATUSES: IndustryFundPaymentStatus[] = ['PAID', 'CANCELLED', 'REVERSED'];
const PAYMENT_VIEWS = ['all', 'pending', 'review', 'recovery'] as const;
type PaymentView = typeof PAYMENT_VIEWS[number];

interface PaymentPageSummary {
  pendingCount?: number;
  reviewCount?: number;
  recoveryCount?: number;
}

type PaymentPageResult = Omit<PageResult<IndustryFundPayment>, 'summary'> & {
  summary?: PaymentPageSummary;
};

interface PaymentFilterValues {
  q?: string;
  dates?: [Dayjs, Dayjs];
  bankReference?: string;
}

function readPaymentPage(value: unknown): PaymentPageResult {
  const rows = getRows<IndustryFundPayment>(value);
  const record = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  const nested = record.data && typeof record.data === 'object' ? record.data as Record<string, unknown> : record;
  const summary = nested.summary && typeof nested.summary === 'object' ? nested.summary as PaymentPageSummary : undefined;
  return { ...rows, summary };
}

function validView(value: string | null): PaymentView {
  return value && (PAYMENT_VIEWS as readonly string[]).includes(value) ? value as PaymentView : 'all';
}

function validStatus(value: string | null): IndustryFundPaymentStatus | undefined {
  return value && PAYMENT_STATUSES.includes(value as IndustryFundPaymentStatus)
    ? value as IndustryFundPaymentStatus
    : undefined;
}

function companyName(payment: IndustryFundPayment): string {
  return payment.company?.name || payment.company?.id || payment.companyId || '未关联公司';
}

function isReserved(payment: IndustryFundPayment): boolean {
  return payment.status === 'RESERVED' || payment.status === 'PAYMENT_RESERVED';
}

function isPaid(payment: IndustryFundPayment): boolean {
  return payment.status === 'PAID' || payment.status === 'PAYMENT_CONFIRMED';
}

function summaryEntry(summary: PaymentPageSummary | undefined, key: string): { count?: number; amount?: number } {
  const count = key === 'pending'
    ? summary?.pendingCount
    : key === 'review'
      ? summary?.reviewCount
      : key === 'recovery'
        ? summary?.recoveryCount
        : undefined;
  return typeof count === 'number' ? { count } : {};
}

function summaryText(value: { count?: number; amount?: number }): string {
  const count = typeof value.count === 'number' ? `${value.count} 笔` : '';
  const amount = typeof value.amount === 'number' ? money(value.amount) : '';
  return count || amount ? [count, amount].filter(Boolean).join(' · ') : '未记录';
}

function paymentStatusLabel(payment: IndustryFundPayment): React.ReactNode {
  return (
    <Space size={4} wrap>
      {paymentStatusTag(payment.status)}
      {payment.needsReview && <Tag color="warning">需核实</Tag>}
    </Space>
  );
}

function listReturnPath(pathname: string, params: URLSearchParams, allowBankReference = true): string {
  const copy = new URLSearchParams(params);
  copy.delete('create');
  copy.delete('correctionId');
  copy.delete('correctPaymentId');
  // A return target belongs to the page that opened this list. Do not nest it
  // when a correction shortcut itself came from a detail page.
  copy.delete('returnTo');
  if (!allowBankReference) copy.delete('bankReference');
  const query = copy.toString();
  return safeFundReturn(`${pathname}${query ? `?${query}` : ''}`);
}

interface PaymentPreviewDrawerProps {
  paymentId: string | null;
  open: boolean;
  returnTo: string;
  onClose: () => void;
}

function PaymentPreviewDrawer({ paymentId, open, returnTo, onClose }: PaymentPreviewDrawerProps) {
  const navigate = useNavigate();
  const query = useQuery({
    queryKey: ['admin', 'industry-funds', 'payment', 'preview', paymentId],
    queryFn: () => getIndustryFundPayment(paymentId!),
    enabled: open && !!paymentId,
  });
  const payment = query.data;

  return (
    <Drawer
      title={payment ? (payment.paymentNo || payment.id) : '付款单详情'}
      open={open}
      onClose={onClose}
      width={760}
      destroyOnClose
      footer={(
        <Space style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <Button onClick={onClose}>关闭</Button>
          {payment && <Button type="primary" onClick={() => navigate(fundLink(`/fund-ledgers/payments/${payment.id}`, returnTo))}>打开完整详情</Button>}
        </Space>
      )}
    >
      {query.isLoading && <Skeleton active />}
      {query.isError && <Alert type="error" showIcon message="付款单读取失败" description={getAdminErrorMessage(query.error, '请重试')} action={<Button onClick={() => query.refetch()}>重试</Button>} />}
      {payment && (
        <Space direction="vertical" size={16} style={{ width: '100%' }}>
          {payment.needsReview && <Alert type="warning" showIcon message="该付款单需要人工核实" description={payment.reviewReason || '请打开完整详情，核实实际付款事实。'} />}
          <Card size="small" title="金额与状态" extra={paymentStatusLabel(payment)}>
            <Descriptions size="small" column={{ xs: 1, sm: 2 }}>
              <Descriptions.Item label="付款金额"><Typography.Text strong className="fund-number">{money(payment.amount)}</Typography.Text></Descriptions.Item>
              <Descriptions.Item label="实际付款">{money(payment.actualAmount)}</Descriptions.Item>
              <Descriptions.Item label="创建时间">{dateTime(payment.createdAt)}</Descriptions.Item>
              <Descriptions.Item label="付款时间">{dateTime(payment.paidAt)}</Descriptions.Item>
              <Descriptions.Item label="登记原因" span={2}>{payment.reason || '未记录'}</Descriptions.Item>
            </Descriptions>
          </Card>
          <Card size="small" title="来源公司与核销">
            <Descriptions size="small" column={1}>
              <Descriptions.Item label="收款公司"><Link to={fundLink(`/fund-ledgers/companies/${payment.companyId}`, returnTo)} onClick={onClose}>{companyName(payment)}</Link></Descriptions.Item>
              <Descriptions.Item label="核销记录">{payment.items?.length ? `${payment.items.length} 笔来源计提` : '当前接口未返回核销明细'}</Descriptions.Item>
            </Descriptions>
            {payment.items?.length ? <Table size="small" pagination={false} rowKey={(row) => row.id || `${row.accrualId}-${row.amount}`} dataSource={payment.items} columns={[{ title: '来源订单', dataIndex: 'orderId', render: value => value || '未记录' }, { title: '计提记录', dataIndex: 'accrualId' }, { title: '核销金额', dataIndex: 'amount', align: 'right', render: value => money(value) }]} /> : null}
          </Card>
          <Card size="small" title="付款与回款凭证">
            <Descriptions size="small" column={{ xs: 1, sm: 2 }}>
              <Descriptions.Item label="付款账户标识">{payment.sourceAccountRef || '受权限保护'}</Descriptions.Item>
              <Descriptions.Item label="银行流水号">{payment.bankReference || '受权限保护或尚未登记'}</Descriptions.Item>
              <Descriptions.Item label="付款凭证">{payment.proofKey ? '已上传私有凭证' : '尚未上传'}</Descriptions.Item>
              <Descriptions.Item label="回款记录">{payment.recoveries?.length ? `${payment.recoveries.length} 笔` : '暂无实际回款'}</Descriptions.Item>
            </Descriptions>
          </Card>
          {payment.statusHistory?.length ? <Card size="small" title="操作历史"><Space direction="vertical" size={8} style={{ width: '100%' }}>{payment.statusHistory.map(item => <div key={item.id}><Space size={8}>{eventTag(item.eventType)}<Typography.Text>{money(item.amount)}</Typography.Text><Typography.Text type="secondary">{dateTime(item.occurredAt)} · {item.operator?.id || '系统任务'}</Typography.Text></Space>{item.reason && <Typography.Paragraph type="secondary" style={{ margin: '2px 0 0 78px' }}>{item.reason}</Typography.Paragraph>}</div>)}</Space></Card> : null}
          {isReserved(payment) && <Alert type="info" showIcon message="待付款单如资料填错，请在完整详情中先核实未转账，再取消旧单并创建新单；原记录不会被覆盖。" />}
          {isPaid(payment) && <Alert type="info" showIcon message="已登记付款的金额和收款快照不可直接编辑；错误登记走冲正，实际退回款走回款登记。" />}
        </Space>
      )}
    </Drawer>
  );
}

function PaymentSummaryRail({ summary }: { summary?: PaymentPageSummary }) {
  const pending = summaryEntry(summary, 'pending');
  const review = summaryEntry(summary, 'review');
  const recovery = summaryEntry(summary, 'recovery');
  return (
    <section className="fund-summary" aria-label="付款待处理摘要">
      <div><Typography.Text type="secondary">待付款核实</Typography.Text><strong>{summaryText(pending)}</strong></div>
      <div><Typography.Text type="secondary">需核实</Typography.Text><strong>{summaryText(review)}</strong></div>
      <div><Typography.Text type="secondary">待追偿</Typography.Text><strong className={recovery.count ? 'fund-warning' : ''}>{summaryText(recovery)}</strong></div>
    </section>
  );
}

export default function IndustryFundPaymentsPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const queryClient = useQueryClient();
  const { params, update, current, page, pageSize, reset } = useFundSearch();
  useFundScroll(current);
  const { hasPermission } = usePermission();
  const canRead = hasPermission(PERMISSIONS.INDUSTRY_FUNDS_READ);
  const canPay = hasPermission(PERMISSIONS.INDUSTRY_FUNDS_PAY);
  const canReverse = hasPermission(PERMISSIONS.INDUSTRY_FUNDS_REVERSE);
  const canSearchBankReference = canPay || canReverse;
  const [filterForm] = Form.useForm<PaymentFilterValues>();
  const [advanced, setAdvanced] = useState(false);
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [createCompanyId, setCreateCompanyId] = useState<string | undefined>();
  const [correctionTarget, setCorrectionTarget] = useState<IndustryFundPayment | null>(null);
  const [correctionTargetId, setCorrectionTargetId] = useState<string | undefined>();
  const handledShortcut = useRef('');

  const q = params.get('q') || params.get('search') || '';
  const status = validStatus(params.get('status'));
  const view = validView(params.get('view'));
  const from = params.get('from') || undefined;
  const to = params.get('to') || undefined;
  const bankReference = canSearchBankReference ? (params.get('bankReference') || '') : '';
  const companyId = params.get('companyId') || undefined;
  const returnTo = listReturnPath(location.pathname, params, canSearchBankReference);

  useEffect(() => {
    filterForm.setFieldsValue({
      q,
      bankReference,
      dates: from && to && dayjs(from).isValid() && dayjs(to).isValid() ? [dayjs(from), dayjs(to)] : undefined,
    });
  }, [bankReference, filterForm, from, q, to]);

  useEffect(() => {
    if (!canRead || params.get('create') !== '1') return;
    const correctionId = params.get('correctionId') || params.get('correctPaymentId') || '';
    const key = `${params.get('companyId') || ''}:${correctionId}`;
    if (handledShortcut.current === key) return;
    handledShortcut.current = key;
    if (!canPay) {
      update({ create: undefined, correctionId: undefined, correctPaymentId: undefined }, false);
      return;
    }
    // Shortcut hydration is an intentional synchronization from the URL into the drawer state.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setCreateCompanyId(params.get('companyId') || undefined);
    setCorrectionTarget(null);
    setCorrectionTargetId(correctionId || undefined);
    setCreateOpen(true);
    update({ create: undefined, correctionId: undefined, correctPaymentId: undefined }, false);
  }, [canPay, canRead, params, update]);

  const listQuery = useQuery({
    queryKey: ['admin', 'industry-funds', 'payments', { q, status, view, from, to, bankReference, companyId, page, pageSize }],
    queryFn: async () => {
      const query: IndustryFundPaymentQuery = {
        page,
        pageSize,
        search: q || undefined,
        status,
        view: status ? 'all' : view,
        from,
        to,
        companyId,
        ...(canSearchBankReference && bankReference ? { bankReference } : {}),
      };
      return readPaymentPage(await getIndustryFundPayments(query));
    },
    enabled: canRead,
    placeholderData: previous => previous,
  });
  const result = listQuery.data;

  useEffect(() => {
    if (!result || listQuery.isFetching || result.total <= 0) return;
    const lastPage = Math.max(1, Math.ceil(result.total / pageSize));
    if (page > lastPage) update({ page: lastPage }, false);
  }, [listQuery.isFetching, page, pageSize, result, update]);

  const clearCreateParams = () => update({ create: undefined, correctionId: undefined, correctPaymentId: undefined }, false);
  const closeCreate = () => {
    setCreateOpen(false);
    setCreateCompanyId(undefined);
    setCorrectionTarget(null);
    setCorrectionTargetId(undefined);
    clearCreateParams();
  };
  const openNewPayment = () => {
    setCorrectionTarget(null);
    setCorrectionTargetId(undefined);
    setCreateCompanyId(companyId);
    setCreateOpen(true);
  };
  const openCorrection = (payment: IndustryFundPayment) => {
    if (!canPay || !isReserved(payment)) return;
    setCorrectionTarget(payment);
    setCorrectionTargetId(payment.id);
    setCreateCompanyId(payment.companyId);
    setCreateOpen(true);
  };
  const handleCreated = (payment: IndustryFundPayment) => {
    queryClient.invalidateQueries({ queryKey: ['admin', 'industry-funds'] });
    queryClient.invalidateQueries({ queryKey: ['admin', 'fund-ledgers'] });
    closeCreate();
    navigate(fundLink(`/fund-ledgers/payments/${payment.id}`, returnTo));
  };

  const paymentColumns: ColumnsType<IndustryFundPayment> = [
    {
      title: '付款单',
      dataIndex: 'paymentNo',
      width: 220,
      render: (_, row) => (
        <div className="fund-list-title">
          <Button type="link" style={{ padding: 0 }} onClick={() => setPreviewId(row.id)}>{row.paymentNo || row.id}</Button>
          <Typography.Text type="secondary" className="fund-bank-ref">{isPaid(row) ? '已登记线下付款' : row.status === 'CANCELLED' ? '付款预留已取消' : row.status === 'REVERSED' ? '付款记录已冲正' : '付款结果待登记'}</Typography.Text>
        </div>
      ),
    },
    {
      title: '收款公司',
      dataIndex: 'company',
      width: 220,
      render: (_, row) => <Link to={fundLink(`/fund-ledgers/companies/${row.companyId}`, returnTo)}>{companyName(row)}</Link>,
    },
    { title: '金额', dataIndex: 'amount', width: 140, align: 'right', render: value => <Typography.Text strong className="fund-number">{money(value)}</Typography.Text> },
    { title: '状态', dataIndex: 'status', width: 150, render: (_, row) => paymentStatusLabel(row) },
    {
      title: '创建 / 付款时间',
      key: 'time',
      width: 190,
      responsive: ['md'],
      render: (_, row) => <div className="fund-list-title"><Typography.Text>{dateTime(row.createdAt)}</Typography.Text><Typography.Text type="secondary">{row.paidAt ? `付款 ${dateTime(row.paidAt)}` : '尚未登记付款'}</Typography.Text></div>,
    },
    {
      title: '操作',
      key: 'action',
      fixed: 'right',
      width: 130,
      render: (_, row) => {
        const menuItems: NonNullable<React.ComponentProps<typeof Dropdown>['menu']>['items'] = [];
        if (isReserved(row) && canPay) {
          menuItems.push({ key: 'confirm', label: '登记已付款', onClick: () => navigate(fundLink(`/fund-ledgers/payments/${row.id}`, returnTo)) });
          menuItems.push({ key: 'correct', label: '更正未付款单', onClick: () => openCorrection(row) });
        }
        if (isPaid(row) && canReverse) {
          menuItems.push({ key: 'reverse', label: '冲正 / 实际回款', onClick: () => navigate(fundLink(`/fund-ledgers/payments/${row.id}`, returnTo)) });
        }
        return <Space size={4}><Button type="link" onClick={() => setPreviewId(row.id)}>查看</Button>{menuItems.length > 0 && <Dropdown menu={{ items: menuItems }} trigger={['click']}><Button type="text" aria-label="更多付款操作" icon={<MoreOutlined />} /></Dropdown>}</Space>;
      },
    },
  ];

  const onFilterFinish = (values: PaymentFilterValues) => {
    const dates = values.dates;
    update({
      q: values.q?.trim(),
      search: undefined,
      from: dates?.[0]?.startOf('day').toISOString(),
      to: dates?.[1]?.endOf('day').toISOString(),
      ...(canSearchBankReference ? { bankReference: values.bankReference?.trim() } : {}),
    });
  };
  const resetFilters = () => {
    filterForm.resetFields();
    reset();
  };
  const selectQuick = (next: string) => {
    if (next === 'all') update({ status: undefined, view: 'all' });
    else if (PAYMENT_VIEWS.includes(next as PaymentView)) update({ status: undefined, view: next });
    else update({ status: next, view: undefined });
  };
  const pagination: TablePaginationConfig = {
    current: page,
    pageSize,
    total: result?.total || 0,
    showSizeChanger: true,
    pageSizeOptions: [20, 50, 100],
    showTotal: total => `共 ${total} 笔`,
    onChange: (nextPage, nextPageSize) => {
      if (nextPageSize !== pageSize) update({ page: 1, pageSize: nextPageSize }, false);
      else update({ page: nextPage }, false);
    },
  };
  const quickItems: Array<[string, string]> = [
    ['all', '全部'],
    ['pending', '待付款核实'],
    ['review', '需核实'],
    ['recovery', '待追偿'],
    ['PAID', '已登记付款'],
    ['CANCELLED', '已取消'],
    ['REVERSED', '已冲正'],
  ];

  if (!canRead) return <div className="fund-workspace"><Alert type="error" showIcon message="没有查看公对公付款的权限" /></div>;

  return (
    <div className="fund-workspace">
      <FundHeading
        title="公对公付款"
        description="先建立付款单并预留金额，线下银行转账完成后登记结果。"
        actions={canPay && <Button type="primary" icon={<PlusOutlined />} onClick={openNewPayment}>新建付款单</Button>}
      />
      <PaymentSummaryRail summary={result?.summary} />
      <Card>
        <div className="fund-quick" role="tablist" aria-label="付款状态快捷筛选">
          {quickItems.map(([value, label]) => {
            const active = value === 'all' ? !status && view === 'all' : status === value || (!status && view === value);
            const count = result?.summary ? summaryEntry(result.summary, value.toLowerCase()) : {};
            return <Button key={value} type={active ? 'primary' : 'default'} onClick={() => selectQuick(value)} aria-selected={active}>{label}{typeof count.count === 'number' ? ` ${count.count}` : ''}</Button>;
          })}
        </div>
        <Form form={filterForm} onFinish={onFilterFinish}>
          <div className="fund-toolbar">
            <Form.Item name="q" noStyle><Input className="fund-search-input" allowClear aria-label={canSearchBankReference ? '公司、付款单号或银行流水号' : '公司或付款单号'} placeholder={canSearchBankReference ? '搜索公司名称、付款单号或银行流水号' : '搜索公司名称或付款单号'} onPressEnter={() => filterForm.submit()} /></Form.Item>
            <Button type="primary" htmlType="submit">查询</Button>
            <Button onClick={resetFilters}>重置</Button>
            <Button icon={<ReloadOutlined />} loading={listQuery.isFetching} onClick={() => listQuery.refetch()}>刷新</Button>
            <Button onClick={() => setAdvanced(value => !value)} aria-expanded={advanced}>更多筛选</Button>
          </div>
          <div hidden={!advanced} className="fund-advanced">
            <Space wrap>
              <Form.Item name="dates" label="创建时间" style={{ marginBottom: 0 }}><DatePicker.RangePicker showTime={false} /></Form.Item>
              {canSearchBankReference && <Form.Item name="bankReference" label="银行流水号" style={{ marginBottom: 0 }}><Input allowClear placeholder="精确匹配银行流水号" /></Form.Item>}
            </Space>
          </div>
        </Form>
        <div className="fund-condition-tags">
          {q && <Tag closable onClose={() => update({ q: undefined })}>关键词：{q}</Tag>}
          {status && <Tag closable onClose={() => update({ status: undefined })}>状态：{status === 'PAID' ? '已登记付款' : status === 'CANCELLED' ? '已取消' : '已冲正'}</Tag>}
          {!status && view !== 'all' && <Tag closable onClose={() => update({ view: 'all' })}>视图：{view === 'pending' ? '待付款核实' : view === 'review' ? '需核实' : '待追偿'}</Tag>}
          {(from || to) && <Tag closable onClose={() => update({ from: undefined, to: undefined })}>创建时间：{from ? dayjs(from).format('YYYY-MM-DD') : '不限'} 至 {to ? dayjs(to).format('YYYY-MM-DD') : '不限'}</Tag>}
          {bankReference && canSearchBankReference && <Tag closable onClose={() => update({ bankReference: undefined })}>银行流水：{bankReference}</Tag>}
          {companyId && <Tag closable onClose={() => update({ companyId: undefined })}>公司：{companyId}</Tag>}
        </div>
        <Typography.Paragraph className="fund-filter-note">搜索支持公司名称、付款单号；银行流水号仅向付款或冲正权限开放。付款详情中的账号、凭证和核销明细按权限返回。</Typography.Paragraph>
        {listQuery.isError ? (
          <Alert type="error" showIcon message="付款列表加载失败" description={getAdminErrorMessage(listQuery.error, '筛选条件已保留，请重试')} action={<Button onClick={() => listQuery.refetch()}>重试</Button>} />
        ) : (
          <Table<IndustryFundPayment>
            rowKey="id"
            columns={paymentColumns}
            dataSource={result?.items || []}
            loading={listQuery.isLoading || listQuery.isFetching}
            pagination={pagination}
            scroll={{ x: 1050 }}
            locale={{ emptyText: <Space direction="vertical"><Typography.Text>{q || status || view !== 'all' || from || to || companyId ? '没有找到符合当前筛选的付款单' : '尚未产生付款单记录'}</Typography.Text>{(q || status || view !== 'all' || from || to || companyId) && <Button onClick={resetFilters}>清除筛选</Button>}</Space> }}
          />
        )}
      </Card>
      <Typography.Paragraph className="fund-filter-note">已登记付款的金额和收款快照不直接编辑。资料填错时，先核实未线下转账，再取消旧单并使用原资料创建新单；旧单取消成功而新单失败时，页面会保留可重试状态。</Typography.Paragraph>

      <PaymentPreviewDrawer paymentId={previewId} open={!!previewId} returnTo={returnTo} onClose={() => setPreviewId(null)} />
      <PaymentCreateDrawer
        open={createOpen}
        initialCompanyId={createCompanyId}
        correctionPayment={correctionTarget}
        correctionPaymentId={correctionTarget?.id || correctionTargetId}
        onClose={closeCreate}
        onCreated={handleCreated}
      />
    </div>
  );
}
