import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { App as AntdApp, Button, Card, Form, Input, InputNumber, Modal, Select, Space, Switch, Table } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import {
  getDeliveryManifestCustomization,
  getDeliveryManifests,
  regenerateDeliveryManifest,
  upsertDeliveryManifestCustomization,
} from '@/api/delivery-management';
import type {
  DeliveryManifestColumn,
  DeliveryManifestCustomization,
  DeliveryManifestCustomizationEntry,
  DeliveryManifestTemplate,
} from '@/types/delivery-management';
import { PageHeader, StatusPill } from './components';
import {
  normalizeDeliveryManifestCustomizationEntries,
  validateDeliveryManifestCustomizationEntries,
  validateDeliveryManifestTemplateColumns,
} from './formValidation';
import { formatDateTime, getErrorMessage } from './utils';

type TemplateFormValues = {
  name?: string;
  description?: string;
  columns: DeliveryManifestColumn[];
};

export default function DeliveryManifestsPage() {
  const { message } = AntdApp.useApp();
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState<DeliveryManifestTemplate | null>(null);
  const [open, setOpen] = useState(false);
  const [columns, setColumns] = useState<DeliveryManifestColumn[]>([]);
  const [customTarget, setCustomTarget] = useState<{
    manifestType: DeliveryManifestCustomization['manifestType'];
    targetId: string;
  }>({
    manifestType: 'BUYER_FULL',
    targetId: '',
  });
  const [customEntries, setCustomEntries] = useState<DeliveryManifestCustomizationEntry[]>([]);
  const [form] = Form.useForm<TemplateFormValues>();

  const query = useQuery({
    queryKey: ['delivery-manifests'],
    queryFn: getDeliveryManifests,
  });

  useEffect(() => {
    if (!editing || !open) {
      form.resetFields();
      setColumns([]);
      return;
    }
    form.setFieldsValue({
      name: editing.name,
      description: editing.description ?? undefined,
      columns: editing.currentConfig.columns,
    });
    setColumns(editing.currentConfig.columns.map((item) => ({ ...item })));
  }, [editing, form, open]);

  const mutation = useMutation({
    mutationFn: async (values: TemplateFormValues) =>
      regenerateDeliveryManifest(editing!.id, {
        name: values.name?.trim() || undefined,
        description: values.description?.trim() || undefined,
        columns: columns.map((item) => ({
          key: item.key,
          label: item.label,
          sortOrder: item.sortOrder,
          visible: item.visible,
        })),
      }),
    onSuccess: async () => {
      message.success('模板已重新生成版本');
      setOpen(false);
      setEditing(null);
      await queryClient.invalidateQueries({ queryKey: ['delivery-manifests'] });
    },
    onError: (error) => {
      message.error(getErrorMessage(error));
    },
  });

  const loadCustomizationMutation = useMutation({
    mutationFn: async () =>
      getDeliveryManifestCustomization(customTarget.manifestType, customTarget.targetId.trim()),
    onSuccess: (data) => {
      setCustomEntries(data.entries.map((entry) => ({ ...entry })));
      message.success('已加载目标自定义列');
    },
    onError: (error) => {
      message.error(getErrorMessage(error));
    },
  });

  const saveCustomizationMutation = useMutation({
    mutationFn: async () =>
      upsertDeliveryManifestCustomization({
        manifestType: customTarget.manifestType,
        targetId: customTarget.targetId.trim(),
        entries: normalizeDeliveryManifestCustomizationEntries(customEntries),
      }),
    onSuccess: async () => {
      message.success('目标自定义列已保存');
      await queryClient.invalidateQueries({ queryKey: ['delivery-manifests'] });
    },
    onError: (error) => {
      message.error(getErrorMessage(error));
    },
  });

  const templateColumns: ColumnsType<DeliveryManifestTemplate> = [
    { title: '模板 ID', dataIndex: 'id', key: 'id', width: 150, ellipsis: true },
    { title: '模板类型', dataIndex: 'type', key: 'type', width: 160 },
    { title: '模板名称', dataIndex: 'name', key: 'name', width: 180 },
    { title: '说明', dataIndex: 'description', key: 'description', ellipsis: true },
    {
      title: '当前版本',
      key: 'latestVersion',
      width: 120,
      render: (_, record) => record.latestVersion?.versionNo ?? '-',
    },
    {
      title: '已发布状态',
      key: 'status',
      width: 100,
      render: (_, record) => <StatusPill value={record.latestVersion?.status ?? null} />,
    },
    {
      title: '列配置数',
      key: 'columns',
      width: 100,
      render: (_, record) => record.currentConfig.columns.length,
    },
    {
      title: '操作',
      key: 'action',
      width: 120,
      render: (_, record) => (
        <Button
          type="link"
          size="small"
          onClick={() => {
            setEditing(record);
            setOpen(true);
          }}
        >
          编辑列配置
        </Button>
      ),
    },
  ];

  const editableColumns: ColumnsType<DeliveryManifestColumn> = [
    { title: 'key', dataIndex: 'key', key: 'key', width: 180 },
    {
      title: '标签',
      dataIndex: 'label',
      key: 'label',
      render: (_, record, index) => (
        <Input
          value={record.label}
          onChange={(event) =>
            setColumns((prev) =>
              prev.map((item, itemIndex) => (itemIndex === index ? { ...item, label: event.target.value } : item)),
            )
          }
        />
      ),
    },
    {
      title: '排序',
      dataIndex: 'sortOrder',
      key: 'sortOrder',
      width: 110,
      render: (_, record, index) => (
        <InputNumber
          min={0}
          max={999}
          precision={0}
          value={record.sortOrder}
          onChange={(value) =>
            setColumns((prev) =>
              prev.map((item, itemIndex) => (itemIndex === index ? { ...item, sortOrder: value ?? item.sortOrder } : item)),
            )
          }
        />
      ),
    },
    {
      title: '显示',
      dataIndex: 'visible',
      key: 'visible',
      width: 90,
      render: (_, record, index) => (
        <Switch
          checked={record.visible}
          onChange={(checked) =>
            setColumns((prev) =>
              prev.map((item, itemIndex) => (itemIndex === index ? { ...item, visible: checked } : item)),
            )
          }
        />
      ),
    },
    {
      title: '固定列',
      dataIndex: 'fixed',
      key: 'fixed',
      width: 90,
      render: (value: boolean | undefined) => <StatusPill value={value ? 'ACTIVE' : 'INACTIVE'} />,
    },
  ];

  const customColumnsTable: ColumnsType<DeliveryManifestCustomizationEntry> = [
    {
      title: 'key',
      dataIndex: 'key',
      key: 'key',
      width: 180,
      render: (_, record, index) => (
        <Input
          value={record.key}
          placeholder="custom_key"
          onChange={(event) =>
            setCustomEntries((prev) =>
              prev.map((item, itemIndex) =>
                itemIndex === index ? { ...item, key: event.target.value } : item,
              ),
            )
          }
        />
      ),
    },
    {
      title: '列名',
      dataIndex: 'label',
      key: 'label',
      width: 180,
      render: (_, record, index) => (
        <Input
          value={record.label}
          onChange={(event) =>
            setCustomEntries((prev) =>
              prev.map((item, itemIndex) =>
                itemIndex === index ? { ...item, label: event.target.value } : item,
              ),
            )
          }
        />
      ),
    },
    {
      title: '内容',
      dataIndex: 'value',
      key: 'value',
      render: (_, record, index) => (
        <Input
          value={record.value}
          onChange={(event) =>
            setCustomEntries((prev) =>
              prev.map((item, itemIndex) =>
                itemIndex === index ? { ...item, value: event.target.value } : item,
              ),
            )
          }
        />
      ),
    },
    {
      title: '排序',
      dataIndex: 'sortOrder',
      key: 'sortOrder',
      width: 110,
      render: (_, record, index) => (
        <InputNumber
          min={0}
          max={999}
          precision={0}
          value={record.sortOrder}
          onChange={(value) =>
            setCustomEntries((prev) =>
              prev.map((item, itemIndex) =>
                itemIndex === index ? { ...item, sortOrder: value ?? item.sortOrder } : item,
              ),
            )
          }
        />
      ),
    },
    {
      title: '显示',
      dataIndex: 'visible',
      key: 'visible',
      width: 90,
      render: (_, record, index) => (
        <Switch
          checked={record.visible}
          onChange={(checked) =>
            setCustomEntries((prev) =>
              prev.map((item, itemIndex) =>
                itemIndex === index ? { ...item, visible: checked } : item,
              ),
            )
          }
        />
      ),
    },
    {
      title: '操作',
      key: 'action',
      width: 100,
      render: (_, __, index) => (
        <Button
          danger
          type="link"
          size="small"
          onClick={() =>
            setCustomEntries((prev) => prev.filter((_, itemIndex) => itemIndex !== index))
          }
        >
          删除
        </Button>
      ),
    },
  ];

  const handleLoadCustomization = () => {
    if (!customTarget.targetId.trim()) {
      message.warning(customTarget.manifestType === 'BUYER_FULL' ? '请输入订单号' : '请输入子单号');
      return;
    }
    loadCustomizationMutation.mutate();
  };

  const handleSaveCustomization = () => {
    if (!customTarget.targetId.trim()) {
      message.warning(customTarget.manifestType === 'BUYER_FULL' ? '请输入订单号' : '请输入子单号');
      return;
    }
    const validationMessage = validateDeliveryManifestCustomizationEntries(
      customEntries,
      customTarget.manifestType,
    );
    if (validationMessage) {
      message.warning(validationMessage);
      return;
    }
    saveCustomizationMutation.mutate();
  };

  return (
    <div style={{ padding: 24 }}>
      <PageHeader title="配送清单模板" subtitle="维护模板列 label / sortOrder / visible，并通过重新生成发布新版本。" />

      <Card>
        <Table<DeliveryManifestTemplate>
          rowKey="id"
          columns={templateColumns}
          dataSource={query.data ?? []}
          loading={query.isLoading}
          scroll={{ x: 980 }}
          locale={{ emptyText: query.isError ? getErrorMessage(query.error) : '暂无模板' }}
          expandable={{
            expandedRowRender: (record) => (
              <Table
                size="small"
                pagination={false}
                rowKey="id"
                dataSource={record.versions}
                columns={[
                  { title: '版本 ID', dataIndex: 'id', key: 'id', width: 150, ellipsis: true },
                  { title: '版本号', dataIndex: 'versionNo', key: 'versionNo', width: 100 },
                  { title: '状态', dataIndex: 'status', key: 'status', width: 100, render: (value: string) => <StatusPill value={value} /> },
                  { title: '创建时间', dataIndex: 'createdAt', key: 'createdAt', width: 150, render: formatDateTime },
                ]}
              />
            ),
          }}
        />
      </Card>

      <Card title="逐单自定义列" style={{ marginTop: 24 }}>
        <Space align="start" style={{ width: '100%', marginBottom: 16 }} wrap>
          <div style={{ minWidth: 180 }}>
            <div style={{ marginBottom: 8 }}>清单类型</div>
            <Select
              value={customTarget.manifestType}
              onChange={(value) =>
                setCustomTarget((prev) => ({
                  ...prev,
                  manifestType: value as DeliveryManifestCustomization['manifestType'],
                }))
              }
              style={{ width: '100%' }}
              options={[
                { value: 'BUYER_FULL', label: '买家整单 PDF' },
                { value: 'SELLER_FULFILLMENT', label: '卖家配货 PDF' },
              ]}
            />
          </div>
          <div style={{ minWidth: 240, flex: 1 }}>
            <div style={{ marginBottom: 8 }}>
              {customTarget.manifestType === 'BUYER_FULL' ? '订单号' : '子单号'}
            </div>
            <Input
              value={customTarget.targetId}
              onChange={(event) =>
                setCustomTarget((prev) => ({ ...prev, targetId: event.target.value }))
              }
              placeholder={
                customTarget.manifestType === 'BUYER_FULL'
                  ? 'PSDD...'
                  : 'PSZDD...'
              }
            />
          </div>
          <Space style={{ paddingTop: 28 }}>
            <Button
              onClick={handleLoadCustomization}
              loading={loadCustomizationMutation.isPending}
            >
              加载
            </Button>
            <Button
              type="primary"
              onClick={handleSaveCustomization}
              loading={saveCustomizationMutation.isPending}
            >
              保存
            </Button>
            <Button
              onClick={() =>
                setCustomEntries((prev) => [
                  ...prev,
                  {
                    key: '',
                    label: '',
                    value: '',
                    sortOrder: 500 + prev.length * 10,
                    visible: true,
                  },
                ])
              }
            >
              新增列
            </Button>
          </Space>
        </Space>

        <Table<DeliveryManifestCustomizationEntry>
          rowKey={(record, index) => `${record.key || 'custom'}-${index}`}
          size="small"
          pagination={false}
          columns={customColumnsTable}
          dataSource={customEntries}
          scroll={{ x: 960 }}
          locale={{ emptyText: '暂无逐单自定义列' }}
        />
      </Card>

      <Modal
        open={open}
        width={900}
        title="编辑清单模板"
        confirmLoading={mutation.isPending}
        onCancel={() => {
          setOpen(false);
          setEditing(null);
          form.resetFields();
        }}
        onOk={async () => {
          const values = await form.validateFields();
          const validationMessage = validateDeliveryManifestTemplateColumns(columns, editing?.type);
          if (validationMessage) {
            message.warning(validationMessage);
            return;
          }
          mutation.mutate(values);
        }}
      >
        <Form form={form} layout="vertical">
          <Space align="start" style={{ width: '100%' }}>
            <Form.Item label="模板名称" name="name" style={{ flex: 1 }}>
              <Input />
            </Form.Item>
            <Form.Item label="说明" name="description" style={{ flex: 1 }}>
              <Input />
            </Form.Item>
          </Space>
        </Form>
        <Table<DeliveryManifestColumn>
          rowKey="key"
          size="small"
          pagination={false}
          columns={editableColumns}
          dataSource={columns}
          scroll={{ x: 760 }}
        />
      </Modal>
    </div>
  );
}
