import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { App as AntdApp, Button, Card, Form, Input, InputNumber, Modal, Select, Space, Table } from 'antd';
import type { ColumnsType, TablePaginationConfig } from 'antd/es/table';
import {
  getDeliverySettlements,
  markDeliverySettlementPaid,
} from '@/api/delivery-management';
import type { DeliverySettlement } from '@/types/delivery-management';
import { PageHeader, StatusPill } from './components';
import { formatDateTime, formatMoney, getErrorMessage, settlementStatusOptions } from './utils';

type SettlementFormValues = {
  settledAmountCents: number;
  note?: string;
};

export default function DeliverySettlementsPage() {
  const { message } = AntdApp.useApp();
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<string | undefined>();
  const [pagination, setPagination] = useState<TablePaginationConfig>({
    current: 1,
    pageSize: 20,
  });
  const [editing, setEditing] = useState<DeliverySettlement | null>(null);
  const [form] = Form.useForm<SettlementFormValues>();

  const query = useQuery({
    queryKey: ['delivery-settlements', pagination.current, pagination.pageSize, status],
    queryFn: () =>
      getDeliverySettlements({
        page: pagination.current,
        pageSize: pagination.pageSize,
        status,
      }),
  });

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
      await queryClient.invalidateQueries({ queryKey: ['delivery-settlements'] });
    },
    onError: (error) => {
      message.error(getErrorMessage(error));
    },
  });

  const columns: ColumnsType<DeliverySettlement> = [
    { title: '结算 ID', dataIndex: 'id', key: 'id', width: 150, ellipsis: true },
    {
      title: '商家',
      key: 'merchant',
      width: 180,
      render: (_, record) => record.merchant?.name ?? record.merchantId,
    },
    {
      title: '子订单',
      key: 'subOrder',
      width: 150,
      render: (_, record) => record.subOrder?.id ?? record.subOrderId ?? '-',
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
    },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      width: 100,
      render: (value: string) => <StatusPill value={value} />,
    },
    { title: '结算月', dataIndex: 'settlementMonth', key: 'settlementMonth', width: 100 },
    { title: '完成时间', dataIndex: 'settledAt', key: 'settledAt', width: 150, render: formatDateTime },
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
    },
  ];

  return (
    <div style={{ padding: 24 }}>
      <PageHeader
        title="配送结算"
        subtitle="结算页只展示供货额、应结额、已结额，不暴露平台定价策略。"
        extra={(
          <Select
            allowClear
            placeholder="按状态筛选"
            style={{ width: 180 }}
            value={status}
            onChange={(value) => {
              setStatus(value);
              setPagination((prev) => ({ ...prev, current: 1 }));
            }}
            options={settlementStatusOptions.map((item) => ({ label: item, value: item }))}
          />
        )}
      />

      <Card>
        <Table<DeliverySettlement>
          rowKey="id"
          columns={columns}
          dataSource={query.data?.items ?? []}
          loading={query.isLoading}
          scroll={{ x: 1160 }}
          locale={{ emptyText: query.isError ? getErrorMessage(query.error) : '暂无结算记录' }}
          pagination={{
            current: query.data?.page ?? pagination.current,
            pageSize: query.data?.pageSize ?? pagination.pageSize,
            total: query.data?.total ?? 0,
            showSizeChanger: true,
          }}
          onChange={(nextPagination) => setPagination(nextPagination)}
        />
      </Card>

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
