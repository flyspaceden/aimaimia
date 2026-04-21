import { useRef, useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { ProTable } from '@ant-design/pro-components';
import type { ActionType, ProColumns } from '@ant-design/pro-components';
import { App, Button, Tag, Modal, Form, Input, Space, Card, Row, Col, Statistic, Badge, Typography } from 'antd';
import {
  EyeOutlined,
  FileTextOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
  ClockCircleOutlined,
  StopOutlined,
  InboxOutlined,
} from '@ant-design/icons';
import { getInvoices, getInvoiceStats, issueInvoice, failInvoice } from '@/api/invoices';
import type { Invoice, InvoiceStatsMap } from '@/api/invoices';
import dayjs from 'dayjs';

const { Text } = Typography;

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

// 状态 Tab 配置
const STATUS_TABS = [
  { key: 'ALL', label: '全部' },
  { key: 'REQUESTED', label: '已申请' },
  { key: 'ISSUED', label: '已开票' },
  { key: 'FAILED', label: '失败' },
  { key: 'CANCELED', label: '已取消' },
];

// 状态统计卡片配置
const STAT_CARDS = [
  { key: 'ALL', label: '全部发票', icon: <InboxOutlined />, color: '#8c8c8c' },
  { key: 'REQUESTED', label: '待开票', icon: <ClockCircleOutlined />, color: '#fa8c16' },
  { key: 'ISSUED', label: '已开票', icon: <CheckCircleOutlined />, color: '#52c41a' },
  { key: 'FAILED', label: '失败', icon: <CloseCircleOutlined />, color: '#ff4d4f' },
  { key: 'CANCELED', label: '已取消', icon: <StopOutlined />, color: '#8c8c8c' },
];

export default function InvoiceListPage() {
  const { message } = App.useApp();
  const navigate = useNavigate();
  const actionRef = useRef<ActionType>(null);
  const [activeTab, setActiveTab] = useState('ALL');
  const [stats, setStats] = useState<InvoiceStatsMap>({});

  // 开票弹窗
  const [issueModalOpen, setIssueModalOpen] = useState(false);
  const [currentInvoice, setCurrentInvoice] = useState<Invoice | null>(null);
  const [issueForm] = Form.useForm();

  // 标记失败弹窗
  const [failModalOpen, setFailModalOpen] = useState(false);
  const [failForm] = Form.useForm();

  // 加载统计数据
  const loadStats = async () => {
    try {
      const data = await getInvoiceStats();
      setStats(data);
    } catch {
      // 静默失败，统计卡片显示 0
    }
  };

  useEffect(() => {
    loadStats();
  }, []);

  // 开票操作
  const handleIssue = async (values: { invoiceNo: string; pdfUrl: string }) => {
    if (!currentInvoice) return;
    await issueInvoice(currentInvoice.id, values);
    message.success('开票成功');
    setIssueModalOpen(false);
    issueForm.resetFields();
    actionRef.current?.reload();
    loadStats();
  };

  // 标记失败操作
  const handleFail = async (values: { reason: string }) => {
    if (!currentInvoice) return;
    await failInvoice(currentInvoice.id, values);
    message.success('已标记为失败');
    setFailModalOpen(false);
    failForm.resetFields();
    actionRef.current?.reload();
    loadStats();
  };

  const columns: ProColumns<Invoice>[] = [
    {
      title: '发票ID',
      dataIndex: 'id',
      width: 100,
      ellipsis: true,
      copyable: true,
      search: false,
    },
    {
      title: '订单号',
      dataIndex: ['order', 'orderNo'],
      width: 180,
      copyable: true,
      ellipsis: true,
      search: false,
    },
    {
      title: '关键词',
      dataIndex: 'keyword',
      hideInTable: true,
      fieldProps: {
        placeholder: '订单号 / 发票抬头',
      },
    },
    {
      title: '买家',
      dataIndex: ['order', 'user', 'nickname'],
      width: 120,
      search: false,
      render: (_: unknown, r: Invoice) => (
        <span>
          {r.order?.user?.nickname && (
            <Text type="secondary" style={{ fontSize: 12, display: 'block' }}>
              {r.order.user.nickname}
            </Text>
          )}
          <Text>{r.profileSnapshot?.phone || '-'}</Text>
        </span>
      ),
    },
    {
      title: '抬头类型',
      dataIndex: ['profileSnapshot', 'type'],
      width: 80,
      search: false,
      render: (_: unknown, r: Invoice) => {
        const type = r.profileSnapshot?.type;
        return type ? <Tag>{titleTypeMap[type] || type}</Tag> : '-';
      },
    },
    {
      title: '抬头名称',
      dataIndex: ['profileSnapshot', 'title'],
      width: 160,
      ellipsis: true,
      search: false,
    },
    {
      title: '订单金额',
      dataIndex: ['order', 'totalAmount'],
      width: 120,
      search: false,
      render: (_: unknown, r: Invoice) => {
        const amount = r.order?.paymentAmount ?? r.order?.totalAmount;
        return amount != null ? (
          <Text strong style={{ color: '#059669' }}>
            ¥{amount.toFixed(2)}
          </Text>
        ) : '-';
      },
    },
    {
      title: '状态',
      dataIndex: 'status',
      width: 100,
      hideInSearch: true,
      render: (_: unknown, r: Invoice) => {
        const s = invoiceStatusMap[r.status];
        return <Tag color={s?.color}>{s?.text || r.status}</Tag>;
      },
    },
    {
      title: '申请时间',
      dataIndex: 'createdAt',
      width: 160,
      valueType: 'dateRange',
      render: (_: unknown, r: Invoice) => dayjs(r.createdAt).format('YYYY-MM-DD HH:mm'),
      search: {
        transform: (value: [string, string]) => ({
          startDate: value[0],
          endDate: value[1],
        }),
      },
    },
    {
      title: '操作',
      key: 'action',
      width: 160,
      fixed: 'right',
      search: false,
      render: (_: unknown, record: Invoice) => (
        <Space size={0}>
          {record.status === 'REQUESTED' ? (
            <>
              <Button
                type="link"
                size="small"
                icon={<FileTextOutlined />}
                onClick={() => {
                  setCurrentInvoice(record);
                  setIssueModalOpen(true);
                }}
              >
                开票
              </Button>
              <Button
                type="link"
                size="small"
                danger
                icon={<CloseCircleOutlined />}
                onClick={() => {
                  setCurrentInvoice(record);
                  setFailModalOpen(true);
                }}
              >
                失败
              </Button>
            </>
          ) : (
            <Button
              type="link"
              size="small"
              icon={<EyeOutlined />}
              onClick={() => navigate(`/invoices/${record.id}`)}
            >
              {record.status === 'ISSUED' ? '查看详情' : '查看'}
            </Button>
          )}
        </Space>
      ),
    },
  ];

  // 生成 Tab items（带数量 Badge）
  const tabItems = useMemo(
    () =>
      STATUS_TABS.map((t) => ({
        key: t.key,
        label: (
          <span>
            {t.label}
            {stats[t.key] != null && stats[t.key] > 0 && (
              <Badge
                count={stats[t.key]}
                size="small"
                style={{ marginLeft: 6 }}
                overflowCount={999}
              />
            )}
          </span>
        ),
      })),
    [stats],
  );

  return (
    <div style={{ padding: 24 }}>
      {/* 状态统计卡片 */}
      <Row gutter={16} style={{ marginBottom: 16 }}>
        {STAT_CARDS.map((card) => (
          <Col key={card.key} xs={12} sm={8} md={4} lg={4} xl={4}>
            <Card
              hoverable
              size="small"
              style={{
                borderLeft: `3px solid ${card.color}`,
                cursor: 'pointer',
                background: activeTab === card.key ? `${card.color}08` : undefined,
              }}
              onClick={() => {
                setActiveTab(card.key);
                actionRef.current?.reload();
              }}
            >
              <Statistic
                title={
                  <Space size={4}>
                    {card.icon}
                    <span>{card.label}</span>
                  </Space>
                }
                value={stats[card.key] ?? 0}
                valueStyle={{ color: card.color, fontSize: 24 }}
              />
            </Card>
          </Col>
        ))}
      </Row>

      {/* 发票表格 */}
      <ProTable<Invoice>
        headerTitle="发票管理"
        actionRef={actionRef}
        rowKey="id"
        columns={columns}
        toolbar={{
          menu: {
            type: 'tab',
            activeKey: activeTab,
            items: tabItems,
            onChange: (key) => {
              setActiveTab(key as string);
              actionRef.current?.reload();
            },
          },
        }}
        request={async (params) => {
          const {
            current,
            pageSize,
            startDate,
            endDate,
            keyword,
          } = params as any;
          const statusFilter = activeTab !== 'ALL' ? activeTab : undefined;
          const res = await getInvoices({
            page: current,
            pageSize,
            status: statusFilter,
            keyword: keyword || undefined,
            startDate,
            endDate,
          });
          return { data: res.items, total: res.total, success: true };
        }}
        scroll={{ x: 1200 }}
        search={{ labelWidth: 'auto', defaultCollapsed: false }}
        pagination={{ defaultPageSize: 20, showSizeChanger: true, showQuickJumper: true }}
        dateFormatter="string"
      />

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
