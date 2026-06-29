import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  Alert,
  App,
  Avatar,
  Button,
  Card,
  Descriptions,
  Space,
  Spin,
  Steps,
  Tag,
  Tooltip,
  Typography,
} from 'antd';
import {
  ArrowLeftOutlined,
  CheckCircleOutlined,
  ClockCircleOutlined,
  CloseCircleOutlined,
  PhoneOutlined,
  PrinterOutlined,
  SendOutlined,
  ShoppingOutlined,
  TruckOutlined,
} from '@ant-design/icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  getOrder,
  shipOrder,
  generateWaybill,
  cancelWaybill,
  bindVirtualCall,
} from '@/api/orders';
import { orderStatusMap, refundStatusMap, shipmentStatusMap } from '@/constants/statusMaps';
import useAuthStore from '@/store/useAuthStore';
import {
  buildPickingSheetHtml,
  printSellerWaybill,
  resolveBundleComponentQuantity,
} from '@/utils/waybillPrint';
import dayjs from 'dayjs';

// 根据订单状态和物流状态计算进度步骤
function getOrderStep(order: {
  status: string;
  shipment?: { status: string; waybillNo?: string } | null;
}): number {
  const { status, shipment } = order;
  if (['CANCELED', 'REFUNDED'].includes(status)) return -1;
  if (status === 'RECEIVED') return 4;
  if (status === 'DELIVERED') return 3;
  if (status === 'SHIPPED') {
    if (shipment?.status === 'DELIVERED') return 3;
    return 2;
  }
  if (status === 'PAID') {
    if (shipment?.waybillNo) return 1;
    return 0;
  }
  return 0;
}

const formatWaybillError = (err: unknown) => {
  const raw = err instanceof Error ? err.message : '';
  if (/对方.*(电话|手机).*不合法|收(件|方).*(电话|手机).*不合法/.test(raw)) {
    return '收货手机号无法生成顺丰面单，系统已通知买家修改收货信息。买家修改后可重新生成面单。';
  }
  return raw || '面单生成失败';
};

export default function OrderDetailPage() {
  const { message, modal } = App.useApp();
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [shipping, setShipping] = useState(false);
  const [generatingWaybill, setGeneratingWaybill] = useState(false);
  const [callingBuyer, setCallingBuyer] = useState(false);
  const { hasRole } = useAuthStore();

  const { data: order, isLoading } = useQuery({
    queryKey: ['seller-order', id],
    queryFn: () => getOrder(id!),
    enabled: !!id,
  });

  const handleShip = async () => {
    setShipping(true);
    try {
      await shipOrder(id!);
      message.success('发货成功');
      queryClient.invalidateQueries({ queryKey: ['seller-order', id] });
      queryClient.invalidateQueries({ queryKey: ['seller-order-tab-counts'] });
      queryClient.invalidateQueries({ queryKey: ['seller-analytics-overview'] });
      queryClient.invalidateQueries({ queryKey: ['seller-analytics-orders'] });
    } catch (err) {
      message.error(err instanceof Error ? err.message : '发货失败');
    } finally {
      setShipping(false);
    }
  };

  const handleGenerateWaybill = async (carrierCode: string) => {
    setGeneratingWaybill(true);
    try {
      const result = await generateWaybill(id!, carrierCode);
      message.success(`面单生成成功：${result.waybillNo}`);
      queryClient.invalidateQueries({ queryKey: ['seller-order', id] });
    } catch (err) {
      message.error(formatWaybillError(err));
    } finally {
      setGeneratingWaybill(false);
    }
  };

  const handleCancelWaybill = () => {
    modal.confirm({
      title: '确认取消面单？',
      content: '取消后需重新生成面单',
      onOk: async () => {
        try {
          await cancelWaybill(id!);
          message.success('面单已取消');
          queryClient.invalidateQueries({ queryKey: ['seller-order', id] });
        } catch (err) {
          message.error(err instanceof Error ? err.message : '取消失败');
        }
      },
    });
  };

  const handlePrintWaybill = () => {
    if (!order) return;
    const result = printSellerWaybill(order);
    if (result === 'blocked') {
      message.error('浏览器拦截了打印窗口，请允许弹窗后重试');
    }
  };

  const handleCallBuyer = async () => {
    setCallingBuyer(true);
    try {
      const result = await bindVirtualCall(id!);
      modal.info({
        title: '联系买家',
        content: (
          <div>
            <p>虚拟号码：<strong>{result.virtualNumber}</strong></p>
            <p>有效期至：{dayjs(result.expireAt).format('YYYY-MM-DD HH:mm')}</p>
            <p>剩余通话次数：{result.remainingCalls}</p>
            <p style={{ color: '#999', fontSize: 12, marginTop: 8 }}>
              请使用此虚拟号码联系买家，通话结束后号码将在到期后自动解绑。
            </p>
          </div>
        ),
      });
    } catch (err) {
      message.error(err instanceof Error ? err.message : '获取虚拟号码失败');
    } finally {
      setCallingBuyer(false);
    }
  };

  const handlePrintPickingSheet = () => {
    if (!order) {
      return;
    }

    const printWindow = window.open('', '_blank', 'noopener,noreferrer');
    if (!printWindow) {
      message.warning('浏览器拦截了拣货单弹窗，请允许弹窗后重试');
      return;
    }

    printWindow.document.write(buildPickingSheetHtml(order));
    printWindow.document.close();
    printWindow.onload = () => {
      printWindow.focus();
      setTimeout(() => printWindow.print(), 200);
    };
  };

  if (isLoading || !order) {
    return <Spin size="large" style={{ display: 'block', margin: '100px auto' }} />;
  }

  const status = orderStatusMap[order.status];
  const refundStatus = order.refundSummary ? refundStatusMap[order.refundSummary.status] : null;
  const canCallBuyer =
    ['PAID', 'SHIPPED'].includes(order.status) && hasRole('OWNER', 'MANAGER');
  const canManageShipment =
    ['PAID', 'SHIPPED'].includes(order.status) &&
    (!order.shipment || order.shipment.status === 'INIT');
  const isCancelled = ['CANCELED', 'REFUNDED'].includes(order.status);
  const currentStep = getOrderStep(order);

  return (
    <div style={{ maxWidth: 900, margin: '0 auto' }}>
      {/* 顶部导航栏 */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: 20,
        }}
      >
        <Button
          icon={<ArrowLeftOutlined />}
          type="text"
          onClick={() => navigate('/orders')}
        >
          返回
        </Button>
        <Space>
          <Tag color={status?.color} style={{ fontSize: 14, padding: '2px 12px' }}>
            {status?.text || order.status}
          </Tag>
          {canCallBuyer && (
            <Tooltip title="通过平台虚拟号联系买家，保护双方隐私">
              <Button
                icon={<PhoneOutlined />}
                loading={callingBuyer}
                onClick={handleCallBuyer}
              >
                联系买家
              </Button>
            </Tooltip>
          )}
        </Space>
      </div>

      {/* VIP 提示 */}
      {order.bizType === 'VIP_PACKAGE' && (
        <Alert
          message="VIP 开通礼包 · 不支持退款"
          type="warning"
          showIcon
          banner
          style={{
            marginBottom: 16,
            backgroundColor: '#FFF8E6',
            border: '1px solid #C9A96E',
            borderRadius: 8,
          }}
        />
      )}

      {/* 订单进度 — 非取消/退款状态才显示 */}
      {!isCancelled && (
        <Card style={{ marginBottom: 16 }}>
          <Steps
            current={currentStep}
            size="small"
            items={[
              {
                title: '已付款',
                icon: <CheckCircleOutlined />,
                description: order.createdDate,
              },
              {
                title: '面单',
                icon: order.shipment?.waybillNo ? (
                  <CheckCircleOutlined />
                ) : (
                  <ClockCircleOutlined />
                ),
                description: order.shipment?.waybillNo ? '已生成' : '待生成',
              },
              {
                title: '已发货',
                icon:
                  currentStep >= 2 ? (
                    <SendOutlined />
                  ) : (
                    <ClockCircleOutlined />
                  ),
                description: order.shipment?.shippedAt
                  ? dayjs(order.shipment.shippedAt).format('MM-DD HH:mm')
                  : undefined,
              },
              {
                title: '运输中',
                icon: <TruckOutlined />,
              },
              {
                title: '已完成',
                icon: <CheckCircleOutlined />,
              },
            ]}
          />
        </Card>
      )}

      {/* 已取消/退款状态提示 */}
      {isCancelled && (
        <Alert
          message={
            order.status === 'CANCELED'
              ? '该订单已取消'
              : '该订单已退款'
          }
          type={order.status === 'CANCELED' ? 'info' : 'error'}
          showIcon
          icon={<CloseCircleOutlined />}
          style={{ marginBottom: 16, borderRadius: 8 }}
        />
      )}

      {order.refundSummary && (
        <Alert
          message={`退款${refundStatus?.text || order.refundSummary.status}`}
          description={`金额 ¥${order.refundSummary.amount.toFixed(2)}，原因：${order.refundSummary.reason}`}
          type={order.refundSummary.status === 'FAILED' ? 'error' : 'info'}
          showIcon
          style={{ marginBottom: 16, borderRadius: 8 }}
        />
      )}

      {/* 发货操作区 — 待发货状态醒目展示 */}
      {canManageShipment && (
        <Card
          style={{
            marginBottom: 16,
            border: '1px solid #fa8c16',
            borderRadius: 8,
          }}
          styles={{
            header: { backgroundColor: '#fff7e6', borderBottom: '1px solid #ffd591' },
          }}
          title={
            <Space>
              <SendOutlined style={{ color: '#fa8c16' }} />
              <span style={{ color: '#d46b08' }}>
                {!order.shipment?.waybillNo ? '生成电子面单' : '确认发货'}
              </span>
            </Space>
          }
        >
          {!order.shipment?.waybillNo ? (
            <div>
              <Typography.Paragraph type="secondary" style={{ marginBottom: 16 }}>
                生成电子面单后，平台将代为打印面单，卖家无需接触买家地址信息。
              </Typography.Paragraph>
              <Button
                type="primary"
                loading={generatingWaybill}
                size="large"
                onClick={() => handleGenerateWaybill('SF')}
              >
                生成面单（顺丰速运）
              </Button>
            </div>
          ) : (
            <div>
              <Typography.Paragraph type="secondary" style={{ marginBottom: 16 }}>
                面单已生成，打印清单只包含商品明细和数量，拣货核对后即可确认发货。
              </Typography.Paragraph>
              <Space size="middle">
                <Button
                  icon={<PrinterOutlined />}
                  size="large"
                  onClick={handlePrintWaybill}
                >
                  打印清单
                </Button>
                {order.shipment?.status === 'INIT' && (
                  <Button danger onClick={handleCancelWaybill}>
                    取消面单
                  </Button>
                )}
                <Button
                  type="primary"
                  size="large"
                  icon={<SendOutlined />}
                  loading={shipping}
                  onClick={handleShip}
                >
                  确认发货
                </Button>
              </Space>
            </div>
          )}
        </Card>
      )}

      {/* 订单信息 */}
      <Card title="订单信息" size="small" style={{ marginBottom: 16 }}>
        <Descriptions column={{ xs: 1, sm: 2 }} size="small">
          <Descriptions.Item label="订单号">
            <Typography.Text copyable style={{ fontFamily: 'monospace' }}>
              {order.id}
            </Typography.Text>
          </Descriptions.Item>
          <Descriptions.Item label="下单日期">{order.createdDate}</Descriptions.Item>
          <Descriptions.Item label="买家">
            <Space direction="vertical" size={0}>
              <span>{order.buyerAlias}</span>
              {order.buyerNo && (
                <Typography.Text
                  type="secondary"
                  copyable={{ text: order.buyerNo, tooltips: ['复制用户编号', '已复制'] }}
                  style={{ fontFamily: 'monospace' }}
                >
                  {order.buyerNo}
                </Typography.Text>
              )}
            </Space>
          </Descriptions.Item>
          <Descriptions.Item label="地区">{order.regionText || '-'}</Descriptions.Item>
          <Descriptions.Item label="发票状态">
            {order.invoiceStatus === 'REQUESTED' && <Tag color="orange">已申请</Tag>}
            {order.invoiceStatus === 'ISSUED' && <Tag color="green">已开票</Tag>}
            {order.invoiceStatus === 'FAILED' && <Tag color="red">开票失败</Tag>}
            {order.invoiceStatus === 'CANCELED' && <Tag color="default">已取消</Tag>}
            {!order.invoiceStatus && <span style={{ color: '#999' }}>未申请</span>}
          </Descriptions.Item>
        </Descriptions>
      </Card>

      {/* 商品清单 — 卡片式展示 */}
      <Card
        title={`商品清单 (${order.items.length})`}
        extra={(
          <Button icon={<PrinterOutlined />} onClick={handlePrintPickingSheet}>
            打印拣货单
          </Button>
        )}
        size="small"
        style={{ marginBottom: 16 }}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {order.items.map((item) => (
            <div
              key={item.id}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 12,
                padding: '8px 12px',
                background: '#fafafa',
                borderRadius: 8,
              }}
            >
              <Avatar
                shape="square"
                size={56}
                src={item.imageUrl}
                icon={!item.imageUrl ? <ShoppingOutlined /> : undefined}
                style={{
                  flexShrink: 0,
                  backgroundColor: item.imageUrl ? undefined : '#f0f0f0',
                  color: '#999',
                }}
              />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div
                  style={{
                    fontWeight: 500,
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {item.title || '-'}
                  </span>
                  {item.productType === 'BUNDLE' && (
                    <Tag color="blue" style={{ marginInlineEnd: 0, flexShrink: 0 }}>
                      组合
                    </Tag>
                  )}
                </div>
                <div style={{ fontSize: 12, color: '#999', marginTop: 2 }}>
                  <Space size={4} wrap>
                    {item.isPrize ? (
                      <Tag color="gold" style={{ fontSize: 11, lineHeight: '16px', padding: '0 4px' }}>
                        {item.prizeType === 'THRESHOLD_GIFT' ? '满额赠品' : item.prizeType === 'DISCOUNT_BUY' ? '特价购' : '抽奖奖品'}
                      </Tag>
                    ) : (
                      <Tag style={{ fontSize: 11, lineHeight: '16px', padding: '0 4px' }}>普通</Tag>
                    )}
                    {item.skuTitle && (
                      <span style={{ color: '#8c8c8c' }}>{item.skuTitle}</span>
                    )}
                  </Space>
                </div>
                {item.productType === 'BUNDLE' && (item.bundleItems?.length ?? 0) > 0 && (
                  <div
                    style={{
                      marginTop: 8,
                      paddingLeft: 12,
                      borderLeft: '2px solid #f0f0f0',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 6,
                    }}
                  >
                    {item.bundleItems?.map((bundleItem, index) => {
                      const quantity = resolveBundleComponentQuantity(bundleItem, item.quantity);
                      if (!quantity) return null;
                      const skuTitle = bundleItem.skuTitle || bundleItem.skuName || '默认规格';
                      return (
                        <div
                          key={`${bundleItem.skuId || bundleItem.productId || bundleItem.productTitle || 'bundle'}-${index}`}
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            gap: 12,
                            fontSize: 12,
                            color: '#595959',
                          }}
                        >
                          <div style={{ minWidth: 0 }}>
                            <span style={{ color: '#8c8c8c', marginRight: 8 }}>组合明细</span>
                            <span>{bundleItem.productTitle || '未命名组件'}</span>
                            <span style={{ color: '#8c8c8c', marginLeft: 8 }}>{skuTitle}</span>
                          </div>
                          <span style={{ whiteSpace: 'nowrap', color: '#262626' }}>x{quantity}</span>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
              <div style={{ textAlign: 'right', flexShrink: 0 }}>
                <div style={{ fontFamily: 'monospace' }}>
                  ¥{item.unitPrice.toFixed(2)} × {item.quantity}
                </div>
                <div
                  style={{
                    fontWeight: 600,
                    fontSize: 15,
                    marginTop: 2,
                  }}
                >
                  ¥{(item.unitPrice * item.quantity).toFixed(2)}
                </div>
              </div>
            </div>
          ))}

          {/* 合计行 */}
          <div
            style={{
              display: 'flex',
              justifyContent: 'flex-end',
              alignItems: 'center',
              padding: '12px 12px 0',
              borderTop: '1px solid #f0f0f0',
              gap: 8,
            }}
          >
            <span style={{ color: '#666' }}>商品金额：</span>
            <span
              style={{
                fontSize: 18,
                fontWeight: 600,
                fontFamily: 'monospace',
                color: '#d46b08',
              }}
            >
              ¥{order.totalAmount.toFixed(2)}
            </span>
          </div>
        </div>
      </Card>

      {/* 物流信息 */}
      {order.shipment && (
        <Card title="物流信息" size="small">
          <Descriptions column={{ xs: 1, sm: 2 }} size="small">
            <Descriptions.Item label="快递公司">
              {order.shipment.carrierName || '-'}
            </Descriptions.Item>
            <Descriptions.Item label="快递单号">
              {order.shipment.trackingNo || '-'}
            </Descriptions.Item>
            {order.shipment.waybillNo && (
              <Descriptions.Item label="电子面单">
                <Space>
                  <Typography.Text copyable>
                    {order.shipment.waybillNo}
                  </Typography.Text>
                  <Button
                    type="link"
                    size="small"
                    icon={<PrinterOutlined />}
                    onClick={handlePrintWaybill}
                  >
                    打印清单
                  </Button>
                  {order.shipment.status === 'INIT' && canManageShipment && (
                    <Button
                      type="link"
                      size="small"
                      danger
                      onClick={handleCancelWaybill}
                    >
                      取消
                    </Button>
                  )}
                </Space>
              </Descriptions.Item>
            )}
            <Descriptions.Item label="发货时间">
              {order.shipment.shippedAt
                ? dayjs(order.shipment.shippedAt).format('YYYY-MM-DD HH:mm')
                : '-'}
            </Descriptions.Item>
            <Descriptions.Item label="物流状态">
              {(() => {
                const ss = shipmentStatusMap[order.shipment!.status];
                return ss ? (
                  <Tag color={ss.color}>{ss.text}</Tag>
                ) : (
                  order.shipment!.status
                );
              })()}
            </Descriptions.Item>
          </Descriptions>
        </Card>
      )}
    </div>
  );
}
