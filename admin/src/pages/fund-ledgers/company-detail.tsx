import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ProTable } from '@ant-design/pro-components';
import type { ProColumns } from '@ant-design/pro-components';
import {
  Alert,
  App,
  Button,
  Card,
  Col,
  Form,
  Input,
  InputNumber,
  Modal,
  Result,
  Row,
  Skeleton,
  Space,
  Statistic,
  Typography,
} from 'antd';
import {
  createIndustryFundPayment,
  getIndustryFundCompany,
  getIndustryFundCompanyLedgers,
  type CreateIndustryFundPaymentInput,
  type FundLedgerEntry,
  type IndustryFundCompanyDetail,
} from '@/api/fund-ledgers';
import { PERMISSIONS } from '@/constants/permissions';
import PermissionGate from '@/components/PermissionGate';
import { getAdminErrorMessage } from '@/utils/adminErrorMessage';
import {
  dateTime,
  eventTag,
  getRows,
  money,
  signedMoney,
  sourceTag,
} from './common';

const makeIdempotencyKey = () => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
};

function readAmount(company: IndustryFundCompanyDetail | undefined, key: string): number {
  if (!company) return 0;
  const direct = company[key as keyof IndustryFundCompanyDetail];
  if (typeof direct === 'number') return direct;
  const nested = company.balances?.[key as keyof NonNullable<IndustryFundCompanyDetail['balances']>];
  return typeof nested === 'number' ? nested : 0;
}

function readString(company: IndustryFundCompanyDetail | undefined, key: string): string {
  if (!company) return '';
  const direct = company[key as keyof IndustryFundCompanyDetail];
  if (typeof direct === 'string') return direct;
  const nested = company.company?.[key];
  return typeof nested === 'string' ? nested : '';
}

export default function IndustryFundCompanyDetailPage() {
  const { message } = App.useApp();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [tableRevision, setTableRevision] = useState(0);
  const { id } = useParams<{ id: string }>();
  const [paymentForm] = Form.useForm<CreateIndustryFundPaymentInput>();
  const [paymentModalOpen, setPaymentModalOpen] = useState(false);

  const companyQuery = useQuery({
    queryKey: ['admin', 'industry-funds', 'company', id],
    queryFn: () => getIndustryFundCompany(id!),
    enabled: !!id,
  });

  const paymentMutation = useMutation({
    mutationFn: createIndustryFundPayment,
    onSuccess: () => {
      setTableRevision(r => r + 1);
      message.success('付款单已创建并预留金额');
      setPaymentModalOpen(false);
      paymentForm.resetFields();
      queryClient.invalidateQueries({ queryKey: ['admin', 'industry-funds'] });
      queryClient.invalidateQueries({ queryKey: ['admin', 'fund-ledgers'] });
    },
    onError: (error) => message.error(getAdminErrorMessage(error, '创建付款单失败')),
  });

  const company = companyQuery.data;
  const initialPayee = useMemo(() => ({
    payeeName: readString(company, 'bankAccountName') || readString(company, 'name'),
    bankAccount: readString(company, 'bankAccount') || readString(company, 'bankAccountNoMasked'),
    bankName: readString(company, 'bankName'),
  }), [company]);

  if (companyQuery.isLoading) return <Card style={{ margin: 24 }}><Skeleton active /></Card>;
  if (companyQuery.isError || !company) {
    return <Result status="error" title="公司账本加载失败" subTitle={getAdminErrorMessage(companyQuery.error, '暂时无法读取该公司账本')} extra={<Space><Button onClick={() => companyQuery.refetch()}>重试</Button><Button onClick={() => navigate('/fund-ledgers')}>返回基金总览</Button></Space>} />;
  }

  const openPaymentModal = () => {
    paymentForm.resetFields();
    paymentForm.setFieldsValue({
      companyId: company.id,
      ...initialPayee,
      idempotencyKey: makeIdempotencyKey(),
    });
    setPaymentModalOpen(true);
  };

  const columns: ProColumns<FundLedgerEntry>[] = [
    { title: '流水号', dataIndex: 'entryNo', width: 190, render: (_, row) => <Link to={`/fund-ledgers/entries/INDUSTRY_FUND/${row.id}`}>{row.entryNo || row.id}</Link> },
    { title: '事件', dataIndex: 'eventType', width: 110, render: (_, row) => eventTag(row.eventType) },
    { title: '来源', dataIndex: 'sourceType', width: 100, render: (_, row) => sourceTag(row.sourceType) },
    { title: '金额', dataIndex: 'amount', width: 130, align: 'right', render: (_, row) => signedMoney(row.amount, row.direction) },
    { title: '余额后', dataIndex: 'balanceAfter', width: 130, align: 'right', render: (_, row) => money(row.balanceAfter) },
    { title: '待追偿后', dataIndex: 'recoveryDueAfter', width: 120, align: 'right', render: (_, row) => money(row.recoveryDueAfter) },
    { title: '冻结后', dataIndex: 'frozenAfter', width: 120, align: 'right', render: (_, row) => money(row.frozenAfter) },
    { title: '预留后', dataIndex: 'reservedAfter', width: 120, align: 'right', render: (_, row) => money(row.reservedAfter) },
    { title: '订单', dataIndex: 'orderId', width: 170, render: (value) => value || '-' },
    { title: '付款单', dataIndex: 'paymentId', width: 170, render: (value) => value ? <Link to={`/fund-ledgers/payments/${value}`}>{value}</Link> : '-' },
    { title: '时间', dataIndex: 'createdAt', width: 175, render: (_, row) => dateTime(row.createdAt) },
  ];

  const handleSubmit = async (values: CreateIndustryFundPaymentInput) => {
    const idempotencyKey = values.idempotencyKey?.trim();
    if (!idempotencyKey) {
      message.error('付款单幂等键缺失，请关闭后重新打开表单');
      return;
    }
    await paymentMutation.mutateAsync({
      ...values,
      amount: Number(values.amount),
      companyId: company.id,
      payeeName: values.payeeName.trim(),
      bankAccount: values.bankAccount.trim(),
      bankName: values.bankName.trim(),
      reason: values.reason.trim(),
      idempotencyKey,
    });
  };

  return (
    <div style={{ padding: 24 }}>
      <Space direction="vertical" size={16} style={{ width: '100%' }}>
        <Space>
          <Button onClick={() => navigate('/fund-ledgers')}>返回基金总览</Button>
          <Typography.Title level={3} style={{ margin: 0 }}>公司产业基金账本</Typography.Title>
        </Space>
        <Alert type="warning" showIcon message="公司账本是平台对公司的应付记录。收款主体为公司，不是公司 OWNER 个人；付款页面只登记线下公对公付款。" />
        <Card title={company.name || company.companyNo || company.id} extra={<PermissionGate permission={PERMISSIONS.INDUSTRY_FUNDS_PAY}><Button type="primary" onClick={openPaymentModal}>创建付款单</Button></PermissionGate>}>
          <Row gutter={[12, 12]}>
            <Col xs={12} md={4}><Statistic title="累计计提" value={readAmount(company, 'accrued')} precision={2} prefix="¥" /></Col>
            <Col xs={12} md={4}><Statistic title="售后冻结" value={readAmount(company, 'frozen')} precision={2} prefix="¥" /></Col>
            <Col xs={12} md={4}><Statistic title="可支付" value={readAmount(company, 'available')} precision={2} prefix="¥" /></Col>
            <Col xs={12} md={4}><Statistic title="付款预留" value={readAmount(company, 'reserved')} precision={2} prefix="¥" /></Col>
            <Col xs={12} md={4}><Statistic title="累计已支付" value={readAmount(company, 'paid')} precision={2} prefix="¥" /></Col>
            <Col xs={12} md={4}><Statistic title="待追偿" value={readAmount(company, 'recoverable')} precision={2} prefix="¥" valueStyle={{ color: readAmount(company, 'recoverable') > 0 ? '#cf1322' : undefined }} /></Col>
          </Row>
          <DescriptionsBlock company={company} />
        </Card>
        <Card title="付款与异常" size="small">
          <Space wrap>
            <Link to={`/fund-ledgers?companyId=${encodeURIComponent(company.id)}`}>查看该公司付款单</Link>
            <Link to={`/fund-ledgers/INDUSTRY_FUND?companyId=${encodeURIComponent(company.id)}&eventType=REVERSAL_PENDING`}>查看待处理冲回</Link>
          </Space>
        </Card>
        <Card title="计提与变动明细">
          <ProTable<FundLedgerEntry>
            key={tableRevision}
            rowKey="id"
            columns={columns}
            options={false}
            search={false}
            scroll={{ x: 1500 }}
            request={async (params) => {
              try {
                const result = getRows<FundLedgerEntry>(await getIndustryFundCompanyLedgers(company.id, { page: Number(params.current ?? 1), pageSize: Number(params.pageSize ?? 20) }));
                return { data: result.items, success: true, total: result.total };
              } catch (error) {
                message.error(getAdminErrorMessage(error, '公司流水加载失败'));
                return { data: [], success: false, total: 0 };
              }
            }}
            pagination={{ defaultPageSize: 20, showSizeChanger: true }}
            locale={{ emptyText: '暂无公司账本流水' }}
          />
        </Card>
      </Space>

      <Modal title="创建付款单并预留金额" open={paymentModalOpen} onCancel={() => { if (!paymentMutation.isPending) setPaymentModalOpen(false); }} onOk={() => paymentForm.submit()} confirmLoading={paymentMutation.isPending} destroyOnClose width={620}>
        <Alert type="warning" showIcon style={{ marginBottom: 16 }} message="仅登记线下付款流程，不会调用银行转账接口。请确保公司名称、开户行和对公账号与银行资料一致。" />
        <Form form={paymentForm} layout="vertical" onFinish={handleSubmit}>
          <Form.Item name="companyId" hidden><Input /></Form.Item>
          <Form.Item name="amount" label="预留金额（元）" rules={[{ required: true, message: '请输入金额' }, { type: 'number', min: 0.01, message: '金额必须大于 0' }]}><InputNumber min={0.01} precision={2} style={{ width: '100%' }} /></Form.Item>
          <Row gutter={12}>
            <Col span={12}><Form.Item name="payeeName" label="对公户名" rules={[{ required: true, message: '请输入对公户名' }]}><Input maxLength={200} /></Form.Item></Col>
            <Col span={12}><Form.Item name="bankName" label="开户行" rules={[{ required: true, message: '请输入开户行' }]}><Input maxLength={200} /></Form.Item></Col>
          </Row>
          <Form.Item name="bankAccount" label="对公账号" rules={[{ required: true, min: 6, message: '请输入完整对公账号' }]}><Input maxLength={80} /></Form.Item>
          <Form.Item name="reason" label="登记原因" rules={[{ required: true, message: '请输入登记原因' }]}><Input.TextArea rows={3} maxLength={500} showCount /></Form.Item>
          <Form.Item name="idempotencyKey" hidden><Input /></Form.Item>
        </Form>
      </Modal>
    </div>
  );
}

function DescriptionsBlock({ company }: { company: IndustryFundCompanyDetail }) {
  const bankAccount = readString(company, 'bankAccountNoMasked') || readString(company, 'bankAccount');
  return (
    <div style={{ marginTop: 16 }}>
      <Typography.Text type="secondary">对公资料（列表仅显示脱敏账号）</Typography.Text>
      <Row gutter={[16, 8]} style={{ marginTop: 8 }}>
        <Col xs={24} md={8}><Typography.Text>企业编号：{company.companyNo || '-'}</Typography.Text></Col>
        <Col xs={24} md={8}><Typography.Text>收款户名：{readString(company, 'bankAccountName') || '-'}</Typography.Text></Col>
        <Col xs={24} md={8}><Typography.Text>开户行：{readString(company, 'bankName') || '-'}</Typography.Text></Col>
        <Col xs={24} md={8}><Typography.Text>账号：{bankAccount || '-'}</Typography.Text></Col>
        <Col xs={24} md={8}><Typography.Text>企业状态：{company.status || '-'}</Typography.Text></Col>
      </Row>
    </div>
  );
}
