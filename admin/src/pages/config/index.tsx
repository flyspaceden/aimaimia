/**
 * 平台设置页面 — 分组卡片式表单
 *
 * 三个业务分组：定价与运费 / 抽奖设置 / 订单设置
 * 支持实时校验、版本历史抽屉、变更说明
 */
import { useState, useCallback, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  App,
  Card,
  Button,
  Form,
  InputNumber,
  Input,
  Space,
  Typography,
  Drawer,
  Timeline,
  Tag,
  Spin,
  Row,
  Col,
  Tooltip,
  Alert,
  Divider,
} from 'antd';
import {
  SaveOutlined,
  HistoryOutlined,
  GiftOutlined,
  ShoppingCartOutlined,
  InfoCircleOutlined,
} from '@ant-design/icons';
import {
  batchUpdateConfig,
  getConfigs,
  getConfigVersions,
  previewMarkupReprice,
  rollbackConfigVersionWithPricing,
} from '@/api/config';
import ConfigVersionRollbackButton from '@/components/ConfigVersionRollbackButton';
import { useUnsavedChanges } from '@/hooks/useUnsavedChanges';
import PermissionGate from '@/components/PermissionGate';
import { PERMISSIONS } from '@/constants/permissions';
import type { RuleConfig, ConfigVersion, MarkupRepricePreview } from '@/types';
import { extractConfigValue, extractConfigDescription } from '@/types';
import dayjs from 'dayjs';

const { Text, Title } = Typography;

// ============ 配置元信息 ============

interface ConfigMeta {
  key: string;
  label: string;
  group: 'pricing' | 'lottery' | 'order';
  type: 'number';
  min?: number;
  max?: number;
  step?: number;
  suffix?: string;
  precision?: number;
  description?: string;
  integer?: boolean;
  defaultValue?: number;
}

const CONFIG_SCHEMA: ConfigMeta[] = [
  // 定价与运费
  { key: 'MARKUP_RATE',            label: '加价率',           group: 'pricing', type: 'number', min: 1.0, max: 10.0, step: 0.1, description: '卖家商品售价 = 成本 × 加价率', defaultValue: 1.3, precision: 2 },
  { key: 'DEFAULT_SHIPPING_FEE',   label: '默认运费',         group: 'pricing', type: 'number', min: 0,   max: 999,  step: 1,   suffix: '元', precision: 2, defaultValue: 10 },
  { key: 'VIP_DISCOUNT_RATE',       label: 'VIP折扣率',        group: 'pricing', type: 'number', min: 0.5, max: 1.0, step: 0.01, description: 'VIP用户商品折扣率（0.95 = 95折，仅对非平台商品生效）', defaultValue: 0.95, precision: 2 },
  // 抽奖设置
  { key: 'LOTTERY_ENABLED',        label: '抽奖开关',         group: 'lottery', type: 'number', min: 0, max: 1, step: 1, integer: true, description: '0=关闭 1=开启每日抽奖功能', defaultValue: 1 },
  { key: 'LOTTERY_DAILY_CHANCES',  label: '每日抽奖次数',     group: 'lottery', type: 'number', min: 1, max: 10, step: 1, suffix: '次', integer: true, defaultValue: 1 },
  // 订单设置
  { key: 'AUTO_CONFIRM_DAYS',      label: '自动确认收货天数', group: 'order', type: 'number', min: 1, max: 30, step: 1, suffix: '天', integer: true },
  {
    key: 'LOW_STOCK_DISPLAY_THRESHOLD',
    label: 'App 低库存展示阈值',
    group: 'order',
    type: 'number',
    min: 0,
    max: 999,
    step: 1,
    suffix: '件',
    integer: true,
    description: '库存 1..阈值时 App 展示“仅剩 x 件”；0 表示关闭低库存文案，但无库存仍会禁选',
    defaultValue: 10,
  },
];

/** 从配置列表中按 key 取原始值 */
function getVal(configs: RuleConfig[], key: string): unknown {
  const c = configs.find((r) => r.key === key);
  if (!c) return undefined;
  return extractConfigValue(c);
}

/** 将后端配置列表解析为表单初始值 */
function configsToFormValues(configs: RuleConfig[]): Record<string, unknown> {
  const values: Record<string, unknown> = {};
  for (const meta of CONFIG_SCHEMA) {
    const raw = getVal(configs, meta.key);
    values[meta.key] = raw ?? meta.defaultValue ?? meta.min ?? 0;
  }
  return values;
}

function extractSnapshotValue(snapshot: Record<string, unknown>, key: string): unknown {
  const stored = snapshot[key];
  return stored && typeof stored === 'object' && !Array.isArray(stored) && 'value' in stored
    ? (stored as { value: unknown }).value
    : stored;
}

function formatPrice(value: number): string {
  return `¥${Number(value).toFixed(2)}`;
}

// ============ 组件 ============

export default function ConfigPage() {
  const queryClient = useQueryClient();
  const { message, modal } = App.useApp();
  const [form] = Form.useForm();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [changeNote, setChangeNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);

  // 未保存更改警告
  useUnsavedChanges(dirty);

  // 加载配置
  const { data: configs = [], isLoading } = useQuery({
    queryKey: ['admin', 'configs'],
    queryFn: getConfigs,
  });

  // 版本历史
  const { data: versions, isLoading: versionsLoading } = useQuery({
    queryKey: ['admin', 'config-versions'],
    queryFn: () => getConfigVersions({ page: 1, pageSize: 50 }),
    enabled: drawerOpen,
  });

  // 回滚
  const rollbackMutation = useMutation({
    mutationFn: ({ id, previewToken }: { id: string; previewToken: string }) =>
      rollbackConfigVersionWithPricing(id, {
        repriceExisting: true,
        markupPreviewToken: previewToken,
      }),
    onSuccess: () => {
      message.success('已回滚到指定版本');
      queryClient.invalidateQueries({ queryKey: ['admin', 'configs'] });
      queryClient.invalidateQueries({ queryKey: ['admin', 'config-versions'] });
      queryClient.invalidateQueries({ queryKey: ['admin', 'profit-safety-summary'] });
      setDrawerOpen(false);
    },
    onError: (err: Error) => message.error(err.message),
  });

  const confirmMarkupReprice = useCallback((preview: MarkupRepricePreview, action: 'save' | 'rollback') =>
    new Promise<boolean>((resolve) => {
      modal.confirm({
        title: action === 'rollback' ? '确认回滚配置并同步商品售价？' : '确认更新加价率和商品售价？',
        width: 680,
        content: <MarkupRepricePanel preview={preview} />,
        okText: action === 'rollback' ? '确认回滚并更新价格' : '确认并更新价格',
        cancelText: '取消',
        okButtonProps: { danger: preview.priceDecreaseCount > 0 },
        onOk: () => resolve(true),
        onCancel: () => resolve(false),
      });
    }), [modal]);

  const handleRollback = useCallback(async (version: ConfigVersion) => {
    const markupRate = Number(extractSnapshotValue(version.snapshot, 'MARKUP_RATE'));
    if (!Number.isFinite(markupRate)) {
      message.error('该版本缺少有效加价率，不能安全回滚');
      return;
    }
    try {
      const preview = await previewMarkupReprice(markupRate);
      if (!await confirmMarkupReprice(preview, 'rollback')) return;
      await rollbackMutation.mutateAsync({ id: version.id, previewToken: preview.previewToken });
    } catch (err: unknown) {
      message.error(err instanceof Error ? err.message : '回滚预检失败');
    }
  }, [confirmMarkupReprice, message, rollbackMutation]);

  // 初始化表单
  useEffect(() => {
    if (!isLoading) {
      form.setFieldsValue(configsToFormValues(configs));
      setDirty(false);
    }
  }, [configs, form, isLoading]);

  // 保存
  const handleSave = useCallback(async () => {
    try {
      await form.validateFields();
    } catch {
      message.warning('请检查表单填写是否正确');
      return;
    }

    const values = form.getFieldsValue(true);

    setSaving(true);

    try {
      // 先汇总变更，再用一个事务保存，避免出现部分配置已更新的中间状态。
      const note = changeNote || '更新平台设置';
      const updates: Array<{ key: string; value: unknown }> = [];
      for (const meta of CONFIG_SCHEMA) {
        const oldVal = getVal(configs, meta.key);
        const newVal = values[meta.key];

        // 简单比较
        if (JSON.stringify(oldVal) === JSON.stringify(newVal)) continue;

        const existingConfig = configs.find((c) => c.key === meta.key);
        const desc = existingConfig ? extractConfigDescription(existingConfig) : undefined;
        updates.push({
          key: meta.key,
          value: { value: newVal, description: desc || meta.description || meta.label },
        });
      }

      if (updates.length === 0) {
        message.info('没有需要保存的配置变更');
        return;
      }

      const markupUpdate = updates.find((item) => item.key === 'MARKUP_RATE');
      let markupPreview: MarkupRepricePreview | undefined;
      if (markupUpdate) {
        markupPreview = await previewMarkupReprice(
          Number((markupUpdate.value as { value: unknown }).value),
        );
        if (!await confirmMarkupReprice(markupPreview, 'save')) return;
      }

      const result = await batchUpdateConfig({
        updates,
        changeNote: note,
        ...(markupPreview ? {
          repriceExisting: true,
          markupPreviewToken: markupPreview.previewToken,
        } : {}),
      });

      message.success(result.markupReprice
        ? `配置保存成功，已同步 ${result.markupReprice.affectedSkuCount} 个商品规格售价`
        : '配置保存成功');
      queryClient.invalidateQueries({ queryKey: ['admin', 'configs'] });
      queryClient.invalidateQueries({ queryKey: ['admin', 'profit-safety-summary'] });
      setDirty(false);
      setChangeNote('');
    } catch (err: unknown) {
      message.error(err instanceof Error ? err.message : '保存失败');
    } finally {
      setSaving(false);
    }
  }, [form, configs, changeNote, queryClient, confirmMarkupReprice, message]);

  if (isLoading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: 400 }}>
        <Spin size="large" tip="加载配置中..." />
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 960, margin: '0 auto' }}>
      {/* 顶部标题栏 */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <div>
          <Title level={4} style={{ margin: 0 }}>平台设置</Title>
          <Text type="secondary" style={{ fontSize: 13 }}>管理平台级公共参数：定价、运费、抽奖与订单策略（VIP 参数请前往「VIP 系统配置」，普通用户参数请前往「普通系统配置」）</Text>
        </div>
        <Space>
          <Button icon={<HistoryOutlined />} onClick={() => setDrawerOpen(true)}>
            版本历史
          </Button>
          <PermissionGate permission={PERMISSIONS.CONFIG_UPDATE}>
            <Button
              type="primary"
              icon={<SaveOutlined />}
              loading={saving}
              onClick={handleSave}
              style={{ background: '#1E40AF' }}
            >
              保存配置
            </Button>
          </PermissionGate>
        </Space>
      </div>

      <Form
        form={form}
        layout="vertical"
        initialValues={configsToFormValues(configs)}
        onValuesChange={() => setDirty(true)}
        requiredMark={false}
      >
        <Row gutter={[16, 16]}>
          {/* ====== 定价与运费 ====== */}
          <Col xs={24} lg={8}>
            <Card
              bordered={false}
              style={{ borderRadius: 12, height: '100%' }}
              styles={{ header: { borderBottom: '2px solid #52c41a', paddingBottom: 8 } }}
              title={
                <Space>
                  <ShoppingCartOutlined style={{ color: '#52c41a', fontSize: 18 }} />
                  <Text strong style={{ fontSize: 15 }}>定价与运费</Text>
                </Space>
              }
            >
              {CONFIG_SCHEMA.filter((m) => m.group === 'pricing').map((meta) => (
                <NumberField key={meta.key} meta={meta} />
              ))}
            </Card>
          </Col>

          {/* ====== 抽奖设置 ====== */}
          <Col xs={24} lg={8}>
            <Card
              bordered={false}
              style={{ borderRadius: 12, height: '100%' }}
              styles={{ header: { borderBottom: '2px solid #eb2f96', paddingBottom: 8 } }}
              title={
                <Space>
                  <GiftOutlined style={{ color: '#eb2f96', fontSize: 18 }} />
                  <Text strong style={{ fontSize: 15 }}>抽奖设置</Text>
                </Space>
              }
            >
              {CONFIG_SCHEMA.filter((m) => m.group === 'lottery').map((meta) => (
                <NumberField key={meta.key} meta={meta} />
              ))}
            </Card>
          </Col>

          {/* ====== 订单设置 ====== */}
          <Col xs={24} lg={8}>
            <Card
              bordered={false}
              style={{ borderRadius: 12, height: '100%' }}
              styles={{ header: { borderBottom: '2px solid #722ed1', paddingBottom: 8 } }}
              title={
                <Space>
                  <ShoppingCartOutlined style={{ color: '#722ed1', fontSize: 18 }} />
                  <Text strong style={{ fontSize: 15 }}>订单设置</Text>
                </Space>
              }
            >
              {CONFIG_SCHEMA.filter((m) => m.group === 'order').map((meta) => (
                <NumberField key={meta.key} meta={meta} />
              ))}
            </Card>
          </Col>

          {/* ====== 变更说明 + 保存 ====== */}
          <Col span={24}>
            <Card bordered={false} style={{ borderRadius: 12, background: '#fafafa' }}>
              <Row gutter={16} align="middle">
                <Col flex="auto">
                  <Input
                    placeholder="填写本次变更说明（可选）"
                    value={changeNote}
                    onChange={(e) => setChangeNote(e.target.value)}
                    prefix={<InfoCircleOutlined style={{ color: '#bfbfbf' }} />}
                    style={{ borderRadius: 8 }}
                    allowClear
                  />
                </Col>
                <Col flex="none">
                  <PermissionGate permission={PERMISSIONS.CONFIG_UPDATE}>
                    <Button
                      type="primary"
                      size="large"
                      icon={<SaveOutlined />}
                      loading={saving}
                      onClick={handleSave}
                      style={{ background: '#1E40AF', borderRadius: 8, minWidth: 140 }}
                    >
                      保存所有配置
                    </Button>
                  </PermissionGate>
                </Col>
              </Row>
            </Card>
          </Col>
        </Row>
      </Form>

      {/* ====== 版本历史抽屉 ====== */}
      <Drawer
        title="配置版本历史"
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        width={480}
        styles={{ body: { padding: '16px 24px' } }}
      >
        {versionsLoading ? (
          <div style={{ textAlign: 'center', padding: 60 }}><Spin /></div>
        ) : !versions?.items?.length ? (
          <Text type="secondary">暂无版本记录</Text>
        ) : (
          <Timeline
            items={versions.items.map((v: ConfigVersion) => ({
              color: '#1E40AF',
              children: (
                <VersionItem
                  key={v.id}
                  version={v}
                  onRollback={() => handleRollback(v)}
                />
              ),
            }))}
          />
        )}
      </Drawer>
    </div>
  );
}

function MarkupRepricePanel({ preview }: { preview: MarkupRepricePreview }) {
  return (
    <div style={{ marginTop: 16 }}>
      <Alert
        type="warning"
        showIcon
        message="这会修改当前普通商品的真实成交价"
        description="历史订单和已创建的结算会话保留原价格；新的购物车结算使用更新后的售价。平台奖励商品不参与自动重算。"
      />
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
          gap: 12,
          marginTop: 16,
        }}
      >
        <PriceImpactMetric label="加价率" value={`${preview.currentMarkupRate} → ${preview.nextMarkupRate}`} />
        <PriceImpactMetric label="受影响商品" value={`${preview.affectedProductCount} 个`} />
        <PriceImpactMetric label="受影响规格" value={`${preview.affectedSkuCount} 个`} />
      </div>
      {preview.examples.length > 0 && (
        <>
          <Divider style={{ margin: '16px 0 10px' }} />
          <Text strong>价格变化示例</Text>
          <div style={{ marginTop: 8, display: 'grid', gap: 8 }}>
            {preview.examples.map((item) => (
              <div
                key={item.skuId}
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'minmax(0, 1fr) auto',
                  gap: 16,
                  padding: '9px 12px',
                  borderRadius: 8,
                  background: '#f6f8fb',
                  borderLeft: `3px solid ${item.difference >= 0 ? '#1677ff' : '#cf1322'}`,
                }}
              >
                <div style={{ minWidth: 0 }}>
                  <Text ellipsis style={{ display: 'block' }}>{item.productTitle}</Text>
                  <Text type="secondary" style={{ fontSize: 12 }}>{item.skuTitle}</Text>
                </div>
                <Text strong style={{ fontFamily: 'monospace', whiteSpace: 'nowrap' }}>
                  {formatPrice(item.currentPrice)} → {formatPrice(item.nextPrice)}
                </Text>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function PriceImpactMetric({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ padding: '10px 12px', borderRadius: 8, background: '#f0f5ff' }}>
      <Text type="secondary" style={{ display: 'block', fontSize: 12 }}>{label}</Text>
      <Text strong style={{ display: 'block', marginTop: 2, fontSize: 16 }}>{value}</Text>
    </div>
  );
}

// ============ 子组件 ============

/** 通用数值字段 */
function NumberField({ meta }: { meta: ConfigMeta }) {
  return (
    <Form.Item
      name={meta.key}
      label={
        <Space size={4}>
          <Text strong style={{ fontSize: 13 }}>{meta.label}</Text>
          {meta.description && (
            <Tooltip title={meta.description}>
              <InfoCircleOutlined style={{ color: '#bfbfbf', fontSize: 12 }} />
            </Tooltip>
          )}
        </Space>
      }
      rules={[{ required: true, message: `请设置${meta.label}` }]}
      style={{ marginBottom: 16 }}
    >
      <InputNumber
        min={meta.min}
        max={meta.max}
        step={meta.step ?? 1}
        precision={meta.integer ? 0 : (meta.precision ?? 2)}
        addonAfter={meta.suffix}
        style={{ width: '100%' }}
      />
    </Form.Item>
  );
}

/** 版本历史条目 */
function VersionItem({ version, onRollback }: { version: ConfigVersion; onRollback: () => void }) {
  const [expanded, setExpanded] = useState(false);

  // 只显示平台级配置 key
  const PLATFORM_KEYS = CONFIG_SCHEMA.map((m) => m.key);

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <Text strong style={{ fontSize: 13 }}>
            {version.changeNote || '配置变更'}
          </Text>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4 }}>
            <Tag style={{ margin: 0, fontSize: 11 }}>v{version.version}</Tag>
            <Text type="secondary" style={{ fontSize: 11 }}>
              {version.createdByAdmin?.realName || version.createdByAdmin?.username || '系统'}
            </Text>
            <Text type="secondary" style={{ fontSize: 11 }}>
              {dayjs(version.createdAt).format('YYYY-MM-DD HH:mm')}
            </Text>
          </div>
        </div>
        <Space size={4}>
          <Button
            type="text"
            size="small"
            onClick={() => setExpanded(!expanded)}
            style={{ fontSize: 12, color: '#1677ff' }}
          >
            {expanded ? '收起' : '详情'}
          </Button>
          <ConfigVersionRollbackButton version={version} onRollback={onRollback} />
        </Space>
      </div>

      {expanded && version.snapshot && (
        <div
          style={{
            marginTop: 8,
            padding: 12,
            background: '#fafafa',
            borderRadius: 8,
            border: '1px solid #f0f0f0',
            maxHeight: 300,
            overflow: 'auto',
          }}
        >
          {Object.entries(version.snapshot)
            .filter(([key]) => PLATFORM_KEYS.includes(key))
            .map(([key, val]) => {
              const meta = CONFIG_SCHEMA.find((m) => m.key === key);
              const displayVal = val
                && typeof val === 'object'
                && !Array.isArray(val)
                && 'value' in val
                ? (val as { value: unknown }).value
                : val;
              return (
                <div
                  key={key}
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    padding: '4px 0',
                    borderBottom: '1px solid #f5f5f5',
                  }}
                >
                  <Text type="secondary" style={{ fontSize: 12 }}>
                    {meta?.label || key}
                  </Text>
                  <Text style={{ fontSize: 12, fontFamily: 'monospace' }}>
                    {JSON.stringify(displayVal)}
                  </Text>
                </div>
              );
            })}
        </div>
      )}
    </div>
  );
}
