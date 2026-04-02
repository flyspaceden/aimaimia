import { useRef, useState } from 'react';
import { ProTable } from '@ant-design/pro-components';
import type { ActionType, ProColumns } from '@ant-design/pro-components';
import {
  Button,
  Tag,
  message,
  Modal,
  Input,
  Descriptions,
  Space,
  Popconfirm,
  Timeline,
  Divider,
  Typography,
  Tooltip,
  Table,
} from 'antd';
import {
  CheckCircleOutlined,
  CloseCircleOutlined,
  InfoCircleOutlined,
  HistoryOutlined,
} from '@ant-design/icons';
import { getRefunds, arbitrateRefund } from '@/api/refunds';
import PermissionGate from '@/components/PermissionGate';
import { PERMISSIONS } from '@/constants/permissions';
import { refundStatusMap, paymentChannelMap, orderStatusMap } from '@/constants/statusMaps';
import type { Refund, RefundStatusHistoryItem } from '@/types';
import dayjs from 'dayjs';

const { Text } = Typography;

/** 支付渠道标签渲染 */
function renderPaymentChannel(channel?: string | null) {
  if (!channel) return <Text type="secondary">-</Text>;
  const entry = paymentChannelMap[channel];
  return <Tag color={entry?.color || 'default'}>{entry?.text || channel}</Tag>;
}

/** 退款状态历史时间线渲染 */
function renderStatusTimeline(history?: RefundStatusHistoryItem[]) {
  if (!history || history.length === 0) {
    return <Text type="secondary">暂无处理记录</Text>;
  }
  return (
    <Timeline
      style={{ marginTop: 8, marginBottom: 0 }}
      items={history.map((h) => {
        const toStatusEntry = refundStatusMap[h.toStatus];
        // 判断是否为卖家操作（非管理员仲裁的REJECTED即卖家拒绝）
        const isSeller = h.toStatus === 'REJECTED' && !h.remark?.includes('管理员仲裁');
        return {
          color: toStatusEntry?.color || 'gray',
          children: (
            <div>
              <div>
                <Tag color={toStatusEntry?.color} style={{ marginRight: 4 }}>
                  {toStatusEntry?.text || h.toStatus}
                </Tag>
                {isSeller && (
                  <Tag color="orange" style={{ fontSize: 11 }}>卖家操作</Tag>
                )}
                <Text type="secondary" style={{ fontSize: 12 }}>
                  {dayjs(h.createdAt).format('YYYY-MM-DD HH:mm:ss')}
                </Text>
              </div>
              {h.remark && (
                <Text style={{ fontSize: 12, display: 'block', marginTop: 2 }}>
                  备注：{h.remark}
                </Text>
              )}
            </div>
          ),
        };
      })}
    />
  );
}

export default function RefundListPage() {
  const actionRef = useRef<ActionType>(null);
  const [arbitrateModal, setArbitrateModal] = useState<{ visible: boolean; refund: Refund | null }>({
    visible: false,
    refund: null,
  });
  const [arbitrateReason, setArbitrateReason] = useState('');
  const [arbitrateLoading, setArbitrateLoading] = useState(false);

  const handleArbitrate = async (status: 'APPROVED' | 'REJECTED') => {
    const refund = arbitrateModal.refund;
    if (!refund) return;
    setArbitrateLoading(true);
    try {
      await arbitrateRefund(refund.id, {
        status,
        reason: arbitrateReason || undefined,
      });
      message.success(status === 'APPROVED' ? '仲裁通过 — 已强制退款' : '仲裁拒绝 — 维持卖家决定');
      setArbitrateModal({ visible: false, refund: null });
      setArbitrateReason('');
      actionRef.current?.reload();
    } catch (err) {
      message.error(err instanceof Error ? err.message : '仲裁操作失败');
    } finally {
      setArbitrateLoading(false);
    }
  };

  const columns: ProColumns<Refund>[] = [
    { title: '退款单号', dataIndex: 'id', ellipsis: true, width: 180, copyable: true },
    {
      title: '退款金额',
      dataIndex: 'amount',
      width: 100,
      search: false,
      render: (_: unknown, r: Refund) => (
        <Text strong style={{ color: '#cf1322' }}>¥{r.amount.toFixed(2)}</Text>
      ),
    },
    {
      title: '退款原因',
      dataIndex: 'reason',
      width: 200,
      ellipsis: true,
      search: false,
      render: (_: unknown, r: Refund) => (
        <Tooltip title={r.reason}>
          <span>{r.reason || '-'}</span>
        </Tooltip>
      ),
    },
    {
      title: '支付渠道',
      width: 100,
      search: false,
      render: (_: unknown, r: Refund) => renderPaymentChannel(r.paymentChannel),
    },
    {
      title: '买家',
      width: 120,
      search: false,
      render: (_: unknown, r: Refund) => {
        const buyer = r.buyer;
        if (!buyer) return '-';
        return buyer.nickname || buyer.phone || '-';
      },
    },
    {
      title: '商家',
      width: 120,
      search: false,
      render: (_: unknown, r: Refund) => r.company?.name || '-',
    },
    {
      title: '状态',
      dataIndex: 'status',
      width: 100,
      valueEnum: Object.fromEntries(
        Object.entries(refundStatusMap).map(([k, v]) => [k, { text: v.text }]),
      ),
      render: (_: unknown, r: Refund) => {
        const s = refundStatusMap[r.status];
        return <Tag color={s?.color}>{s?.text || r.status}</Tag>;
      },
    },
    {
      title: '卖家处理',
      width: 100,
      search: false,
      render: (_: unknown, r: Refund) => {
        const history = r.statusHistory;
        if (!history || history.length <= 1) {
          return <Text type="secondary">待处理</Text>;
        }
        // 查找卖家的处理记录（非首次创建的 REJECTED 或 APPROVED）
        const sellerAction = history.find(
          (h) => h.fromStatus && ['REJECTED', 'APPROVED'].includes(h.toStatus),
        );
        if (!sellerAction) return <Text type="secondary">待处理</Text>;
        const entry = refundStatusMap[sellerAction.toStatus];
        return (
          <Tooltip title={sellerAction.remark || '无备注'}>
            <Tag color={entry?.color}>{entry?.text || sellerAction.toStatus}</Tag>
          </Tooltip>
        );
      },
    },
    {
      title: '关联订单',
      dataIndex: 'orderId',
      width: 180,
      ellipsis: true,
      render: (_: unknown, r: Refund) => (
        <a onClick={() => window.open(`/orders/${r.orderId}`, '_blank')}>{r.orderId}</a>
      ),
    },
    {
      title: '申请时间',
      dataIndex: 'createdAt',
      width: 160,
      search: false,
      render: (_: unknown, r: Refund) => dayjs(r.createdAt).format('YYYY-MM-DD HH:mm'),
    },
    {
      title: '操作',
      width: 100,
      search: false,
      fixed: 'right',
      render: (_: unknown, r: Refund) => {
        // 只有待处理或被卖家拒绝的退款可仲裁
        const canArbitrate = ['REQUESTED', 'REJECTED'].includes(r.status);
        if (!canArbitrate) return null;
        return (
          <PermissionGate permission={PERMISSIONS.ORDERS_REFUND}>
            <Button
              type="link"
              size="small"
              onClick={() => setArbitrateModal({ visible: true, refund: r })}
            >
              仲裁
            </Button>
          </PermissionGate>
        );
      },
    },
  ];

  // 仲裁弹窗中的退款单
  const refund = arbitrateModal.refund;

  return (
    <div style={{ padding: 24 }}>
      <ProTable<Refund>
        headerTitle="售后仲裁"
        actionRef={actionRef}
        columns={columns}
        rowKey="id"
        scroll={{ x: 1460 }}
        request={async (params) => {
          const res = await getRefunds({
            page: params.current || 1,
            pageSize: params.pageSize || 20,
            status: params.status || '',
            keyword: params.id || '',
          });
          return { data: res.items, total: res.total, success: true };
        }}
        pagination={{ defaultPageSize: 20 }}
        search={{ labelWidth: 'auto' }}
      />

      {/* 仲裁弹窗 — 增强上下文信息 */}
      <Modal
        title={
          <Space>
            <InfoCircleOutlined />
            售后仲裁
          </Space>
        }
        open={arbitrateModal.visible}
        width={720}
        onCancel={() => { setArbitrateModal({ visible: false, refund: null }); setArbitrateReason(''); }}
        footer={
          <Space>
            <Button
              danger
              icon={<CloseCircleOutlined />}
              loading={arbitrateLoading}
              onClick={() => handleArbitrate('REJECTED')}
            >
              拒绝退款（维持卖家决定）
            </Button>
            {/* I26修复：强制退款操作添加确认弹窗 */}
            <Popconfirm
              title="确认强制退款"
              description="此操作将直接触发退款流程，不可撤销。确定继续？"
              onConfirm={() => handleArbitrate('APPROVED')}
              okText="确认退款"
              cancelText="取消"
              okButtonProps={{ danger: true }}
            >
              <Button
                type="primary"
                icon={<CheckCircleOutlined />}
                loading={arbitrateLoading}
              >
                同意退款（强制退款）
              </Button>
            </Popconfirm>
          </Space>
        }
      >
        {refund && (
          <>
            {/* 退款基本信息 */}
            <Descriptions
              column={2}
              size="small"
              bordered
              style={{ marginBottom: 16 }}
              title="退款信息"
            >
              <Descriptions.Item label="退款单号">{refund.id}</Descriptions.Item>
              <Descriptions.Item label="退款金额">
                <Text strong style={{ color: '#cf1322' }}>¥{refund.amount.toFixed(2)}</Text>
              </Descriptions.Item>
              <Descriptions.Item label="退款状态">
                <Tag color={refundStatusMap[refund.status]?.color}>
                  {refundStatusMap[refund.status]?.text}
                </Tag>
              </Descriptions.Item>
              <Descriptions.Item label="申请时间">
                {dayjs(refund.createdAt).format('YYYY-MM-DD HH:mm:ss')}
              </Descriptions.Item>
              <Descriptions.Item label="退款原因" span={2}>{refund.reason}</Descriptions.Item>
            </Descriptions>

            {/* 订单与支付信息 */}
            <Descriptions
              column={2}
              size="small"
              bordered
              style={{ marginBottom: 16 }}
              title="订单与支付信息"
            >
              <Descriptions.Item label="关联订单">
                <a onClick={() => window.open(`/orders/${refund.orderId}`, '_blank')}>
                  {refund.orderId}
                </a>
              </Descriptions.Item>
              <Descriptions.Item label="订单状态">
                {refund.order?.status ? (
                  <Tag color={orderStatusMap[refund.order.status]?.color}>
                    {orderStatusMap[refund.order.status]?.text || refund.order.status}
                  </Tag>
                ) : '-'}
              </Descriptions.Item>
              <Descriptions.Item label="订单金额">
                ¥{refund.order?.totalAmount?.toFixed(2) || '-'}
              </Descriptions.Item>
              <Descriptions.Item label="支付渠道">
                {renderPaymentChannel(refund.paymentChannel)}
              </Descriptions.Item>
              <Descriptions.Item label="支付时间">
                {refund.order?.paidAt ? dayjs(refund.order.paidAt).format('YYYY-MM-DD HH:mm:ss') : '-'}
              </Descriptions.Item>
              <Descriptions.Item label="下单时间">
                {refund.order?.createdAt ? dayjs(refund.order.createdAt).format('YYYY-MM-DD HH:mm:ss') : '-'}
              </Descriptions.Item>
            </Descriptions>

            {/* 买家与卖家信息 */}
            <Descriptions
              column={2}
              size="small"
              bordered
              style={{ marginBottom: 16 }}
              title="买卖双方"
            >
              <Descriptions.Item label="买家">
                {refund.buyer?.nickname || refund.buyer?.phone || '-'}
              </Descriptions.Item>
              <Descriptions.Item label="卖家企业">
                {refund.company?.name || '-'}
              </Descriptions.Item>
            </Descriptions>

            {/* 订单商品明细 */}
            {refund.order?.items && refund.order.items.length > 0 && (
              <>
                <Divider style={{ margin: '12px 0' }} />
                <Text strong style={{ display: 'block', marginBottom: 8 }}>订单商品</Text>
                <Table
                  size="small"
                  dataSource={refund.order.items}
                  rowKey="id"
                  pagination={false}
                  columns={[
                    {
                      title: '商品',
                      dataIndex: 'productTitle',
                      render: (text: string, item: any) => text || item.skuName || '-',
                    },
                    {
                      title: '规格',
                      dataIndex: 'skuName',
                      width: 100,
                      render: (text: string) => text || '-',
                    },
                    {
                      title: '数量',
                      dataIndex: 'quantity',
                      width: 60,
                      align: 'center' as const,
                    },
                    {
                      title: '单价',
                      dataIndex: 'unitPrice',
                      width: 80,
                      render: (v: number) => `¥${v?.toFixed(2) || '-'}`,
                    },
                    {
                      title: '小计',
                      dataIndex: 'totalPrice',
                      width: 80,
                      render: (v: number) => `¥${v?.toFixed(2) || '-'}`,
                    },
                  ]}
                />
              </>
            )}

            {/* 卖家处理记录（状态变更时间线） */}
            <Divider style={{ margin: '12px 0' }} />
            <Space style={{ marginBottom: 8 }}>
              <HistoryOutlined />
              <Text strong>处理记录</Text>
            </Space>
            {renderStatusTimeline(refund.statusHistory)}

            {/* 仲裁说明输入 */}
            <Divider style={{ margin: '12px 0' }} />
            <Text strong style={{ display: 'block', marginBottom: 8 }}>仲裁说明</Text>
            <Input.TextArea
              rows={3}
              placeholder="仲裁说明（可选）— 将追加到退款原因中"
              value={arbitrateReason}
              onChange={(e) => setArbitrateReason(e.target.value)}
            />
          </>
        )}
      </Modal>
    </div>
  );
}
