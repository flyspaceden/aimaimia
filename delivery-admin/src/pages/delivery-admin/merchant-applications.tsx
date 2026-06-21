import { useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { App as AntdApp, Button, Form, Input, Modal, Select, Space } from 'antd';
import { ReloadOutlined } from '@ant-design/icons';
import { ProTable, type ActionType, type ProColumns } from '@ant-design/pro-components';
import {
  getDeliveryMerchantApplications,
  reviewDeliveryMerchantApplication,
} from '@/api/delivery-management';
import type { DeliveryMerchantApplicationSummary } from '@/types/delivery-management';
import { DetailLinkButton, PageHeader, StatusPill } from './components';
import {
  deliveryValueEnum,
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
  const actionRef = useRef<ActionType | undefined>(undefined);
  const [reviewing, setReviewing] = useState<DeliveryMerchantApplicationSummary | null>(null);
  const [form] = Form.useForm<ReviewFormValues>();

  const mutation = useMutation({
    mutationFn: (values: ReviewFormValues) => reviewDeliveryMerchantApplication(reviewing!.id, values),
    onSuccess: async () => {
      message.success('申请审核结果已提交');
      setReviewing(null);
      form.resetFields();
      actionRef.current?.reload();
      await queryClient.invalidateQueries({ queryKey: ['delivery-merchant-application-detail'] });
    },
    onError: (error) => {
      message.error(getErrorMessage(error));
    },
  });

  const columns: ProColumns<DeliveryMerchantApplicationSummary>[] = [
    { title: '申请编号', dataIndex: 'id', key: 'id', width: 170, ellipsis: true, copyable: true, search: false },
    { title: '企业名', dataIndex: 'companyName', key: 'companyName', width: 220, search: false },
    { title: '联系人', dataIndex: 'contactName', key: 'contactName', width: 120, search: false },
    { title: '联系电话', dataIndex: 'contactPhone', key: 'contactPhone', width: 140, search: false },
    { title: '关联商家', key: 'merchant', width: 160, render: (_, record) => record.merchant?.name ?? '-', search: false },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      width: 100,
      valueEnum: deliveryValueEnum(merchantApplicationStatusOptions),
      render: (_, record) => <StatusPill value={record.status} />,
    },
    {
      title: '创建时间',
      dataIndex: 'createdAt',
      key: 'createdAt',
      width: 160,
      render: (_, record) => formatDateTime(record.createdAt),
      search: false,
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
      search: false,
    },
  ];

  return (
    <div style={{ padding: 24 }}>
      <PageHeader
        title="商家入驻审核"
        subtitle="审核配送商家申请，并明确批准或驳回结果。"
      />
      <ProTable<DeliveryMerchantApplicationSummary>
        actionRef={actionRef}
        rowKey="id"
        columns={columns}
        request={async (params) => {
          const result = await getDeliveryMerchantApplications({
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
        scroll={{ x: 1250 }}
        toolBarRender={() => [
          <Button key="reload" icon={<ReloadOutlined />} onClick={() => actionRef.current?.reload()}>
            刷新
          </Button>,
        ]}
      />

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
                { label: '审核通过', value: 'APPROVED' },
                { label: '审核驳回', value: 'REJECTED' },
              ]}
            />
          </Form.Item>
          <Form.Item
            shouldUpdate={(prev, next) => prev.status !== next.status}
            noStyle
          >
            {({ getFieldValue }) =>
              getFieldValue('status') === 'APPROVED' ? (
                <Form.Item label="关联商家编号" name="merchantId">
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
