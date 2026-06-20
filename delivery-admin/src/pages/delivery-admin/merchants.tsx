import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { App as AntdApp, Button, Card, Form, Input, InputNumber, Modal, Select, Space, Table } from 'antd';
import type { ColumnsType, TablePaginationConfig } from 'antd/es/table';
import { getDeliveryMerchants, updateDeliveryMerchant } from '@/api/delivery-management';
import type { DeliveryMerchantSummary } from '@/types/delivery-management';
import { DetailLinkButton, PageHeader, StatusPill } from './components';
import { formatBps, formatDateTime, getErrorMessage, merchantStatusOptions } from './utils';

type MerchantFormValues = {
  name?: string;
  status?: string;
  servicePhone?: string;
  defaultMarkupBps?: number | null;
};

export default function DeliveryMerchantsPage() {
  const { message } = AntdApp.useApp();
  const queryClient = useQueryClient();
  const [keywordInput, setKeywordInput] = useState('');
  const [keyword, setKeyword] = useState('');
  const [status, setStatus] = useState<string | undefined>();
  const [editing, setEditing] = useState<DeliveryMerchantSummary | null>(null);
  const [pagination, setPagination] = useState<TablePaginationConfig>({
    current: 1,
    pageSize: 20,
  });
  const [form] = Form.useForm<MerchantFormValues>();

  const query = useQuery({
    queryKey: ['delivery-merchants', pagination.current, pagination.pageSize, keyword, status],
    queryFn: () =>
      getDeliveryMerchants({
        page: pagination.current,
        pageSize: pagination.pageSize,
        keyword,
        status,
      }),
  });

  useEffect(() => {
    if (!editing) {
      form.resetFields();
      return;
    }
    form.setFieldsValue({
      name: editing.name,
      status: editing.status,
      servicePhone: editing.servicePhone ?? undefined,
      defaultMarkupBps: editing.defaultMarkupBps,
    });
  }, [editing, form]);

  const mutation = useMutation({
    mutationFn: (values: MerchantFormValues) =>
      updateDeliveryMerchant(editing!.id, {
        name: values.name,
        status: values.status,
        servicePhone: values.servicePhone,
        defaultMarkupBps: values.defaultMarkupBps ?? undefined,
      }),
    onSuccess: async () => {
      message.success('商家信息已更新');
      setEditing(null);
      await queryClient.invalidateQueries({ queryKey: ['delivery-merchants'] });
      await queryClient.invalidateQueries({ queryKey: ['delivery-merchant-detail'] });
    },
    onError: (error) => {
      message.error(getErrorMessage(error));
    },
  });

  const columns: ColumnsType<DeliveryMerchantSummary> = [
    { title: '商家 ID', dataIndex: 'id', key: 'id', width: 140, ellipsis: true },
    { title: '商家名称', dataIndex: 'name', key: 'name', width: 200 },
    { title: '联系人', dataIndex: 'contactName', key: 'contactName', width: 120 },
    { title: '联系电话', dataIndex: 'contactPhone', key: 'contactPhone', width: 140 },
    { title: '客服热线', dataIndex: 'servicePhone', key: 'servicePhone', width: 140 },
    {
      title: '默认加价率',
      dataIndex: 'defaultMarkupBps',
      key: 'defaultMarkupBps',
      width: 120,
      render: (value: number | null) => formatBps(value),
    },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      width: 100,
      render: (value: string) => <StatusPill value={value} />,
    },
    {
      title: '创建时间',
      dataIndex: 'createdAt',
      key: 'createdAt',
      width: 160,
      render: formatDateTime,
    },
    {
      title: '操作',
      key: 'action',
      fixed: 'right',
      width: 180,
      render: (_, record) => (
        <Space size="small">
          <DetailLinkButton to={`/merchants/${record.id}`} />
          <Button type="link" size="small" onClick={() => setEditing(record)}>
            编辑
          </Button>
        </Space>
      ),
    },
  ];

  return (
    <div style={{ padding: 24 }}>
      <PageHeader
        title="配送商家"
        subtitle="管理商家状态、客服热线和默认加价率。"
        extra={(
          <Space>
            <Input.Search
              allowClear
              placeholder="搜商家/联系人/手机号"
              style={{ width: 260 }}
              value={keywordInput}
              onChange={(event) => setKeywordInput(event.target.value)}
              onSearch={(value) => {
                setKeyword(value.trim());
                setPagination((prev) => ({ ...prev, current: 1 }));
              }}
            />
            <Select
              allowClear
              placeholder="状态"
              style={{ width: 160 }}
              value={status}
              onChange={(value) => {
                setStatus(value);
                setPagination((prev) => ({ ...prev, current: 1 }));
              }}
              options={merchantStatusOptions.map((item) => ({ label: item, value: item }))}
            />
          </Space>
        )}
      />
      <Card>
        <Table<DeliveryMerchantSummary>
          rowKey="id"
          columns={columns}
          dataSource={query.data?.items ?? []}
          loading={query.isLoading}
          scroll={{ x: 1350 }}
          locale={{ emptyText: query.isError ? getErrorMessage(query.error) : '暂无配送商家' }}
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
        title="编辑配送商家"
        confirmLoading={mutation.isPending}
        onCancel={() => setEditing(null)}
        onOk={async () => {
          const values = await form.validateFields();
          mutation.mutate(values);
        }}
      >
        <Form form={form} layout="vertical">
          <Form.Item label="商家名称" name="name">
            <Input />
          </Form.Item>
          <Form.Item label="状态" name="status">
            <Select options={merchantStatusOptions.map((item) => ({ label: item, value: item }))} />
          </Form.Item>
          <Form.Item label="客服热线" name="servicePhone">
            <Input />
          </Form.Item>
          <Form.Item label="默认加价率 (bps)" name="defaultMarkupBps">
            <InputNumber min={0} max={100000} style={{ width: '100%' }} />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
