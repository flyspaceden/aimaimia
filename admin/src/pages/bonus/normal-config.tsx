/**
 * 普通用户系统参数配置页
 *
 * 三个业务分组：普通树结构 / 奖励设置 / 利润六分比例
 * 支持实时校验、版本历史抽屉、变更说明
 * 增强功能：业务说明、推荐模板、恢复默认值、变更影响提示
 */
import { useState, useMemo, useCallback, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Card,
  Button,
  Form,
  InputNumber,
  Slider,
  Input,
  Space,
  Typography,
  Drawer,
  Timeline,
  Tag,
  Modal,
  Spin,
  Alert,
  Row,
  Col,
  Divider,
  message,
  Tooltip,
} from 'antd';
import {
  SaveOutlined,
  HistoryOutlined,
  PercentageOutlined,
  ApartmentOutlined,
  TrophyOutlined,
  InfoCircleOutlined,
  RollbackOutlined,
  CheckCircleOutlined,
  WarningOutlined,
  ThunderboltOutlined,
  UndoOutlined,
  ExclamationCircleOutlined,
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
  group: 'tree' | 'reward' | 'ratio';
  type: 'percent' | 'number';
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
  // 普通树结构
  {
    key: 'NORMAL_BRANCH_FACTOR',
    label: '普通树分叉数',
    group: 'tree',
    type: 'number',
    min: 2,
    max: 5,
    step: 1,
    suffix: '叉',
    integer: true,
    description: '普通树每个节点的最大子节点数',
    defaultValue: 3,
  },
  {
    key: 'NORMAL_MAX_LAYERS',
    label: '最大分配层数',
    group: 'tree',
    type: 'number',
    min: 1,
    max: 50,
    step: 1,
    suffix: '层',
    integer: true,
    description: '普通奖励上溯分润最大层级深度',
    defaultValue: 15,
  },

  // 奖励设置
  {
    key: 'NORMAL_FREEZE_DAYS',
    label: '冻结天数',
    group: 'reward',
    type: 'number',
    min: 1,
    max: 365,
    step: 1,
    suffix: '天',
    integer: true,
    description: '普通奖励冻结后多少天过期归平台',
    defaultValue: 30,
  },
  {
    key: 'NORMAL_REWARD_EXPIRY_DAYS',
    label: '奖励有效期',
    group: 'reward',
    type: 'number',
    min: 1,
    max: 365,
    step: 1,
    suffix: '天',
    integer: true,
    description: '普通奖励领取后多少天过期',
    defaultValue: 90,
  },

  // 利润六分比例（须合计 = 1.0）
  {
    key: 'NORMAL_PLATFORM_PERCENT',
    label: '平台占比',
    group: 'ratio',
    type: 'percent',
    min: 0,
    max: 1,
    step: 0.01,
    description: '普通利润中归平台的比例',
    defaultValue: 0.50,
  },
  {
    key: 'NORMAL_REWARD_PERCENT',
    label: '奖励占比',
    group: 'ratio',
    type: 'percent',
    min: 0,
    max: 1,
    step: 0.01,
    description: '普通利润中分配给奖励的比例',
    defaultValue: 0.16,
  },
  {
    key: 'NORMAL_INDUSTRY_FUND_PERCENT',
    label: '产业基金(卖家)占比',
    group: 'ratio',
    type: 'percent',
    min: 0,
    max: 1,
    step: 0.01,
    description: '普通利润中划入产业基金（卖家）的比例',
    defaultValue: 0.16,
  },
  {
    key: 'NORMAL_CHARITY_PERCENT',
    label: '慈善占比',
    group: 'ratio',
    type: 'percent',
    min: 0,
    max: 1,
    step: 0.01,
    description: '普通利润中归慈善的比例',
    defaultValue: 0.08,
  },
  {
    key: 'NORMAL_TECH_PERCENT',
    label: '科技占比',
    group: 'ratio',
    type: 'percent',
    min: 0,
    max: 1,
    step: 0.01,
    description: '普通利润中归科技的比例',
    defaultValue: 0.08,
  },
  {
    key: 'NORMAL_RESERVE_PERCENT',
    label: '备用金占比',
    group: 'ratio',
    type: 'percent',
    min: 0,
    max: 1,
    step: 0.01,
    description: '普通利润中归备用金的比例',
    defaultValue: 0.02,
  },
];

// 六分比例 keys（全部须合计 = 1.0）
const RATIO_KEYS = CONFIG_SCHEMA
  .filter((m) => m.group === 'ratio' && m.type === 'percent')
  .map((m) => m.key);

// 推荐模板：标准六分比例（50/16/16/8/8/2）
const RECOMMENDED_RATIO_TEMPLATE: Record<string, number> = {
  NORMAL_PLATFORM_PERCENT: 0.50,
  NORMAL_REWARD_PERCENT: 0.16,
  NORMAL_INDUSTRY_FUND_PERCENT: 0.16,
  NORMAL_CHARITY_PERCENT: 0.08,
  NORMAL_TECH_PERCENT: 0.08,
  NORMAL_RESERVE_PERCENT: 0.02,
};

// 所有配置项的默认值
const ALL_DEFAULTS: Record<string, number> = CONFIG_SCHEMA.reduce((acc, meta) => {
  if (meta.defaultValue !== undefined) {
    acc[meta.key] = meta.defaultValue;
  }
  return acc;
}, {} as Record<string, number>);

// 业务说明文案
const GROUP_DESCRIPTIONS = {
  tree: '普通用户奖励树决定了奖励如何在用户之间传递。分叉数控制每个节点最多可以有几个下级，最大分配层数决定一笔订单的奖励最多向上分配几层。调整这些参数会影响普通用户奖励分配的广度和深度。',
  reward: '冻结天数和奖励有效期控制用户获得奖励后的资金流转节奏。冻结期内奖励不可提现，过期后未提现的奖励将归平台所有。合理设置可平衡用户体验和平台资金安全。',
  ratio: '利润六分比例决定了普通用户每笔消费产生的利润如何分配到各个资金池。六项必须合计等于100%。推荐使用标准模板（50/16/16/8/8/2），该比例经过业务验证，能保证平台可持续运营。',
} as const;

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

/** 格式化百分比显示 */
const fmtPercent = (v: number) => `${(v * 100).toFixed(0)}%`;

// ============ 组件 ============

export default function NormalConfigPage() {
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

  // 实时获取六分比例合计
  const allValues = Form.useWatch([], form);
  const sumValue = useMemo(() => {
    if (!allValues) return 0;
    return RATIO_KEYS.reduce((s, k) => s + (Number((allValues as any)?.[k]) || 0), 0);
  }, [allValues]);
  const sumValid = Math.abs(sumValue - 1) < 0.001;

  // 实际执行保存逻辑
  const doSave = useCallback(async () => {
    const values = form.getFieldsValue(true);

    setSaving(true);

    try {
      // 逐项提交有变更的配置
      const note = changeNote || '更新普通用户系统配置';
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

  // 保存（带变更影响提示）
  const handleSave = useCallback(async () => {
    try {
      await form.validateFields();
    } catch {
      message.warning('请检查表单填写是否正确');
      return;
    }

    if (!sumValid) {
      message.error('六分比例合计必须等于 100%，当前合计：' + fmtPercent(sumValue));
      return;
    }

    // 检测哪些配置发生了变更
    const values = form.getFieldsValue(true);
    const changedItems: string[] = [];
    for (const meta of CONFIG_SCHEMA) {
      const oldVal = getVal(configs, meta.key);
      const newVal = values[meta.key];
      if (JSON.stringify(oldVal) !== JSON.stringify(newVal)) {
        changedItems.push(meta.label);
      }
    }

    if (changedItems.length === 0) {
      message.info('没有检测到配置变更');
      return;
    }

    // 构建变更影响提示
    const hasRatioChange = CONFIG_SCHEMA
      .filter((m) => m.group === 'ratio')
      .some((m) => {
        const oldVal = getVal(configs, m.key);
        const newVal = values[m.key];
        return JSON.stringify(oldVal) !== JSON.stringify(newVal);
      });
    const hasTreeChange = CONFIG_SCHEMA
      .filter((m) => m.group === 'tree')
      .some((m) => {
        const oldVal = getVal(configs, m.key);
        const newVal = values[m.key];
        return JSON.stringify(oldVal) !== JSON.stringify(newVal);
      });
    const hasRewardChange = CONFIG_SCHEMA
      .filter((m) => m.group === 'reward')
      .some((m) => {
        const oldVal = getVal(configs, m.key);
        const newVal = values[m.key];
        return JSON.stringify(oldVal) !== JSON.stringify(newVal);
      });

    const impacts: string[] = [];
    if (hasRatioChange) {
      impacts.push('修改分润比例将影响后续所有新订单的普通用户奖励分配金额');
    }
    if (hasTreeChange) {
      impacts.push('修改树结构参数将影响新用户的节点分配和奖励传递层级');
    }
    if (hasRewardChange) {
      impacts.push('修改奖励设置将影响后续新产生的奖励冻结和过期时间');
    }

    Modal.confirm({
      title: '确认保存配置变更？',
      icon: <ExclamationCircleOutlined />,
      content: (
        <div>
          <div style={{ marginBottom: 12 }}>
            <Text strong>本次变更项：</Text>
            <div style={{ marginTop: 4 }}>
              {changedItems.map((item) => (
                <Tag key={item} color="blue" style={{ marginBottom: 4 }}>{item}</Tag>
              ))}
            </div>
          </div>
          {impacts.length > 0 && (
            <Alert
              type="warning"
              showIcon
              message="变更影响"
              description={
                <ul style={{ margin: '4px 0 0', paddingLeft: 20 }}>
                  {impacts.map((imp, i) => <li key={i}>{imp}</li>)}
                </ul>
              }
              style={{ borderRadius: 8 }}
            />
          )}
          <div style={{ marginTop: 12 }}>
            <Text type="secondary" style={{ fontSize: 12 }}>
              以上变更仅对后续新数据生效，不会追溯影响已有的订单和奖励记录。
            </Text>
          </div>
        </div>
      ),
      okText: '确认保存',
      cancelText: '取消',
      okButtonProps: { style: { background: '#2E7D32' } },
      onOk: doSave,
    });
  }, [form, configs, sumValid, sumValue, doSave]);

  // 应用推荐模板（六分比例）
  const handleApplyTemplate = useCallback(() => {
    Modal.confirm({
      title: '应用推荐模板',
      icon: <ThunderboltOutlined style={{ color: '#2E7D32' }} />,
      content: (
        <div>
          <Text>将六分比例设置为推荐值：</Text>
          <div style={{ marginTop: 8, padding: 12, background: '#f6ffed', borderRadius: 8, border: '1px solid #b7eb8f' }}>
            <div>平台 50% / 奖励 16% / 产业基金 16%</div>
            <div>慈善 8% / 科技 8% / 备用金 2%</div>
          </div>
          <Text type="secondary" style={{ fontSize: 12, marginTop: 8, display: 'block' }}>
            此操作仅预填表单，需点击"保存"后才会生效。
          </Text>
        </div>
      ),
      okText: '应用模板',
      cancelText: '取消',
      okButtonProps: { style: { background: '#2E7D32' } },
      onOk: () => {
        form.setFieldsValue(RECOMMENDED_RATIO_TEMPLATE);
        setDirty(true);
        message.success('已应用推荐模板，请确认后保存');
      },
    });
  }, [form]);

  // 恢复默认值
  const handleRestoreDefaults = useCallback(() => {
    Modal.confirm({
      title: '恢复默认值',
      icon: <ExclamationCircleOutlined style={{ color: '#faad14' }} />,
      content: (
        <div>
          <Text>将所有配置项重置为系统默认值：</Text>
          <div style={{ marginTop: 8, padding: 12, background: '#fafafa', borderRadius: 8, border: '1px solid #f0f0f0' }}>
            {CONFIG_SCHEMA.map((meta) => (
              <div key={meta.key} style={{ display: 'flex', justifyContent: 'space-between', padding: '2px 0' }}>
                <Text type="secondary" style={{ fontSize: 12 }}>{meta.label}</Text>
                <Text style={{ fontSize: 12, fontFamily: 'monospace' }}>
                  {meta.type === 'percent' ? fmtPercent(meta.defaultValue ?? 0) : `${meta.defaultValue ?? meta.min ?? 0}${meta.suffix || ''}`}
                </Text>
              </div>
            ))}
          </div>
          <Text type="secondary" style={{ fontSize: 12, marginTop: 8, display: 'block' }}>
            此操作仅预填表单，需点击"保存"后才会生效。
          </Text>
        </div>
      ),
      okText: '恢复默认值',
      cancelText: '取消',
      okButtonProps: { danger: true },
      onOk: () => {
        form.setFieldsValue(ALL_DEFAULTS);
        setDirty(true);
        message.success('已恢复默认值，请确认后保存');
      },
    });
  }, [form]);

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
          <Title level={4} style={{ margin: 0 }}>普通用户系统配置</Title>
          <Text type="secondary" style={{ fontSize: 13 }}>
            管理普通用户奖励树结构、冻结/过期参数与利润六分比例（独立于 VIP 体系）
          </Text>
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
              style={{ background: '#2E7D32' }}
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
          {/* ====== 普通树结构 ====== */}
          <Col xs={24} lg={12}>
            <Card
              bordered={false}
              style={{ borderRadius: 12, height: '100%' }}
              styles={{ header: { borderBottom: '2px solid #2E7D32', paddingBottom: 8 } }}
              title={
                <Space>
                  <ApartmentOutlined style={{ color: '#2E7D32', fontSize: 18 }} />
                  <Text strong style={{ fontSize: 15 }}>普通树结构</Text>
                </Space>
              }
            >
              <Alert
                message="业务说明"
                description={GROUP_DESCRIPTIONS.tree}
                type="info"
                showIcon
                style={{ marginBottom: 16, borderRadius: 8 }}
              />
              {CONFIG_SCHEMA.filter((m) => m.group === 'tree').map((meta) => (
                <NumberField key={meta.key} meta={meta} />
              ))}
            </Card>
          </Col>

          {/* ====== 奖励设置 ====== */}
          <Col xs={24} lg={12}>
            <Card
              bordered={false}
              style={{ borderRadius: 12, height: '100%' }}
              styles={{ header: { borderBottom: '2px solid #d4380d', paddingBottom: 8 } }}
              title={
                <Space>
                  <TrophyOutlined style={{ color: '#d4380d', fontSize: 18 }} />
                  <Text strong style={{ fontSize: 15 }}>奖励设置</Text>
                </Space>
              }
            >
              <Alert
                message="业务说明"
                description={GROUP_DESCRIPTIONS.reward}
                type="info"
                showIcon
                style={{ marginBottom: 16, borderRadius: 8 }}
              />
              {CONFIG_SCHEMA.filter((m) => m.group === 'reward').map((meta) => (
                <NumberField key={meta.key} meta={meta} />
              ))}
            </Card>
          </Col>

          {/* ====== 利润六分比例 ====== */}
          <Col span={24}>
            <Card
              bordered={false}
              style={{ borderRadius: 12 }}
              styles={{ header: { borderBottom: '2px solid #1E40AF', paddingBottom: 8 } }}
              title={
                <Space>
                  <PercentageOutlined style={{ color: '#1E40AF', fontSize: 18 }} />
                  <Text strong style={{ fontSize: 15 }}>利润六分比例</Text>
                </Space>
              }
              extra={
                <Space>
                  <PermissionGate permission={PERMISSIONS.CONFIG_UPDATE}>
                    <Button
                      icon={<ThunderboltOutlined />}
                      size="small"
                      onClick={handleApplyTemplate}
                      style={{ borderColor: '#2E7D32', color: '#2E7D32' }}
                    >
                      推荐模板
                    </Button>
                  </PermissionGate>
                  <Tag
                    icon={sumValid ? <CheckCircleOutlined /> : <WarningOutlined />}
                    color={sumValid ? 'green' : 'error'}
                    style={{ fontSize: 13, padding: '2px 10px' }}
                  >
                    合计：{fmtPercent(sumValue)}
                  </Tag>
                </Space>
              }
            >
              <Alert
                message="业务说明"
                description={GROUP_DESCRIPTIONS.ratio}
                type="info"
                showIcon
                style={{ marginBottom: 16, borderRadius: 8 }}
              />

              <Divider style={{ margin: '0 0 12px' }}>
                <Text type="secondary" style={{ fontSize: 12 }}>以下六项须合计 = 100%（50/16/16/8/8/2）</Text>
              </Divider>

              {!sumValid && (
                <Alert
                  message={`当前合计 ${fmtPercent(sumValue)}，需要调整至 100%`}
                  type="warning"
                  showIcon
                  style={{ marginBottom: 12, borderRadius: 8 }}
                />
              )}

              <Row gutter={16}>
                {CONFIG_SCHEMA.filter((m) => m.group === 'ratio').map((meta) => (
                  <Col span={12} key={meta.key}>
                    <RatioField meta={meta} />
                  </Col>
                ))}
              </Row>
            </Card>
          </Col>

          {/* ====== 变更说明 + 操作按钮 ====== */}
          <Col span={24}>
            <Card bordered={false} style={{ borderRadius: 12, background: '#fafafa' }}>
              <Alert
                message="变更影响提示"
                description="修改配置后仅对后续新产生的数据生效，不会追溯影响已有的订单和奖励记录。修改分润比例将直接影响后续所有新订单的普通用户奖励分配金额，请谨慎操作。"
                type="warning"
                showIcon
                style={{ marginBottom: 16, borderRadius: 8 }}
              />
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
                  <Space>
                    <PermissionGate permission={PERMISSIONS.CONFIG_UPDATE}>
                      <Button
                        icon={<UndoOutlined />}
                        onClick={handleRestoreDefaults}
                        style={{ borderRadius: 8 }}
                      >
                        恢复默认值
                      </Button>
                    </PermissionGate>
                    <PermissionGate permission={PERMISSIONS.CONFIG_UPDATE}>
                      <Button
                        type="primary"
                        size="large"
                        icon={<SaveOutlined />}
                        loading={saving}
                        onClick={handleSave}
                        style={{ background: '#2E7D32', borderRadius: 8, minWidth: 140 }}
                      >
                        保存所有配置
                      </Button>
                    </PermissionGate>
                  </Space>
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
              color: '#2E7D32',
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

/** 百分比滑块字段 */
function RatioField({ meta }: { meta: ConfigMeta }) {
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
      <RatioSlider min={meta.min ?? 0} max={meta.max ?? 1} step={meta.step ?? 0.01} />
    </Form.Item>
  );
}

/** 滑块 + 数字联动组合控件 */
function RatioSlider({ value, onChange, min, max, step }: {
  value?: number;
  onChange?: (v: number) => void;
  min: number;
  max: number;
  step: number;
}) {
  const v = value ?? min;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
      <Slider
        style={{ flex: 1 }}
        min={min}
        max={max}
        step={step}
        value={v}
        onChange={(n) => onChange?.(n)}
        tooltip={{ formatter: (val) => val !== undefined ? fmtPercent(val) : '' }}
        styles={{
          track: { background: '#2E7D32' },
          rail: { background: '#e8e8e8' },
        }}
      />
      <InputNumber
        min={min}
        max={max}
        step={step}
        value={v}
        onChange={(n) => n !== null && onChange?.(n)}
        style={{ width: 80 }}
        formatter={(val) => val !== undefined ? `${((val as number) * 100).toFixed(0)}%` : ''}
        parser={(val) => (parseFloat(val?.replace('%', '') || '0') / 100) as unknown as number}
      />
    </div>
  );
}

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
          {Object.entries(version.snapshot).map(([key, val]) => {
            const meta = CONFIG_SCHEMA.find((m) => m.key === key);
            // 仅显示本页相关的 NORMAL_* 配置项
            if (!meta) return null;
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
                  {meta.label}
                </Text>
                <Text style={{ fontSize: 12, fontFamily: 'monospace' }}>
                  {meta.type === 'percent' ? fmtPercent(Number(displayVal)) : JSON.stringify(displayVal)}
                </Text>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
