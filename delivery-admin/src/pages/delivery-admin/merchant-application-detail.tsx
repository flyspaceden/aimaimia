import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { App as AntdApp, Button, Card, Form, Input, Modal, Select, Space } from 'antd';
import { useParams } from 'react-router-dom';
import {
  getDeliveryMerchantApplication,
  reviewDeliveryMerchantApplication,
} from '@/api/delivery-management';
import { DetailDescriptions, NotFoundPanel, PageHeader, StatusPill } from './components';
import { formatDateTime, getErrorMessage } from './utils';

type ReviewFormValues = {
  status: 'APPROVED' | 'REJECTED';
  merchantId?: string;
  rejectReason?: string;
};

export default function DeliveryMerchantApplicationDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { message } = AntdApp.useApp();
  const queryClient = useQueryClient();
  const [reviewOpen, setReviewOpen] = useState(false);
  const [form] = Form.useForm<ReviewFormValues>();

  const query = useQuery({
    queryKey: ['delivery-merchant-application-detail', id],
    queryFn: () => getDeliveryMerchantApplication(id ?? ''),
    enabled: Boolean(id),
  });

  const mutation = useMutation({
    mutationFn: (values: ReviewFormValues) => reviewDeliveryMerchantApplication(id!, values),
    onSuccess: async () => {
      message.success('申请审核结果已提交');
      setReviewOpen(false);
      form.resetFields();
      await queryClient.invalidateQueries({ queryKey: ['delivery-merchant-application-detail', id] });
      await queryClient.invalidateQueries({ queryKey: ['delivery-merchant-applications'] });
    },
    onError: (error) => {
      message.error(getErrorMessage(error));
    },
  });

  if (!id) {
    return <NotFoundPanel title="缺少申请编号" />;
  }

  if (query.isError) {
    return <NotFoundPanel title="商家入驻申请不存在或无法加载" subtitle={(query.error as Error).message} />;
  }

  const data = query.data;

  return (
    <div style={{ padding: 24 }}>
      <PageHeader
        title="入驻申请详情"
        subtitle="查看申请资料、审批人和当前审核状态。"
        extra={(
          <Space>
            <Button onClick={() => setReviewOpen(true)}>审核</Button>
          </Space>
        )}
      />
      <Card loading={query.isLoading}>
        {data ? (
          <DetailDescriptions
            items={[
              { key: 'id', label: '申请编号', children: data.id },
              { key: 'companyName', label: '企业名', children: data.companyName },
              { key: 'contactName', label: '联系人', children: data.contactName },
              { key: 'contactPhone', label: '联系电话', children: data.contactPhone },
              { key: 'email', label: '邮箱', children: data.email ?? '-' },
              { key: 'status', label: '状态', children: <StatusPill value={data.status} /> },
              { key: 'merchant', label: '关联商家', children: data.merchant?.name ?? '-' },
              {
                key: 'reviewedByAdmin',
                label: '审核人',
                children: data.reviewedByAdmin?.realName || data.reviewedByAdmin?.username || '-',
              },
              { key: 'reviewedAt', label: '审核时间', children: formatDateTime(data.reviewedAt) },
              { key: 'rejectReason', label: '驳回原因', children: data.rejectReason ?? '-' },
              { key: 'licenseFileUrl', label: '营业执照', children: data.licenseFileUrl ?? '-' },
              { key: 'note', label: '备注', children: data.note ?? '-' },
              { key: 'createdAt', label: '创建时间', children: formatDateTime(data.createdAt) },
              { key: 'updatedAt', label: '更新时间', children: formatDateTime(data.updatedAt) },
            ]}
          />
        ) : null}
      </Card>

      <Modal
        open={reviewOpen}
        title="审核商家入驻"
        confirmLoading={mutation.isPending}
        onCancel={() => {
          setReviewOpen(false);
          form.resetFields();
        }}
        onOk={async () => {
          const values = await form.validateFields();
          mutation.mutate(values);
        }}
      >
        <Form form={form} layout="vertical" initialValues={{ status: 'APPROVED' }}>
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
          <Form.Item shouldUpdate={(prev, next) => prev.status !== next.status} noStyle>
            {({ getFieldValue }) =>
              getFieldValue('status') === 'APPROVED' ? (
                <Form.Item label="关联商家编号" name="merchantId">
                  <Input />
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
