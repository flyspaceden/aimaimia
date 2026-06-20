import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  App as AntdApp,
  Button,
  Card,
  Form,
  Input,
  InputNumber,
  Modal,
  Select,
  Space,
  Switch,
  Table,
  Tabs,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import {
  getDeliveryConfig,
  getDeliveryUnitFieldConfig,
  updateDeliveryConfig,
  updateDeliveryUnitFieldConfig,
} from '@/api/delivery-management';
import type {
  DeliveryConfigItem,
  DeliveryUnitFieldConfig,
  JsonValue,
} from '@/types/delivery-management';
import { PageHeader, StatusPill } from './components';
import {
  configScopeOptions,
  formatDateTime,
  getErrorMessage,
  parseJsonText,
  safeStringify,
  unitFieldTypeOptions,
} from './utils';

type ConfigFormValues = {
  key: string;
  scope: string;
  description?: string;
  valueText: string;
};

type UnitFieldFormValues = {
  fieldKey: string;
  label?: string;
  fieldType?: string;
  sortOrder?: number;
  placeholder?: string;
  optionsText?: string;
  isVisible?: boolean;
  isRequired?: boolean;
  showInApp?: boolean;
  showInAdmin?: boolean;
  includeInPdf?: boolean;
  includeInExcel?: boolean;
};

function parseJsonValue(valueText: string): JsonValue {
  const parsed = parseJsonText(valueText);
  return (parsed ?? '') as JsonValue;
}

export default function DeliveryConfigPage() {
  const { message } = AntdApp.useApp();
  const queryClient = useQueryClient();
  const [editingConfig, setEditingConfig] = useState<DeliveryConfigItem | null>(null);
  const [editingField, setEditingField] = useState<DeliveryUnitFieldConfig | null>(null);
  const [configOpen, setConfigOpen] = useState(false);
  const [fieldOpen, setFieldOpen] = useState(false);
  const [configForm] = Form.useForm<ConfigFormValues>();
  const [fieldForm] = Form.useForm<UnitFieldFormValues>();

  const configQuery = useQuery({
    queryKey: ['delivery-config'],
    queryFn: () => getDeliveryConfig(),
  });
  const unitFieldQuery = useQuery({
    queryKey: ['delivery-unit-field-config'],
    queryFn: getDeliveryUnitFieldConfig,
  });

  useEffect(() => {
    if (!configOpen) {
      configForm.resetFields();
      return;
    }
    if (editingConfig) {
      configForm.setFieldsValue({
        key: editingConfig.key,
        scope: editingConfig.scope,
        description: editingConfig.description ?? undefined,
        valueText: safeStringify(editingConfig.value),
      });
      return;
    }
    configForm.setFieldsValue({
      scope: 'SYSTEM',
      valueText: '""',
    });
  }, [configForm, configOpen, editingConfig]);

  useEffect(() => {
    if (!fieldOpen) {
      fieldForm.resetFields();
      return;
    }
    if (editingField) {
      fieldForm.setFieldsValue({
        fieldKey: editingField.fieldKey,
        label: editingField.label,
        fieldType: editingField.fieldType,
        sortOrder: editingField.sortOrder,
        placeholder: editingField.placeholder ?? undefined,
        optionsText: safeStringify(editingField.options),
        isVisible: editingField.isVisible,
        isRequired: editingField.isRequired,
        showInApp: editingField.showInApp,
        showInAdmin: editingField.showInAdmin,
        includeInPdf: editingField.includeInPdf,
        includeInExcel: editingField.includeInExcel,
      });
      return;
    }
    fieldForm.setFieldsValue({
      fieldType: 'TEXT',
      sortOrder: 100,
      optionsText: '[]',
      isVisible: true,
      isRequired: false,
      showInApp: true,
      showInAdmin: true,
      includeInPdf: false,
      includeInExcel: false,
    });
  }, [editingField, fieldForm, fieldOpen]);

  const configMutation = useMutation({
    mutationFn: async (values: ConfigFormValues) =>
      updateDeliveryConfig([
        {
          key: values.key.trim(),
          scope: values.scope,
          description: values.description?.trim() || undefined,
          value: parseJsonValue(values.valueText),
        },
      ]),
    onSuccess: async () => {
      message.success('配置已保存');
      setConfigOpen(false);
      setEditingConfig(null);
      await queryClient.invalidateQueries({ queryKey: ['delivery-config'] });
    },
    onError: (error) => {
      message.error(getErrorMessage(error));
    },
  });

  const fieldMutation = useMutation({
    mutationFn: async (values: UnitFieldFormValues) =>
      updateDeliveryUnitFieldConfig([
        {
          fieldKey: values.fieldKey.trim(),
          label: values.label?.trim() || undefined,
          fieldType: values.fieldType,
          sortOrder: values.sortOrder,
          placeholder: values.placeholder?.trim() || undefined,
          options: parseJsonText(values.optionsText) ?? undefined,
          isVisible: values.isVisible,
          isRequired: values.isRequired,
          showInApp: values.showInApp,
          showInAdmin: values.showInAdmin,
          includeInPdf: values.includeInPdf,
          includeInExcel: values.includeInExcel,
        },
      ]),
    onSuccess: async () => {
      message.success('单位字段配置已保存');
      setFieldOpen(false);
      setEditingField(null);
      await queryClient.invalidateQueries({ queryKey: ['delivery-unit-field-config'] });
    },
    onError: (error) => {
      message.error(getErrorMessage(error));
    },
  });

  const configColumns: ColumnsType<DeliveryConfigItem> = [
    { title: 'key', dataIndex: 'key', key: 'key', width: 220 },
    { title: 'scope', dataIndex: 'scope', key: 'scope', width: 140 },
    { title: '说明', dataIndex: 'description', key: 'description', ellipsis: true },
    {
      title: '值预览',
      key: 'value',
      ellipsis: true,
      render: (_, record) => safeStringify(record.value),
    },
    { title: '更新时间', dataIndex: 'updatedAt', key: 'updatedAt', width: 150, render: formatDateTime },
    {
      title: '操作',
      key: 'action',
      width: 100,
      render: (_, record) => (
        <Button
          type="link"
          size="small"
          onClick={() => {
            setEditingConfig(record);
            setConfigOpen(true);
          }}
        >
          编辑
        </Button>
      ),
    },
  ];

  const unitFieldColumns: ColumnsType<DeliveryUnitFieldConfig> = [
    { title: 'fieldKey', dataIndex: 'fieldKey', key: 'fieldKey', width: 180 },
    { title: '标签', dataIndex: 'label', key: 'label', width: 160 },
    { title: '类型', dataIndex: 'fieldType', key: 'fieldType', width: 110 },
    { title: '排序', dataIndex: 'sortOrder', key: 'sortOrder', width: 90 },
    { title: '固定列', dataIndex: 'isFixed', key: 'isFixed', width: 90, render: (value: boolean) => <StatusPill value={value ? 'ACTIVE' : 'INACTIVE'} /> },
    { title: 'App', dataIndex: 'showInApp', key: 'showInApp', width: 80, render: (value: boolean) => <StatusPill value={value ? 'ACTIVE' : 'INACTIVE'} /> },
    { title: 'Admin', dataIndex: 'showInAdmin', key: 'showInAdmin', width: 80, render: (value: boolean) => <StatusPill value={value ? 'ACTIVE' : 'INACTIVE'} /> },
    { title: 'PDF', dataIndex: 'includeInPdf', key: 'includeInPdf', width: 80, render: (value: boolean) => <StatusPill value={value ? 'ACTIVE' : 'INACTIVE'} /> },
    { title: 'Excel', dataIndex: 'includeInExcel', key: 'includeInExcel', width: 80, render: (value: boolean) => <StatusPill value={value ? 'ACTIVE' : 'INACTIVE'} /> },
    {
      title: '操作',
      key: 'action',
      width: 100,
      render: (_, record) => (
        <Button
          type="link"
          size="small"
          onClick={() => {
            setEditingField(record);
            setFieldOpen(true);
          }}
        >
          编辑
        </Button>
      ),
    },
  ];

  return (
    <div style={{ padding: 24 }}>
      <PageHeader title="配送配置" subtitle="平台配置与单位字段配置分 Tab 维护，金额口径仍只在订单/结算页展示。" />

      <Tabs
        items={[
          {
            key: 'config',
            label: '平台配置',
            children: (
              <Card
                extra={(
                  <Button
                    type="primary"
                    onClick={() => {
                      setEditingConfig(null);
                      setConfigOpen(true);
                    }}
                  >
                    新增配置
                  </Button>
                )}
              >
                <Table<DeliveryConfigItem>
                  rowKey="id"
                  columns={configColumns}
                  dataSource={configQuery.data ?? []}
                  loading={configQuery.isLoading}
                  scroll={{ x: 1120 }}
                  locale={{ emptyText: configQuery.isError ? getErrorMessage(configQuery.error) : '暂无配置' }}
                />
              </Card>
            ),
          },
          {
            key: 'unit-fields',
            label: '单位字段配置',
            children: (
              <Card
                extra={(
                  <Button
                    type="primary"
                    onClick={() => {
                      setEditingField(null);
                      setFieldOpen(true);
                    }}
                  >
                    新增字段
                  </Button>
                )}
              >
                <Table<DeliveryUnitFieldConfig>
                  rowKey="fieldKey"
                  columns={unitFieldColumns}
                  dataSource={unitFieldQuery.data ?? []}
                  loading={unitFieldQuery.isLoading}
                  scroll={{ x: 1120 }}
                  locale={{ emptyText: unitFieldQuery.isError ? getErrorMessage(unitFieldQuery.error) : '暂无单位字段配置' }}
                />
              </Card>
            ),
          },
        ]}
      />

      <Modal
        open={configOpen}
        width={760}
        title={editingConfig ? '编辑平台配置' : '新增平台配置'}
        confirmLoading={configMutation.isPending}
        onCancel={() => {
          setConfigOpen(false);
          setEditingConfig(null);
          configForm.resetFields();
        }}
        onOk={async () => {
          const values = await configForm.validateFields();
          configMutation.mutate(values);
        }}
      >
        <Form form={configForm} layout="vertical">
          <Space align="start" style={{ width: '100%' }}>
            <Form.Item label="key" name="key" rules={[{ required: true }]} style={{ flex: 1 }}>
              <Input disabled={Boolean(editingConfig)} />
            </Form.Item>
            <Form.Item label="scope" name="scope" rules={[{ required: true }]} style={{ width: 180 }}>
              <Select options={configScopeOptions.map((item) => ({ label: item, value: item }))} />
            </Form.Item>
          </Space>
          <Form.Item label="说明" name="description">
            <Input />
          </Form.Item>
          <Form.Item label="值（JSON）" name="valueText" rules={[{ required: true }]}>
            <Input.TextArea rows={10} />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        open={fieldOpen}
        width={860}
        title={editingField ? '编辑单位字段' : '新增单位字段'}
        confirmLoading={fieldMutation.isPending}
        onCancel={() => {
          setFieldOpen(false);
          setEditingField(null);
          fieldForm.resetFields();
        }}
        onOk={async () => {
          const values = await fieldForm.validateFields();
          fieldMutation.mutate(values);
        }}
      >
        <Form form={fieldForm} layout="vertical">
          <Space align="start" style={{ width: '100%' }}>
            <Form.Item label="fieldKey" name="fieldKey" rules={[{ required: true }]} style={{ flex: 1 }}>
              <Input disabled={Boolean(editingField?.isFixed)} />
            </Form.Item>
            <Form.Item label="标签" name="label" style={{ flex: 1 }}>
              <Input />
            </Form.Item>
            <Form.Item label="字段类型" name="fieldType" style={{ width: 180 }}>
              <Select options={unitFieldTypeOptions.map((item) => ({ label: item, value: item }))} />
            </Form.Item>
          </Space>

          <Space align="start" style={{ width: '100%' }}>
            <Form.Item label="排序" name="sortOrder">
              <InputNumber min={0} max={999} precision={0} style={{ width: 120 }} />
            </Form.Item>
            <Form.Item label="placeholder" name="placeholder" style={{ flex: 1 }}>
              <Input />
            </Form.Item>
          </Space>

          <Form.Item label="options（JSON，仅 SELECT 用）" name="optionsText">
            <Input.TextArea rows={6} />
          </Form.Item>

          <Space wrap>
            <Form.Item label="可见" name="isVisible" valuePropName="checked">
              <Switch disabled={Boolean(editingField?.isFixed)} />
            </Form.Item>
            <Form.Item label="必填" name="isRequired" valuePropName="checked">
              <Switch disabled={Boolean(editingField?.isFixed)} />
            </Form.Item>
            <Form.Item label="App" name="showInApp" valuePropName="checked">
              <Switch disabled={Boolean(editingField?.isFixed)} />
            </Form.Item>
            <Form.Item label="Admin" name="showInAdmin" valuePropName="checked">
              <Switch disabled={Boolean(editingField?.isFixed)} />
            </Form.Item>
            <Form.Item label="PDF" name="includeInPdf" valuePropName="checked">
              <Switch disabled={Boolean(editingField?.isFixed)} />
            </Form.Item>
            <Form.Item label="Excel" name="includeInExcel" valuePropName="checked">
              <Switch disabled={Boolean(editingField?.isFixed)} />
            </Form.Item>
          </Space>
        </Form>
      </Modal>
    </div>
  );
}
