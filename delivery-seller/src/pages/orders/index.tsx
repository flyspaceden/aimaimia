import { useEffect, useRef } from 'react';
import {
  Avatar,
  Badge,
  Button,
  Card,
  Space,
  Statistic,
  Tag,
  Typography,
} from 'antd';
import {
  ClockCircleOutlined,
  FileTextOutlined,
  SendOutlined,
  ShoppingOutlined,
  InboxOutlined,
} from '@ant-design/icons';
import { ProTable } from '@ant-design/pro-components';
import type { ActionType, ProColumns } from '@ant-design/pro-components';
import { useQuery } from '@tanstack/react-query';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { getOrders } from '@/api/orders';
import { getStatusDisplay, orderStatusMap } from '@/constants/statusMaps';
import type { Order } from '@/types';

const orderStatusTabs = [
  { key: 'all', label: '全部', status: '' },
  { key: 'pending', label: '待发货', status: 'PENDING_SHIPMENT' },
  { key: 'shipped', label: '已发货', status: 'SHIPPED' },
  { key: 'completed', label: '已完成', status: 'DELIVERED,COMPLETED' },
  { key: 'cancelled', label: '已取消', status: 'CANCELED' },
] as const;

// 格式化订单号：截取后 8 位展示
function shortOrderId(id: string): string {
  if (id.length <= 8) return id;
  return `...${id.slice(-8)}`;
}

export default function OrderListPage() {
  const navigate = useNavigate();
  const actionRef = useRef<ActionType>(null);
  const [searchParams, setSearchParams] = useSearchParams();

  const activeOrderStatusTab = orderStatusTabs.some(
    (tab) => tab.key === searchParams.get('statusTab'),
  )
    ? (searchParams.get('statusTab') as (typeof orderStatusTabs)[number]['key'])
    : 'all';
  const currentStatusFilter =
    orderStatusTabs.find((tab) => tab.key === activeOrderStatusTab)?.status || '';

  // 页面回到前台立即拉一次（弥补 polling 30s 的等待）
  // 买家 app 付款 → 后端建单后，卖家从其他 tab 切回来瞬间就能看到新单 + tab counts 同步刷新
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === 'visible') {
        actionRef.current?.reload();
      }
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, []);

  // Tab 计数
  const { data: orderTabCounts } = useQuery({
    queryKey: ['seller-order-tab-counts'],
    staleTime: 30_000,
    queryFn: async () => {
      const responses = await Promise.all(
        orderStatusTabs.map((tab) =>
          getOrders({ page: 1, pageSize: 1, status: tab.status }),
        ),
      );
      return Object.fromEntries(
        orderStatusTabs.map((tab, index) => [tab.key, responses[index].total]),
      ) as Record<(typeof orderStatusTabs)[number]['key'], number>;
    },
  });

  const handleOrderStatusTabChange = (key: string) => {
    const next = new URLSearchParams(searchParams);
    if (key === 'all') {
      next.delete('statusTab');
    } else {
      next.set('statusTab', key);
    }
    setSearchParams(next, { replace: true });
  };

  // 获取订单商品操作按钮
  const getActionButton = (record: Order) => {
    if (record.status === 'PENDING_SHIPMENT') {
      return (
        <Button
          size="small"
          style={{ backgroundColor: '#fa8c16', borderColor: '#fa8c16', color: '#fff' }}
          onClick={() => navigate(`/orders/${record.id}`)}
        >
          去发货
        </Button>
      );
    }
    if (record.status === 'SHIPPED') {
      return (
        <Button type="link" size="small" onClick={() => navigate(`/orders/${record.id}`)}>
          查看物流
        </Button>
      );
    }
    return (
      <Button type="link" size="small" onClick={() => navigate(`/orders/${record.id}`)}>
        查看详情
      </Button>
    );
  };

  const columns: ProColumns<Order>[] = [
    {
      title: '商品信息',
      width: 280,
      search: false,
      render: (_, r) => {
        const firstItem = r.items[0];
        const totalQty = r.items.reduce((sum, i) => sum + i.quantity, 0);
        const imageUrl = firstItem?.imageUrl;
        return (
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <Avatar
              shape="square"
              size={48}
              src={imageUrl}
              icon={!imageUrl ? <ShoppingOutlined /> : undefined}
              style={{
                flexShrink: 0,
                backgroundColor: imageUrl ? undefined : '#f0f0f0',
                color: '#999',
              }}
            />
            <div style={{ minWidth: 0, flex: 1 }}>
              <div
                style={{
                  fontWeight: 500,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                  lineHeight: '20px',
                }}
              >
                {firstItem?.title || '-'}
              </div>
              <div style={{ fontSize: 12, color: '#999', marginTop: 2 }}>
                {r.items.length > 1 ? `共 ${r.items.length} 种 / ${totalQty} 件` : `${totalQty} 件`}
              </div>
            </div>
          </div>
        );
      },
    },
    {
      title: '订单号',
      dataIndex: 'id',
      width: 120,
      ellipsis: true,
      copyable: true,
      render: (_, r) => (
        <Typography.Text
          copyable={{ text: r.id, tooltips: ['复制完整订单号', '已复制'] }}
          style={{ fontSize: 13, fontFamily: 'monospace' }}
        >
          {shortOrderId(r.id)}
        </Typography.Text>
      ),
    },
    {
      title: '买家',
      dataIndex: 'buyerAlias',
      width: 160,
      search: false,
      render: (_, r) => (
        <Space direction="vertical" size={0}>
          <span style={{ fontSize: 13 }}>{r.buyerAlias}</span>
          {r.buyerNo && (
            <Typography.Text
              type="secondary"
              copyable={{ text: r.buyerNo, tooltips: ['复制用户编号', '已复制'] }}
              style={{ fontSize: 12, fontFamily: 'monospace' }}
            >
              {r.buyerNo}
            </Typography.Text>
          )}
        </Space>
      ),
    },
    {
      title: '状态',
      dataIndex: 'status',
      width: 90,
      search: false,
      render: (_, r) => {
        const s = getStatusDisplay(orderStatusMap, r.status);
        return <Tag color={s.color}>{s.text}</Tag>;
      },
    },
    {
      title: '下单时间',
      dataIndex: 'createdDate',
      width: 110,
      search: false,
      render: (_, r) => (
        <span style={{ fontSize: 13, color: '#666' }}>{r.createdDate}</span>
      ),
    },
    {
      title: '操作',
      width: 100,
      fixed: 'right',
      search: false,
      render: (_, r) => getActionButton(r),
    },
  ];

  return (
    <div>
      {/* 顶部统计卡片 */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(4, 1fr)',
          gap: 16,
          marginBottom: 16,
        }}
      >
        <Card
          size="small"
          hoverable
          style={{ cursor: 'pointer' }}
          onClick={() => handleOrderStatusTabChange('pending')}
        >
          <Statistic
            title="待发货"
            value={orderTabCounts?.pending ?? 0}
            prefix={<ClockCircleOutlined style={{ color: '#fa8c16' }} />}
            valueStyle={{ color: '#fa8c16', fontSize: 28 }}
          />
        </Card>
        <Card size="small">
          <Statistic
            title="已发货"
            value={orderTabCounts?.shipped ?? 0}
            prefix={<SendOutlined style={{ color: '#1677ff' }} />}
            valueStyle={{ color: '#1677ff', fontSize: 28 }}
          />
        </Card>
        <Card size="small">
          <Statistic
            title="已完成"
            value={orderTabCounts?.completed ?? 0}
            prefix={<FileTextOutlined style={{ color: '#52c41a' }} />}
            valueStyle={{ color: '#52c41a', fontSize: 28 }}
          />
        </Card>
        <Card size="small">
          <Statistic
            title="已取消"
            value={orderTabCounts?.cancelled ?? 0}
            prefix={<InboxOutlined style={{ color: '#722ed1' }} />}
            valueStyle={{ color: '#722ed1', fontSize: 28 }}
          />
        </Card>
      </div>

      {/* 状态筛选 Tab */}
      <div
        style={{
          display: 'flex',
          gap: 8,
          marginBottom: 16,
          flexWrap: 'wrap',
        }}
      >
        {orderStatusTabs.map((tab) => {
          const isActive = activeOrderStatusTab === tab.key;
          const count = orderTabCounts?.[tab.key];
          return (
            <Button
              key={tab.key}
              type={isActive ? 'primary' : 'default'}
              size="middle"
              onClick={() => handleOrderStatusTabChange(tab.key)}
              style={{
                borderRadius: 20,
                ...(isActive ? {} : { borderColor: '#d9d9d9' }),
              }}
            >
              {tab.label}
              {typeof count === 'number' && count > 0 && (
                <Badge
                  count={count}
                  size="small"
                  style={{
                    marginLeft: 6,
                    ...(tab.key === 'pending' && !isActive
                      ? { backgroundColor: '#ff4d4f' }
                      : {}),
                  }}
                />
              )}
            </Button>
          );
        })}
      </div>

      {/* 订单表格 */}
      <ProTable<Order>
        actionRef={actionRef}
        columns={columns}
        rowKey="id"
        scroll={{ x: 900 }}
        tableAlertRender={false}
        rowClassName={(record) => record.status === 'PENDING_SHIPMENT' ? 'row-pending-ship' : ''}
        params={{ statusScope: activeOrderStatusTab }}
        // 30s 自动轮询，配合 visibilitychange 回前台立即拉，覆盖买家 app 付款后卖家需要手动刷新的场景
        polling={30_000}
        request={async (params) => {
          const res = await getOrders({
            page: params.current || 1,
            pageSize: params.pageSize || 20,
            status: currentStatusFilter,
          });
          return { data: res.items, total: res.total, success: true };
        }}
        pagination={{ defaultPageSize: 20, showSizeChanger: true }}
        search={{ labelWidth: 'auto', collapsed: true, collapseRender: (collapsed) => collapsed ? '展开筛选' : '收起' }}
        headerTitle={
          <Space>
            <InboxOutlined />
            <span>订单列表</span>
          </Space>
        }
        toolBarRender={() => []}
        locale={{
          emptyText: (
            <div style={{ padding: '40px 0', color: '#999' }}>
              <InboxOutlined style={{ fontSize: 48, marginBottom: 16, display: 'block' }} />
              暂无订单数据
            </div>
          ),
        }}
      />
    </div>
  );
}
