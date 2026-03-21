/**
 * 平台设置页面 — 分组卡片式表单
 *
 * 三个业务分组：定价与运费 / 抽奖设置 / 订单设置
 * 支持实时校验、版本历史抽屉、变更说明
 */
import { useState, useCallback, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
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
  Modal,
  Spin,
  Row,
  Col,
  message,
  Tooltip,
} from 'antd';
import {
  SaveOutlined,
  HistoryOutlined,
  GiftOutlined,
  ShoppingCartOutlined,
  InfoCircleOutlined,
  RollbackOutlined,
} from '@ant-design/icons';
import { getConfigs, updateConfig, getConfigVersions, rollbackConfigVersion } from '@/api/config';
import { useUnsavedChanges } from '@/hooks/useUnsavedChanges';
import PermissionGate from '@/components/PermissionGate';
import { PERMISSIONS } from '@/constants/permissions';
import type { RuleConfig, ConfigVersion } from '@/types';
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
];

/** 从配置列表中按 key 取原始值 */
function getVal(configs: RuleConfig[], key: string): unknown {
  const c = configs.find((r) => r.key === key);
  if (!c) return undefined;
  return extractConfigValue(c);
}

/** 将后端配置列表解析为表单初始值 */
function configsToFormValues(configs: RuleConfig[]): Record<string, any> {
  const values: Record<string, any> = {};
  for (const meta of CONFIG_SCHEMA) {
    const raw = getVal(configs, meta.key);
    values[meta.key] = raw ?? meta.defaultValue ?? meta.min ?? 0;
  }
  return values;
}

// ============ 组件 ============

export default function ConfigPage() {
  const queryClient = useQueryClient();
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
    mutationFn: rollbackConfigVersion,
    onSuccess: () => {
      message.success('已回滚到指定版本');
      queryClient.invalidateQueries({ queryKey: ['admin', 'configs'] });
      queryClient.invalidateQueries({ queryKey: ['admin', 'config-versions'] });
      setDrawerOpen(false);
    },
    onError: (err: Error) => message.error(err.message),
  });

  // 初始化表单
  useEffect(() => {
    if (configs.length > 0) {
      form.setFieldsValue(configsToFormValues(configs));
      setDirty(false);
    }
  }, [configs, form]);

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
      // 逐项提交有变更的配置
      const note = changeNote || '更新平台设置';
      for (const meta of CONFIG_SCHEMA) {
        const oldVal = getVal(configs, meta.key);
        const newVal = values[meta.key];

        // 简单比较
        if (JSON.stringify(oldVal) === JSON.stringify(newVal)) continue;

        const desc = extractConfigDescription(configs.find((c) => c.key === meta.key)!);
        await updateConfig(meta.key, {
          value: { value: newVal, description: desc || meta.description || meta.label },
          changeNote: note,
        });
      }

      message.success('配置保存成功');
      queryClient.invalidateQueries({ queryKey: ['admin', 'configs'] });
      setDirty(false);
      setChangeNote('');
    } catch (err: any) {
      message.error(err?.message || '保存失败');
    } finally {
      setSaving(false);
    }
  }, [form, configs, changeNote, queryClient]);

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
                  onRollback={() => {
                    Modal.confirm({
                      title: '确认回滚到此版本？',
                      content: '回滚将覆盖当前所有配置，此操作不可撤销',
                      okText: '确认回滚',
                      okButtonProps: { danger: true },
                      onOk: () => rollbackMutation.mutateAsync(v.id),
                    });
                  }}
                />
              ),
            }))}
          />
        )}
      </Drawer>
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
          <PermissionGate permission={PERMISSIONS.CONFIG_UPDATE}>
            <Button
              type="text"
              size="small"
              danger
              icon={<RollbackOutlined />}
              onClick={onRollback}
              style={{ fontSize: 12 }}
            >
              回滚
            </Button>
          </PermissionGate>
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
              const stored = val as any;
              const displayVal = stored?.value ?? stored;
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
