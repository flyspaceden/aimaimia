import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
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
  message,
} from 'antd';
import { ArrowLeftOutlined, FileTextOutlined, CloseCircleOutlined } from '@ant-design/icons';
import { getInvoiceDetail, issueInvoice, failInvoice } from '@/api/invoices';
import type { Invoice, InvoiceOrderItem } from '@/api/invoices';
import dayjs from 'dayjs';

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

export default function InvoiceDetailPage() {
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

  // 开票操作
  const handleIssue = async (values: { invoiceNo: string; pdfUrl: string }) => {
    if (!invoice) return;
    await issueInvoice(invoice.id, values);
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
            <Space>
              <Button
                type="primary"
                icon={<FileTextOutlined />}
                onClick={() => setIssueModalOpen(true)}
              >
                开票
              </Button>
              <Button
                danger
                icon={<CloseCircleOutlined />}
                onClick={() => setFailModalOpen(true)}
              >
                标记失败
              </Button>
            </Space>
          )
        }
      >
        <Descriptions bordered column={{ xs: 1, sm: 2, lg: 3 }}>
          <Descriptions.Item label="发票ID">{invoice.id}</Descriptions.Item>
          <Descriptions.Item label="状态">
            <Tag color={status?.color}>{status?.text || invoice.status}</Tag>
          </Descriptions.Item>
          <Descriptions.Item label="申请时间">
            {dayjs(invoice.createdAt).format('YYYY-MM-DD HH:mm:ss')}
          </Descriptions.Item>
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
              {dayjs(invoice.issuedAt).format('YYYY-MM-DD HH:mm:ss')}
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

      {/* 开票弹窗 */}
      <Modal
        title="开票"
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
