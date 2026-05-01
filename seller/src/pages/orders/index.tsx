import { useEffect, useRef, useState, type Key } from 'react';
import {
  App,
  Avatar,
  Badge,
  Button,
  Card,
  Modal,
  Space,
  Statistic,
  Tag,
  Typography,
} from 'antd';
import type { TableProps } from 'antd/es/table';
import {
  ClockCircleOutlined,
  FileTextOutlined,
  PrinterOutlined,
  SendOutlined,
  ShoppingOutlined,
  DollarOutlined,
  InboxOutlined,
} from '@ant-design/icons';
import { ProTable } from '@ant-design/pro-components';
import type { ActionType, ProColumns } from '@ant-design/pro-components';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  batchGenerateWaybill,
  batchShipOrders,
  getOrders,
} from '@/api/orders';
import { getOverview } from '@/api/analytics';
import { orderStatusMap } from '@/constants/statusMaps';
import type { Order } from '@/types';
import useAuthStore from '@/store/useAuthStore';

const orderStatusTabs = [
  { key: 'all', label: '全部', status: '' },
  { key: 'pending', label: '待发货', status: 'PAID' },
  { key: 'shipped', label: '已发货', status: 'SHIPPED' },
  { key: 'completed', label: '已完成', status: 'DELIVERED,RECEIVED' },
  { key: 'cancelled', label: '已取消', status: 'CANCELED,REFUNDED' },
] as const;

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function isWaybillPending(order: Order): boolean {
  return order.status === 'PAID' && !order.shipment?.waybillNo;
}

function canBatchShip(order: Order): boolean {
  return (
    ['PAID', 'SHIPPED'].includes(order.status) &&
    order.shipment?.status === 'INIT' &&
    Boolean(order.shipment?.waybillNo)
  );
}

// 格式化订单号：截取后 8 位展示
function shortOrderId(id: string): string {
  if (id.length <= 8) return id;
  return `...${id.slice(-8)}`;
}

export default function OrderListPage() {
  const { message, modal } = App.useApp();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const actionRef = useRef<ActionType>(null);
  const [searchParams, setSearchParams] = useSearchParams();
  const [orders, setOrders] = useState<Order[]>([]);
  const [selectedRowKeys, setSelectedRowKeys] = useState<Key[]>([]);
  const [carrierModalOpen, setCarrierModalOpen] = useState(false);
  const [batchGenerating, setBatchGenerating] = useState(false);
  const [batchShipping, setBatchShipping] = useState(false);

  const activeOrderStatusTab = orderStatusTabs.some(
    (tab) => tab.key === searchParams.get('statusTab'),
  )
    ? (searchParams.get('statusTab') as (typeof orderStatusTabs)[number]['key'])
    : 'all';
  const currentStatusFilter =
    orderStatusTabs.find((tab) => tab.key === activeOrderStatusTab)?.status || '';
  const canBatchManage = useAuthStore((s) => s.hasRole('OWNER', 'MANAGER'));
  const selectedOrders = orders.filter((order) => selectedRowKeys.includes(order.id));

  // 页面回到前台立即拉一次（弥补 polling 30s 的等待）
  // 买家 app 付款 → 后端建单后，卖家从其他 tab 切回来瞬间就能看到新单 + tab counts 同步刷新
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === 'visible') {
        actionRef.current?.reload();
        queryClient.invalidateQueries({ queryKey: ['seller-order-tab-counts'] });
        queryClient.invalidateQueries({ queryKey: ['seller-analytics-overview'] });
      }
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [queryClient]);
  const pendingWaybillOrders = selectedOrders.filter(isWaybillPending);
  const printableOrders = selectedOrders.filter((order) => order.shipment?.waybillPrintUrl);
  const shippableOrders = selectedOrders.filter(canBatchShip);

  // 概览统计数据
  const { data: overview } = useQuery({
    queryKey: ['seller-analytics-overview'],
    queryFn: getOverview,
    staleTime: 30_000,
  });

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

  const resetSelection = () => setSelectedRowKeys([]);

  const handleOrderStatusTabChange = (key: string) => {
    const next = new URLSearchParams(searchParams);
    resetSelection();
    if (key === 'all') {
      next.delete('statusTab');
    } else {
      next.set('statusTab', key);
    }
    setSearchParams(next, { replace: true });
  };

  const showBatchResult = (
    title: string,
    results: Array<{ orderId: string; success: boolean; error?: string }>,
  ) => {
    const successCount = results.filter((item) => item.success).length;
    const failed = results.filter((item) => !item.success);

    if (failed.length === 0) {
      message.success(`${title}成功，共 ${successCount} 条`);
      return;
    }

    modal.info({
      title: `${title}完成`,
      width: 640,
      content: (
        <div>
          <p>成功 {successCount} 条，失败 {failed.length} 条。</p>
          <div style={{ maxHeight: 260, overflow: 'auto' }}>
            {failed.map((item) => (
              <div key={item.orderId} style={{ marginBottom: 8 }}>
                <strong>{item.orderId}</strong>
                <div style={{ color: '#666' }}>{item.error || '未知错误'}</div>
              </div>
            ))}
          </div>
        </div>
      ),
    });
  };

  const handleBatchGenerateWaybill = async () => {
    if (pendingWaybillOrders.length === 0) {
      message.warning('请选择待发货且尚未生成面单的订单');
      return;
    }

    setBatchGenerating(true);
    try {
      const result = await batchGenerateWaybill(
        pendingWaybillOrders.map((order) => ({
          orderId: order.id,
          carrierCode: 'SF',
        })),
      );
      setCarrierModalOpen(false);
      resetSelection();
      showBatchResult('批量生成面单', result.results);
      actionRef.current?.reload();
    } catch (err) {
      message.error(err instanceof Error ? err.message : '批量生成面单失败');
    } finally {
      setBatchGenerating(false);
    }
  };

  const handleBatchShip = () => {
    if (shippableOrders.length === 0) {
      message.warning('请选择已生成面单且待发货的订单');
      return;
    }

    modal.confirm({
      title: `确认批量发货 ${shippableOrders.length} 个订单？`,
      content: '批量发货会逐单执行，失败的订单会保留错误原因。',
      onOk: async () => {
        setBatchShipping(true);
        try {
          const result = await batchShipOrders(
            shippableOrders.map((order) => ({ orderId: order.id })),
          );
          resetSelection();
          showBatchResult('批量确认发货', result.results);
          queryClient.invalidateQueries({ queryKey: ['seller-order-tab-counts'] });
          queryClient.invalidateQueries({ queryKey: ['seller-analytics-overview'] });
          queryClient.invalidateQueries({ queryKey: ['seller-analytics-orders'] });
          actionRef.current?.reload();
        } catch (err) {
          message.error(err instanceof Error ? err.message : '批量发货失败');
        } finally {
          setBatchShipping(false);
        }
      },
    });
  };

  const handleBatchPrint = () => {
    if (printableOrders.length === 0) {
      message.warning('请选择已生成面单的订单');
      return;
    }

    const urls = printableOrders
      .map((order) => order.shipment?.waybillPrintUrl)
      .filter((url): url is string => Boolean(url));

    const printWindow = window.open('', '_blank', 'noopener,noreferrer');
    if (!printWindow) {
      message.error('浏览器拦截了打印窗口，请允许弹窗后重试');
      return;
    }

    const pages = printableOrders
      .map((order, index) => {
        const url = urls[index];
        return `
          <section class="page">
            <header>订单 ${escapeHtml(order.id)}</header>
            <img src="${escapeHtml(url)}" alt="waybill-${escapeHtml(order.id)}" />
          </section>
        `;
      })
      .join('');

    printWindow.document.write(`
      <html>
        <head>
          <title>批量打印面单</title>
          <style>
            body { margin: 0; font-family: Arial, sans-serif; background: #f5f5f5; }
            .page { page-break-after: always; padding: 16px; background: #fff; }
            .page:last-child { page-break-after: auto; }
            header { margin-bottom: 12px; font-size: 14px; color: #666; }
            img { width: 100%; height: auto; display: block; border: 1px solid #eee; }
            @media print {
              body { background: #fff; }
              .page { padding: 0; }
              header { display: none; }
              img { border: 0; }
            }
          </style>
        </head>
        <body>${pages}</body>
      </html>
    `);
    printWindow.document.close();
    printWindow.onload = () => {
      printWindow.focus();
      printWindow.print();
    };
  };

  // 获取订单商品操作按钮
  const getActionButton = (record: Order) => {
    if (record.status === 'PAID' && !record.shipment?.waybillNo) {
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
    if (record.status === 'PAID' && record.shipment?.waybillNo) {
      return (
        <Button
          size="small"
          style={{ color: '#fa8c16', borderColor: '#fa8c16' }}
          onClick={() => navigate(`/orders/${record.id}`)}
        >
          确认发货
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
                {r.bizType === 'VIP_PACKAGE' && (
                  <Tag color="#C9A96E" style={{ color: '#fff', marginLeft: 6, fontSize: 11, lineHeight: '16px', padding: '0 4px' }}>
                    VIP
                  </Tag>
                )}
                {r.items.some((item) => item.isPrize) && (
                  <Tag color="gold" style={{ marginLeft: 6, fontSize: 11, lineHeight: '16px', padding: '0 4px' }}>
                    奖品
                  </Tag>
                )}
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
      title: '类型',
      dataIndex: 'bizType',
      width: 100,
      hideInTable: true,
      valueType: 'select',
      valueEnum: {
        VIP_PACKAGE: { text: 'VIP礼包' },
        LOTTERY_PRIZE: { text: '抽奖奖品' },
        NORMAL_GOODS: { text: '普通订单' },
      },
    },
    {
      title: '买家',
      dataIndex: 'buyerAlias',
      width: 90,
      search: false,
      render: (_, r) => (
        <span style={{ fontSize: 13 }}>{r.buyerAlias}</span>
      ),
    },
    {
      title: '金额',
      dataIndex: 'totalAmount',
      width: 100,
      search: false,
      sorter: true,
      render: (_, r) => (
        <span style={{ fontWeight: 500, fontFamily: 'monospace' }}>
          ¥{r.totalAmount.toFixed(2)}
        </span>
      ),
    },
    {
      title: '状态',
      dataIndex: 'status',
      width: 90,
      search: false,
      render: (_, r) => {
        const s = orderStatusMap[r.status];
        return <Tag color={s?.color}>{s?.text || r.status}</Tag>;
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

  const rowSelection: TableProps<Order>['rowSelection'] = canBatchManage
    ? {
        selectedRowKeys,
        onChange: (keys) => setSelectedRowKeys(keys),
      }
    : undefined;

  const hasSelection = selectedRowKeys.length > 0;

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
            value={overview?.today.pendingShipCount ?? orderTabCounts?.pending ?? 0}
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
            title="今日订单"
            value={overview?.today.orderCount ?? 0}
            prefix={<FileTextOutlined style={{ color: '#52c41a' }} />}
            valueStyle={{ color: '#52c41a', fontSize: 28 }}
          />
        </Card>
        <Card size="small">
          <Statistic
            title="本月营收"
            value={overview?.month.revenue ?? 0}
            precision={2}
            prefix={<DollarOutlined style={{ color: '#722ed1' }} />}
            valueStyle={{ color: '#722ed1', fontSize: 28 }}
            suffix="元"
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
        rowSelection={rowSelection}
        tableAlertRender={false}
        rowClassName={(record) => record.status === 'PAID' ? 'row-pending-ship' : ''}
        params={{ statusScope: activeOrderStatusTab }}
        // 30s 自动轮询，配合 visibilitychange 回前台立即拉，覆盖买家 app 付款后卖家需要手动刷新的场景
        polling={30_000}
        request={async (params) => {
          const res = await getOrders({
            page: params.current || 1,
            pageSize: params.pageSize || 20,
            status: currentStatusFilter,
            bizType: params.bizType || '',
          });
          setOrders(res.items);
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

      {/* 浮动批量操作栏 — 仅勾选后显示 */}
      {canBatchManage && hasSelection && (
        <div
          style={{
            position: 'fixed',
            bottom: 24,
            left: '50%',
            transform: 'translateX(-50%)',
            zIndex: 100,
            background: '#fff',
            borderRadius: 12,
            boxShadow: '0 6px 24px rgba(0,0,0,0.15)',
            padding: '12px 24px',
            display: 'flex',
            alignItems: 'center',
            gap: 12,
          }}
        >
          <Typography.Text strong>
            已选 {selectedOrders.length} 单
          </Typography.Text>
          <div style={{ width: 1, height: 24, background: '#e8e8e8' }} />
          <Button
            type="primary"
            disabled={pendingWaybillOrders.length === 0}
            onClick={() => setCarrierModalOpen(true)}
          >
            生成面单 ({pendingWaybillOrders.length})
          </Button>
          <Button
            icon={<PrinterOutlined />}
            disabled={printableOrders.length === 0}
            onClick={handleBatchPrint}
          >
            打印 ({printableOrders.length})
          </Button>
          <Button
            icon={<SendOutlined />}
            loading={batchShipping}
            disabled={shippableOrders.length === 0}
            onClick={handleBatchShip}
          >
            发货 ({shippableOrders.length})
          </Button>
          <Button type="text" onClick={resetSelection}>
            取消
          </Button>
        </div>
      )}

      {/* 批量生成面单弹窗 */}
      <Modal
        title="批量生成面单（顺丰速运）"
        open={carrierModalOpen}
        onCancel={() => {
          if (batchGenerating) return;
          setCarrierModalOpen(false);
        }}
        onOk={handleBatchGenerateWaybill}
        okText="生成"
        cancelText="取消"
        confirmLoading={batchGenerating}
      >
        <Typography.Text type="secondary">
          当前可生成面单的已选订单：{pendingWaybillOrders.length} 条，快递公司：顺丰速运
        </Typography.Text>
      </Modal>
    </div>
  );
}
