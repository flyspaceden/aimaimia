import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  App,
  Avatar,
  Button,
  Card,
  Descriptions,
  Space,
  Spin,
  Steps,
  Tag,
  Typography,
} from 'antd';
import {
  ArrowLeftOutlined,
  CheckCircleOutlined,
  ClockCircleOutlined,
  PrinterOutlined,
  SendOutlined,
  ShoppingOutlined,
  TruckOutlined,
} from '@ant-design/icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { getOrder, shipOrder } from '@/api/orders';
import { exportFulfillmentManifest } from '@/api/manifests';
import { orderStatusMap, shipmentStatusMap } from '@/constants/statusMaps';
import { downloadDeliveryUploadWithAuth } from '@/utils/uploadDownload';
import dayjs from 'dayjs';

const API_BASE = import.meta.env.VITE_API_BASE_URL || '/api/v1';

// 根据订单状态和物流状态计算进度步骤
function getOrderStep(order: {
  status: string;
  shipment?: { status: string; waybillNo?: string } | null;
}): number {
  const { status, shipment } = order;
  if (status === 'CANCELED') return -1;
  if (status === 'COMPLETED') return 4;
  if (status === 'DELIVERED') return 3;
  if (status === 'SHIPPED') {
    if (shipment?.status === 'DELIVERED') return 3;
    return 2;
  }
  if (status === 'PENDING_SHIPMENT') {
    if (shipment?.waybillNo) return 1;
    return 0;
  }
  return 0;
}

export default function OrderDetailPage() {
  const { message } = App.useApp();
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [shipping, setShipping] = useState(false);
  const [exporting, setExporting] = useState(false);

  const { data: order, isLoading } = useQuery({
    queryKey: ['seller-order', id],
    queryFn: () => getOrder(id!),
    enabled: !!id,
  });

  const handleShip = async () => {
    setShipping(true);
    try {
      await shipOrder(id!);
      queryClient.invalidateQueries({ queryKey: ['seller-order', id] });
      queryClient.invalidateQueries({ queryKey: ['seller-order-tab-counts'] });
      await queryClient.refetchQueries({ queryKey: ['seller-order', id] });
    } catch (err) {
      message.error(err instanceof Error ? err.message : '发货失败');
    } finally {
      setShipping(false);
    }
  };

  const handleFulfillmentExport = async () => {
    setExporting(true);
    try {
      const manifest = await exportFulfillmentManifest(id!);
      await downloadDeliveryUploadWithAuth(manifest.fileUrl, manifest.title || '配送履约清单', API_BASE);
      message.success('履约清单已生成');
    } catch (err) {
      message.error(err instanceof Error ? err.message : '履约清单生成失败');
    } finally {
      setExporting(false);
    }
  };

  if (isLoading || !order) {
    return <Spin size="large" style={{ display: 'block', margin: '100px auto' }} />;
  }

  const status = orderStatusMap[order.status];
  const canManageShipment =
    order.status === 'PENDING_SHIPMENT' &&
    (!order.shipment || order.shipment.status === 'INIT');
  const isCancelled = order.status === 'CANCELED';
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
          <Button
            icon={<PrinterOutlined />}
            loading={exporting}
            onClick={handleFulfillmentExport}
          >
            导出履约清单
          </Button>
          <Tag color={status?.color} style={{ fontSize: 14, padding: '2px 12px' }}>
            {status?.text || order.status}
          </Tag>
        </Space>
      </div>

      {/* 订单进度 */}
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

      {/* 已关闭状态提示 */}
      {isCancelled && (
        <Card style={{ marginBottom: 16, borderRadius: 8 }}>
          <Typography.Text type="secondary">该订单已取消</Typography.Text>
        </Card>
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
                确认发货
              </span>
            </Space>
          }
        >
          <div>
            <Typography.Paragraph type="secondary" style={{ marginBottom: 16 }}>
              确认发货后系统会生成并绑定顺丰面单，订单状态会更新为已发货。
            </Typography.Paragraph>
            <Button
              type="primary"
              size="large"
              icon={<SendOutlined />}
              loading={shipping}
              onClick={handleShip}
            >
              确认发货
            </Button>
          </div>
        </Card>
      )}

      {/* 订单信息 */}
      <Card title="订单信息" size="small" style={{ marginBottom: 16 }}>
        <Descriptions column={{ xs: 1, sm: 2 }} size="small">
          <Descriptions.Item label="子订单号">
            <Typography.Text copyable style={{ fontFamily: 'monospace' }}>
              {order.id}
            </Typography.Text>
          </Descriptions.Item>
          <Descriptions.Item label="主订单号">
            <Typography.Text copyable style={{ fontFamily: 'monospace' }}>
              {order.orderId}
            </Typography.Text>
          </Descriptions.Item>
          <Descriptions.Item label="下单日期">{order.createdDate}</Descriptions.Item>
          <Descriptions.Item label="付款时间">
            {order.paidAt ? dayjs(order.paidAt).format('YYYY-MM-DD HH:mm') : '-'}
          </Descriptions.Item>
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
          {order.shippingAddress && (
            <>
              <Descriptions.Item label="收货人">
                {order.shippingAddress.recipientName || '-'}
              </Descriptions.Item>
              <Descriptions.Item label="联系电话">
                {order.shippingAddress.phone || '-'}
              </Descriptions.Item>
              <Descriptions.Item label="收货地址" span={2}>
                {`${order.shippingAddress.regionText} ${order.shippingAddress.detailAddress}`.trim() || '-'}
              </Descriptions.Item>
            </>
          )}
        </Descriptions>
      </Card>

      {/* 商品清单 — 卡片式展示 */}
      <Card title={`商品清单 (${order.items.length})`} size="small" style={{ marginBottom: 16 }}>
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
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {item.title || '-'}
                </div>
                <div style={{ fontSize: 12, color: '#999', marginTop: 2 }}>
                  <Tag style={{ fontSize: 11, lineHeight: '16px', padding: '0 4px' }}>
                    {item.skuTitle || '默认规格'}
                  </Tag>
                  {item.unitName && (
                    <span style={{ marginLeft: 8 }}>{item.unitName}</span>
                  )}
                </div>
              </div>
              <div style={{ textAlign: 'right', flexShrink: 0 }}>
                <div
                  style={{
                    fontWeight: 600,
                    fontSize: 15,
                    marginTop: 2,
                  }}
                >
                  × {item.quantity}
                </div>
              </div>
            </div>
          ))}
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
                    onClick={async () => {
                      if (!order.shipment?.waybillPrintUrl) {
                        message.warning('面单文件暂无，请重新生成面单后再打印');
                        return;
                      }
                      try {
                        await downloadDeliveryUploadWithAuth(
                          order.shipment.waybillPrintUrl,
                          `配送面单-${order.shipment.waybillNo}`,
                          API_BASE,
                        );
                      } catch (err) {
                        message.error(err instanceof Error ? err.message : '面单下载失败');
                      }
                    }}
                  >
                    打印
                  </Button>
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
