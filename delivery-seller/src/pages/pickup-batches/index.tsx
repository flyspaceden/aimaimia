import { useRef, useState } from 'react';
import {
  Alert,
  App,
  Button,
  Form,
  Input,
  InputNumber,
  Modal,
  Select,
  Space,
  Tag,
  Typography,
} from 'antd';
import {
  CheckCircleOutlined,
  ExclamationCircleOutlined,
  InboxOutlined,
  PrinterOutlined,
  SendOutlined,
  TruckOutlined,
} from '@ant-design/icons';
import { ProTable } from '@ant-design/pro-components';
import type { ActionType, ProColumns } from '@ant-design/pro-components';
import { useQuery } from '@tanstack/react-query';
import dayjs from 'dayjs';
import {
  getPickupBatches,
  markPickupBatchReady,
  reprintPickupBatchWaybill,
  reportPickupBatchException,
  shipPickupBatchWithSf,
} from '@/api/orders';
import { getPublicAppConfig } from '@/api/config';
import useAuthStore from '@/store/useAuthStore';
import type { PickupBatch, PickupBatchItem } from '@/types';
import { downloadDeliveryUploadWithAuth } from '@/utils/uploadDownload';

const { Text } = Typography;
const API_BASE = import.meta.env.VITE_API_BASE_URL || '/api/v1';

const statusText: Record<string, string> = {
  PLANNED: '待备货',
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

const statusColor: Record<string, string> = {
  PLANNED: 'default',
  READY_TO_CALL: 'processing',
  CALLING_CARRIER: 'processing',
  WAITING_DRIVER: 'cyan',
  DRIVER_ASSIGNED: 'blue',
  ARRIVED: 'cyan',
  LOADED: 'purple',
  DELIVERING: 'geekblue',
  COMPLETED: 'success',
  CANCELED: 'default',
  EXCEPTION: 'error',
};

type SfFormValues = {
  expressTypeId: number;
  packageCount: number;
  totalWeightKg: number;
};

function StatusTag({ value }: { value?: string | null }) {
  return value ? <Tag color={statusColor[value] ?? 'default'}>{statusText[value] ?? value}</Tag> : <Tag>-</Tag>;
}

function formatDateTime(value?: string | null) {
  return value ? dayjs(value).format('YYYY-MM-DD HH:mm') : '-';
}

function formatItemTitle(item: PickupBatchItem) {
  return item.skuTitle ? `${item.productTitle || item.skuId} / ${item.skuTitle}` : item.productTitle || item.skuId;
}

function canMarkReady(batch: PickupBatch) {
  return ['PLANNED', 'EXCEPTION'].includes(batch.status) && !batch.latestCarrierOrder?.carrierOrderNo;
}

function canShip(batch: PickupBatch) {
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

export default function PickupBatchesPage() {
  const { message, modal } = App.useApp();
  const actionRef = useRef<ActionType>(null);
  const canWrite = useAuthStore((state) => state.hasPermission('orders:write'));
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [sfTarget, setSfTarget] = useState<PickupBatch | null>(null);
  const [exceptionTarget, setExceptionTarget] = useState<PickupBatch | null>(null);
  const [exceptionMessage, setExceptionMessage] = useState('');
  const [sfForm] = Form.useForm<SfFormValues>();
  const configQuery = useQuery({ queryKey: ['seller-public-config'], queryFn: getPublicAppConfig });
  const sfProducts = configQuery.data?.sfExpressProducts ?? [];

  const reload = () => actionRef.current?.reload();

  const confirmReady = (batch: PickupBatch) => {
    modal.confirm({
      title: '确认备货完成',
      icon: <CheckCircleOutlined />,
      content: `配送批次 ${batch.id} 的商品已备齐，可以创建顺丰运单。`,
      okText: '确认已备货',
      cancelText: '返回',
      onOk: async () => {
        setActionLoading(`ready:${batch.id}`);
        try {
          await markPickupBatchReady(batch.id);
          message.success('配送批次已进入待顺丰发货');
          reload();
        } catch (error) {
          message.error(error instanceof Error ? error.message : '备货状态更新失败');
        } finally {
          setActionLoading(null);
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
    setActionLoading(`ship:${sfTarget.id}`);
    try {
      await shipPickupBatchWithSf(sfTarget.id, values);
      message.success('顺丰运单已创建，已通知上门揽收');
      setSfTarget(null);
      sfForm.resetFields();
      reload();
    } catch (error) {
      message.error(error instanceof Error ? error.message : '顺丰发货失败');
    } finally {
      setActionLoading(null);
    }
  };

  const reprintWaybill = async (batch: PickupBatch) => {
    setActionLoading(`print:${batch.id}`);
    try {
      const updated = await reprintPickupBatchWaybill(batch.id);
      const url = updated.latestCarrierOrder?.waybillUrl;
      if (!url) throw new Error('顺丰面单文件尚未生成');
      await downloadDeliveryUploadWithAuth(url, `顺丰面单-${batch.id}`, API_BASE);
      message.success('顺丰面单已重新生成');
      reload();
    } catch (error) {
      message.error(error instanceof Error ? error.message : '面单重打失败');
    } finally {
      setActionLoading(null);
    }
  };

  const submitException = async () => {
    if (!exceptionTarget) return;
    const content = exceptionMessage.trim();
    if (!content) return message.warning('请填写异常说明');
    setActionLoading(`exception:${exceptionTarget.id}`);
    try {
      await reportPickupBatchException(exceptionTarget.id, content);
      message.success('异常已提交给平台管理员');
      setExceptionTarget(null);
      setExceptionMessage('');
      reload();
    } catch (error) {
      message.error(error instanceof Error ? error.message : '异常提交失败');
    } finally {
      setActionLoading(null);
    }
  };

  const columns: ProColumns<PickupBatch>[] = [
    {
      title: '批次或订单号',
      dataIndex: 'keyword',
      hideInTable: true,
      fieldProps: { placeholder: '输入配送批次、订单或子单号' },
    },
    {
      title: '配送批次', key: 'batch', width: 220, search: false,
      render: (_, record) => (
        <Space direction="vertical" size={0}>
          <Text copyable={{ text: record.id }} style={{ fontFamily: 'monospace' }}>{record.id}</Text>
          <Text type="secondary">订单 {record.orderId} · 第 {record.batchNo} 批</Text>
        </Space>
      ),
    },
    {
      title: '状态', dataIndex: 'status', width: 130,
      valueEnum: Object.fromEntries(Object.entries(statusText).map(([key, text]) => [key, { text }])),
      render: (_, record) => <StatusTag value={record.status} />,
    },
    {
      title: '商品', key: 'items', width: 280, search: false,
      render: (_, record) => (
        <Space direction="vertical" size={0}>
          {record.items.slice(0, 2).map((item) => (
            <Text key={item.id} ellipsis style={{ maxWidth: 260 }}>
              {formatItemTitle(item)} × {item.quantity}{item.unitName || '件'}
            </Text>
          ))}
          {record.items.length > 2 ? <Text type="secondary">另 {record.items.length - 2} 项</Text> : null}
        </Space>
      ),
    },
    {
      title: '配送进度', key: 'quantity', width: 140, search: false,
      render: (_, record) => {
        const total = record.items.reduce((sum, item) => sum + item.quantity, 0);
        const delivered = record.items.reduce((sum, item) => sum + item.pickedQuantity, 0);
        return <Text>{delivered} / {total}</Text>;
      },
    },
    {
      title: '顺丰产品 / 运单', key: 'sf', width: 260, search: false,
      render: (_, record) => {
        const carrier = record.latestCarrierOrder;
        return (
          <Space direction="vertical" size={0}>
            <Text>{carrier?.expressTypeName ?? '顺丰速运'}</Text>
            {(carrier?.waybills ?? []).map((waybill) => (
              <Text key={waybill.trackingNo} copyable={{ text: waybill.trackingNo }} type="secondary">
                {waybill.trackingNo} · {waybill.status}
              </Text>
            ))}
            {carrier?.packageCount ? <Text type="secondary">{carrier.packageCount} 件 / {carrier.totalWeightKg} kg</Text> : null}
          </Space>
        );
      },
    },
    {
      title: '计划 / 更新', key: 'time', width: 170, search: false,
      render: (_, record) => (
        <Space direction="vertical" size={0}>
          <Text>{formatDateTime(record.plannedPickupAt)}</Text>
          <Text type="secondary">{formatDateTime(record.updatedAt)}</Text>
        </Space>
      ),
    },
    {
      title: '操作', key: 'actions', width: 280, fixed: 'right', search: false,
      render: (_, record) => (
        <Space size={4} wrap>
          <Button size="small" disabled={!canWrite || !canMarkReady(record)} loading={actionLoading === `ready:${record.id}`} onClick={() => confirmReady(record)}>
            已备货
          </Button>
          <Button type="primary" size="small" icon={<SendOutlined />} disabled={!canWrite || !canShip(record) || sfProducts.length === 0} loading={actionLoading === `ship:${record.id}`} onClick={() => openSfShipment(record)}>
            顺丰发货
          </Button>
          <Button size="small" icon={<PrinterOutlined />} disabled={!canWrite || !record.latestCarrierOrder?.carrierOrderNo} loading={actionLoading === `print:${record.id}`} onClick={() => reprintWaybill(record)}>
            重打面单
          </Button>
          <Button danger size="small" icon={<ExclamationCircleOutlined />} disabled={!canWrite || !canReportException(record)} loading={actionLoading === `exception:${record.id}`} onClick={() => setExceptionTarget(record)}>
            报异常
          </Button>
        </Space>
      ),
    },
  ];

  return (
    <Space direction="vertical" size={16} style={{ display: 'flex' }}>
      <Alert
        showIcon
        type="info"
        message="每个配送批次独立创建顺丰运单"
        description="实际重量和包裹数请按本次交寄填写；可选产品只来自平台已启用的顺丰签约产品。"
      />
      <ProTable<PickupBatch>
        actionRef={actionRef}
        rowKey="id"
        columns={columns}
        scroll={{ x: 1580 }}
        tableAlertRender={false}
        request={async (params) => {
          const result = await getPickupBatches({
            page: params.current,
            pageSize: params.pageSize,
            keyword: typeof params.keyword === 'string' ? params.keyword : undefined,
            status: typeof params.status === 'string' ? params.status : undefined,
          });
          return { data: result.items, total: result.total, success: true };
        }}
        pagination={{ defaultPageSize: 20, showSizeChanger: true }}
        search={{ labelWidth: 'auto', collapsed: false, collapseRender: false }}
        headerTitle={<Space><TruckOutlined /><span>配送批次</span></Space>}
        toolBarRender={() => []}
        locale={{ emptyText: <div style={{ padding: '40px 0', color: '#999' }}><InboxOutlined style={{ fontSize: 48, display: 'block', marginBottom: 16 }} />暂无配送批次</div> }}
      />

      <Modal
        title="创建顺丰运单"
        open={Boolean(sfTarget)}
        okText="确认顺丰发货"
        cancelText="返回检查"
        confirmLoading={actionLoading === `ship:${sfTarget?.id}`}
        onOk={submitSfShipment}
        onCancel={() => { setSfTarget(null); sfForm.resetFields(); }}
        destroyOnHidden
      >
        <Alert type="warning" showIcon style={{ marginBottom: 16 }} message="运单创建后顺丰将按配置上门揽收；重量和产品会影响月结成本。" />
        <Form form={sfForm} layout="vertical">
          <Form.Item name="expressTypeId" label="顺丰产品" rules={[{ required: true, message: '请选择顺丰产品' }]}>
            <Select options={sfProducts.map((item) => ({ value: item.expressTypeId, label: `${item.name}（代码 ${item.expressTypeId}）` }))} />
          </Form.Item>
          <Form.Item name="packageCount" label="包裹数量" rules={[{ required: true, message: '请输入包裹数量' }]}>
            <InputNumber min={1} max={999} precision={0} style={{ width: '100%' }} addonAfter="件" />
          </Form.Item>
          <Form.Item name="totalWeightKg" label="本批实际总重量" rules={[{ required: true, message: '请输入实际总重量' }]}>
            <InputNumber min={0.001} max={1000000} precision={3} style={{ width: '100%' }} addonAfter="kg" />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title="上报配送异常"
        open={Boolean(exceptionTarget)}
        okText="提交给平台"
        confirmLoading={actionLoading === `exception:${exceptionTarget?.id}`}
        onOk={submitException}
        onCancel={() => { setExceptionTarget(null); setExceptionMessage(''); }}
        destroyOnHidden
      >
        <Text type="secondary">请说明顺丰揽收、面单、商品或收件信息中的具体问题。</Text>
        <Input.TextArea value={exceptionMessage} onChange={(event) => setExceptionMessage(event.target.value)} rows={4} maxLength={200} showCount style={{ marginTop: 12 }} placeholder="填写异常说明和已采取的处理" />
      </Modal>
    </Space>
  );
}
