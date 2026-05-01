import { useRef, useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { ProTable } from '@ant-design/pro-components';
import type { ActionType, ProColumns } from '@ant-design/pro-components';
import { App, Button, Tag, Modal, Form, Input, Space, Card, Row, Col, Select, Statistic, Badge, Typography, Tooltip } from 'antd';
import {
  EyeOutlined,
  SendOutlined,
  ShoppingCartOutlined,
  DollarOutlined,
  CarOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
  InboxOutlined,
} from '@ant-design/icons';
import { getOrders, getOrderStats, shipOrder } from '@/api/orders';
import { getCompanies } from '@/api/companies';
import PermissionGate from '@/components/PermissionGate';
import type { Order, OrderStatsMap } from '@/types';
import {
  orderStatusMap as statusMap,
  paymentChannelMap,
} from '@/constants/statusMaps';
import { PERMISSIONS } from '@/constants/permissions';
import dayjs from 'dayjs';

const { Text } = Typography;

// 状态 Tab 配置
const STATUS_TABS = [
  { key: 'ALL', label: '全部' },
  { key: 'PAID', label: '待发货' },
  { key: 'SHIPPED', label: '已发货' },
  { key: 'DELIVERED', label: '已送达' },
  { key: 'RECEIVED', label: '已收货' },
  { key: 'CANCELED', label: '已取消' },
  { key: 'REFUNDED', label: '已退款' },
];

// 状态卡片配置
const STAT_CARDS = [
  { key: 'ALL', label: '全部订单', icon: <InboxOutlined />, color: '#8c8c8c' },
  { key: 'PAID', label: '待发货', icon: <DollarOutlined />, color: '#1677ff' },
  { key: 'SHIPPED', label: '运输中', icon: <CarOutlined />, color: '#13c2c2' },
  { key: 'RECEIVED', label: '已完成', icon: <CheckCircleOutlined />, color: '#52c41a' },
  { key: 'REFUNDED', label: '已退款', icon: <CloseCircleOutlined />, color: '#ff4d4f' },
];

export default function OrderListPage() {
  const { message } = App.useApp();
  const navigate = useNavigate();
  const actionRef = useRef<ActionType>(null);
  const [shipModalOpen, setShipModalOpen] = useState(false);
  const [currentOrder, setCurrentOrder] = useState<Order | null>(null);
  const [shipForm] = Form.useForm();
  const [activeTab, setActiveTab] = useState('ALL');
  const [stats, setStats] = useState<OrderStatsMap>({});
  const [companyOptions, setCompanyOptions] = useState<{ label: string; value: string }[]>([]);

  // 加载统计数据
  const loadStats = async () => {
    try {
      const data = await getOrderStats();
      setStats(data);
    } catch {
      // 静默失败，统计卡片显示 0
    }
  };

  // 加载公司列表（用于下拉筛选）
  useEffect(() => {
    loadStats();
    getCompanies({ pageSize: 200 })
      .then((res) => {
        setCompanyOptions(
          res.items.map((c) => ({ label: c.name, value: c.id })),
        );
      })
      .catch(() => {});
  }, []);

  // 页面回到前台立即拉一次（弥补 polling 30s 的等待）
  // app 端付款 → 后端建单后，管理员从其他 tab 切回来瞬间就能看到新单
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === 'visible') {
        actionRef.current?.reload();
        loadStats();
      }
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, []);

  const handleShip = async (values: { carrierCode: string; carrierName: string; trackingNo: string }) => {
    if (!currentOrder) return;
    await shipOrder(currentOrder.id, values);
    message.success('发货成功');
    setShipModalOpen(false);
    shipForm.resetFields();
    actionRef.current?.reload();
    loadStats();
  };

  // 待发货行高亮
  const rowClassName = (record: Order) => {
    if (record.status === 'PAID') return 'order-row-pending-ship';
    return '';
  };

  const columns: ProColumns<Order>[] = [
    {
      title: '订单号',
      dataIndex: 'orderNo',
      width: 180,
      copyable: true,
      ellipsis: true,
    },
    {
      title: '公司',
      dataIndex: 'companyId',
      width: 140,
      ellipsis: true,
      renderFormItem: () => (
        <Select
          placeholder="选择公司"
          allowClear
          showSearch
          optionFilterProp="label"
          options={companyOptions}
        />
      ),
      render: (_: unknown, r: Order) => {
        if (!r.company) return <Text type="secondary">-</Text>;
        return (
          <Text
            style={{ cursor: 'pointer', color: '#059669' }}
            onClick={() => navigate(`/companies/${r.company!.id}`)}
          >
            {r.company.name}
          </Text>
        );
      },
    },
    {
      title: '商品',
      dataIndex: 'itemsSummary',
      width: 260,
      search: false,
      render: (_: unknown, r: Order) => (
        <Space size={4} style={{ maxWidth: '100%', flexWrap: 'nowrap' }}>
          <ShoppingCartOutlined style={{ color: '#8c8c8c', flexShrink: 0 }} />
          <Tooltip title={r.itemsSummary}>
            <Text ellipsis style={{ maxWidth: 180 }}>{r.itemsSummary || '-'}</Text>
          </Tooltip>
          {r.itemCount != null && r.itemCount > 1 && (
            <Tag style={{ marginLeft: 4, flexShrink: 0 }}>{r.itemCount}件</Tag>
          )}
        </Space>
      ),
    },
    {
      title: '用户',
      dataIndex: ['user', 'phone'],
      width: 120,
      search: false,
      render: (_: unknown, r: Order) => (
        <span>
          {r.user?.nickname && (
            <Text type="secondary" style={{ fontSize: 12, display: 'block' }}>
              {r.user.nickname}
            </Text>
          )}
          <Text>{r.user?.phone || '-'}</Text>
        </span>
      ),
    },
    {
      title: '订单金额',
      dataIndex: 'totalAmount',
      width: 120,
      search: false,
      sorter: true,
      render: (_: unknown, r: Order) => {
        const hasDiscount = (r.discountAmount ?? 0) > 0;
        return (
          <span>
            <Text strong style={{ color: '#059669' }}>
              ¥{(r.paymentAmount ?? r.totalAmount).toFixed(2)}
            </Text>
            {hasDiscount && (
              <Text
                delete
                type="secondary"
                style={{ fontSize: 12, display: 'block' }}
              >
                ¥{r.totalAmount.toFixed(2)}
              </Text>
            )}
          </span>
        );
      },
    },
    {
      title: '支付方式',
      dataIndex: 'paymentMethod',
      width: 100,
      renderFormItem: () => (
        <Select
          placeholder="支付方式"
          allowClear
          options={Object.entries(paymentChannelMap).map(([k, v]) => ({
            label: v.text,
            value: k,
          }))}
        />
      ),
      render: (_: unknown, r: Order) => {
        if (!r.paymentMethod) return <Text type="secondary">-</Text>;
        const m = paymentChannelMap[r.paymentMethod];
        return m ? <Tag color={m.color}>{m.text}</Tag> : r.paymentMethod;
      },
    },
    {
      title: '状态',
      dataIndex: 'status',
      width: 100,
      hideInSearch: true,
      render: (_: unknown, r: Order) => {
        const s = statusMap[r.status];
        return (
          <span>
            <Tag color={s?.color}>{s?.text}</Tag>
            {r.bizType === 'VIP_PACKAGE' && (
              <Tag color="#C9A96E" style={{ marginTop: 2 }}>VIP礼包</Tag>
            )}
          </span>
        );
      },
    },
    {
      title: '下单时间',
      dataIndex: 'createdAt',
      width: 160,
      valueType: 'dateRange',
      render: (_: unknown, r: Order) => dayjs(r.createdAt).format('YYYY-MM-DD HH:mm'),
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
      width: 120,
      fixed: 'right',
      search: false,
      render: (_: unknown, record: Order) => (
        <Space size={0}>
          <Button
            type="link"
            size="small"
            icon={<EyeOutlined />}
            onClick={() => navigate(`/orders/${record.id}`)}
          >
            详情
          </Button>
          {record.bizType !== 'VIP_PACKAGE' && (
            <PermissionGate permission={PERMISSIONS.ORDERS_SHIP}>
              {record.status === 'PAID' && (
                <Button
                  type="link"
                  size="small"
                  icon={<SendOutlined />}
                  onClick={() => {
                    setCurrentOrder(record);
                    setShipModalOpen(true);
                  }}
                >
                  发货
                </Button>
              )}
            </PermissionGate>
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

      {/* 订单表格 */}
      <ProTable<Order>
        headerTitle="订单管理"
        actionRef={actionRef}
        rowKey="id"
        columns={columns}
        // 30s 自动轮询，配合 visibilitychange 回前台立即拉，覆盖 app 端付款后管理员需要手动刷新的场景
        polling={30_000}
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
            orderNo: keyword,
            paymentMethod: paymentChannel,
            companyId,
          } = params as any;
          const statusFilter = activeTab !== 'ALL' ? activeTab : undefined;
          const res = await getOrders({
            page: current,
            pageSize,
            status: statusFilter,
            keyword,
            startDate,
            endDate,
            companyId: companyId || undefined,
            paymentChannel: paymentChannel || undefined,
          });
          return { data: res.items, total: res.total, success: true };
        }}
        scroll={{ x: 1300 }}
        search={{ labelWidth: 'auto', defaultCollapsed: false }}
        pagination={{ defaultPageSize: 20, showSizeChanger: true, showQuickJumper: true }}
        rowClassName={rowClassName}
        dateFormatter="string"
      />

      {/* 发货弹窗 */}
      <Modal
        title="发货"
        open={shipModalOpen}
        onCancel={() => setShipModalOpen(false)}
        onOk={() => shipForm.submit()}
        destroyOnClose
      >
        <Form form={shipForm} layout="vertical" onFinish={handleShip}>
          <Form.Item name="carrierName" label="快递公司" rules={[{ required: true, message: '请输入快递公司' }]}>
            <Input placeholder="如：顺丰速运" />
          </Form.Item>
          <Form.Item name="carrierCode" label="快递编码" rules={[{ required: true, message: '请输入快递编码' }]}>
            <Input placeholder="如：SF" />
          </Form.Item>
          <Form.Item name="trackingNo" label="运单号" rules={[{ required: true, message: '请输入运单号' }]}>
            <Input placeholder="请输入运单号" />
          </Form.Item>
        </Form>
      </Modal>

      {/* 待发货行高亮样式 */}
      <style>{`
        .order-row-pending-ship {
          background: #e6f4ff !important;
        }
        .order-row-pending-ship:hover > td {
          background: #bae0ff !important;
        }
      `}</style>
    </div>
  );
}
