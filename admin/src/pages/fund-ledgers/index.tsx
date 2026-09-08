import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ProTable } from '@ant-design/pro-components';
import type { ProColumns } from '@ant-design/pro-components';
import {
  Alert,
  App,
  Button,
  Card,
  Col,
  DatePicker,
  Divider,
  Form,
  Input,
  InputNumber,
  Modal,
  Row,
  Select,
  Space,
  Statistic,
  Tag,
  Typography,
} from 'antd';
import { EyeOutlined, PlusOutlined, ReloadOutlined, WalletOutlined } from '@ant-design/icons';
import type { Dayjs } from 'dayjs';
import {
  createIndustryFundPayment,
  getFundSummary,
  getIndustryFundCompanies,
  getIndustryFundSummary,
  getIndustryFundPayments,
  getIndustryFundUnassigned,
  type CreateIndustryFundPaymentInput,
  type FundSummaryResponse,
  type IndustryFundCompany,
  type IndustryFundPayment,
  type IndustryFundPaymentQuery,
  type IndustryFundUnassignedEntry,
} from '@/api/fund-ledgers';
import { PERMISSIONS } from '@/constants/permissions';
import PermissionGate from '@/components/PermissionGate';
import { usePermission } from '@/hooks/usePermission';
import { getAdminErrorMessage } from '@/utils/adminErrorMessage';
import {
  FUND_TYPE_LABELS,
  FUND_TYPE_COLORS,
  FUND_TYPE_LABELS as fundTypeLabels,
  money,
  dateTime,
  getArray,
  getRows,
  paymentStatusTag,
} from './common';

const { RangePicker } = DatePicker;

interface DateFilterValues {
  dates?: [Dayjs, Dayjs];
}

const makeIdempotencyKey = () => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
};

function getIndustryValues(summary?: FundSummaryResponse | null) {
  const row = summary?.funds?.find((item) => item.fundType === 'INDUSTRY_FUND');
  const direct = summary as (FundSummaryResponse & {
    accrued?: number;
    frozen?: number;
    available?: number;
    reserved?: number;
    paid?: number;
    recoverable?: number;
    companyPayable?: number;
  }) | undefined;
  const industry = summary?.industry ?? direct;
  return {
    accrued: summary?.industry?.accrued ?? direct?.accrued ?? 0,
    payable: industry?.companyPayable ?? row?.companyPayable ?? direct?.companyPayable ?? row?.currentBalance ?? 0,
    frozen: industry?.frozen ?? row?.frozen ?? direct?.frozen ?? 0,
    reserved: industry?.reserved ?? row?.reserved ?? direct?.reserved ?? 0,
    paid: industry?.paid ?? row?.paid ?? direct?.paid ?? 0,
    recoverable: industry?.recoverable ?? row?.recoverable ?? direct?.recoverable ?? 0,
  };
}

function companyName(company: IndustryFundPayment['company']): string {
  if (!company) return '-';
  return company.name || company.id || '-';
}

export default function FundLedgersPage() {
  const { message } = App.useApp();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [filterForm] = Form.useForm<DateFilterValues>();
  const [paymentForm] = Form.useForm<CreateIndustryFundPaymentInput>();
  const [paymentModalOpen, setPaymentModalOpen] = useState(false);
  const [tableRevision, setTableRevision] = useState(0);
  const [filter, setFilter] = useState<{ from?: string; to?: string }>({});
  const { hasPermission } = usePermission();
  const canReadUnified = hasPermission(PERMISSIONS.FUND_LEDGERS_READ);
  const canReadIndustry = hasPermission(PERMISSIONS.INDUSTRY_FUNDS_READ);

  const summaryQuery = useQuery({
    queryKey: ['admin', 'fund-ledgers', 'summary', filter],
    queryFn: () => getFundSummary(filter),
    enabled: canReadUnified,
  });
  const industrySummaryQuery = useQuery({
    queryKey: ['admin', 'industry-funds', 'summary'],
    queryFn: getIndustryFundSummary,
    enabled: !canReadUnified && canReadIndustry,
  });
  const companyOptionsQuery = useQuery({
    queryKey: ['admin', 'industry-funds', 'companies', 'options'],
    queryFn: () => getIndustryFundCompanies({ page: 1, pageSize: 100 }),
    enabled: canReadIndustry,
  });

  const paymentMutation = useMutation({
    mutationFn: createIndustryFundPayment,
    onSuccess: () => {
      setTableRevision(r => r + 1);
      message.success('付款单已创建并预留金额');
      setPaymentModalOpen(false);
      paymentForm.resetFields();
      queryClient.invalidateQueries({ queryKey: ['admin', 'fund-ledgers'] });
      queryClient.invalidateQueries({ queryKey: ['admin', 'industry-funds'] });
    },
    onError: (error) => message.error(getAdminErrorMessage(error, '创建付款单失败')),
  });

  const companies = useMemo(
    () => getRows<IndustryFundCompany>(companyOptionsQuery.data).items,
    [companyOptionsQuery.data],
  );
  const effectiveSummary = summaryQuery.data ?? industrySummaryQuery.data;
  const industry = getIndustryValues(effectiveSummary);
  const summaryRows = getArray<NonNullable<FundSummaryResponse['funds']>[number]>(summaryQuery.data, ['funds']);

  const applyDateFilter = (values: DateFilterValues) => {
    const dates = values.dates;
    setFilter({
      from: dates?.[0]?.startOf('day').toISOString(),
      to: dates?.[1]?.endOf('day').toISOString(),
    });
  };

  const openPaymentModal = () => {
    paymentForm.resetFields();
    paymentForm.setFieldsValue({ idempotencyKey: makeIdempotencyKey() });
    setPaymentModalOpen(true);
  };

  const submitPayment = async (values: CreateIndustryFundPaymentInput) => {
    const idempotencyKey = values.idempotencyKey?.trim();
    if (!idempotencyKey) {
      message.error('付款单幂等键缺失，请关闭后重新打开表单');
      return;
    }
    await paymentMutation.mutateAsync({
      ...values,
      amount: Number(values.amount),
      companyId: values.companyId.trim(),
      payeeName: values.payeeName.trim(),
      bankAccount: values.bankAccount.trim(),
      bankName: values.bankName.trim(),
      reason: values.reason.trim(),
      idempotencyKey,
    });
  };

  const companyColumns: ProColumns<IndustryFundCompany>[] = [
    {
      title: '企业',
      dataIndex: 'name',
      render: (_, row) => <Link to={`/fund-ledgers/companies/${row.id}`}>{row.name || row.companyNo || row.id}</Link>,
    },
    { title: '售后冻结', dataIndex: 'frozen', width: 120, align: 'right', render: (_, row) => money(row.frozen ?? row.balances?.frozen) },
    { title: '可支付', dataIndex: 'available', width: 120, align: 'right', render: (_, row) => money(row.available ?? row.balances?.available) },
    { title: '付款预留', dataIndex: 'reserved', width: 120, align: 'right', render: (_, row) => money(row.reserved ?? row.balances?.reserved) },
    { title: '累计已支付', dataIndex: 'paid', width: 120, align: 'right', render: (_, row) => money(row.paid ?? row.balances?.paid) },
    { title: '待追偿', dataIndex: 'recoverable', width: 120, align: 'right', render: (_, row) => money(row.recoverable ?? row.balances?.recoverable) },
    { title: '最近变动', dataIndex: 'lastEntryAt', width: 170, render: (_, row) => dateTime(row.lastEntryAt) },
    {
      title: '操作',
      key: 'action',
      valueType: 'option',
      width: 100,
      render: (_, row) => <Button type="link" icon={<EyeOutlined />} onClick={() => navigate(`/fund-ledgers/companies/${row.id}`)}>账本</Button>,
    },
  ];

  const paymentColumns: ProColumns<IndustryFundPayment>[] = [
    { title: '付款单号', dataIndex: 'paymentNo', width: 180, render: (_, row) => <Link to={`/fund-ledgers/payments/${row.id}`}>{row.paymentNo || row.id}</Link> },
    { title: '收款公司', dataIndex: 'companyName', width: 180, render: (_, row) => companyName(row.company) },
    { title: '金额', dataIndex: 'amount', width: 120, align: 'right', render: (_, row) => money(row.amount) },
    { title: '状态', dataIndex: 'status', valueEnum: { RESERVED: { text: '待付款核实' }, PAID: { text: '已付款登记' }, CANCELLED: { text: '已取消' }, REVERSED: { text: '已冲正' } }, width: 120, render: (_, row) => paymentStatusTag(row.status) },
    { title: '付款时间', dataIndex: 'paidAt', width: 170, render: (_, row) => dateTime(row.paidAt) },
    { title: '创建时间', dataIndex: 'createdAt', width: 170, render: (_, row) => dateTime(row.createdAt) },
    { title: '操作', key: 'action', valueType: 'option', width: 100, render: (_, row) => <Button type="link" onClick={() => navigate(`/fund-ledgers/payments/${row.id}`)}>详情</Button> },
  ];

  const fundColumns: ProColumns<NonNullable<FundSummaryResponse['funds']>[number]>[] = [
    {
      title: '账本',
      dataIndex: 'fundType',
      render: (value) => {
        const type = value as keyof typeof FUND_TYPE_LABELS;
        return <Link to={`/fund-ledgers/${type}`}><Tag color={FUND_TYPE_COLORS[type]}>{fundTypeLabels[type] || value}</Tag></Link>;
      },
    },
    { title: '期初余额', dataIndex: 'initialBalance', align: 'right', render: (_, row) => money(row.initialBalance) },
    { title: '期间收入', dataIndex: 'periodIncome', align: 'right', render: (_, row) => money(row.periodIncome) },
    { title: '期间支出/冲回', dataIndex: 'periodExpense', align: 'right', render: (_, row) => money(row.periodExpense) },
    { title: '当前余额', dataIndex: 'currentBalance', align: 'right', render: (_, row) => money(row.currentBalance) },
    { title: '最近变动', dataIndex: 'lastEntryAt', render: (_, row) => dateTime(row.lastEntryAt) },
  ];

  const dateParams = (params: Record<string, unknown>): IndustryFundPaymentQuery => ({
    page: Number(params.current ?? 1),
    pageSize: Number(params.pageSize ?? 20),
    from: filter.from,
    to: filter.to,
    status: typeof params.status === 'string' ? params.status : undefined,
    search: typeof params.name === 'string' ? params.name : typeof params.companyName === 'string' ? params.companyName : undefined,
  });

  return (
    <div style={{ padding: 24 }}>
      <Space direction="vertical" size={16} style={{ width: '100%' }}>
        <Space align="center">
          <WalletOutlined style={{ fontSize: 22, color: '#1677ff' }} />
          <Typography.Title level={3} style={{ margin: 0 }}>基金账本</Typography.Title>
        </Space>
        <Alert
          type="info"
          showIcon
          message="账本用于记录和对账。公对公付款由平台在线下银行渠道完成，本页面只登记付款结果，不会发起银行转账。"
        />

        <Card size="small" title="期间筛选">
          <Form form={filterForm} layout="inline" onFinish={applyDateFilter}>
            <Form.Item name="dates" label="发生时间">
              <RangePicker showTime format="YYYY-MM-DD HH:mm" allowClear />
            </Form.Item>
            <Form.Item>
              <Space>
                <Button type="primary" htmlType="submit">查询</Button>
                <Button icon={<ReloadOutlined />} onClick={() => { filterForm.resetFields(); setFilter({}); }}>重置</Button>
              </Space>
            </Form.Item>
          </Form>
        </Card>

        <Row gutter={[12, 12]}>
          <Col xs={12} md={4}><Card><Statistic title="产业基金累计计提" value={industry.accrued} precision={2} prefix="¥" /></Card></Col>
          <Col xs={12} md={4}><Card><Statistic title="公司待支付" value={industry.payable} precision={2} prefix="¥" /></Card></Col>
          <Col xs={12} md={4}><Card><Statistic title="售后冻结" value={industry.frozen} precision={2} prefix="¥" /></Card></Col>
          <Col xs={12} md={4}><Card><Statistic title="付款预留" value={industry.reserved} precision={2} prefix="¥" /></Card></Col>
          <Col xs={12} md={4}><Card><Statistic title="累计已支付" value={industry.paid} precision={2} prefix="¥" /></Card></Col>
          <Col xs={12} md={4}><Card><Statistic title="待追偿" value={industry.recoverable} precision={2} prefix="¥" valueStyle={{ color: industry.recoverable > 0 ? '#cf1322' : undefined }} /></Card></Col>
        </Row>

        {canReadUnified && <Card title="各基金账本" extra={summaryQuery.isError ? <Button onClick={() => summaryQuery.refetch()}>重试</Button> : null}>
          <ProTable
            rowKey="fundType"
            search={false}
            options={false}
            pagination={false}
            loading={summaryQuery.isLoading}
            dataSource={summaryRows}
            columns={fundColumns}
            locale={{ emptyText: summaryQuery.isError ? '加载失败，请重试' : '暂无基金账本' }}
          />
        </Card>}

        {canReadIndustry && <Divider orientation="left">产业基金公司账本</Divider>}
        {canReadIndustry && <Card title="公司子账" extra={<PermissionGate permission={PERMISSIONS.INDUSTRY_FUNDS_PAY}><Button type="primary" icon={<PlusOutlined />} onClick={openPaymentModal}>创建付款单</Button></PermissionGate>}>
          <ProTable<IndustryFundCompany>
            key={`${tableRevision}:${JSON.stringify(filter)}`}
            rowKey="id"
            search={{ labelWidth: 'auto' }}
            options={false}
            columns={companyColumns.map(c => ({ ...c, hideInSearch: c.dataIndex !== 'name' }))}
            request={async (params) => {
              try {
                const result = getRows<IndustryFundCompany>(await getIndustryFundCompanies({
                  page: Number(params.current ?? 1),
                  pageSize: Number(params.pageSize ?? 20),
                  from: filter.from,
                  to: filter.to,
                  status: typeof params.status === 'string' ? params.status : undefined,
                  search: typeof params.name === 'string' ? params.name : typeof params.companyName === 'string' ? params.companyName : undefined,
                }));
                return { data: result.items, success: true, total: result.total };
              } catch (error) {
                message.error(getAdminErrorMessage(error, '公司账本加载失败'));
                return { data: [], success: false, total: 0 };
              }
            }}
            pagination={{ defaultPageSize: 20, showSizeChanger: true }}
          />
        </Card>}

        {canReadIndustry && <Card title="待归属产业基金" extra={<Typography.Text type="secondary">无法解析公司时单列，不计入平台利润</Typography.Text>}>
          <ProTable<IndustryFundUnassignedEntry>
            key={`${tableRevision}:${JSON.stringify(filter)}`}
            rowKey="id"
            search={false}
            options={false}
            columns={[
              { title: '记录号', dataIndex: 'id', width: 220 },
              { title: '原计提', dataIndex: 'originalAmount', width: 120, render: (_, row) => money(row.originalAmount) },
              { title: '已冲回', dataIndex: 'reversedAmount', width: 120, render: (_, row) => money(row.reversedAmount) },
              { title: '金额', dataIndex: 'amount', width: 140, align: 'right', render: (_, row) => money(row.amount) },
              { title: '来源订单', dataIndex: 'orderId', width: 180, render: (_, row) => row.orderId || '-' },
              { title: '原因', dataIndex: 'reason', render: (_, row) => row.reason || '-' },
              { title: '发生时间', dataIndex: 'occurredAt', width: 180, render: (_, row) => dateTime(row.occurredAt || row.createdAt) },
            ]}
            request={async (params) => {
              try {
                const result = getRows<IndustryFundUnassignedEntry>(await getIndustryFundUnassigned({ page: Number(params.current ?? 1), pageSize: Number(params.pageSize ?? 20), from: filter.from, to: filter.to }));
                return { data: result.items, success: true, total: result.total };
              } catch (error) {
                message.error(getAdminErrorMessage(error, '待归属记录加载失败'));
                return { data: [], success: false, total: 0 };
              }
            }}
            pagination={{ defaultPageSize: 20, showSizeChanger: true }}
            expandable={{ expandedRowRender: row => <Space direction="vertical">{row.events?.map(e => <Typography.Text key={e.id}>{dateTime(e.createdAt)} · 累计冲回 {money(e.reversedBefore)} → {money(e.reversedAfter)}</Typography.Text>)}</Space> }}
            locale={{ emptyText: '暂无待归属记录' }}
          />
        </Card>}

        {canReadIndustry && <Divider orientation="left">公对公付款登记</Divider>}
        {canReadIndustry && <Card title="付款单" extra={<Typography.Text type="secondary">付款确认必须填写银行流水号和私有凭证</Typography.Text>}>
          <ProTable<IndustryFundPayment>
            key={`${tableRevision}:${JSON.stringify(filter)}`}
            rowKey="id"
            columns={paymentColumns.map(c => ({ ...c, hideInSearch: !['companyName', 'status'].includes(String(c.dataIndex)) }))}
            options={false}
            search={{ labelWidth: 'auto' }}
            request={async (params) => {
              try {
                const result = getRows<IndustryFundPayment>(await getIndustryFundPayments(dateParams(params)));
                return { data: result.items, success: true, total: result.total };
              } catch (error) {
                message.error(getAdminErrorMessage(error, '付款单加载失败'));
                return { data: [], success: false, total: 0 };
              }
            }}
            pagination={{ defaultPageSize: 20, showSizeChanger: true }}
          />
        </Card>}
      </Space>

      <Modal
        title="创建付款单并预留金额"
        open={paymentModalOpen}
        onCancel={() => { if (!paymentMutation.isPending) setPaymentModalOpen(false); }}
        onOk={() => paymentForm.submit()}
        confirmLoading={paymentMutation.isPending}
        destroyOnClose
        width={620}
      >
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 16 }}
          message="这里只创建付款登记单并预留公司可支付余额，不会调用银行转账接口。请核对对公收款资料后再在线下付款。"
        />
        <Form form={paymentForm} layout="vertical" onFinish={submitPayment} initialValues={{ idempotencyKey: makeIdempotencyKey() }}>
          <Form.Item name="companyId" label="收款公司" rules={[{ required: true, message: '请选择收款公司' }]}>
            <Select
              showSearch
              loading={companyOptionsQuery.isLoading}
              optionFilterProp="label"
              placeholder="选择公司"
              options={companies.map((company) => ({ value: company.id, label: `${company.name}${company.companyNo ? `（${company.companyNo}）` : ''}` }))}
            />
          </Form.Item>
          <Row gutter={12}>
            <Col span={12}><Form.Item name="amount" label="预留金额（元）" rules={[{ required: true, message: '请输入金额' }, { type: 'number', min: 0.01, message: '金额必须大于 0' }]}><InputNumber min={0.01} precision={2} style={{ width: '100%' }} /></Form.Item></Col>
            <Col span={12}><Form.Item name="payeeName" label="对公户名" rules={[{ required: true, message: '请输入对公户名' }]}><Input maxLength={200} /></Form.Item></Col>
          </Row>
          <Row gutter={12}>
            <Col span={12}><Form.Item name="bankAccount" label="对公账号" rules={[{ required: true, min: 6, message: '请输入完整对公账号' }]}><Input maxLength={80} /></Form.Item></Col>
            <Col span={12}><Form.Item name="bankName" label="开户行" rules={[{ required: true, message: '请输入开户行' }]}><Input maxLength={200} /></Form.Item></Col>
          </Row>
          <Form.Item name="reason" label="登记原因" rules={[{ required: true, message: '请输入登记原因' }]}><Input.TextArea rows={3} maxLength={500} showCount placeholder="例如：2026 年 9 月产业基金第一批公对公付款" /></Form.Item>
          <Form.Item name="idempotencyKey" hidden><Input /></Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
