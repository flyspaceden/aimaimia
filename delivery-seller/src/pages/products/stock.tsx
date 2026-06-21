import { useMemo, useState } from 'react';
import { App, Button, Form, Input, InputNumber, Modal, Space, Table, Tag, Typography } from 'antd';
import { EditOutlined, WarningOutlined } from '@ant-design/icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { getProducts } from '@/api/products';
import { updateSkuStock } from '@/api/inventory';
import { getStatusDisplay, productStatusMap } from '@/constants/statusMaps';
import type { Product, ProductSKU } from '@/types';

interface StockRow {
  skuId: string;
  productId: string;
  productTitle: string;
  skuTitle: string;
  stock: number;
  unitName?: string;
  status?: string;
  supplyPriceCents?: number;
}

interface StockForm {
  stock: number;
  remark?: string;
}

const formatMoney = (value?: number) =>
  typeof value === 'number' ? `¥${(value / 100).toFixed(2)}` : '-';

const flattenProducts = (products: Product[]): StockRow[] =>
  products.flatMap((product) =>
    (product.skus || []).map((sku: ProductSKU) => ({
      skuId: sku.id,
      productId: product.id,
      productTitle: product.title,
      skuTitle: sku.title || '默认规格',
      stock: sku.stock ?? 0,
      unitName: product.unitName || sku.title,
      status: sku.status,
      supplyPriceCents: sku.supplyPriceCents,
    })),
  );

export default function StockPage() {
  const { message } = App.useApp();
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState<StockRow | null>(null);
  const [saving, setSaving] = useState(false);
  const [form] = Form.useForm<StockForm>();

  const { data, isLoading } = useQuery({
    queryKey: ['delivery-stock-products'],
    queryFn: () => getProducts({ page: 1, pageSize: 200 }),
  });

  const rows = useMemo(() => flattenProducts(data?.items || []), [data?.items]);

  const openEdit = (row: StockRow) => {
    setEditing(row);
    form.setFieldsValue({ stock: Math.max(0, row.stock), remark: '' });
  };

  const handleSave = async (values: StockForm) => {
    if (!editing) return;
    setSaving(true);
    try {
      await updateSkuStock(editing.skuId, {
        stock: values.stock,
        remark: values.remark?.trim() || undefined,
      });
      message.success('库存已更新');
      setEditing(null);
      queryClient.invalidateQueries({ queryKey: ['delivery-stock-products'] });
      queryClient.invalidateQueries({ queryKey: ['seller-product-status-counts'] });
    } catch (err) {
      message.error(err instanceof Error ? err.message : '库存更新失败');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Space direction="vertical" size={16} style={{ display: 'flex' }}>
      <Table<StockRow>
        rowKey="skuId"
        loading={isLoading}
        dataSource={rows}
        pagination={{ pageSize: 20, showSizeChanger: true }}
        size="middle"
        columns={[
          {
            title: '商品',
            dataIndex: 'productTitle',
            render: (_, row) => (
              <Space direction="vertical" size={0}>
                <Typography.Text strong>{row.productTitle}</Typography.Text>
                <Typography.Text type="secondary">{row.skuTitle}</Typography.Text>
              </Space>
            ),
          },
          {
            title: '供货价',
            dataIndex: 'supplyPriceCents',
            width: 120,
            render: (value) => <Typography.Text>{formatMoney(value)}</Typography.Text>,
          },
          {
            title: '库存',
            dataIndex: 'stock',
            width: 120,
            sorter: (a, b) => a.stock - b.stock,
            render: (value: number) => (
              <Space>
                {value <= 0 ? <WarningOutlined style={{ color: '#d4380d' }} /> : null}
                <Typography.Text type={value <= 0 ? 'danger' : undefined}>{value}</Typography.Text>
              </Space>
            ),
          },
          {
            title: '状态',
            dataIndex: 'status',
            width: 120,
            render: (value?: string) => {
              const status = getStatusDisplay(productStatusMap, value);
              return <Tag color={status.color}>{status.text}</Tag>;
            },
          },
          {
            title: '操作',
            width: 120,
            render: (_, row) => (
              <Button type="link" icon={<EditOutlined />} onClick={() => openEdit(row)}>
                调整库存
              </Button>
            ),
          },
        ]}
      />

      <Modal
        title={editing ? `调整库存: ${editing.skuTitle}` : '调整库存'}
        open={!!editing}
        onCancel={() => setEditing(null)}
        onOk={() => form.submit()}
        confirmLoading={saving}
        destroyOnClose
      >
        <Form<StockForm> form={form} layout="vertical" onFinish={handleSave}>
          <Form.Item label="商品">
            <Typography.Text>{editing?.productTitle || '-'}</Typography.Text>
          </Form.Item>
          <Form.Item label="当前库存">
            <Typography.Text>{editing?.stock ?? '-'}</Typography.Text>
          </Form.Item>
          <Form.Item
            name="stock"
            label="更新后库存"
            rules={[{ required: true, message: '请输入库存' }]}
          >
            <InputNumber min={0} precision={0} style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item name="remark" label="调整备注">
            <Input.TextArea rows={3} maxLength={500} showCount />
          </Form.Item>
        </Form>
      </Modal>
    </Space>
  );
}
