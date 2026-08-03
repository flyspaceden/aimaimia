import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  App,
  Alert,
  Avatar,
  Button,
  Card,
  Descriptions,
  Form,
  Input,
  InputNumber,
  Modal,
  Space,
  Spin,
  Steps,
  Select,
  Table,
  Tag,
  Typography,
  type TableColumnsType,
} from 'antd';
import {
  ArrowLeftOutlined,
  CheckCircleOutlined,
  ClockCircleOutlined,
  ExclamationCircleOutlined,
  PrinterOutlined,
  SendOutlined,
  ShoppingOutlined,
  TruckOutlined,
} from '@ant-design/icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  getOrder,
  markPickupBatchReady,
  reprintPickupBatchWaybill,
  reportPickupBatchException,
  shipPickupBatchWithSf,
  shipOrder,
} from '@/api/orders';
import { getPublicAppConfig } from '@/api/config';
import { exportFulfillmentManifest } from '@/api/manifests';
import { getStatusDisplay, orderStatusMap, shipmentStatusMap } from '@/constants/statusMaps';
import { downloadDeliveryUploadWithAuth } from '@/utils/uploadDownload';
import type { PickupBatch, PickupBatchItem } from '@/types';
import useAuthStore from '@/store/useAuthStore';
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

const pickupBatchStatusText: Record<string, string> = {
  PLANNED: '已计划',
  READY_TO_CALL: '待顺丰发货',
  CALLING_CARRIER: '顺丰下单中',
  WAITING_DRIVER: '待顺丰揽收',
  DRIVER_ASSIGNED: '顺丰已接单',
  ARRIVED: '快递员已到达',
  LOADED: '顺丰已揽收',
  DELIVERING: '运输中',
  COMPLETED: '已签收',
  CANCELED: '已取消',
  EXCEPTION: '异常',
};

const pickupBatchStatusColor: Record<string, string> = {
  PLANNED: 'default',
  READY_TO_CALL: 'processing',
  CALLING_CARRIER: 'processing',
  WAITING_DRIVER: 'processing',
  DRIVER_ASSIGNED: 'blue',
  ARRIVED: 'cyan',
  LOADED: 'purple',
  DELIVERING: 'geekblue',
  COMPLETED: 'success',
  CANCELED: 'default',
  EXCEPTION: 'error',
};

function PickupBatchStatusTag({ value }: { value?: string | null }) {
  if (!value) {
    return <Tag>-</Tag>;
  }
  return <Tag color={pickupBatchStatusColor[value] ?? 'default'}>{pickupBatchStatusText[value] ?? value}</Tag>;
}

function formatDateTime(value?: string | null) {
  return value ? dayjs(value).format('YYYY-MM-DD HH:mm') : '-';
}

function formatItemTitle(item: PickupBatchItem) {
  const productTitle = item.productTitle || item.skuId;
  return item.skuTitle ? `${productTitle} / ${item.skuTitle}` : productTitle;
}

function formatUnitName(item: PickupBatchItem) {
  return item.unitName || '件';
}

function canMarkReady(batch: PickupBatch) {
  return ['PLANNED', 'EXCEPTION'].includes(batch.status) && !batch.latestCarrierOrder?.carrierOrderNo;
}

function canShipBatch(batch: PickupBatch) {
  const carrier = batch.latestCarrierOrder;
  const staleReservation =
    batch.status === 'CALLING_CARRIER' &&
    carrier?.status === 'CREATING_SF_ORDER' &&
    Boolean(carrier.updatedAt) &&
    Date.now() - new Date(carrier.updatedAt!).getTime() >= 15 * 60 * 1000;
  return (['READY_TO_CALL', 'EXCEPTION'].includes(batch.status) || staleReservation)
    && (!carrier?.carrierOrderNo || carrier.status?.startsWith('CANCELED'));
}

function canReportException(batch: PickupBatch) {
  return !['COMPLETED', 'CANCELED'].includes(batch.status);
}

export default function OrderDetailPage() {
  const { message, modal } = App.useApp();
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const canWriteOrders = useAuthStore((state) => state.hasPermission('orders:write'));
  const [shipping, setShipping] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [batchActionLoading, setBatchActionLoading] = useState<string | null>(null);
  const [exceptionTarget, setExceptionTarget] = useState<PickupBatch | null>(null);
  const [exceptionMessage, setExceptionMessage] = useState('');
  const [sfTarget, setSfTarget] = useState<PickupBatch | null>(null);
  const [sfForm] = Form.useForm<{ expressTypeId: number; packageCount: number; totalWeightKg: number }>();

  const { data: order, isLoading } = useQuery({
    queryKey: ['seller-order', id],
    queryFn: () => getOrder(id!),
    enabled: !!id,
  });
  const configQuery = useQuery({ queryKey: ['seller-public-config'], queryFn: getPublicAppConfig });
  const sfProducts = configQuery.data?.sfExpressProducts ?? [];

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

  const refreshOrder = async () => {
    queryClient.invalidateQueries({ queryKey: ['seller-order', id] });
    queryClient.invalidateQueries({ queryKey: ['seller-order-tab-counts'] });
    await queryClient.refetchQueries({ queryKey: ['seller-order', id] });
  };

  const confirmBatchReady = (batch: PickupBatch) => {
    modal.confirm({
      title: '确认备货完成',
      icon: <CheckCircleOutlined />,
      content: `配送批次 ${batch.id} 的商品已备齐，可以创建顺丰运单。`,
      okText: '确认已备货',
      cancelText: '取消',
      onOk: async () => {
        const key = `ready:${batch.id}`;
        setBatchActionLoading(key);
        try {
          await markPickupBatchReady(batch.id);
          message.success('配送批次已进入待顺丰发货');
          await refreshOrder();
        } catch (err) {
          message.error(err instanceof Error ? err.message : '批次操作失败');
        } finally {
          setBatchActionLoading(null);
        }
      },
    });
  };

  const openSfShipment = (batch: PickupBatch) => {
    setSfTarget(batch);
    sfForm.setFieldsValue({
      expressTypeId: sfProducts[0]?.expressTypeId ?? 1,
      packageCount: 1,
      totalWeightKg: Math.max(0.1, batch.suggestedWeightKg ?? 1),
    });
  };

  const submitSfShipment = async () => {
    if (!sfTarget) return;
    const values = await sfForm.validateFields();
    setBatchActionLoading(`ship:${sfTarget.id}`);
    try {
      await shipPickupBatchWithSf(sfTarget.id, values);
      message.success('顺丰运单已创建，已通知上门揽收');
      setSfTarget(null);
      sfForm.resetFields();
      await refreshOrder();
    } catch (error) {
      message.error(error instanceof Error ? error.message : '顺丰发货失败');
    } finally {
      setBatchActionLoading(null);
    }
  };

  const handleReprintBatchWaybill = async (batch: PickupBatch) => {
    setBatchActionLoading(`print:${batch.id}`);
    try {
      const updated = await reprintPickupBatchWaybill(batch.id);
      const url = updated.latestCarrierOrder?.waybillUrl;
      if (!url) throw new Error('顺丰面单文件尚未生成');
      await downloadDeliveryUploadWithAuth(url, `顺丰面单-${batch.id}`, API_BASE);
      message.success('顺丰面单已重新生成');
      await refreshOrder();
    } catch (error) {
      message.error(error instanceof Error ? error.message : '面单重打失败');
    } finally {
      setBatchActionLoading(null);
    }
  };

  const submitBatchException = async () => {
    if (!exceptionTarget) return;
    const content = exceptionMessage.trim();
    if (!content) {
      message.warning('请填写异常反馈');
      return;
    }
    const key = `exception:${exceptionTarget.id}`;
    setBatchActionLoading(key);
    try {
      await reportPickupBatchException(exceptionTarget.id, content);
      message.success('异常反馈已提交');
      setExceptionTarget(null);
      setExceptionMessage('');
      await refreshOrder();
    } catch (err) {
      message.error(err instanceof Error ? err.message : '异常反馈提交失败');
    } finally {
      setBatchActionLoading(null);
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

  const status = getStatusDisplay(orderStatusMap, order.status);
  const pickupBatches = order.pickupBatches ?? [];
  const hasPickupBatches = pickupBatches.length > 0;
  const canManageShipment =
    canWriteOrders &&
    !hasPickupBatches &&
    order.status === 'PENDING_SHIPMENT' &&
    (!order.shipment || order.shipment.status === 'INIT');
  const isCancelled = order.status === 'CANCELED';
  const currentStep = getOrderStep(order);
  const pickupBatchColumns: TableColumnsType<PickupBatch> = [
    {
      title: '批次号',
      dataIndex: 'id',
      width: 170,
      render: (value: string, record) => (
        <Space direction="vertical" size={0}>
          <Typography.Text copyable={{ text: value }} style={{ fontFamily: 'monospace' }}>
            {value}
          </Typography.Text>
          <Tag>第 {record.batchNo} 批</Tag>
        </Space>
      ),
    },
    {
      title: '状态',
      dataIndex: 'status',
      width: 110,
      render: (value: string) => <PickupBatchStatusTag value={value} />,
    },
    {
      title: '商品',
      dataIndex: 'items',
      width: 220,
      render: (items: PickupBatchItem[]) => (
        <Space direction="vertical" size={0}>
          {items.slice(0, 2).map((item) => (
            <Typography.Text key={item.id} ellipsis style={{ maxWidth: 200 }}>
              {formatItemTitle(item)}
            </Typography.Text>
          ))}
          {items.length > 2 ? <Typography.Text type="secondary">另 {items.length - 2} 项</Typography.Text> : null}
        </Space>
      ),
    },
    {
      title: '数量',
      width: 120,
      render: (_, record) => {
        const total = record.items.reduce((sum, item) => sum + item.quantity, 0);
        const picked = record.items.reduce((sum, item) => sum + item.pickedQuantity, 0);
        const unit = record.items[0] ? formatUnitName(record.items[0]) : '件';
        return (
          <Space direction="vertical" size={0}>
            <span>{total}{unit}</span>
            <Typography.Text type="secondary">已交 {picked}{unit}</Typography.Text>
          </Space>
        );
      },
    },
    {
      title: '顺丰产品 / 运单',
      width: 230,
      render: (_, record) => (
        <Space direction="vertical" size={0}>
          <span>{record.latestCarrierOrder?.expressTypeName ?? '顺丰速运'}</span>
          {(record.latestCarrierOrder?.waybills ?? []).map((waybill) => (
            <Typography.Text key={waybill.trackingNo} copyable={{ text: waybill.trackingNo }} type="secondary">
              {waybill.trackingNo}
            </Typography.Text>
          ))}
          {record.latestCarrierOrder?.packageCount ? (
            <Typography.Text type="secondary">{record.latestCarrierOrder.packageCount} 件 / {record.latestCarrierOrder.totalWeightKg} kg</Typography.Text>
          ) : null}
        </Space>
      ),
    },
    {
      title: '预计/完成时间',
      width: 160,
      render: (_, record) => (
        <Space direction="vertical" size={0}>
          <span>{formatDateTime(record.plannedPickupAt)}</span>
          <Typography.Text type="secondary">{formatDateTime(record.completedAt ?? record.loadedAt ?? record.updatedAt)}</Typography.Text>
        </Space>
      ),
    },
    {
      title: '操作',
      width: 300,
      fixed: 'right',
      render: (_, record) => (
        <Space size={4} wrap>
          <Button
            size="small"
            disabled={!canWriteOrders || !canMarkReady(record)}
            loading={batchActionLoading === `ready:${record.id}`}
            onClick={() => confirmBatchReady(record)}
          >
            已备货
          </Button>
          <Button type="primary" size="small" icon={<SendOutlined />} disabled={!canWriteOrders || !canShipBatch(record) || sfProducts.length === 0} loading={batchActionLoading === `ship:${record.id}`} onClick={() => openSfShipment(record)}>
            顺丰发货
          </Button>
          <Button size="small" icon={<PrinterOutlined />} disabled={!canWriteOrders || !record.latestCarrierOrder?.carrierOrderNo} loading={batchActionLoading === `print:${record.id}`} onClick={() => handleReprintBatchWaybill(record)}>
            重打面单
          </Button>
          <Button
            danger
            size="small"
            icon={<ExclamationCircleOutlined />}
            disabled={!canWriteOrders || !canReportException(record)}
            loading={batchActionLoading === `exception:${record.id}`}
            onClick={() => {
              setExceptionTarget(record);
              setExceptionMessage('');
            }}
          >
            异常反馈
          </Button>
        </Space>
      ),
    },
  ];

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
          <Tag color={status.color} style={{ fontSize: 14, padding: '2px 12px' }}>
            {status.text}
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

      {hasPickupBatches && (
        <Card
          title={
            <Space>
              <TruckOutlined />
              <span>配送批次</span>
            </Space>
          }
          size="small"
          style={{ marginBottom: 16 }}
        >
          <Table<PickupBatch>
            rowKey="id"
            size="small"
            columns={pickupBatchColumns}
            dataSource={pickupBatches}
            pagination={false}
            scroll={{ x: 1320 }}
          />
        </Card>
      )}

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
                const ss = getStatusDisplay(shipmentStatusMap, order.shipment!.status);
                return <Tag color={ss.color}>{ss.text}</Tag>;
              })()}
            </Descriptions.Item>
          </Descriptions>
        </Card>
      )}

      <Modal
        title="创建顺丰运单"
        open={Boolean(sfTarget)}
        okText="确认顺丰发货"
        confirmLoading={batchActionLoading === `ship:${sfTarget?.id}`}
        onOk={submitSfShipment}
        onCancel={() => { setSfTarget(null); sfForm.resetFields(); }}
        destroyOnHidden
      >
        <Alert type="warning" showIcon style={{ marginBottom: 16 }} message="运单创建后顺丰将上门揽收；请按本批实物填写重量和包裹数。" />
        <Form form={sfForm} layout="vertical">
          <Form.Item name="expressTypeId" label="顺丰产品" rules={[{ required: true, message: '请选择顺丰产品' }]}>
            <Select options={sfProducts.map((item) => ({ value: item.expressTypeId, label: `${item.name}（代码 ${item.expressTypeId}）` }))} />
          </Form.Item>
          <Form.Item name="packageCount" label="包裹数量" rules={[{ required: true, message: '请输入包裹数量' }]}>
            <InputNumber min={1} max={999} precision={0} addonAfter="件" style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item name="totalWeightKg" label="本批实际总重量" rules={[{ required: true, message: '请输入实际总重量' }]}>
            <InputNumber min={0.001} max={1000000} precision={3} addonAfter="kg" style={{ width: '100%' }} />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title="异常反馈"
        open={!!exceptionTarget}
        okText="提交反馈"
        cancelText="取消"
        confirmLoading={batchActionLoading === `exception:${exceptionTarget?.id}`}
        onOk={submitBatchException}
        onCancel={() => {
          setExceptionTarget(null);
          setExceptionMessage('');
        }}
        destroyOnHidden
      >
        <Space direction="vertical" size={12} style={{ display: 'flex' }}>
          <Typography.Text type="secondary">
            配送批次 {exceptionTarget?.id || '-'} 如遇顺丰揽收、面单、商品或收件信息问题，请记录具体情况。
          </Typography.Text>
          <Input.TextArea
            value={exceptionMessage}
            onChange={(event) => setExceptionMessage(event.target.value)}
            rows={4}
            maxLength={200}
            showCount
            placeholder="填写异常反馈"
          />
        </Space>
      </Modal>
    </div>
  );
}
