import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import {
  Alert,
  App,
  Button,
  Card,
  Checkbox,
  Descriptions,
  Divider,
  Drawer,
  Form,
  Input,
  InputNumber,
  Select,
  Space,
  Spin,
  Typography,
} from 'antd';
import {
  cancelIndustryFundPayment,
  createIndustryFundPayment,
  getIndustryFundCompanies,
  getIndustryFundPayment,
  type CancelIndustryFundPaymentInput,
  type CreateIndustryFundPaymentInput,
  type IndustryFundCompany,
  type IndustryFundPayment,
} from '@/api/fund-ledgers';
import { getAdminErrorMessage } from '@/utils/adminErrorMessage';
import { getRows, money } from './common';

export interface PaymentCreateDrawerProps {
  open: boolean;
  initialCompanyId?: string;
  correctionPayment?: IndustryFundPayment | null;
  correctionPaymentId?: string;
  onClose: () => void;
  onCreated: (payment: IndustryFundPayment) => void;
}

type PaymentFormValues = CreateIndustryFundPaymentInput & {
  confirmUnpaid?: boolean;
};

type UnknownStage = 'cancel' | 'create' | null;

const makeIdempotencyKey = () => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
};

function companyName(company?: IndustryFundCompany | { id?: string; name?: string } | null): string {
  return company?.name || company?.id || '';
}

function balance(company: IndustryFundCompany | undefined, key: 'available' | 'recoverable'): number {
  const value = company?.[key] ?? company?.balances?.[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function isActive(company: IndustryFundCompany | undefined): boolean {
  return company?.status === 'ACTIVE';
}

function blockedReason(company: IndustryFundCompany | undefined, releaseAmount = 0): string | null {
  if (!company) return '请选择收款公司';
  if (!isActive(company)) return `公司当前状态为“${company.status || '未知'}”，暂不允许登记付款`;
  const due = balance(company, 'recoverable');
  if (due > 0) return `该公司存在待追偿 ${money(due)}，请先登记实际回款`;
  if (balance(company, 'available') + releaseAmount <= 0) return '该公司暂无可支付余额';
  return null;
}

function maskAccount(value?: string | null): string {
  if (!value) return '未填写';
  if (value.startsWith('****')) return value;
  return value.length > 4 ? `****${value.slice(-4)}` : value;
}

function isUnknownResult(error: unknown): boolean {
  const candidate = error as { status?: number } | undefined;
  // Only an explicit client/business rejection proves that the command failed.
  // A network failure or server/gateway error may follow a committed transaction.
  return !candidate?.status || candidate.status < 400 || candidate.status >= 500;
}

function paymentCompany(payment?: IndustryFundPayment | null): IndustryFundCompany | undefined {
  if (!payment?.companyId) return undefined;
  return {
    id: payment.companyId,
    name: companyName(payment.company) || payment.companyId,
    status: 'ACTIVE',
  };
}

export default function PaymentCreateDrawer({
  open,
  initialCompanyId,
  correctionPayment,
  correctionPaymentId,
  onClose,
  onCreated,
}: PaymentCreateDrawerProps) {
  const { message, modal } = App.useApp();
  const [form] = Form.useForm<PaymentFormValues>();
  const selectedCompanyId = Form.useWatch('companyId', form) as string | undefined;
  const selectedAmount = Form.useWatch('amount', form) as number | undefined;
  const selectedPayeeName = Form.useWatch('payeeName', form) as string | undefined;
  const selectedBankName = Form.useWatch('bankName', form) as string | undefined;
  const selectedBankAccount = Form.useWatch('bankAccount', form) as string | undefined;
  const [companySearch, setCompanySearch] = useState('');
  const [selectedCompanySnapshot, setSelectedCompanySnapshot] = useState<IndustryFundCompany | undefined>();
  const [correctionCancelled, setCorrectionCancelled] = useState(false);
  const [releasedAmount, setReleasedAmount] = useState(0);
  const [releasedBalanceReflected, setReleasedBalanceReflected] = useState(false);
  const [unknownStage, setUnknownStage] = useState<UnknownStage>(null);
  const [operationError, setOperationError] = useState<string | null>(null);
  const initializedKey = useRef('');
  const createKeyRef = useRef('');
  const cancelKeyRef = useRef('');
  const createPayloadRef = useRef<CreateIndustryFundPaymentInput | null>(null);
  const cancelPayloadRef = useRef<CancelIndustryFundPaymentInput | null>(null);

  const activeCorrectionId = correctionPaymentId || correctionPayment?.id;
  const correctionQuery = useQuery({
    queryKey: ['admin', 'industry-funds', 'payment', 'correction-source', activeCorrectionId],
    queryFn: () => getIndustryFundPayment(activeCorrectionId!),
    enabled: open && !!activeCorrectionId,
  });
  const sourcePayment = correctionQuery.data || correctionPayment || null;
  const sourceCompanyId = sourcePayment?.companyId;

  const companyQuery = useQuery({
    queryKey: ['admin', 'industry-funds', 'companies', 'payment-selector', companySearch, initialCompanyId, sourceCompanyId],
    queryFn: async () => getRows<IndustryFundCompany>(await getIndustryFundCompanies({
      page: 1,
      pageSize: 20,
      search: companySearch.trim() || undefined,
      companyId: companySearch.trim() ? undefined : (initialCompanyId || sourceCompanyId || undefined),
    })),
    enabled: open,
    staleTime: 15_000,
  });

  const fallbackSourceCompany = useMemo(() => paymentCompany(sourcePayment), [sourcePayment]);
  const companies = useMemo(() => {
    const rows = companyQuery.data?.items || [];
    const selectedFallback = selectedCompanySnapshot && !rows.some(row => row.id === selectedCompanySnapshot.id)
      ? [selectedCompanySnapshot]
      : [];
    const sourceFallback = fallbackSourceCompany && !rows.some(row => row.id === fallbackSourceCompany.id) && !selectedFallback.some(row => row.id === fallbackSourceCompany.id)
      ? [fallbackSourceCompany]
      : [];
    return [...selectedFallback, ...sourceFallback, ...rows];
  }, [companyQuery.data?.items, fallbackSourceCompany, selectedCompanySnapshot]);
  const selectedCompany = companies.find(company => company.id === selectedCompanyId);
  const correction = !!activeCorrectionId;
  const releaseAmount = correction && sourcePayment && selectedCompanyId === sourcePayment.companyId
    ? (correctionCancelled ? (releasedBalanceReflected ? 0 : releasedAmount) : Number(sourcePayment.amount || 0))
    : 0;
  const availableLimit = balance(selectedCompany, 'available') + releaseAmount;
  const selectedBlockedReason = blockedReason(selectedCompany, releaseAmount);
  const accountNeedsReentry = !!sourcePayment?.bankAccount && sourcePayment.bankAccount.startsWith('****');

  const createMutation = useMutation({ mutationFn: createIndustryFundPayment });
  const cancelMutation = useMutation({
    mutationFn: ({ paymentId, input }: { paymentId: string; input: CancelIndustryFundPaymentInput }) =>
      cancelIndustryFundPayment(paymentId, input),
  });
  const submitting = createMutation.isPending || cancelMutation.isPending;
  const formFrozen = !!unknownStage;

  useEffect(() => {
    if (!open) {
      initializedKey.current = '';
      return;
    }
    if (correction && correctionQuery.isLoading) return;
    const sourceVersion = correctionQuery.data ? 'detail' : 'row';
    const sessionKey = `${correction ? `correction:${activeCorrectionId}:${sourceVersion}` : `new:${initialCompanyId || ''}`}`;
    if (initializedKey.current === sessionKey) return;
    initializedKey.current = sessionKey;
    createKeyRef.current = makeIdempotencyKey();
    cancelKeyRef.current = makeIdempotencyKey();
    createPayloadRef.current = null;
    cancelPayloadRef.current = null;
    // A new drawer session intentionally resets local workflow state from its URL/props.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setCorrectionCancelled(false);
    setReleasedAmount(0);
    setReleasedBalanceReflected(false);
    setSelectedCompanySnapshot(undefined);
    setUnknownStage(null);
    setOperationError(null);
    setCompanySearch('');
    const companyId = sourcePayment?.companyId || initialCompanyId || '';
    const sourceAccount = sourcePayment?.bankAccount && !sourcePayment.bankAccount.startsWith('****') ? sourcePayment.bankAccount : '';
    form.setFieldsValue({
      companyId,
      amount: sourcePayment?.amount,
      payeeName: sourcePayment?.payeeName || companyName(sourcePayment?.company) || '',
      bankAccount: sourceAccount,
      bankName: sourcePayment?.bankName || '',
      reason: correction
        ? `更正未付款单 ${sourcePayment?.paymentNo || activeCorrectionId}`
        : '',
      idempotencyKey: createKeyRef.current,
      confirmUnpaid: false,
    });
  }, [activeCorrectionId, correction, correctionQuery.data, correctionQuery.isLoading, form, initialCompanyId, open, sourcePayment]);

  useEffect(() => {
    if (!open || !selectedCompanyId || correctionQuery.isLoading) return;
    const name = selectedCompany?.name || fallbackSourceCompany?.name;
    if (name && form.getFieldValue('payeeName') !== name && !correctionCancelled) {
      form.setFieldsValue({ payeeName: name });
    }
  }, [correctionCancelled, correctionQuery.isLoading, fallbackSourceCompany?.name, form, open, selectedCompany?.name, selectedCompanyId]);

  const handleError = (error: unknown, fallback: string) => {
    const text = getAdminErrorMessage(error, fallback);
    setOperationError(text);
    message.error(text);
  };

  const runCreate = async (payload: CreateIndustryFundPaymentInput): Promise<boolean> => {
    createPayloadRef.current = payload;
    try {
      const result = await createMutation.mutateAsync(payload);
      setUnknownStage(null);
      setOperationError(null);
      message.success('付款单已创建并预留金额');
      onCreated(result);
      return true;
    } catch (error) {
      if (isUnknownResult(error)) {
        setUnknownStage('create');
        setOperationError('创建请求结果未知。已冻结原输入和幂等键，请用相同幂等键重试或先读取付款列表确认。');
      } else {
        handleError(error, '创建付款单失败');
      }
      return false;
    }
  };

  const runCancel = async (payload: CancelIndustryFundPaymentInput): Promise<boolean> => {
    if (!activeCorrectionId) return false;
    cancelPayloadRef.current = payload;
    try {
      await cancelMutation.mutateAsync({ paymentId: activeCorrectionId, input: payload });
      setCorrectionCancelled(true);
      setReleasedAmount(Number(sourcePayment?.amount || 0));
      setUnknownStage(null);
      setOperationError(null);
      const refreshed = await companyQuery.refetch();
      const refreshedCompany = refreshed.data?.items.find(item => item.id === sourcePayment?.companyId);
      // A successful company read is authoritative even when another ledger event
      // changes the available balance at the same time. Never add the released
      // amount on top of a fresh balance that already includes that event.
      setReleasedBalanceReflected(!!refreshedCompany);
      message.success('旧付款单已取消，原预留已释放');
      return true;
    } catch (error) {
      if (isUnknownResult(error)) {
        setUnknownStage('cancel');
        setOperationError('取消请求结果未知。已冻结原输入和幂等键，请用相同幂等键重试或先读取付款列表确认。');
      } else {
        handleError(error, '取消旧付款单失败');
      }
      return false;
    }
  };

  const submit = async (values: PaymentFormValues) => {
    if (unknownStage === 'create' && createPayloadRef.current) {
      await runCreate(createPayloadRef.current);
      return;
    }
    if (unknownStage === 'cancel' && cancelPayloadRef.current) {
      const cancelled = await runCancel(cancelPayloadRef.current);
      if (cancelled && createPayloadRef.current) await runCreate(createPayloadRef.current);
      return;
    }
    if (submitting) return;
    const company = companies.find(item => item.id === values.companyId);
    const amount = Number(values.amount);
    const reason = values.reason?.trim();
    const payload: CreateIndustryFundPaymentInput = {
      companyId: values.companyId?.trim(),
      amount,
      payeeName: values.payeeName?.trim(),
      bankAccount: values.bankAccount?.trim(),
      bankName: values.bankName?.trim(),
      reason: reason || '',
      idempotencyKey: createKeyRef.current || values.idempotencyKey,
    };
    if (!payload.idempotencyKey) {
      message.error('付款单幂等键缺失，请关闭后重新打开表单');
      return;
    }
    const reasonForBlock = blockedReason(company, correction && company?.id === sourceCompanyId ? releaseAmount : 0);
    if (reasonForBlock) {
      message.error(reasonForBlock);
      return;
    }
    if (!Number.isFinite(amount) || amount <= 0 || amount > availableLimit) {
      message.error(`金额需大于零且不超过可支付余额 ${money(availableLimit)}`);
      return;
    }
    if (correction && !correctionCancelled) {
      if (!values.confirmUnpaid) {
        message.error('请先勾选已核实旧付款单尚未实际转账');
        return;
      }
      if (!sourcePayment || !['RESERVED', 'PAYMENT_RESERVED'].includes(sourcePayment.status)) {
        message.error('这笔付款单已经不是待付款状态，不能按未付款单更正');
        return;
      }
      createPayloadRef.current = payload;
      const cancelled = await runCancel({
        reason: reason || `更正未付款单 ${sourcePayment.paymentNo || sourcePayment.id}`,
        idempotencyKey: cancelKeyRef.current,
      });
      if (!cancelled) return;
    }
    await runCreate(payload);
  };

  const handleClose = () => {
    if (submitting) return;
    if (unknownStage) {
      message.warning('请求结果未知，请使用相同幂等键重试或先读取付款列表确认');
      return;
    }
    if (!form.isFieldsTouched() && !correctionCancelled) {
      onClose();
      return;
    }
    modal.confirm({
      title: correctionCancelled ? '旧付款单已取消，确定离开吗？' : '放弃未提交的付款单？',
      content: correctionCancelled
        ? '旧付款单已经取消，新付款单尚未创建；关闭后仍可从付款列表重新发起。'
        : '已填写的内容不会保存。',
      okText: '离开',
      cancelText: '继续填写',
      onOk: onClose,
    });
  };

  const title = correction ? '更正未付款单' : '新建付款单';
  const sourceLoading = correction && correctionQuery.isLoading;
  const sourceError = correction && correctionQuery.isError;

  return (
    <Drawer
      title={title}
      open={open}
      onClose={handleClose}
      width="min(720px, 100vw)"
      destroyOnClose
      maskClosable={false}
      footer={(
        <Space style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <Button onClick={handleClose} disabled={submitting || !!unknownStage}>取消</Button>
          <Button
            type="primary"
            loading={submitting}
            disabled={formFrozen || !!selectedBlockedReason || sourceLoading || sourceError}
            onClick={() => form.submit()}
          >
            {unknownStage ? '使用相同幂等键重试' : correction && !correctionCancelled ? '确认未付款并创建' : '创建并预留'}
          </Button>
        </Space>
      )}
    >
      <Typography.Paragraph type="secondary">
        创建付款单只登记线下公对公付款，并预留公司可支付余额，不会调用银行转账接口。
      </Typography.Paragraph>
      {unknownStage && (
        <Alert
          type="warning"
          showIcon
          closable={false}
          message="请求结果未知，已冻结本次提交"
          description={operationError || '请用相同幂等键重试，或先读取付款列表确认是否已经创建。'}
          action={<Button size="small" onClick={() => form.submit()}>相同幂等键重试</Button>}
          style={{ marginBottom: 16 }}
        />
      )}
      {correctionCancelled && !unknownStage && (
        <Alert
          type="warning"
          showIcon
          message="旧付款单已取消，新付款单尚未创建"
          description={<>原付款单历史已保留，原预留已释放。请核对资料后重试创建；这不是原子替换。{operationError && <><br />最近一次创建失败：{operationError}</>}</>}
          style={{ marginBottom: 16 }}
        />
      )}
      {operationError && !unknownStage && !correctionCancelled && (
        <Alert type="error" showIcon message="操作未完成" description={operationError} style={{ marginBottom: 16 }} />
      )}
      {sourceError && (
        <Alert type="error" showIcon message="原付款单读取失败" description={getAdminErrorMessage(correctionQuery.error, '暂时无法读取原付款单，请重试')} action={<Button onClick={() => correctionQuery.refetch()}>重试</Button>} style={{ marginBottom: 16 }} />
      )}
      {sourceLoading ? (
        <Space style={{ width: '100%', justifyContent: 'center', padding: 60 }}><Spin /></Space>
      ) : (
        <Form form={form} layout="vertical" onFinish={submit} disabled={formFrozen || submitting}>
          {correction && (
            <Alert
              type="info"
              showIcon
              message="更正流程会先取消旧单，再创建新单"
              description="只有明确核实旧付款单尚未在线下银行转账后，才会取消旧单。已登记付款的历史记录不能直接编辑金额。"
              style={{ marginBottom: 16 }}
            />
          )}
          {companyQuery.isError && <Alert type="error" showIcon message="公司查询失败" description="请重试后再选择收款公司。" action={<Button onClick={() => companyQuery.refetch()}>重试</Button>} style={{ marginBottom: 16 }} />}
          {correction && (
            <Form.Item
              name="confirmUnpaid"
              valuePropName="checked"
              rules={[{ validator: (_, value: boolean) => value ? Promise.resolve() : Promise.reject(new Error('请确认旧付款单尚未实际转账')) }]}
            >
              <Checkbox>我已核实旧付款单尚未在线下银行付款</Checkbox>
            </Form.Item>
          )}

          <Typography.Title level={5}>选择公司与金额</Typography.Title>
          <Form.Item name="companyId" label="收款公司" rules={[{ required: true, message: '请选择收款公司' }]}>
            <Select
              showSearch
              filterOption={false}
              onSearch={setCompanySearch}
              onChange={(value: string) => {
                const company = companies.find(item => item.id === value);
                setSelectedCompanySnapshot(company);
                form.setFieldsValue({ payeeName: company?.name || '' });
              }}
              loading={companyQuery.isLoading}
              notFoundContent={companyQuery.isError ? '公司查询失败' : '没有匹配的公司'}
              placeholder="输入公司名称搜索"
              options={companies.map(company => {
                const due = balance(company, 'recoverable');
                const available = balance(company, 'available');
                const canRelease = correction && company.id === sourceCompanyId && !correctionCancelled ? Number(sourcePayment?.amount || 0) : 0;
                const reason = blockedReason(company, canRelease);
                return {
                  value: company.id,
                  label: `${company.name}${company.status !== 'ACTIVE' ? ` · ${company.status || '不可用'}` : ''}${due > 0 ? ` · 待追偿 ${money(due)}` : ` · 可支付 ${money(available + canRelease)}`}`,
                  disabled: !!reason && reason !== '该公司暂无可支付余额',
                };
              })}
            />
          </Form.Item>
          {selectedCompany && (
            <Card size="small" style={{ marginBottom: 16, background: '#f8fafc' }}>
              <Descriptions size="small" column={2}>
                <Descriptions.Item label="可支付">{money(availableLimit)}</Descriptions.Item>
                <Descriptions.Item label="待追偿">{money(balance(selectedCompany, 'recoverable'))}</Descriptions.Item>
              </Descriptions>
              {releaseAmount > 0 && !correctionCancelled && <Typography.Text type="secondary">金额包含取消旧单后预计释放的 {money(releaseAmount)}。</Typography.Text>}
              {selectedBlockedReason && <Alert type="warning" showIcon message={selectedBlockedReason} style={{ marginTop: 12 }} />}
            </Card>
          )}
          <Form.Item
            name="amount"
            label="预留金额（元）"
            rules={[{ required: true, message: '请输入金额' }, { type: 'number', min: 0.01, message: '金额必须大于 0' }, { validator: () => selectedAmount === undefined || selectedAmount <= availableLimit ? Promise.resolve() : Promise.reject(new Error(`金额不能超过可支付余额 ${money(availableLimit)}`)) }]}
          >
            <InputNumber min={0.01} precision={2} style={{ width: '100%' }} disabled={!selectedCompanyId} />
          </Form.Item>

          <Divider />
          <Typography.Title level={5}>核对对公资料</Typography.Title>
          {accountNeedsReentry && <Alert type="warning" showIcon message="原付款单账号仅返回脱敏值，请重新核对并填写完整对公账号" style={{ marginBottom: 16 }} />}
          <Form.Item name="payeeName" label="对公户名" rules={[{ required: true, message: '请选择公司后确认对公户名' }]}>
            <Input readOnly placeholder="按公司主体自动填写" />
          </Form.Item>
          <Form.Item name="bankName" label="开户行" rules={[{ required: true, message: '请输入开户行' }]}>
            <Input maxLength={200} placeholder="填写开户行" />
          </Form.Item>
          <Form.Item name="bankAccount" label="对公账号" rules={[{ required: true, min: 6, max: 80, message: '请输入完整对公账号' }]}>
            <Input maxLength={80} inputMode="numeric" placeholder="填写完整对公账号" />
          </Form.Item>

          <Divider />
          <Typography.Title level={5}>登记原因与确认摘要</Typography.Title>
          <Form.Item name="reason" label="登记原因" rules={[{ required: true, message: '请输入登记原因' }, { max: 500, message: '登记原因不能超过 500 字' }]}>
            <Input.TextArea rows={3} maxLength={500} showCount placeholder="例如：2026 年 9 月产业基金第一批公对公付款" />
          </Form.Item>
          <Card size="small" title="提交摘要" style={{ background: '#f8fafc' }}>
            <Descriptions size="small" column={1}>
              <Descriptions.Item label="收款公司">{selectedCompany?.name || '未选择'}</Descriptions.Item>
              <Descriptions.Item label="金额">{selectedAmount ? money(selectedAmount) : '未填写'}</Descriptions.Item>
              <Descriptions.Item label="对公户名">{selectedPayeeName || '未填写'}</Descriptions.Item>
              <Descriptions.Item label="开户行">{selectedBankName || '未填写'}</Descriptions.Item>
              <Descriptions.Item label="账号">{maskAccount(selectedBankAccount)}</Descriptions.Item>
            </Descriptions>
            <Typography.Text type="secondary">提交后将建立付款单并预留余额；付款结果需在详情页另行登记。</Typography.Text>
          </Card>
          <Form.Item name="idempotencyKey" hidden><Input /></Form.Item>
        </Form>
      )}
    </Drawer>
  );
}
