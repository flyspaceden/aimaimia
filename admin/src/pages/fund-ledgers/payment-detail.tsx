import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useParams, Link, useSearchParams } from 'react-router-dom';
import {
  Alert,
  App,
  Button,
  Card,
  Checkbox,
  DatePicker,
  Descriptions,
  Form,
  Input,
  InputNumber,
  Modal,
  Result,
  Skeleton,
  Space,
  Table,
  Typography,
  Upload,
} from 'antd';
import type { UploadFile, UploadProps } from 'antd';
import { DownloadOutlined, ExclamationCircleOutlined, UploadOutlined } from '@ant-design/icons';
import dayjs, { type Dayjs } from 'dayjs';
import {
  cancelIndustryFundPayment,
  confirmIndustryFundPayment,
  createIndustryFundRecovery,
  downloadIndustryFundProof,
  getIndustryFundPayment,
  reverseIndustryFundPayment,
  uploadIndustryFundProof,
  type CancelIndustryFundPaymentInput,
  type ConfirmIndustryFundPaymentInput,
  type RecoveryInput,
  type ReverseIndustryFundPaymentInput,
} from '@/api/fund-ledgers';
import { PERMISSIONS } from '@/constants/permissions';
import PermissionGate from '@/components/PermissionGate';
import { getAdminErrorMessage } from '@/utils/adminErrorMessage';
import { dateTime, eventTag, money, paymentStatusTag } from './common';
import { fundLink, safeFundReturn } from './workspace-state';

const makeIdempotencyKey = () => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
};

type ConfirmFormValues = Omit<ConfirmIndustryFundPaymentInput, 'paidAt'> & { paidAt: Dayjs };
type RecoveryFormValues = Omit<RecoveryInput, 'recoveredAt'> & { recoveredAt: Dayjs };

export default function IndustryFundPaymentDetailPage() {
  const { message } = App.useApp();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { id } = useParams<{ id: string }>();
  const [searchParams] = useSearchParams();
  const returnTo = safeFundReturn(searchParams.get('returnTo'));
  const [confirmForm] = Form.useForm<ConfirmFormValues>();
  const [cancelForm] = Form.useForm<CancelIndustryFundPaymentInput>();
  const [reverseForm] = Form.useForm<ReverseIndustryFundPaymentInput>();
  const [recoveryForm] = Form.useForm<RecoveryFormValues>();
  const [modal, setModal] = useState<'confirm' | 'cancel' | 'reverse' | 'recovery' | null>(null);
  const [proofFileList, setProofFileList] = useState<UploadFile[]>([]);
  const [proofKey, setProofKey] = useState<string>('');
  const [proofUploading, setProofUploading] = useState(false);
  const uploadGeneration = useRef(0);

  const paymentQuery = useQuery({
    queryKey: ['admin', 'industry-funds', 'payment', id],
    queryFn: () => getIndustryFundPayment(id!),
    enabled: !!id,
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['admin', 'industry-funds'] });
    queryClient.invalidateQueries({ queryKey: ['admin', 'fund-ledgers'] });
    paymentQuery.refetch();
  };
  const handleError = (error: unknown, fallback: string) => message.error(getAdminErrorMessage(error, fallback));
  const confirmMutation = useMutation({ mutationFn: (input: ConfirmIndustryFundPaymentInput) => confirmIndustryFundPayment(id!, input), onSuccess: () => { message.success('已登记线下付款'); setModal(null); invalidate(); }, onError: (error) => handleError(error, '付款确认失败') });
  const cancelMutation = useMutation({ mutationFn: (input: CancelIndustryFundPaymentInput) => cancelIndustryFundPayment(id!, input), onSuccess: () => { message.success('付款预留已取消'); setModal(null); invalidate(); }, onError: (error) => handleError(error, '取消付款预留失败') });
  const reverseMutation = useMutation({ mutationFn: (input: ReverseIndustryFundPaymentInput) => reverseIndustryFundPayment(id!, input), onSuccess: () => { message.success('付款登记已冲正'); setModal(null); invalidate(); }, onError: (error) => handleError(error, '付款冲正失败') });
  const recoveryMutation = useMutation({ mutationFn: (input: RecoveryInput) => createIndustryFundRecovery(id!, input), onSuccess: () => { message.success('实际回款已登记'); setModal(null); invalidate(); }, onError: (error) => handleError(error, '实际回款登记失败') });

  useEffect(() => {
    if (!modal) {
      uploadGeneration.current += 1;
      setProofKey('');
      setProofFileList([]);
      setProofUploading(false);
      confirmForm.resetFields();
      recoveryForm.resetFields();
    }
  }, [modal, confirmForm, recoveryForm]);

  if (paymentQuery.isLoading) return <Card style={{ margin: 24 }}><Skeleton active /></Card>;
  if (paymentQuery.isError || !paymentQuery.data) {
    return <Result status="error" title="付款单加载失败" subTitle={getAdminErrorMessage(paymentQuery.error, '暂时无法读取付款单')} extra={<Space><Button onClick={() => paymentQuery.refetch()}>重试</Button><Button onClick={() => navigate(returnTo)}>返回付款列表</Button></Space>} />;
  }

  const payment = paymentQuery.data;
  const canMutate = confirmMutation.isPending || cancelMutation.isPending || reverseMutation.isPending || recoveryMutation.isPending || proofUploading;
  const isReserved = payment.status === 'RESERVED' || payment.status === 'PAYMENT_RESERVED';
  const isPaid = payment.status === 'PAID' || payment.status === 'PAYMENT_CONFIRMED';
  const correctionHref = fundLink(
    `/fund-ledgers/payments?companyId=${encodeURIComponent(payment.companyId)}&correctionId=${encodeURIComponent(payment.id)}&create=1`,
    returnTo,
  );

  const resetProofUpload = () => {
    uploadGeneration.current += 1;
    setProofKey('');
    setProofFileList([]);
    setProofUploading(false);
  };

  const openConfirm = () => {
    resetProofUpload();
    confirmForm.setFieldsValue({ actualAmount: payment.amount, paidAt: dayjs(), sourceAccountRef: '', bankReference: '', proofKey: '', confirmActualPayment: false, reviewReason: '', idempotencyKey: makeIdempotencyKey() });
    setModal('confirm');
  };
  const openCancel = () => { cancelForm.setFieldsValue({ reason: '', idempotencyKey: makeIdempotencyKey() }); setModal('cancel'); };
  const openReverse = () => { reverseForm.setFieldsValue({ reason: '', idempotencyKey: makeIdempotencyKey() }); setModal('reverse'); };
  const openRecovery = () => {
    resetProofUpload();
    recoveryForm.setFieldsValue({ amount: payment.amount, recoveredAt: dayjs(), bankReference: '', proofKey: '', reason: '', idempotencyKey: makeIdempotencyKey() });
    setModal('recovery');
  };

  const confirmSubmit = async (values: ConfirmFormValues) => {
    if (proofUploading) { message.info('凭证仍在上传，请稍候'); return; }
    if (!proofKey) {
      message.error('请上传银行付款凭证');
      return;
    }
    if (payment.needsReview && !values.confirmActualPayment) {
      message.error('该付款单需要先勾选“已核实银行实际付款”');
      return;
    }
    if (payment.needsReview && !values.reviewReason?.trim()) {
      message.error('请填写售后待核实事项的核实说明');
      return;
    }
    if (!values.idempotencyKey) { message.error('付款确认幂等键缺失，请关闭后重新打开表单'); return; }
    await confirmMutation.mutateAsync({ ...values, actualAmount: Number(values.actualAmount), paidAt: values.paidAt.toISOString(), proofKey, idempotencyKey: values.idempotencyKey });
  };
  const cancelSubmit = async (values: CancelIndustryFundPaymentInput) => {
    if (!values.idempotencyKey) { message.error('取消操作幂等键缺失，请关闭后重新打开表单'); return; }
    return cancelMutation.mutateAsync({ ...values, reason: values.reason.trim(), idempotencyKey: values.idempotencyKey });
  };
  const reverseSubmit = async (values: ReverseIndustryFundPaymentInput) => {
    if (!values.idempotencyKey) { message.error('冲正操作幂等键缺失，请关闭后重新打开表单'); return; }
    return reverseMutation.mutateAsync({ ...values, reason: values.reason.trim(), idempotencyKey: values.idempotencyKey });
  };
  const recoverySubmit = async (values: RecoveryFormValues) => {
    if (proofUploading) { message.info('凭证仍在上传，请稍候'); return; }
    if (!proofKey) { message.error('请上传实际回款凭证'); return; }
    if (!values.idempotencyKey) { message.error('回款操作幂等键缺失，请关闭后重新打开表单'); return; }
    await recoveryMutation.mutateAsync({ ...values, amount: Number(values.amount), recoveredAt: values.recoveredAt.toISOString(), proofKey, reason: values.reason.trim(), idempotencyKey: values.idempotencyKey });
  };

  const proofUploadProps: UploadProps = {
    accept: '.pdf,.png,.jpg,.jpeg',
    maxCount: 1,
    fileList: proofFileList,
    beforeUpload: async (file) => {
      const allowed = ['application/pdf', 'image/png', 'image/jpeg'];
      if (!allowed.includes(file.type)) { message.error('凭证只支持 PDF、PNG 或 JPEG'); return Upload.LIST_IGNORE; }
      if (file.size > 5 * 1024 * 1024) { message.error('凭证不能超过 5MB'); return Upload.LIST_IGNORE; }
      const generation = uploadGeneration.current + 1;
      uploadGeneration.current = generation;
      setProofKey('');
      setProofFileList([]);
      setProofUploading(true);
      try {
        const result = await uploadIndustryFundProof(file);
        if (generation === uploadGeneration.current && modal) {
          setProofKey(result.id);
          setProofFileList([{ uid: file.uid, name: file.name, status: 'done' }]);
          message.success('凭证已安全上传');
        }
      } catch (error) {
        if (generation === uploadGeneration.current) handleError(error, '凭证上传失败');
      } finally {
        if (generation === uploadGeneration.current) setProofUploading(false);
      }
      return Upload.LIST_IGNORE;
    },
    onRemove: () => { uploadGeneration.current += 1; setProofKey(''); setProofFileList([]); setProofUploading(false); },
  };

  const downloadProof = async (key: string) => {
    try {
      const blob = await downloadIndustryFundProof(key);
      const href = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = href;
      anchor.download = `industry-fund-proof-${payment.paymentNo || payment.id}`;
      anchor.click();
      URL.revokeObjectURL(href);
    } catch (error) {
      handleError(error, '凭证下载失败');
    }
  };

  return (
    <div style={{ padding: 24 }}>
      <Space direction="vertical" size={16} style={{ width: '100%' }}>
        <Space><Button onClick={() => navigate(returnTo)}>返回付款列表</Button><Typography.Title level={3} style={{ margin: 0 }}>付款登记详情</Typography.Title></Space>
        {payment.needsReview && <Alert type="warning" showIcon icon={<ExclamationCircleOutlined />} message="该付款单需要人工核实" description={payment.reviewReason || '付款资料与当前账本状态存在待核对事项，请核实后再确认。'} />}
        <Alert type="info" showIcon message="本页面只记录线下公对公付款。确认付款必须填写实际金额、付款时间、平台付款账户标识、银行流水号和私有凭证。" />
        <Card title={payment.paymentNo || payment.id} extra={paymentStatusTag(payment.status)}>
          <Descriptions bordered size="small" column={{ xs: 1, sm: 2, md: 3 }}>
            <Descriptions.Item label="收款公司">{payment.company?.id ? <Link to={fundLink(`/fund-ledgers/companies/${payment.company.id}`, returnTo)}>{payment.company.name || payment.company.id}</Link> : payment.company?.name || payment.companyId}</Descriptions.Item>
            <Descriptions.Item label="付款金额">{money(payment.amount)}</Descriptions.Item>
            <Descriptions.Item label="实际付款">{money(payment.actualAmount)}</Descriptions.Item>
            <Descriptions.Item label="对公户名">{payment.payeeName || '-'}</Descriptions.Item>
            <Descriptions.Item label="开户行">{payment.bankName || '-'}</Descriptions.Item>
            <Descriptions.Item label="对公账号">{payment.bankAccount || '受权限保护'}</Descriptions.Item>
            <Descriptions.Item label="付款时间">{dateTime(payment.paidAt)}</Descriptions.Item>
            <Descriptions.Item label="付款账户标识">{payment.sourceAccountRef || '-'}</Descriptions.Item>
            <Descriptions.Item label="银行流水号">{payment.bankReference || '-'}</Descriptions.Item>
            <Descriptions.Item label="登记原因" span={2}>{payment.reason || '-'}</Descriptions.Item>
            <Descriptions.Item label="创建时间">{dateTime(payment.createdAt)}</Descriptions.Item>
          </Descriptions>
          <Space style={{ marginTop: 16 }} wrap>
            {isReserved && <PermissionGate permission={PERMISSIONS.INDUSTRY_FUNDS_PAY}><Button type="primary" disabled={canMutate} onClick={openConfirm}>登记已付款</Button><Button disabled={canMutate} onClick={openCancel}>核实未付款并取消预留</Button><Button disabled={canMutate} onClick={() => navigate(correctionHref)}>更正未付款单</Button></PermissionGate>}
            {isPaid && <PermissionGate permission={PERMISSIONS.INDUSTRY_FUNDS_REVERSE}><Button danger disabled={canMutate} onClick={openReverse}>登记错误并冲正</Button><Button disabled={canMutate} onClick={openRecovery}>登记实际回款</Button></PermissionGate>}
          </Space>
        </Card>

        <Card title="付款核销明细">
          <Typography.Paragraph type="secondary">创建付款单时由服务器按可支付计提记录 FIFO 核销；如返回明细，可从这里追溯每个订单来源。</Typography.Paragraph>
          <Table
            rowKey={(row) => row.id || `${row.accrualId}-${row.amount}`}
            dataSource={payment.items || []}
            pagination={false}
            size="small"
            locale={{ emptyText: '当前接口未返回明细；请以付款单关联账本流水为准' }}
            columns={[{ title: '计提记录', dataIndex: 'accrualId' }, { title: '订单', dataIndex: 'orderId', render: (value) => value || '-' }, { title: '核销金额', dataIndex: 'amount', align: 'right' as const, render: (value: number) => money(value) }]}
          />
        </Card>

        {payment.proofKey && <Card title="付款凭证"><Space><Typography.Text>私有凭证已上传</Typography.Text><Button icon={<DownloadOutlined />} onClick={() => downloadProof(payment.proofKey!)}>鉴权下载</Button></Space></Card>}
        {payment.recoveries?.length ? <Card title="实际回款记录"><Table rowKey="id" size="small" pagination={false} dataSource={payment.recoveries} columns={[{ title: '回款金额', dataIndex: 'amount', render: (value: number) => money(value) }, { title: '回款时间', dataIndex: 'recoveredAt', render: (value) => dateTime(value) }, { title: '银行流水号', dataIndex: 'bankReference', render: (value) => value || '受权限保护' }, { title: '原因', dataIndex: 'reason' }]} /></Card> : null}
        {payment.statusHistory?.length ? <Card title="付款状态历史"><Table rowKey="id" size="small" pagination={false} dataSource={payment.statusHistory} columns={[{ title: '事件', dataIndex: 'eventType', render: (value: string) => eventTag(value) }, { title: '金额', dataIndex: 'amount', render: (value: number) => money(value) }, { title: '时间', dataIndex: 'occurredAt', render: (value) => dateTime(value) }, { title: '原因', dataIndex: 'reason', render: (value) => value || '-' }, { title: '操作人', dataIndex: ['operator', 'id'], render: (value) => value || '系统任务' }]} /></Card> : null}
      </Space>

      <Modal title="登记已付款" open={modal === 'confirm'} onCancel={() => { if (!confirmMutation.isPending) setModal(null); }} onOk={() => confirmForm.submit()} okButtonProps={{ disabled: proofUploading }} confirmLoading={confirmMutation.isPending} destroyOnClose>
        <Alert type="warning" showIcon style={{ marginBottom: 16 }} message="实际付款金额必须等于付款单金额；银行流水号和付款凭证为必填。" />
        <Form form={confirmForm} layout="vertical" onFinish={confirmSubmit}>
          <Form.Item name="actualAmount" label="实际付款金额（元）" rules={[{ required: true, message: '请输入实际付款金额' }, { type: 'number', min: 0.01, message: '金额必须大于 0' }]}><InputNumber min={0.01} precision={2} style={{ width: '100%' }} /></Form.Item>
          <Form.Item name="paidAt" label="实际付款时间" rules={[{ required: true, message: '请选择付款时间' }]}><DatePicker showTime style={{ width: '100%' }} /></Form.Item>
          <Form.Item name="sourceAccountRef" label="平台付款账户标识" rules={[{ required: true, message: '请输入付款账户标识' }]}><Input maxLength={100} placeholder="例如：对公账户尾号或内部账户编号" /></Form.Item>
          <Form.Item name="bankReference" label="银行流水号" rules={[{ required: true, message: '请输入银行流水号' }]}><Input maxLength={100} /></Form.Item>
          <Form.Item label="付款凭证" required><Upload {...proofUploadProps}><Button icon={<UploadOutlined />}>上传私有凭证</Button></Upload><Typography.Text type="secondary">仅支持 PDF、PNG、JPEG，最大 5MB</Typography.Text></Form.Item>
          {payment.needsReview && <>
            <Alert type="warning" showIcon style={{ marginBottom: 16 }} message="该付款单涉及售后保护，必须人工核实后才能登记真实付款。" />
            <Form.Item name="confirmActualPayment" valuePropName="checked" rules={[{ validator: (_, value: boolean) => value ? Promise.resolve() : Promise.reject(new Error('请确认已核实银行实际付款')) }]}>
              <Checkbox>我已核实银行实际付款已发生</Checkbox>
            </Form.Item>
            <Form.Item name="reviewReason" label="核实说明" rules={[{ required: true, message: '请填写核实说明' }]}>
              <Input.TextArea rows={3} maxLength={500} showCount placeholder="说明核实人、核实时间及售后状态" />
            </Form.Item>
          </>}
          <Form.Item name="idempotencyKey" hidden><Input /></Form.Item>
          <Form.Item name="proofKey" hidden><Input /></Form.Item>
        </Form>
      </Modal>

      <Modal title="取消付款预留" open={modal === 'cancel'} onCancel={() => { if (!cancelMutation.isPending) setModal(null); }} onOk={() => cancelForm.submit()} confirmLoading={cancelMutation.isPending} destroyOnClose>
        <Form form={cancelForm} layout="vertical" onFinish={cancelSubmit}><Form.Item name="reason" label="核实原因" rules={[{ required: true, message: '请填写核实原因' }]}><Input.TextArea rows={4} maxLength={500} showCount /></Form.Item><Form.Item name="idempotencyKey" hidden><Input /></Form.Item></Form>
      </Modal>

      <Modal title="登记错误并冲正" open={modal === 'reverse'} onCancel={() => { if (!reverseMutation.isPending) setModal(null); }} onOk={() => reverseForm.submit()} confirmLoading={reverseMutation.isPending} destroyOnClose>
        <Alert type="warning" showIcon style={{ marginBottom: 16 }} message="冲正只用于错误登记，不能假装真实银行退款；若款项已退回平台，请使用实际回款登记。" />
        <Form form={reverseForm} layout="vertical" onFinish={reverseSubmit}><Form.Item name="reason" label="冲正原因" rules={[{ required: true, message: '请填写冲正原因' }]}><Input.TextArea rows={4} maxLength={500} showCount /></Form.Item><Form.Item name="idempotencyKey" hidden><Input /></Form.Item></Form>
      </Modal>

      <Modal title="登记实际回款" open={modal === 'recovery'} onCancel={() => { if (!recoveryMutation.isPending) setModal(null); }} onOk={() => recoveryForm.submit()} okButtonProps={{ disabled: proofUploading }} confirmLoading={recoveryMutation.isPending} destroyOnClose>
        <Alert type="info" showIcon style={{ marginBottom: 16 }} message="实际回款会减少待追偿金额，需要对应的银行流水和私有凭证。" />
        <Form form={recoveryForm} layout="vertical" onFinish={recoverySubmit}>
          <Form.Item name="amount" label="回款金额（元）" rules={[{ required: true, message: '请输入回款金额' }, { type: 'number', min: 0.01, message: '金额必须大于 0' }]}><InputNumber min={0.01} precision={2} style={{ width: '100%' }} /></Form.Item>
          <Form.Item name="recoveredAt" label="实际回款时间" rules={[{ required: true, message: '请选择回款时间' }]}><DatePicker showTime style={{ width: '100%' }} /></Form.Item>
          <Form.Item name="bankReference" label="银行流水号" rules={[{ required: true, message: '请输入银行流水号' }]}><Input maxLength={100} /></Form.Item>
          <Form.Item label="回款凭证" required><Upload {...proofUploadProps}><Button icon={<UploadOutlined />}>上传私有凭证</Button></Upload><Typography.Text type="secondary">仅支持 PDF、PNG、JPEG，最大 5MB</Typography.Text></Form.Item>
          <Form.Item name="reason" label="回款原因" rules={[{ required: true, message: '请填写回款原因' }]}><Input.TextArea rows={3} maxLength={500} showCount /></Form.Item>
          <Form.Item name="idempotencyKey" hidden><Input /></Form.Item>
          <Form.Item name="proofKey" hidden><Input /></Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
