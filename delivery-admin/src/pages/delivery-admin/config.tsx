import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  App as AntdApp,
  Badge,
  Button,
  Col,
  Drawer,
  Form,
  Input,
  InputNumber,
  List,
  Row,
  Select,
  Space,
  Statistic,
  Switch,
  Table,
  Tag,
  Typography,
} from 'antd';
import {
  EditOutlined,
  FilePdfOutlined,
  FormOutlined,
  PlusOutlined,
  SaveOutlined,
  SettingOutlined,
} from '@ant-design/icons';
import { ProCard } from '@ant-design/pro-components';
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
  formatDateTime,
  formatDeliveryDisplayText,
  getErrorMessage,
  unitFieldTypeOptions,
} from './utils';

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

type ConfigCategoryKey = 'unit-fields' | 'manifest-export' | 'platform-rules';
type PlatformRuleKey = 'LOW_STOCK_DISPLAY_THRESHOLD' | 'MANIFEST_CUSTOM_COLUMNS_ENABLED';

type RuleFormValues = {
  lowStockThreshold?: number;
  manifestCustomColumnsEnabled?: boolean;
};

type ConfigCategoryItem = {
  key: ConfigCategoryKey;
  title: string;
  description: string;
  icon: ReactNode;
};

const configCategoryItems: ConfigCategoryItem[] = [
  {
    key: 'unit-fields',
    title: '配送单位字段',
    description: '设置收货单位要填写哪些资料，以及这些资料显示在哪里。',
    icon: <FormOutlined />,
  },
  {
    key: 'manifest-export',
    title: '清单与导出',
    description: '控制配送清单 PDF 和后台表格导出的字段范围。',
    icon: <FilePdfOutlined />,
  },
  {
    key: 'platform-rules',
    title: '平台规则',
    description: '设置库存提醒、自定义列等配送运营规则。',
    icon: <SettingOutlined />,
  },
];

const platformRuleDefinitions: Record<PlatformRuleKey, {
  key: PlatformRuleKey;
  title: string;
  scope: string;
  sceneLabel: string;
  description: string;
  valueType: 'number' | 'switch';
  defaultValue: number | boolean;
}> = {
  LOW_STOCK_DISPLAY_THRESHOLD: {
    key: 'LOW_STOCK_DISPLAY_THRESHOLD',
    title: '低库存展示',
    scope: 'SYSTEM',
    sceneLabel: '商品提示',
    description: '配送商品库存小于等于阈值时，买家端展示低库存提示。',
    valueType: 'number',
    defaultValue: 10,
  },
  MANIFEST_CUSTOM_COLUMNS_ENABLED: {
    key: 'MANIFEST_CUSTOM_COLUMNS_ENABLED',
    title: '逐单自定义列',
    scope: 'MANIFEST',
    sceneLabel: '清单规则',
    description: '允许管理员在单笔配送清单上补充自定义列和内容。',
    valueType: 'switch',
    defaultValue: true,
  },
};

const platformRuleOrder: PlatformRuleKey[] = [
  'LOW_STOCK_DISPLAY_THRESHOLD',
  'MANIFEST_CUSTOM_COLUMNS_ENABLED',
];

function booleanText(value: boolean) {
  return value ? '已开启' : '已关闭';
}

function getObjectValue(value: JsonValue | null | undefined, key: string) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }
  return value[key];
}

function unwrapConfigValue(value: JsonValue) {
  return getObjectValue(value, 'value') ?? getObjectValue(value, 'enabled') ?? value;
}

function getPlatformRuleValue(definition: (typeof platformRuleDefinitions)[PlatformRuleKey], item?: DeliveryConfigItem) {
  const raw = item ? unwrapConfigValue(item.value) : definition.defaultValue;
  if (definition.valueType === 'switch') {
    return raw === true;
  }
  if (typeof raw === 'number') {
    return raw;
  }
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : Number(definition.defaultValue);
}

function formatOptionLines(value: JsonValue | null | undefined) {
  if (!Array.isArray(value)) {
    return '';
  }
  return value.map((item) => String(item)).join('\n');
}

function parseOptionLines(value?: string): JsonValue | undefined {
  const options = (value ?? '')
    .split(/\r?\n/)
    .map((item) => item.trim())
    .filter(Boolean);
  return options.length > 0 ? options : undefined;
}

function renderLocationTags(record: DeliveryUnitFieldConfig) {
  const locations = [
    record.showInApp ? '买家端' : null,
    record.showInAdmin ? '管理后台' : null,
    record.includeInPdf ? '清单文件' : null,
    record.includeInExcel ? '表格导出' : null,
  ].filter(Boolean);

  if (locations.length === 0) {
    return <Typography.Text type="secondary">未显示</Typography.Text>;
  }

  return (
    <Space size={[4, 4]} wrap>
      {locations.map((item) => (
        <Tag key={item}>{item}</Tag>
      ))}
    </Space>
  );
}

export default function DeliveryConfigPage() {
  const { message } = AntdApp.useApp();
  const queryClient = useQueryClient();
  const [activeCategory, setActiveCategory] = useState<ConfigCategoryKey>('unit-fields');
  const [ruleDirty, setRuleDirty] = useState(false);
  const [editingField, setEditingField] = useState<DeliveryUnitFieldConfig | null>(null);
  const [fieldOpen, setFieldOpen] = useState(false);
  const [ruleForm] = Form.useForm<RuleFormValues>();
  const [fieldForm] = Form.useForm<UnitFieldFormValues>();

  const configQuery = useQuery({
    queryKey: ['delivery-config'],
    queryFn: () => getDeliveryConfig(),
  });
  const unitFieldQuery = useQuery({
    queryKey: ['delivery-unit-field-config'],
    queryFn: getDeliveryUnitFieldConfig,
  });

  const unitFields = unitFieldQuery.data ?? [];
  const configItems = configQuery.data ?? [];
  const configByKey = useMemo(
    () => new Map(configItems.map((item) => [item.key, item])),
    [configItems],
  );

  const fieldStats = useMemo(() => ({
    total: unitFields.length,
    visible: unitFields.filter((item) => item.isVisible).length,
    required: unitFields.filter((item) => item.isRequired).length,
    manifest: unitFields.filter((item) => item.includeInPdf || item.includeInExcel).length,
  }), [unitFields]);

  useEffect(() => {
    if (ruleDirty) {
      return;
    }
    const lowStockDefinition = platformRuleDefinitions.LOW_STOCK_DISPLAY_THRESHOLD;
    const manifestDefinition = platformRuleDefinitions.MANIFEST_CUSTOM_COLUMNS_ENABLED;
    ruleForm.setFieldsValue({
      lowStockThreshold: Number(getPlatformRuleValue(lowStockDefinition, configByKey.get(lowStockDefinition.key))),
      manifestCustomColumnsEnabled: Boolean(getPlatformRuleValue(manifestDefinition, configByKey.get(manifestDefinition.key))),
    });
  }, [configByKey, ruleDirty, ruleForm]);

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
        optionsText: formatOptionLines(editingField.options),
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
      optionsText: '',
      isVisible: true,
      isRequired: false,
      showInApp: true,
      showInAdmin: true,
      includeInPdf: false,
      includeInExcel: false,
    });
  }, [editingField, fieldForm, fieldOpen]);

  const ruleMutation = useMutation({
    mutationFn: async (values: RuleFormValues) => {
      const lowStockDefinition = platformRuleDefinitions.LOW_STOCK_DISPLAY_THRESHOLD;
      const manifestDefinition = platformRuleDefinitions.MANIFEST_CUSTOM_COLUMNS_ENABLED;

      return updateDeliveryConfig([
        {
          key: lowStockDefinition.key,
          scope: lowStockDefinition.scope,
          description: lowStockDefinition.description,
          value: { value: Number(values.lowStockThreshold ?? lowStockDefinition.defaultValue) },
        },
        {
          key: manifestDefinition.key,
          scope: manifestDefinition.scope,
          description: manifestDefinition.description,
          value: { enabled: Boolean(values.manifestCustomColumnsEnabled) },
        },
      ]);
    },
    onSuccess: async () => {
      message.success('平台规则已保存');
      setRuleDirty(false);
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
          options: parseOptionLines(values.optionsText),
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

  const fieldPatchMutation = useMutation({
    mutationFn: async (payload: {
      fieldKey: string;
      patch: Partial<Pick<
        DeliveryUnitFieldConfig,
        'isVisible' | 'isRequired' | 'showInApp' | 'showInAdmin' | 'includeInPdf' | 'includeInExcel'
      >>;
    }) => updateDeliveryUnitFieldConfig([{ fieldKey: payload.fieldKey, ...payload.patch }]),
    onSuccess: async () => {
      message.success('字段开关已保存');
      await queryClient.invalidateQueries({ queryKey: ['delivery-unit-field-config'] });
    },
    onError: (error) => {
      message.error(getErrorMessage(error));
    },
  });

  const openFieldDrawer = (record?: DeliveryUnitFieldConfig) => {
    setEditingField(record ?? null);
    setFieldOpen(true);
  };

  const quickToggle = (
    record: DeliveryUnitFieldConfig,
    key: keyof Pick<
      DeliveryUnitFieldConfig,
      'isVisible' | 'isRequired' | 'showInApp' | 'showInAdmin' | 'includeInPdf' | 'includeInExcel'
    >,
    value: boolean,
  ) => {
    fieldPatchMutation.mutate({
      fieldKey: record.fieldKey,
      patch: { [key]: value },
    });
  };

  const baseFieldColumns: ColumnsType<DeliveryUnitFieldConfig> = [
    {
      title: '字段名称',
      key: 'label',
      width: 220,
      render: (_, record) => (
        <Space direction="vertical" size={0}>
          <Typography.Text strong>{record.label || '未命名字段'}</Typography.Text>
        </Space>
      ),
    },
    {
      title: '填写方式',
      dataIndex: 'fieldType',
      key: 'fieldType',
      width: 120,
      render: (value: string) => <Tag>{formatDeliveryDisplayText(value)}</Tag>,
    },
    { title: '排序', dataIndex: 'sortOrder', key: 'sortOrder', width: 90 },
    {
      title: '固定字段',
      dataIndex: 'isFixed',
      key: 'isFixed',
      width: 100,
      render: (value: boolean) => <StatusPill value={value ? 'ACTIVE' : 'INACTIVE'} />,
    },
    {
      title: '启用',
      dataIndex: 'isVisible',
      key: 'isVisible',
      width: 100,
      render: (value: boolean, record) => (
        <Switch
          size="small"
          checked={value}
          checkedChildren="开"
          unCheckedChildren="关"
          disabled={record.isFixed || fieldPatchMutation.isPending}
          onChange={(checked) => quickToggle(record, 'isVisible', checked)}
        />
      ),
    },
    {
      title: '必填',
      dataIndex: 'isRequired',
      key: 'isRequired',
      width: 100,
      render: (value: boolean, record) => (
        <Switch
          size="small"
          checked={value}
          checkedChildren="是"
          unCheckedChildren="否"
          disabled={record.isFixed || fieldPatchMutation.isPending}
          onChange={(checked) => quickToggle(record, 'isRequired', checked)}
        />
      ),
    },
    {
      title: '显示位置',
      key: 'locations',
      width: 260,
      render: (_, record) => renderLocationTags(record),
    },
    {
      title: '操作',
      key: 'action',
      width: 96,
      render: (_, record) => (
        <Button type="link" size="small" icon={<EditOutlined />} onClick={() => openFieldDrawer(record)}>
          编辑
        </Button>
      ),
    },
  ];

  const manifestFieldColumns: ColumnsType<DeliveryUnitFieldConfig> = [
    {
      title: '字段名称',
      key: 'label',
      width: 240,
      render: (_, record) => (
        <Space direction="vertical" size={0}>
          <Typography.Text strong>{record.label || '未命名字段'}</Typography.Text>
        </Space>
      ),
    },
    {
      title: '清单文件',
      dataIndex: 'includeInPdf',
      key: 'includeInPdf',
      width: 130,
      render: (value: boolean, record) => (
        <Switch
          size="small"
          checked={value}
          checkedChildren="加入"
          unCheckedChildren="不加"
          disabled={record.isFixed || fieldPatchMutation.isPending}
          onChange={(checked) => quickToggle(record, 'includeInPdf', checked)}
        />
      ),
    },
    {
      title: '表格导出',
      dataIndex: 'includeInExcel',
      key: 'includeInExcel',
      width: 130,
      render: (value: boolean, record) => (
        <Switch
          size="small"
          checked={value}
          checkedChildren="加入"
          unCheckedChildren="不加"
          disabled={record.isFixed || fieldPatchMutation.isPending}
          onChange={(checked) => quickToggle(record, 'includeInExcel', checked)}
        />
      ),
    },
    {
      title: '影响范围',
      key: 'impact',
      render: (_, record) => (
        <Space size={[4, 4]} wrap>
          <Tag color={record.includeInPdf ? 'blue' : 'default'}>{booleanText(record.includeInPdf)} PDF 清单</Tag>
          <Tag color={record.includeInExcel ? 'cyan' : 'default'}>{booleanText(record.includeInExcel)} Excel 导出</Tag>
        </Space>
      ),
    },
    {
      title: '操作',
      key: 'action',
      width: 96,
      render: (_, record) => (
        <Button type="link" size="small" icon={<EditOutlined />} onClick={() => openFieldDrawer(record)}>
          编辑
        </Button>
      ),
    },
  ];

  function renderPlatformRules() {
    return (
      <ProCard
        title="平台规则"
        headerBordered
        extra={(
          <Button
            type="primary"
            icon={<SaveOutlined />}
            loading={ruleMutation.isPending}
            disabled={!ruleDirty || ruleMutation.isPending}
            onClick={async () => {
              const values = await ruleForm.validateFields();
              ruleMutation.mutate(values);
            }}
          >
            保存平台规则
          </Button>
        )}
      >
        <Form form={ruleForm} layout="vertical" onValuesChange={() => setRuleDirty(true)}>
          <Row gutter={[16, 16]}>
            {platformRuleOrder.map((ruleKey) => {
              const definition = platformRuleDefinitions[ruleKey];
              const item = configByKey.get(ruleKey);
              return (
                <Col xs={24} md={12} xl={8} key={definition.key}>
                  <div
                    style={{
                      border: '1px solid #e5e7eb',
                      borderRadius: 8,
                      padding: 16,
                      minHeight: 210,
                      background: '#fff',
                    }}
                  >
                    <Space direction="vertical" size={12} style={{ width: '100%' }}>
                      <Space direction="vertical" size={2}>
                        <Typography.Text strong style={{ fontSize: 16 }}>{definition.title}</Typography.Text>
                        <Tag>{definition.sceneLabel}</Tag>
                      </Space>
                      <Typography.Text type="secondary">{definition.description}</Typography.Text>

                      {definition.key === 'LOW_STOCK_DISPLAY_THRESHOLD' ? (
                        <Form.Item
                          label="低库存提醒阈值"
                          name="lowStockThreshold"
                          extra="填 0 表示不显示低库存提示。"
                          rules={[{ required: true, message: '请输入低库存提醒阈值' }]}
                          style={{ marginBottom: 0 }}
                        >
                          <InputNumber
                            min={0}
                            max={999}
                            precision={0}
                            addonAfter="件"
                            disabled={ruleMutation.isPending}
                            style={{ width: '100%' }}
                          />
                        </Form.Item>
                      ) : (
                        <Form.Item
                          label="允许逐单添加自定义列"
                          name="manifestCustomColumnsEnabled"
                          valuePropName="checked"
                          extra="开启后可在单笔配送清单上补充额外列和内容。"
                          style={{ marginBottom: 0 }}
                        >
                          <Switch
                            checkedChildren="允许"
                            unCheckedChildren="不允许"
                            disabled={ruleMutation.isPending}
                          />
                        </Form.Item>
                      )}

                      <Typography.Text type="secondary">
                        更新时间 {item ? formatDateTime(item.updatedAt) : '尚未保存'}
                      </Typography.Text>
                    </Space>
                  </div>
                </Col>
              );
            })}
          </Row>
        </Form>
      </ProCard>
    );
  }

  const renderCategoryContent = () => {
    if (activeCategory === 'unit-fields') {
      return (
        <ProCard
          title="配送单位字段"
          headerBordered
          extra={(
            <Button type="primary" icon={<PlusOutlined />} onClick={() => openFieldDrawer()}>
              新增字段
            </Button>
          )}
        >
          <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
            <Col xs={12} md={6}>
              <Statistic title="字段总数" value={fieldStats.total} />
            </Col>
            <Col xs={12} md={6}>
              <Statistic title="已启用" value={fieldStats.visible} />
            </Col>
            <Col xs={12} md={6}>
              <Statistic title="必填项" value={fieldStats.required} />
            </Col>
            <Col xs={12} md={6}>
              <Statistic title="进入清单/导出" value={fieldStats.manifest} />
            </Col>
          </Row>
          <Table<DeliveryUnitFieldConfig>
            rowKey="fieldKey"
            columns={baseFieldColumns}
            dataSource={unitFields}
            loading={unitFieldQuery.isLoading}
            scroll={{ x: 1120 }}
            locale={{ emptyText: unitFieldQuery.isError ? getErrorMessage(unitFieldQuery.error) : '暂无配送单位字段' }}
          />
        </ProCard>
      );
    }

    if (activeCategory === 'manifest-export') {
      return (
        <ProCard
          title="清单与导出"
          headerBordered
          extra={(
            <Button icon={<SettingOutlined />} onClick={() => setActiveCategory('unit-fields')}>
              管理字段
            </Button>
          )}
        >
          <Table<DeliveryUnitFieldConfig>
            rowKey="fieldKey"
            columns={manifestFieldColumns}
            dataSource={unitFields}
            loading={unitFieldQuery.isLoading}
            scroll={{ x: 980 }}
            locale={{ emptyText: unitFieldQuery.isError ? getErrorMessage(unitFieldQuery.error) : '暂无可配置字段' }}
          />
        </ProCard>
      );
    }

    return renderPlatformRules();
  };

  return (
    <div style={{ padding: 24 }}>
      <PageHeader title="配送配置" subtitle="按业务场景维护单位字段、清单导出和平台规则。" />

      <Row gutter={[16, 16]} align="top">
        <Col xs={24} lg={7} xl={6}>
          <ProCard title="配置中心" headerBordered>
            <List<ConfigCategoryItem>
              dataSource={configCategoryItems}
              renderItem={(item) => {
                const active = activeCategory === item.key;
                const count = item.key === 'unit-fields' || item.key === 'manifest-export'
                  ? unitFields.length
                  : platformRuleOrder.length;
                return (
                  <List.Item
                    onClick={() => setActiveCategory(item.key)}
                    style={{
                      cursor: 'pointer',
                      borderRadius: 8,
                      marginBottom: 8,
                      padding: '12px 14px',
                      border: active ? '1px solid #91caff' : '1px solid #f0f0f0',
                      background: active ? '#e6f4ff' : '#fff',
                    }}
                  >
                    <List.Item.Meta
                      avatar={(
                        <Badge count={count} size="small" overflowCount={99}>
                          <span style={{ fontSize: 18 }}>{item.icon}</span>
                        </Badge>
                      )}
                      title={<Typography.Text strong={active}>{item.title}</Typography.Text>}
                      description={item.description}
                    />
                  </List.Item>
                );
              }}
            />
          </ProCard>
        </Col>

        <Col xs={24} lg={17} xl={18}>
          {renderCategoryContent()}
        </Col>
      </Row>

      <Drawer
        open={fieldOpen}
        width={860}
        title={editingField ? '编辑配送单位字段' : '新增配送单位字段'}
        onClose={() => {
          setFieldOpen(false);
          setEditingField(null);
          fieldForm.resetFields();
        }}
        extra={(
          <Space>
            <Button
              onClick={() => {
                setFieldOpen(false);
                setEditingField(null);
                fieldForm.resetFields();
              }}
            >
              取消
            </Button>
            <Button
              type="primary"
              loading={fieldMutation.isPending}
              onClick={async () => {
                const values = await fieldForm.validateFields();
                fieldMutation.mutate(values);
              }}
            >
              保存
            </Button>
          </Space>
        )}
      >
        <Form form={fieldForm} layout="vertical">
          <Typography.Title level={5}>基础资料</Typography.Title>
          {editingField ? (
            <Form.Item name="fieldKey" hidden>
              <Input />
            </Form.Item>
          ) : null}
          <Row gutter={16}>
            {!editingField ? (
              <Col xs={24} md={10}>
                <Form.Item
                  label="字段编号"
                  name="fieldKey"
                  extra="用于保存这项资料，买家不会看到。"
                  rules={[{ required: true, message: '请输入字段编号' }]}
                >
                  <Input placeholder="例如：门禁信息" />
                </Form.Item>
              </Col>
            ) : null}
            <Col xs={24} md={editingField ? 12 : 8}>
              <Form.Item label="字段名称" name="label">
                <Input placeholder="例如：部门名称" />
              </Form.Item>
            </Col>
            <Col xs={24} md={editingField ? 12 : 6}>
              <Form.Item label="填写方式" name="fieldType">
                <Select options={unitFieldTypeOptions.map((item) => ({ label: formatDeliveryDisplayText(item), value: item }))} />
              </Form.Item>
            </Col>
          </Row>
          <Row gutter={16}>
            <Col xs={24} md={6}>
              <Form.Item label="排序" name="sortOrder">
                <InputNumber min={0} max={999} precision={0} style={{ width: '100%' }} />
              </Form.Item>
            </Col>
            <Col xs={24} md={18}>
              <Form.Item label="提示文字" name="placeholder">
                <Input placeholder="填写时显示的提示文字" />
              </Form.Item>
            </Col>
          </Row>
          <Form.Item
            label="下拉选项"
            name="optionsText"
            extra="每行填写一个选项，仅填写方式为选择时使用。"
          >
            <Input.TextArea rows={5} placeholder={'学校\n企业\n机关单位'} />
          </Form.Item>

          <Typography.Title level={5} style={{ marginTop: 24 }}>显示位置</Typography.Title>
          <Row gutter={[16, 12]}>
            <Col xs={24} sm={12}>
              <Form.Item label="买家端填写" name="showInApp" valuePropName="checked">
                <Switch checkedChildren="显示" unCheckedChildren="隐藏" disabled={Boolean(editingField?.isFixed)} />
              </Form.Item>
            </Col>
            <Col xs={24} sm={12}>
              <Form.Item label="管理后台显示" name="showInAdmin" valuePropName="checked">
                <Switch checkedChildren="显示" unCheckedChildren="隐藏" disabled={Boolean(editingField?.isFixed)} />
              </Form.Item>
            </Col>
            <Col xs={24} sm={12}>
              <Form.Item label="清单文件包含" name="includeInPdf" valuePropName="checked">
                <Switch checkedChildren="加入" unCheckedChildren="不加" disabled={Boolean(editingField?.isFixed)} />
              </Form.Item>
            </Col>
            <Col xs={24} sm={12}>
              <Form.Item label="表格导出包含" name="includeInExcel" valuePropName="checked">
                <Switch checkedChildren="加入" unCheckedChildren="不加" disabled={Boolean(editingField?.isFixed)} />
              </Form.Item>
            </Col>
          </Row>

          <Typography.Title level={5} style={{ marginTop: 24 }}>填写规则</Typography.Title>
          <Row gutter={[16, 12]}>
            <Col xs={24} sm={12}>
              <Form.Item label="字段启用" name="isVisible" valuePropName="checked">
                <Switch checkedChildren="启用" unCheckedChildren="停用" disabled={Boolean(editingField?.isFixed)} />
              </Form.Item>
            </Col>
            <Col xs={24} sm={12}>
              <Form.Item label="是否必填" name="isRequired" valuePropName="checked">
                <Switch checkedChildren="必填" unCheckedChildren="选填" disabled={Boolean(editingField?.isFixed)} />
              </Form.Item>
            </Col>
          </Row>
        </Form>
      </Drawer>
    </div>
  );
}
