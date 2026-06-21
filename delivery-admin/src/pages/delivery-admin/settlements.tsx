import { useEffect, useRef, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { App as AntdApp, Button, Form, Input, InputNumber, Modal, Space } from 'antd';
import { ReloadOutlined } from '@ant-design/icons';
import { ProTable, type ActionType, type ProColumns } from '@ant-design/pro-components';
import {
  getDeliverySettlements,
  markDeliverySettlementPaid,
} from '@/api/delivery-management';
import type { DeliverySettlement } from '@/types/delivery-management';
import { PageHeader, StatusPill } from './components';
import { deliveryValueEnum, formatDateTime, formatMoney, getErrorMessage, settlementStatusOptions } from './utils';

type SettlementFormValues = {
  settledAmountCents: number;
  note?: string;
};

export default function DeliverySettlementsPage() {
  const { message } = AntdApp.useApp();
  const actionRef = useRef<ActionType | undefined>(undefined);
  const [editing, setEditing] = useState<DeliverySettlement | null>(null);
  const [form] = Form.useForm<SettlementFormValues>();

  useEffect(() => {
    if (!editing) {
      form.resetFields();
      return;
    }
    form.setFieldsValue({
      settledAmountCents: editing.expectedAmountCents,
      note: editing.note ?? undefined,
    });
  }, [editing, form]);

  const mutation = useMutation({
    mutationFn: (values: SettlementFormValues) =>
      markDeliverySettlementPaid(editing!.id, values),
    onSuccess: async () => {
      message.success('结算已标记为已支付');
      setEditing(null);
      actionRef.current?.reload();
    },
    onError: (error) => {
      message.error(getErrorMessage(error));
    },
  });

  const columns: ProColumns<DeliverySettlement>[] = [
    { title: '结算编号', dataIndex: 'id', key: 'id', width: 170, ellipsis: true, copyable: true, search: false },
    {
      title: '商家',
      key: 'merchant',
      width: 180,
      render: (_, record) => record.merchant?.name ?? record.merchantId,
      search: false,
    },
    {
      title: '子订单',
      key: 'subOrder',
      width: 150,
      render: (_, record) => record.subOrder?.id ?? record.subOrderId ?? '-',
      search: false,
    },
    {
      title: '金额边界',
      key: 'money',
      width: 220,
      render: (_, record) => (
        <Space direction="vertical" size={0}>
          <span>供货额: {formatMoney(record.supplyAmountCents)}</span>
          <span>应结额: {formatMoney(record.expectedAmountCents)}</span>
          <span>已结额: {formatMoney(record.settledAmountCents)}</span>
        </Space>
      ),
      search: false,
    },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      width: 100,
      valueEnum: deliveryValueEnum(settlementStatusOptions),
      render: (_, record) => <StatusPill value={record.status} />,
    },
    { title: '结算月', dataIndex: 'settlementMonth', key: 'settlementMonth', width: 100, search: false },
    { title: '完成时间', dataIndex: 'settledAt', key: 'settledAt', width: 150, render: (_, record) => formatDateTime(record.settledAt), search: false },
    {
      title: '操作',
      key: 'action',
      width: 110,
      fixed: 'right',
      render: (_, record) => (
        <Button type="link" size="small" disabled={record.status === 'SETTLED'} onClick={() => setEditing(record)}>
          标记已打款
        </Button>
      ),
      search: false,
    },
  ];

  return (
    <div style={{ padding: 24 }}>
      <PageHeader
        title="配送结算"
        subtitle="结算页只展示供货额、应结额、已结额，不暴露平台定价策略。"
      />

      <ProTable<DeliverySettlement>
        actionRef={actionRef}
        rowKey="id"
        columns={columns}
        request={async (params) => {
          const result = await getDeliverySettlements({
            page: params.current,
            pageSize: params.pageSize,
            status: typeof params.status === 'string' ? params.status : undefined,
          });
          return {
            data: result.items,
            success: true,
            total: result.total,
          };
        }}
        pagination={{ defaultPageSize: 20, showSizeChanger: true }}
        search={{ labelWidth: 84 }}
        scroll={{ x: 1160 }}
        toolBarRender={() => [
          <Button key="reload" icon={<ReloadOutlined />} onClick={() => actionRef.current?.reload()}>
            刷新
          </Button>,
        ]}
      />

      <Modal
        open={Boolean(editing)}
        title="标记结算为已支付"
        confirmLoading={mutation.isPending}
        onCancel={() => setEditing(null)}
        onOk={async () => {
          const values = await form.validateFields();
          mutation.mutate(values);
        }}
      >
        <Form form={form} layout="vertical">
          <Form.Item label="应结金额">
            <Input value={formatMoney(editing?.expectedAmountCents)} readOnly />
          </Form.Item>
          <Form.Item
            label="实际打款金额（分）"
            name="settledAmountCents"
            rules={[{ required: true, message: '请输入实际打款金额' }]}
          >
            <InputNumber min={0} precision={0} style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item label="备注" name="note">
            <Input.TextArea rows={4} maxLength={500} />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
