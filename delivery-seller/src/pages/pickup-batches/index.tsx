import { useRef, useState } from 'react';
import {
  App,
  Button,
  Input,
  Modal,
  Space,
  Tag,
  Typography,
} from 'antd';
import {
  CheckCircleOutlined,
  ExclamationCircleOutlined,
  InboxOutlined,
  TruckOutlined,
} from '@ant-design/icons';
import { ProTable } from '@ant-design/pro-components';
import type { ActionType, ProColumns } from '@ant-design/pro-components';
import dayjs from 'dayjs';
import {
  getPickupBatches,
  markPickupBatchLoaded,
  markPickupBatchReady,
  reportPickupBatchException,
} from '@/api/orders';
import useAuthStore from '@/store/useAuthStore';
import type { PickupBatch, PickupBatchCarrierOrder, PickupBatchItem } from '@/types';

const { Text } = Typography;

const pickupBatchStatusOptions = [
  'PLANNED',
  'READY_TO_CALL',
  'CALLING_CARRIER',
  'WAITING_DRIVER',
  'DRIVER_ASSIGNED',
  'ARRIVED',
  'LOADED',
  'DELIVERING',
  'COMPLETED',
  'CANCELED',
  'EXCEPTION',
];

const pickupBatchStatusText: Record<string, string> = {
  PLANNED: '已计划',
  READY_TO_CALL: '待叫车',
  CALLING_CARRIER: '叫车中',
  WAITING_DRIVER: '待接单',
  DRIVER_ASSIGNED: '司机已接单',
  ARRIVED: '司机已到达',
  LOADED: '已交货',
  DELIVERING: '配送中',
  COMPLETED: '已完成',
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

function pickupBatchValueEnum() {
  return Object.fromEntries(
    pickupBatchStatusOptions.map((status) => [status, { text: pickupBatchStatusText[status] }]),
  );
}

function PickupBatchStatusTag({ value }: { value?: string | null }) {
  if (!value) {
    return <Tag>-</Tag>;
  }
  return <Tag color={pickupBatchStatusColor[value] ?? 'default'}>{pickupBatchStatusText[value] ?? value}</Tag>;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function asString(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : '';
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

function getCarrierOrder(batch: PickupBatch): PickupBatchCarrierOrder {
  return batch.latestCarrierOrder ?? {
    carrierOrderNo: batch.carrierOrderNo,
    driverSnapshot: batch.driverSnapshot,
    vehicleSnapshot: batch.vehicleSnapshot,
  };
}

function formatDriver(snapshot?: unknown) {
  const record = asRecord(snapshot);
  const name =
    asString(record.name) ||
    asString(record.driverName) ||
    asString(record.driver_name);
  const phone =
    asString(record.phone) ||
    asString(record.mobile) ||
    asString(record.driverPhone) ||
    asString(record.driver_phone);
  if (name && phone) {
    return `${name} / ${phone}`;
  }
  return name || phone || '-';
}

function formatVehicle(snapshot?: unknown) {
  const record = asRecord(snapshot);
  const plate =
    asString(record.plateNo) ||
    asString(record.vehicleNo) ||
    asString(record.carNo) ||
    asString(record.licensePlate) ||
    asString(record.plate_no);
  const model =
    asString(record.model) ||
    asString(record.vehicleTypeName) ||
    asString(record.vehicleType) ||
    asString(record.vehicle_type);
  if (plate && model) {
    return `${plate} / ${model}`;
  }
  return plate || model || '-';
}

function formatUnitAndAddress(batch: PickupBatch) {
  const unit = asRecord(batch.unitSnapshot);
  const address = asRecord(batch.addressSnapshot);
  const unitName =
    asString(unit.name) ||
    asString(unit.unitName) ||
    asString(unit.companyName) ||
    batch.merchantName ||
    batch.unitId ||
    '-';
  const regionText =
    asString(address.regionText) ||
    asString(address.region) ||
    asString(unit.regionText);
  const detailAddress =
    asString(address.detailAddress) ||
    asString(address.address) ||
    asString(address.detail) ||
    asString(unit.address);
  const fullAddress = [regionText, detailAddress].filter(Boolean).join(' ');
  return { unitName, fullAddress };
}

function canMarkReady(batch: PickupBatch) {
  return ['PLANNED', 'EXCEPTION'].includes(batch.status);
}

function canMarkLoaded(batch: PickupBatch) {
  return ['ARRIVED', 'DRIVER_ASSIGNED'].includes(batch.status);
}

function canReportException(batch: PickupBatch) {
  return !['COMPLETED', 'CANCELED'].includes(batch.status);
}

export default function PickupBatchesPage() {
  const { message } = App.useApp();
  const actionRef = useRef<ActionType>(null);
  const hasPermission = useAuthStore((s) => s.hasPermission);
  const canWrite = hasPermission('orders:write');
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [exceptionTarget, setExceptionTarget] = useState<PickupBatch | null>(null);
  const [exceptionMessage, setExceptionMessage] = useState('');

  const reload = () => actionRef.current?.reload();

  const confirmBatchAction = (
    batch: PickupBatch,
    action: 'ready' | 'loaded',
  ) => {
    const isReady = action === 'ready';
    Modal.confirm({
      title: isReady ? '确认已备货' : '确认已交货',
      icon: isReady ? <CheckCircleOutlined /> : <TruckOutlined />,
      content: isReady
        ? `批次 ${batch.id} 的商品已备齐，可以等待平台叫车。`
        : `批次 ${batch.id} 已交给司机，后续由承运状态继续更新。`,
      okText: isReady ? '已备货' : '已交货',
      cancelText: '取消',
      onOk: async () => {
        const key = `${action}:${batch.id}`;
        setActionLoading(key);
        try {
          if (isReady) {
            await markPickupBatchReady(batch.id);
            message.success('批次已标记为备货完成');
          } else {
            await markPickupBatchLoaded(batch.id);
            message.success('批次已标记为交货完成');
          }
          reload();
        } catch (err) {
          message.error(err instanceof Error ? err.message : '批次操作失败');
        } finally {
          setActionLoading(null);
        }
      },
    });
  };

  const submitException = async () => {
    if (!exceptionTarget) return;
    const content = exceptionMessage.trim();
    if (!content) {
      message.warning('请填写异常反馈');
      return;
    }
    const key = `exception:${exceptionTarget.id}`;
    setActionLoading(key);
    try {
      await reportPickupBatchException(exceptionTarget.id, content);
      message.success('异常反馈已提交');
      setExceptionTarget(null);
      setExceptionMessage('');
      reload();
    } catch (err) {
      message.error(err instanceof Error ? err.message : '异常反馈提交失败');
    } finally {
      setActionLoading(null);
    }
  };

  const columns: ProColumns<PickupBatch>[] = [
    {
      title: '批次/订单',
      dataIndex: 'keyword',
      hideInTable: true,
      fieldProps: { placeholder: '输入批次号或订单号' },
    },
    {
      title: '批次号',
      key: 'batch',
      width: 190,
      search: false,
      render: (_, record) => (
        <Space direction="vertical" size={0}>
          <Text copyable={{ text: record.id }} style={{ fontFamily: 'monospace' }}>
            {record.id}
          </Text>
          <Tag>第 {record.batchNo} 批</Tag>
        </Space>
      ),
    },
    {
      title: '订单号',
      key: 'order',
      width: 220,
      search: false,
      render: (_, record) => (
        <Space direction="vertical" size={0}>
          <Text copyable={{ text: record.orderId }} style={{ fontFamily: 'monospace' }}>
            {record.orderId}
          </Text>
          <Text type="secondary" copyable={{ text: record.subOrderId }}>
            子单 {record.subOrderId}
          </Text>
        </Space>
      ),
    },
    {
      title: '状态',
      dataIndex: 'status',
      width: 120,
      valueEnum: pickupBatchValueEnum(),
      render: (_, record) => <PickupBatchStatusTag value={record.status} />,
    },
    {
      title: '商品',
      key: 'items',
      width: 260,
      search: false,
      render: (_, record) => (
        <Space direction="vertical" size={0}>
          {record.items.slice(0, 2).map((item) => (
            <Text key={item.id} ellipsis style={{ maxWidth: 240 }}>
              {formatItemTitle(item)}
            </Text>
          ))}
          {record.items.length > 2 ? <Text type="secondary">另 {record.items.length - 2} 项</Text> : null}
        </Space>
      ),
    },
    {
      title: '数量',
      key: 'quantity',
      width: 150,
      search: false,
      render: (_, record) => {
        const total = record.items.reduce((sum, item) => sum + item.quantity, 0);
        const picked = record.items.reduce((sum, item) => sum + item.pickedQuantity, 0);
        const firstUnit = record.items[0] ? formatUnitName(record.items[0]) : '件';
        return (
          <Space direction="vertical" size={0}>
            <Text>{total}{firstUnit}</Text>
            <Text type="secondary">已交 {picked}{firstUnit}</Text>
          </Space>
        );
      },
    },
    {
      title: '收货单位/地址',
      key: 'unit',
      width: 230,
      search: false,
      render: (_, record) => {
        const { unitName, fullAddress } = formatUnitAndAddress(record);
        return (
          <Space direction="vertical" size={0}>
            <Text>{unitName}</Text>
            <Text type="secondary" ellipsis style={{ maxWidth: 210 }}>
              {fullAddress || '-'}
            </Text>
          </Space>
        );
      },
    },
    {
      title: '司机',
      key: 'driver',
      width: 160,
      search: false,
      render: (_, record) => formatDriver(getCarrierOrder(record).driverSnapshot),
    },
    {
      title: '车辆',
      key: 'vehicle',
      width: 150,
      search: false,
      render: (_, record) => formatVehicle(getCarrierOrder(record).vehicleSnapshot),
    },
    {
      title: '预计/更新时间',
      key: 'time',
      width: 180,
      search: false,
      render: (_, record) => (
        <Space direction="vertical" size={0}>
          <Text>{formatDateTime(record.plannedPickupAt)}</Text>
          <Text type="secondary">{formatDateTime(record.updatedAt)}</Text>
        </Space>
      ),
    },
    {
      title: '操作',
      key: 'actions',
      width: 230,
      fixed: 'right',
      search: false,
      render: (_, record) => (
        <Space size={4} wrap>
          <Button
            size="small"
            disabled={!canWrite || !canMarkReady(record)}
            loading={actionLoading === `ready:${record.id}`}
            onClick={() => confirmBatchAction(record, 'ready')}
          >
            已备货
          </Button>
          <Button
            size="small"
            disabled={!canWrite || !canMarkLoaded(record)}
            loading={actionLoading === `loaded:${record.id}`}
            onClick={() => confirmBatchAction(record, 'loaded')}
          >
            已交货
          </Button>
          <Button
            danger
            size="small"
            icon={<ExclamationCircleOutlined />}
            disabled={!canWrite || !canReportException(record)}
            loading={actionLoading === `exception:${record.id}`}
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
    <Space direction="vertical" size={16} style={{ display: 'flex' }}>
      <ProTable<PickupBatch>
        actionRef={actionRef}
        rowKey="id"
        columns={columns}
        scroll={{ x: 1520 }}
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
        headerTitle={
          <Space>
            <TruckOutlined />
            <span>提货批次</span>
          </Space>
        }
        toolBarRender={() => []}
        locale={{
          emptyText: (
            <div style={{ padding: '40px 0', color: '#999' }}>
              <InboxOutlined style={{ fontSize: 48, marginBottom: 16, display: 'block' }} />
              暂无提货批次
            </div>
          ),
        }}
      />

      <Modal
        title="异常反馈"
        open={!!exceptionTarget}
        okText="提交反馈"
        cancelText="取消"
        confirmLoading={actionLoading === `exception:${exceptionTarget?.id}`}
        onOk={submitException}
        onCancel={() => {
          setExceptionTarget(null);
          setExceptionMessage('');
        }}
        destroyOnClose
      >
        <Space direction="vertical" size={12} style={{ display: 'flex' }}>
          <Text type="secondary">
            批次 {exceptionTarget?.id || '-'} 如遇司机联系不上、车辆未到场、商品破损等情况，请记录现场说明。
          </Text>
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
    </Space>
  );
}
