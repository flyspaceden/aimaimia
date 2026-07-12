import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  App,
  Card,
  Descriptions,
  Table,
  Tag,
  Button,
  Spin,
  Breadcrumb,
  Space,
  Modal,
  Form,
  Input,
  Timeline,
  Alert,
  Typography,
  Upload,
} from 'antd';
import {
  ArrowLeftOutlined,
  FileTextOutlined,
  CloseCircleOutlined,
  ThunderboltOutlined,
  HistoryOutlined,
  InboxOutlined,
  SyncOutlined,
} from '@ant-design/icons';
import {
  getInvoiceDetail,
  issueInvoice,
  failInvoice,
  resetInvoiceProviderReservation,
} from '@/api/invoices';
import type { InvoiceOrderItem } from '@/api/invoices';
import PermissionGate from '@/components/PermissionGate';
import { PERMISSIONS } from '@/constants/permissions';
import { sanitizeAdminErrorMessage } from '@/utils/adminErrorMessage';
import dayjs from 'dayjs';

const { Text } = Typography;
const { Dragger } = Upload;
const API_BASE = import.meta.env.VITE_API_BASE_URL || '/api/v1';

// 发票状态映射
const invoiceStatusMap: Record<string, { text: string; color: string }> = {
  REQUESTED: { text: '已申请', color: 'orange' },
  ISSUED: { text: '已开票', color: 'green' },
  FAILED: { text: '失败', color: 'red' },
  CANCELED: { text: '已取消', color: 'default' },
};

// 抬头类型映射
const titleTypeMap: Record<string, string> = {
  PERSONAL: '个人',
  COMPANY: '企业',
};

// 操作人类型映射
const OPERATOR_TYPE_LABEL: Record<string, string> = {
  BUYER: '买家',
  ADMIN: '管理员',
  SYSTEM: '系统自动',
  PROVIDER: '开票服务',
};

// 订单商品列定义
const itemColumns = [
  {
    title: '图片',
    dataIndex: 'productImage',
    key: 'productImage',
    width: 64,
    render: (url: string | null) =>
      url ? (
        <img
          src={url}
          alt="商品图"
          style={{ width: 48, height: 48, objectFit: 'cover', borderRadius: 4 }}
        />
      ) : (
        <div
          style={{
            width: 48,
            height: 48,
            background: '#f5f5f5',
            borderRadius: 4,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: '#ccc',
            fontSize: 12,
          }}
        >
          暂无
        </div>
      ),
  },
  { title: '商品', dataIndex: 'productTitle', key: 'productTitle' },
  {
    title: '规格',
    dataIndex: 'skuName',
    key: 'skuName',
    render: (v: string | null) => v || '-',
  },
  {
    title: '单价',
    dataIndex: 'unitPrice',
    key: 'unitPrice',
    render: (v: number | null) => (v != null ? `¥${v.toFixed(2)}` : '-'),
  },
  { title: '数量', dataIndex: 'quantity', key: 'quantity' },
  {
    title: '小计',
    key: 'subtotal',
    render: (_: unknown, record: InvoiceOrderItem) => {
      const price = record.unitPrice ?? 0;
      const qty = record.quantity ?? 0;
      return `¥${(price * qty).toFixed(2)}`;
    },
  },
];

const snapshotLineColumns = [
  { title: '名称', dataIndex: 'name', key: 'name' },
  {
    title: '数量',
    dataIndex: 'quantity',
    key: 'quantity',
    width: 90,
  },
  {
    title: '单价',
    dataIndex: 'unitPrice',
    key: 'unitPrice',
    width: 110,
    render: (v: number | null) => (v != null ? `¥${Number(v).toFixed(2)}` : '-'),
  },
  {
    title: '金额',
    dataIndex: 'amount',
    key: 'amount',
    width: 120,
    render: (v: number | null) => (v != null ? `¥${Number(v).toFixed(2)}` : '-'),
  },
  {
    title: '税率',
    dataIndex: 'taxRate',
    key: 'taxRate',
    width: 100,
    render: (v: number | null) => (v != null ? `${(Number(v) * 100).toFixed(2)}%` : '-'),
  },
];

const formatTime = (value?: string | null) =>
  value ? dayjs(value).format('YYYY-MM-DD HH:mm:ss') : '-';

export default function InvoiceDetailPage() {
  const { message, modal } = App.useApp();
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  // 开票弹窗
  const [issueModalOpen, setIssueModalOpen] = useState(false);
  const [issueForm] = Form.useForm();

  // 标记失败弹窗
  const [failModalOpen, setFailModalOpen] = useState(false);
  const [failForm] = Form.useForm();

  const { data: invoice, isLoading } = useQuery({
    queryKey: ['admin', 'invoice', id],
    queryFn: () => getInvoiceDetail(id!),
    enabled: !!id,
  });

  // 自动开票
  const handleAutoIssue = async () => {
    if (!invoice) return;
    await issueInvoice(invoice.id, { mode: 'MOCK' });
    message.success('自动开票成功');
    queryClient.invalidateQueries({ queryKey: ['admin', 'invoice', id] });
  };

  // 人工开票
  const handleIssue = async (values: { invoiceNo: string; pdfUrl: string }) => {
    if (!invoice) return;
    await issueInvoice(invoice.id, { mode: 'MANUAL', ...values });
    message.success('开票成功');
    setIssueModalOpen(false);
    issueForm.resetFields();
    queryClient.invalidateQueries({ queryKey: ['admin', 'invoice', id] });
  };

  // 标记失败操作
  const handleFail = async (values: { reason: string }) => {
    if (!invoice) return;
    await failInvoice(invoice.id, values);
    message.success('已标记为失败');
    setFailModalOpen(false);
    failForm.resetFields();
    queryClient.invalidateQueries({ queryKey: ['admin', 'invoice', id] });
  };

  // 重置卡住的 Provider 预占
  const handleResetProviderReservation = () => {
    if (!invoice) return;
    modal.confirm({
      title: '重置开票任务',
      content: '仅用于处理长时间卡住的开票任务。重置后可重新自动开票、人工开票或标记失败。',
      okText: '重置',
      okButtonProps: { danger: true },
      cancelText: '取消',
      onOk: async () => {
        await resetInvoiceProviderReservation(invoice.id);
        message.success('开票任务已重置');
        queryClient.invalidateQueries({ queryKey: ['admin', 'invoice', id] });
      },
    });
  };

  if (isLoading) {
    return (
      <div style={{ textAlign: 'center', padding: 60 }}>
        <Spin size="large" />
      </div>
    );
  }

  if (!invoice) {
    return (
      <div style={{ padding: 24, textAlign: 'center', paddingTop: 100 }}>
        <Button icon={<ArrowLeftOutlined />} onClick={() => navigate(-1)} style={{ marginBottom: 16 }}>
          返回
        </Button>
        <div style={{ color: '#999' }}>发票不存在或加载失败</div>
      </div>
    );
  }

  const status = invoiceStatusMap[invoice.status];
  const profile = invoice.profileSnapshot || ({} as any);
  const order = invoice.order;
  const snapshot = invoice.invoiceContentSnapshot || null;
  const snapshotBuyer = snapshot?.buyer || {};
  const snapshotIssuer = snapshot?.issuer || {};
  const snapshotLines = Array.isArray(snapshot?.lines) ? snapshot.lines : [];
  const isProviderInProgress = invoice.status === 'REQUESTED' && !!invoice.providerRequestId;

  return (
    <div style={{ padding: 24 }}>
      <Breadcrumb
        style={{ marginBottom: 12 }}
        items={[
          { title: <a onClick={() => navigate('/')}>首页</a> },
          { title: <a onClick={() => navigate('/invoices')}>发票管理</a> },
          { title: '发票详情' },
        ]}
      />
      <Button icon={<ArrowLeftOutlined />} onClick={() => navigate(-1)} style={{ marginBottom: 16 }}>
        返回
      </Button>

      {/* 发票基本信息 */}
      <Card
        title="发票信息"
        style={{ marginBottom: 16 }}
        extra={
          invoice.status === 'REQUESTED' && (
            <PermissionGate permission={PERMISSIONS.INVOICES_ISSUE}>
              <Space>
                {isProviderInProgress ? (
                  <Button
                    danger
                    icon={<SyncOutlined />}
                    onClick={handleResetProviderReservation}
                  >
                    重置开票任务
                  </Button>
                ) : (
                  <>
                    <Button
                      type="primary"
                      icon={<ThunderboltOutlined />}
                      onClick={handleAutoIssue}
                    >
                      自动开票
                    </Button>
                    <Button
                      icon={<FileTextOutlined />}
                      onClick={() => setIssueModalOpen(true)}
                    >
                      人工开票
                    </Button>
                    <Button
                      danger
                      icon={<CloseCircleOutlined />}
                      onClick={() => setFailModalOpen(true)}
                    >
                      标记失败
                    </Button>
                  </>
                )}
              </Space>
            </PermissionGate>
          )
        }
      >
        {isProviderInProgress && (
          <Alert
            type="warning"
            showIcon
            style={{ marginBottom: 16 }}
            message="开票任务处理中"
            description="Provider 请求已预占，普通开票和失败标记已锁定。若任务长时间未完成，可重置后重新处理。"
          />
        )}
        <Descriptions bordered column={{ xs: 1, sm: 2, lg: 3 }}>
          <Descriptions.Item label="发票ID">{invoice.id}</Descriptions.Item>
          <Descriptions.Item label="状态">
            <Tag color={isProviderInProgress ? 'processing' : status?.color}>
              {isProviderInProgress ? '开票中' : status?.text || invoice.status}
            </Tag>
          </Descriptions.Item>
          <Descriptions.Item label="申请时间">
            {formatTime(invoice.requestedAt || invoice.createdAt)}
          </Descriptions.Item>
          <Descriptions.Item label="Provider">{invoice.provider || '-'}</Descriptions.Item>
          <Descriptions.Item label="Provider请求号" span={2}>
            {invoice.providerRequestId || '-'}
          </Descriptions.Item>
          {invoice.failedAttempts > 0 && (
            <Descriptions.Item label="自动开票失败次数" span={3}>
              <Text type="warning">
                {invoice.failedAttempts} 次
                {invoice.lastAutoIssueAttemptAt &&
                  `（上次 ${dayjs(invoice.lastAutoIssueAttemptAt).format('YYYY-MM-DD HH:mm:ss')}）`}
              </Text>
            </Descriptions.Item>
          )}
          {invoice.invoiceNo && (
            <Descriptions.Item label="发票号码">{invoice.invoiceNo}</Descriptions.Item>
          )}
          {invoice.pdfUrl && (
            <Descriptions.Item label="发票文件" span={2}>
              <a href={invoice.pdfUrl} target="_blank" rel="noopener noreferrer">
                查看/下载发票 PDF
              </a>
            </Descriptions.Item>
          )}
          {invoice.issuedAt && (
            <Descriptions.Item label="开票时间">
              {formatTime(invoice.issuedAt)}
            </Descriptions.Item>
          )}
          {invoice.failedAt && (
            <Descriptions.Item label="失败时间">
              {formatTime(invoice.failedAt)}
            </Descriptions.Item>
          )}
          {invoice.canceledAt && (
            <Descriptions.Item label="取消时间">
              {formatTime(invoice.canceledAt)}
            </Descriptions.Item>
          )}
          {invoice.failReason && (
            <Descriptions.Item label="失败原因" span={3}>
              <span style={{ color: '#ff4d4f' }}>{invoice.failReason}</span>
            </Descriptions.Item>
          )}
        </Descriptions>
      </Card>

      {/* 开票信息（抬头档案快照） */}
      <Card title="开票信息" style={{ marginBottom: 16 }}>
        <Descriptions bordered column={{ xs: 1, sm: 2, lg: 3 }}>
          <Descriptions.Item label="抬头类型">
            <Tag>{titleTypeMap[profile.type] || profile.type || '-'}</Tag>
          </Descriptions.Item>
          <Descriptions.Item label="抬头名称" span={2}>
            {profile.title || '-'}
          </Descriptions.Item>
          {profile.taxNo && (
            <Descriptions.Item label="税号">{profile.taxNo}</Descriptions.Item>
          )}
          {profile.email && (
            <Descriptions.Item label="邮箱">{profile.email}</Descriptions.Item>
          )}
          {profile.phone && (
            <Descriptions.Item label="电话">{profile.phone}</Descriptions.Item>
          )}
          {profile.bankInfo && (
            <Descriptions.Item label="开户银行" span={3}>
              {profile.bankInfo.bankName} {profile.bankInfo.accountNo}
            </Descriptions.Item>
          )}
          {profile.address && (
            <Descriptions.Item label="地址" span={3}>
              {profile.address}
            </Descriptions.Item>
          )}
        </Descriptions>
      </Card>

      {/* 关联订单信息 */}
      {order && (
        <Card title="关联订单" style={{ marginBottom: 16 }}>
          <Descriptions bordered column={{ xs: 1, sm: 2, lg: 3 }}>
            <Descriptions.Item label="订单号">
              <a onClick={() => navigate(`/orders/${order.id}`)}>{order.orderNo}</a>
            </Descriptions.Item>
            <Descriptions.Item label="订单状态">{order.status}</Descriptions.Item>
            <Descriptions.Item label="下单时间">
              {dayjs(order.createdAt).format('YYYY-MM-DD HH:mm:ss')}
            </Descriptions.Item>
            <Descriptions.Item label="订单总额">
              ¥{order.totalAmount?.toFixed(2) ?? '-'}
            </Descriptions.Item>
            <Descriptions.Item label="实付金额">
              <span style={{ color: '#059669', fontWeight: 600 }}>
                ¥{order.paymentAmount?.toFixed(2) ?? '-'}
              </span>
            </Descriptions.Item>
            {order.shippingFee != null && (
              <Descriptions.Item label="运费">
                ¥{Number(order.shippingFee).toFixed(2)}
              </Descriptions.Item>
            )}
            {order.user && (
              <Descriptions.Item label="买家">
                {order.user.nickname || '-'}
              </Descriptions.Item>
            )}
          </Descriptions>
        </Card>
      )}

      {/* 订单商品明细 */}
      {order?.items && order.items.length > 0 && (
        <Card title="商品明细" style={{ marginBottom: 16 }}>
          <Table<InvoiceOrderItem>
            columns={itemColumns}
            dataSource={order.items}
            rowKey="id"
            pagination={false}
            size="small"
            scroll={{ x: 600 }}
          />
        </Card>
      )}

      {/* 最终开票内容快照 */}
      <Card
        title={snapshot ? '最终开票内容快照' : '开票内容预览'}
        style={{ marginBottom: 16 }}
      >
        {!snapshot && (
          <Alert
            type="info"
            showIcon
            style={{ marginBottom: 16 }}
            message="当前仅为预览"
            description="待开票记录尚未生成最终快照，实际开票内容以执行开票时的配置为准。"
          />
        )}
        <Descriptions bordered column={{ xs: 1, sm: 2, lg: 3 }} style={{ marginBottom: 16 }}>
          <Descriptions.Item label="购买方名称" span={2}>
            {snapshot ? snapshotBuyer.title || '-' : profile.title || '-'}
          </Descriptions.Item>
          <Descriptions.Item label="购买方类型">
            {titleTypeMap[(snapshot ? snapshotBuyer.type : profile.type) as string] || (snapshot ? snapshotBuyer.type : profile.type) || '-'}
          </Descriptions.Item>
          <Descriptions.Item label="销售方名称" span={2}>
            {snapshot ? snapshotIssuer.companyName || '-' : '以发票设置为准'}
          </Descriptions.Item>
          <Descriptions.Item label="订单号">{order?.orderNo || order?.id || '-'}</Descriptions.Item>
          <Descriptions.Item label="备注" span={3}>
            {snapshot?.remark || '以发票设置模板为准'}
          </Descriptions.Item>
        </Descriptions>
        <Table
          columns={snapshotLineColumns}
          dataSource={snapshot ? snapshotLines : (order?.items || []).map((item) => ({
            name: [item.productTitle, item.skuName].filter(Boolean).join(' '),
            quantity: item.quantity,
            unitPrice: item.unitPrice,
            amount: item.totalPrice ?? item.unitPrice * item.quantity,
            taxRate: null,
          }))}
          rowKey={(_, index) => String(index)}
          pagination={false}
          size="small"
          scroll={{ x: 640 }}
        />
      </Card>

      {/* 状态历史 */}
      {invoice.statusHistory && invoice.statusHistory.length > 0 && (
        <Card
          title={
            <Space>
              <HistoryOutlined />
              <span>状态历史</span>
            </Space>
          }
          style={{ marginBottom: 16 }}
        >
          <Timeline
            items={invoice.statusHistory.map((item) => ({
              color: invoiceStatusMap[item.toStatus]?.color || 'blue',
              children: (
                <Space direction="vertical" size={2}>
                  <Text strong>
                    {(item.fromStatus ? `${invoiceStatusMap[item.fromStatus]?.text || item.fromStatus} → ` : '')}
                    {invoiceStatusMap[item.toStatus]?.text || item.toStatus}
                  </Text>
                  <Text type="secondary">
                    {formatTime(item.createdAt)}
                    {item.operatorType &&
                      `  ·  ${OPERATOR_TYPE_LABEL[item.operatorType] || item.operatorType}`}
                  </Text>
                  {item.reason && <Text type="danger">{sanitizeAdminErrorMessage(item.reason, '开票处理未完成，请稍后重试')}</Text>}
                </Space>
              ),
            }))}
          />
        </Card>
      )}

      {/* 人工开票弹窗 */}
      <Modal
        title="人工开票"
        open={issueModalOpen}
        onCancel={() => {
          setIssueModalOpen(false);
          issueForm.resetFields();
        }}
        onOk={() => issueForm.submit()}
        destroyOnClose
      >
        <Form form={issueForm} layout="vertical" onFinish={handleIssue}>
          <Form.Item
            name="invoiceNo"
            label="发票号码"
            rules={[{ required: true, message: '请输入发票号码' }]}
          >
            <Input placeholder="请输入发票号码" />
          </Form.Item>
          <Form.Item label="上传发票 PDF">
            <Dragger
              name="file"
              maxCount={1}
              accept="application/pdf"
              action={`${API_BASE}/upload?folder=invoices/manual`}
              headers={{ Authorization: `Bearer ${localStorage.getItem('admin_token') || ''}` }}
              beforeUpload={(file) => {
                const isPdf = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
                if (!isPdf) {
                  message.error('仅支持 PDF 文件');
                  return Upload.LIST_IGNORE;
                }
                return true;
              }}
              onChange={({ file }) => {
                if (file.status !== 'done') return;
                const url = file.response?.data?.url || file.response?.url;
                if (url) {
                  issueForm.setFieldValue('pdfUrl', url);
                  message.success('PDF 已上传');
                }
              }}
            >
              <p className="ant-upload-drag-icon"><InboxOutlined /></p>
              <p className="ant-upload-text">点击或拖拽上传 PDF</p>
              <p className="ant-upload-hint">也可以直接在下方粘贴已有 PDF 地址</p>
            </Dragger>
          </Form.Item>
          <Form.Item
            name="pdfUrl"
            label="发票文件地址（PDF URL）"
            rules={[{ required: true, message: '请输入发票文件地址' }]}
          >
            <Input placeholder="请输入发票 PDF 的 URL 地址" />
          </Form.Item>
        </Form>
      </Modal>

      {/* 标记失败弹窗 */}
      <Modal
        title="标记开票失败"
        open={failModalOpen}
        onCancel={() => {
          setFailModalOpen(false);
          failForm.resetFields();
        }}
        onOk={() => failForm.submit()}
        destroyOnClose
      >
        <Form form={failForm} layout="vertical" onFinish={handleFail}>
          <Form.Item
            name="reason"
            label="失败原因"
            rules={[{ required: true, message: '请输入失败原因' }]}
          >
            <Input.TextArea rows={4} placeholder="请输入开票失败的原因" />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
