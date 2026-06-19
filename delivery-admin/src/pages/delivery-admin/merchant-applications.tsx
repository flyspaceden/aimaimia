import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { App as AntdApp, Button, Card, Form, Input, Modal, Select, Space, Table } from 'antd';
import type { ColumnsType, TablePaginationConfig } from 'antd/es/table';
import {
  getDeliveryMerchantApplications,
  reviewDeliveryMerchantApplication,
} from '@/api/delivery-management';
import type { DeliveryMerchantApplicationSummary } from '@/types/delivery-management';
import { DetailLinkButton, PageHeader, StatusPill } from './components';
import {
  formatDateTime,
  getErrorMessage,
  merchantApplicationStatusOptions,
} from './utils';

type ReviewFormValues = {
  status: 'APPROVED' | 'REJECTED';
  merchantId?: string;
  rejectReason?: string;
};

export default function DeliveryMerchantApplicationsPage() {
  const { message } = AntdApp.useApp();
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<string | undefined>();
  const [reviewing, setReviewing] = useState<DeliveryMerchantApplicationSummary | null>(null);
  const [pagination, setPagination] = useState<TablePaginationConfig>({
    current: 1,
    pageSize: 20,
  });
  const [form] = Form.useForm<ReviewFormValues>();

  const query = useQuery({
    queryKey: ['delivery-merchant-applications', pagination.current, pagination.pageSize, status],
    queryFn: () =>
      getDeliveryMerchantApplications({
        page: pagination.current,
        pageSize: pagination.pageSize,
        status,
      }),
  });

  const mutation = useMutation({
    mutationFn: (values: ReviewFormValues) => reviewDeliveryMerchantApplication(reviewing!.id, values),
    onSuccess: async () => {
      message.success('申请审核结果已提交');
      setReviewing(null);
      form.resetFields();
      await queryClient.invalidateQueries({ queryKey: ['delivery-merchant-applications'] });
      await queryClient.invalidateQueries({ queryKey: ['delivery-merchant-application-detail'] });
    },
    onError: (error) => {
      message.error(getErrorMessage(error));
    },
  });

  const columns: ColumnsType<DeliveryMerchantApplicationSummary> = [
    { title: '申请 ID', dataIndex: 'id', key: 'id', width: 150, ellipsis: true },
    { title: '企业名', dataIndex: 'companyName', key: 'companyName', width: 220 },
    { title: '联系人', dataIndex: 'contactName', key: 'contactName', width: 120 },
    { title: '联系电话', dataIndex: 'contactPhone', key: 'contactPhone', width: 140 },
    { title: '关联商家', key: 'merchant', width: 160, render: (_, record) => record.merchant?.name ?? '-' },
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
          <DetailLinkButton to={`/merchant-applications/${record.id}`} />
          <Button type="link" size="small" onClick={() => setReviewing(record)}>
            审核
          </Button>
        </Space>
      ),
    },
  ];

  return (
    <div style={{ padding: 24 }}>
      <PageHeader
        title="商家入驻审核"
        subtitle="审核配送商家申请，并明确批准或驳回结果。"
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
            options={merchantApplicationStatusOptions.map((item) => ({ label: item, value: item }))}
          />
        )}
      />
      <Card>
        <Table<DeliveryMerchantApplicationSummary>
          rowKey="id"
          columns={columns}
          dataSource={query.data?.items ?? []}
          loading={query.isLoading}
          scroll={{ x: 1250 }}
          locale={{ emptyText: query.isError ? getErrorMessage(query.error) : '暂无入驻申请' }}
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
        open={Boolean(reviewing)}
        title="审核商家入驻"
        confirmLoading={mutation.isPending}
        onCancel={() => {
          setReviewing(null);
          form.resetFields();
        }}
        onOk={async () => {
          const values = await form.validateFields();
          mutation.mutate(values);
        }}
      >
        <Form
          form={form}
          layout="vertical"
          initialValues={{ status: 'APPROVED' }}
        >
          <Form.Item
            label="审核结果"
            name="status"
            rules={[{ required: true, message: '请选择审核结果' }]}
          >
            <Select
              options={[
                { label: 'APPROVED', value: 'APPROVED' },
                { label: 'REJECTED', value: 'REJECTED' },
              ]}
            />
          </Form.Item>
          <Form.Item
            shouldUpdate={(prev, next) => prev.status !== next.status}
            noStyle
          >
            {({ getFieldValue }) =>
              getFieldValue('status') === 'APPROVED' ? (
                <Form.Item label="关联商家 ID" name="merchantId">
                  <Input placeholder="已存在商家时填写；留空则仅更新申请状态" />
                </Form.Item>
              ) : (
                <Form.Item label="驳回原因" name="rejectReason">
                  <Input.TextArea rows={4} maxLength={500} />
                </Form.Item>
              )
            }
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
