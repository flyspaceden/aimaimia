import { useRef, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { App as AntdApp, Button, Form, Input, Modal, Space, Table, Typography } from 'antd';
import { ReloadOutlined } from '@ant-design/icons';
import { ProTable, type ActionType, type ProColumns } from '@ant-design/pro-components';
import type { ColumnsType } from 'antd/es/table';
import {
  approveDeliveryProduct,
  getDeliveryProducts,
  rejectDeliveryProduct,
} from '@/api/delivery-management';
import type { DeliveryProduct, DeliveryProductSku } from '@/types/delivery-management';
import { PageHeader, StatusPill } from './components';
import {
  deliveryValueEnum,
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
  const actionRef = useRef<ActionType | undefined>(undefined);
  const [reviewAction, setReviewAction] = useState<ReviewAction | null>(null);
  const [form] = Form.useForm<{ note?: string }>();

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
      actionRef.current?.reload();
    },
    onError: (error) => {
      message.error(getErrorMessage(error));
    },
  });

  const skuColumns: ColumnsType<DeliveryProductSku> = [
    { title: '规格名称', dataIndex: 'title', key: 'title', width: 180 },
    { title: '规格编码', dataIndex: 'skuCode', key: 'skuCode', width: 140, render: (value) => value || '-' },
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

  const columns: ProColumns<DeliveryProduct>[] = [
    {
      title: '关键词',
      dataIndex: 'keyword',
      hideInTable: true,
      fieldProps: { placeholder: '搜标题、副标题、关键字' },
    },
    { title: '商品编号', dataIndex: 'id', key: 'id', width: 170, ellipsis: true, copyable: true, search: false },
    { title: '商品标题', dataIndex: 'title', key: 'title', width: 220, search: false },
    {
      title: '商家',
      key: 'merchant',
      width: 180,
      render: (_, record) => record.merchant?.name ?? record.merchantId,
      search: false,
    },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      width: 200,
      valueEnum: deliveryValueEnum(productStatusOptions),
      render: (_, record) => (
        <Space direction="vertical" size={4}>
          <StatusPill value={record.status} />
          <StatusPill value={record.auditStatus} />
        </Space>
      ),
    },
    {
      title: '审核状态',
      dataIndex: 'auditStatus',
      hideInTable: true,
      valueEnum: deliveryValueEnum(productAuditStatusOptions),
    },
    {
      title: '规格定价概览',
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
      search: false,
    },
    {
      title: '提审次数',
      dataIndex: 'submissionCount',
      key: 'submissionCount',
      width: 90,
      search: false,
    },
    {
      title: '更新时间',
      dataIndex: 'updatedAt',
      key: 'updatedAt',
      width: 150,
      render: (_, record) => formatDateTime(record.updatedAt),
      search: false,
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
      search: false,
    },
  ];

  return (
    <div style={{ padding: 24 }}>
      <PageHeader
        title="配送商品"
        subtitle="审核配送商品，重点区分商家供货价、基础价和固定最终价。"
      />

      <ProTable<DeliveryProduct>
        actionRef={actionRef}
        rowKey="id"
        columns={columns}
        request={async (params) => {
          const result = await getDeliveryProducts({
            keyword: typeof params.keyword === 'string' ? params.keyword.trim() : undefined,
            status: typeof params.status === 'string' ? params.status : undefined,
            auditStatus: typeof params.auditStatus === 'string' ? params.auditStatus : undefined,
          });
          return {
            data: result.items,
            success: true,
            total: result.items.length,
          };
        }}
        pagination={{ defaultPageSize: 20, showSizeChanger: true }}
        search={{ labelWidth: 84 }}
        scroll={{ x: 1380 }}
        toolBarRender={() => [
          <Button key="reload" icon={<ReloadOutlined />} onClick={() => actionRef.current?.reload()}>
            刷新
          </Button>,
        ]}
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
