import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { App as AntdApp, Button, Card, Form, Input, Modal, Select, Space, Table, Typography } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import {
  approveDeliveryProduct,
  getDeliveryProducts,
  rejectDeliveryProduct,
} from '@/api/delivery-management';
import type { DeliveryProduct, DeliveryProductSku } from '@/types/delivery-management';
import { PageHeader, StatusPill } from './components';
import {
  formatDateTime,
  formatMoney,
  getErrorMessage,
  productAuditStatusOptions,
  productStatusOptions,
} from './utils';

const { Text } = Typography;

type ReviewAction = {
  product: DeliveryProduct;
  type: 'approve' | 'reject';
};

export default function DeliveryProductsPage() {
  const { message } = AntdApp.useApp();
  const queryClient = useQueryClient();
  const [keywordInput, setKeywordInput] = useState('');
  const [keyword, setKeyword] = useState('');
  const [status, setStatus] = useState<string | undefined>();
  const [auditStatus, setAuditStatus] = useState<string | undefined>();
  const [reviewAction, setReviewAction] = useState<ReviewAction | null>(null);
  const [form] = Form.useForm<{ note?: string }>();

  const query = useQuery({
    queryKey: ['delivery-products', keyword, status, auditStatus],
    queryFn: () => getDeliveryProducts({ keyword, status, auditStatus }),
  });

  const reviewMutation = useMutation({
    mutationFn: async (values: { note?: string }) => {
      if (!reviewAction) {
        throw new Error('缺少审核上下文');
      }
      if (reviewAction.type === 'approve') {
        return approveDeliveryProduct(reviewAction.product.id, values.note);
      }
      return rejectDeliveryProduct(reviewAction.product.id, values.note);
    },
    onSuccess: async (_, values) => {
      message.success(values?.note ? '商品审核结果已提交并附带备注' : '商品审核结果已提交');
      setReviewAction(null);
      form.resetFields();
      await queryClient.invalidateQueries({ queryKey: ['delivery-products'] });
    },
    onError: (error) => {
      message.error(getErrorMessage(error));
    },
  });

  const skuColumns: ColumnsType<DeliveryProductSku> = [
    { title: 'SKU 标题', dataIndex: 'title', key: 'title', width: 180 },
    { title: 'SKU 编码', dataIndex: 'skuCode', key: 'skuCode', width: 140, render: (value) => value || '-' },
    {
      title: '供货价',
      dataIndex: 'supplyPriceCents',
      key: 'supplyPriceCents',
      width: 110,
      render: (value: number) => formatMoney(value),
    },
    {
      title: '基础价',
      dataIndex: 'basePriceCents',
      key: 'basePriceCents',
      width: 110,
      render: (value: number) => formatMoney(value),
    },
    {
      title: '固定最终价',
      dataIndex: 'fixedFinalPriceCents',
      key: 'fixedFinalPriceCents',
      width: 120,
      render: (value: number | null) => formatMoney(value),
    },
    { title: '库存', dataIndex: 'stock', key: 'stock', width: 80 },
    { title: '起订量', dataIndex: 'minOrderQuantity', key: 'minOrderQuantity', width: 90 },
    { title: '步长', dataIndex: 'orderStepQuantity', key: 'orderStepQuantity', width: 80 },
    { title: '重量(g)', dataIndex: 'weightGram', key: 'weightGram', width: 90 },
    {
      title: '启用',
      dataIndex: 'isActive',
      key: 'isActive',
      width: 80,
      render: (value: boolean) => <StatusPill value={value ? 'ACTIVE' : 'INACTIVE'} />,
    },
  ];

  const columns: ColumnsType<DeliveryProduct> = [
    { title: '商品 ID', dataIndex: 'id', key: 'id', width: 150, ellipsis: true },
    { title: '商品标题', dataIndex: 'title', key: 'title', width: 220 },
    {
      title: '商家',
      key: 'merchant',
      width: 180,
      render: (_, record) => record.merchant?.name ?? record.merchantId,
    },
    {
      title: '状态',
      key: 'status',
      width: 200,
      render: (_, record) => (
        <Space direction="vertical" size={4}>
          <StatusPill value={record.status} />
          <StatusPill value={record.auditStatus} />
        </Space>
      ),
    },
    {
      title: 'SKU 定价概览',
      key: 'pricing',
      width: 240,
      render: (_, record) => {
        const supplyPrices = record.skus.map((item) => item.supplyPriceCents);
        const basePrices = record.skus.map((item) => item.basePriceCents);
        const fixedPrices = record.skus
          .map((item) => item.fixedFinalPriceCents)
          .filter((item): item is number => item !== null && item !== undefined);
        return (
          <Space direction="vertical" size={0}>
            <Text>供货价: {supplyPrices.length ? `${formatMoney(Math.min(...supplyPrices))} - ${formatMoney(Math.max(...supplyPrices))}` : '-'}</Text>
            <Text>基础价: {basePrices.length ? `${formatMoney(Math.min(...basePrices))} - ${formatMoney(Math.max(...basePrices))}` : '-'}</Text>
            <Text type="secondary">
              固定最终价: {fixedPrices.length ? `${formatMoney(Math.min(...fixedPrices))} - ${formatMoney(Math.max(...fixedPrices))}` : '-'}
            </Text>
          </Space>
        );
      },
    },
    {
      title: '提审次数',
      dataIndex: 'submissionCount',
      key: 'submissionCount',
      width: 90,
    },
    {
      title: '更新时间',
      dataIndex: 'updatedAt',
      key: 'updatedAt',
      width: 150,
      render: formatDateTime,
    },
    {
      title: '操作',
      key: 'action',
      width: 160,
      fixed: 'right',
      render: (_, record) => (
        <Space size="small">
          <Button type="link" size="small" onClick={() => setReviewAction({ product: record, type: 'approve' })}>
            通过
          </Button>
          <Button type="link" danger size="small" onClick={() => setReviewAction({ product: record, type: 'reject' })}>
            驳回
          </Button>
        </Space>
      ),
    },
  ];

  return (
    <div style={{ padding: 24 }}>
      <PageHeader
        title="配送商品"
        subtitle="审核配送商品，重点区分商家供货价、基础价和固定最终价。"
        extra={(
          <Space wrap>
            <Input.Search
              allowClear
              placeholder="搜标题、副标题、关键字"
              style={{ width: 280 }}
              value={keywordInput}
              onChange={(event) => setKeywordInput(event.target.value)}
              onSearch={(value) => setKeyword(value.trim())}
            />
            <Select
              allowClear
              placeholder="商品状态"
              style={{ width: 160 }}
              value={status}
              onChange={setStatus}
              options={productStatusOptions.map((item) => ({ label: item, value: item }))}
            />
            <Select
              allowClear
              placeholder="审核状态"
              style={{ width: 160 }}
              value={auditStatus}
              onChange={setAuditStatus}
              options={productAuditStatusOptions.map((item) => ({ label: item, value: item }))}
            />
          </Space>
        )}
      />

      <Card>
        <Table<DeliveryProduct>
          rowKey="id"
          columns={columns}
          dataSource={query.data?.items ?? []}
          loading={query.isLoading}
          scroll={{ x: 1380 }}
          locale={{ emptyText: query.isError ? getErrorMessage(query.error) : '暂无配送商品' }}
          expandable={{
            expandedRowRender: (record) => (
              <Table<DeliveryProductSku>
                rowKey="id"
                size="small"
                pagination={false}
                columns={skuColumns}
                dataSource={record.skus}
                scroll={{ x: 1040 }}
              />
            ),
          }}
        />
      </Card>

      <Modal
        open={Boolean(reviewAction)}
        title={reviewAction?.type === 'approve' ? '通过商品审核' : '驳回商品审核'}
        confirmLoading={reviewMutation.isPending}
        onCancel={() => {
          setReviewAction(null);
          form.resetFields();
        }}
        onOk={async () => {
          const values = await form.validateFields();
          reviewMutation.mutate(values);
        }}
      >
        <Form form={form} layout="vertical">
          <Form.Item label="商品标题">
            <Input value={reviewAction?.product.title} readOnly />
          </Form.Item>
          <Form.Item label="审核备注" name="note">
            <Input.TextArea rows={4} maxLength={500} placeholder="可选，写给商家或留给运营备注" />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
