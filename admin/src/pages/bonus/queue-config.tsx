import { useCallback, useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Alert,
  App,
  Button,
  Card,
  Col,
  DatePicker,
  Divider,
  Form,
  Input,
  InputNumber,
  Radio,
  Row,
  Space,
  Switch,
  Tag,
  Typography,
} from 'antd';
import {
  BellOutlined,
  ArrowRightOutlined,
  PauseCircleOutlined,
  SafetyCertificateOutlined,
  SaveOutlined,
} from '@ant-design/icons';
import dayjs, { type Dayjs } from 'dayjs';
import {
  batchUpdateConfig,
  getConfigs,
  getProfitSafetySummary,
} from '@/api/config';
import PermissionGate from '@/components/PermissionGate';
import ProfitSafetyStatus from '@/components/ProfitSafetyStatus';
import { PERMISSIONS } from '@/constants/permissions';
import { useConfigProfitSafetyPreview } from '@/hooks/useConfigProfitSafetyPreview';
import { usePermission } from '@/hooks/usePermission';
import {
  extractConfigDescription,
  extractConfigValue,
  type ProfitSafetySummary,
  type RuleConfig,
} from '@/types';
import { getAdminErrorMessage } from '@/utils/adminErrorMessage';

const { Text, Title } = Typography;

type QueueConfigKey =
  | 'QUEUE_REWARD_ENABLED'
  | 'QUEUE_SIZE'
  | 'QUEUE_REWARD_PERCENT'
  | 'QUEUE_SPLIT_UNIT_AMOUNT'
  | 'QUEUE_MAX_POSITIONS_PER_ORDER'
  | 'QUEUE_DISTRIBUTION_MODE'
  | 'QUEUE_RANDOM_STDDEV'
  | 'QUEUE_RANDOM_MIN_FACTOR'
  | 'QUEUE_RANDOM_MAX_FACTOR'
  | 'QUEUE_ACTIVATION_AT';

type QueueForm = {
  enabled: boolean;
  queueSize: number;
  rewardPercentDisplay: number;
  splitUnitAmount: number;
  maxPositionsPerOrder: number;
  distributionMode: 'AVERAGE' | 'NORMAL_RANDOM';
  randomStddev: number;
  randomMinFactor: number;
  randomMaxFactor: number;
  activationAt: Dayjs | null;
  changeNote: string;
};

const DEFAULTS: Omit<QueueForm, 'activationAt' | 'changeNote'> = {
  enabled: false,
  queueSize: 21,
  rewardPercentDisplay: 1,
  splitUnitAmount: 200,
  maxPositionsPerOrder: 100,
  distributionMode: 'AVERAGE',
  randomStddev: 0.25,
  randomMinFactor: 0.5,
  randomMaxFactor: 1.5,
};

function configValue(configs: RuleConfig[], key: string) {
  const row = configs.find((config) => config.key === key);
  return row ? extractConfigValue(row) : undefined;
}

function initialValues(configs: RuleConfig[]): QueueForm {
  const activationRaw = configValue(configs, 'QUEUE_ACTIVATION_AT');
  const activationAt =
    typeof activationRaw === 'string' && activationRaw
      ? dayjs(activationRaw)
      : null;
  return {
    enabled:
      configValue(configs, 'QUEUE_REWARD_ENABLED') === true,
    queueSize: Number(
      configValue(configs, 'QUEUE_SIZE') ?? DEFAULTS.queueSize,
    ),
    rewardPercentDisplay:
      Number(
        configValue(configs, 'QUEUE_REWARD_PERCENT') ??
          DEFAULTS.rewardPercentDisplay / 100,
      ) * 100,
    splitUnitAmount: Number(
      configValue(configs, 'QUEUE_SPLIT_UNIT_AMOUNT') ??
        DEFAULTS.splitUnitAmount,
    ),
    maxPositionsPerOrder: Number(
      configValue(configs, 'QUEUE_MAX_POSITIONS_PER_ORDER') ??
        DEFAULTS.maxPositionsPerOrder,
    ),
    distributionMode:
      configValue(configs, 'QUEUE_DISTRIBUTION_MODE') ===
      'NORMAL_RANDOM'
        ? 'NORMAL_RANDOM'
        : 'AVERAGE',
    randomStddev: Number(
      configValue(configs, 'QUEUE_RANDOM_STDDEV') ??
        DEFAULTS.randomStddev,
    ),
    randomMinFactor: Number(
      configValue(configs, 'QUEUE_RANDOM_MIN_FACTOR') ??
        DEFAULTS.randomMinFactor,
    ),
    randomMaxFactor: Number(
      configValue(configs, 'QUEUE_RANDOM_MAX_FACTOR') ??
        DEFAULTS.randomMaxFactor,
    ),
    activationAt,
    changeNote: '',
  };
}

const FORM_TO_CONFIG: Array<{
  formKey: keyof QueueForm;
  configKey: QueueConfigKey;
  description: string;
  serialize?: (value: unknown) => unknown;
}> = [
  {
    formKey: 'enabled',
    configKey: 'QUEUE_REWARD_ENABLED',
    description: '全平台订单队列奖励开关',
  },
  {
    formKey: 'queueSize',
    configKey: 'QUEUE_SIZE',
    description: '队列人数（当前订单加前序位置）',
  },
  {
    formKey: 'rewardPercentDisplay',
    configKey: 'QUEUE_REWARD_PERCENT',
    description: '每单利润中用于队列奖励的比例（实际从平台分成扣减）',
    serialize: (value) => Number(value) / 100,
  },
  {
    formKey: 'splitUnitAmount',
    configKey: 'QUEUE_SPLIT_UNIT_AMOUNT',
    description: '大单完整队列位置金额单元（元）',
  },
  {
    formKey: 'maxPositionsPerOrder',
    configKey: 'QUEUE_MAX_POSITIONS_PER_ORDER',
    description: '单个订单最多产生的队列位置数',
  },
  {
    formKey: 'distributionMode',
    configKey: 'QUEUE_DISTRIBUTION_MODE',
    description: '队列红包分配模式',
  },
  {
    formKey: 'randomStddev',
    configKey: 'QUEUE_RANDOM_STDDEV',
    description: '正态随机权重标准差',
  },
  {
    formKey: 'randomMinFactor',
    configKey: 'QUEUE_RANDOM_MIN_FACTOR',
    description: '正态随机权重最小倍数',
  },
  {
    formKey: 'randomMaxFactor',
    configKey: 'QUEUE_RANDOM_MAX_FACTOR',
    description: '正态随机权重最大倍数',
  },
  {
    formKey: 'activationAt',
    configKey: 'QUEUE_ACTIVATION_AT',
    description: '队列奖励生效时间',
    serialize: (value) =>
      value && dayjs.isDayjs(value)
        ? value.toISOString()
        : '',
  },
];

const PROFIT_SAFETY_SCHEMA = FORM_TO_CONFIG.map(({ configKey }) => ({
  key: configKey,
}));

function serializeQueueFormForProfitSafety(
  values: Partial<QueueForm> | undefined,
): Record<string, unknown> | undefined {
  if (!values) return undefined;
  return Object.fromEntries(
    FORM_TO_CONFIG.flatMap((item) => {
      const rawValue = values[item.formKey];
      if (rawValue === undefined) return [];
      return [
        [
          item.configKey,
          item.serialize ? item.serialize(rawValue) : rawValue,
        ],
      ];
    }),
  );
}

function percent(value: number): string {
  return `${(value * 100).toFixed(2)}%`;
}

function QueueProfitGate({
  enabled,
  queueRate,
  normalPlatformRate,
  vipPlatformRate,
  summary,
  candidate,
}: {
  enabled: boolean;
  queueRate: number;
  normalPlatformRate: number;
  vipPlatformRate: number;
  summary?: ProfitSafetySummary;
  candidate: boolean;
}) {
  const activeQueueRate = enabled ? queueRate : 0;
  const normalAfterQueue = normalPlatformRate - activeQueueRate;
  const vipAfterQueue = vipPlatformRate - activeQueueRate;
  const tightestScenario = summary?.scenarios.reduce(
    (tightest, scenario) => {
      const currentMargin =
        scenario.platformRetainedRevenueRate -
        scenario.platformRequiredRevenueRate;
      const tightestMargin =
        tightest.platformRetainedRevenueRate -
        tightest.platformRequiredRevenueRate;
      return currentMargin < tightestMargin ? scenario : tightest;
    },
  );
  const revenueSafetyMargin = tightestScenario
    ? tightestScenario.platformRetainedRevenueRate -
      tightestScenario.platformRequiredRevenueRate
    : null;
  const safe = summary?.safe;

  const metricStyle = {
    background: '#F5F9F6',
    border: '1px solid #DCE9E0',
    borderRadius: 12,
    minHeight: 94,
    padding: '14px 16px',
  } as const;

  return (
    <Card
      title={
        <Space>
          <SafetyCertificateOutlined style={{ color: '#1F6848' }} />
          <span>利润安全闸门</span>
        </Space>
      }
      extra={
        <Space size={6}>
          {candidate ? <Tag color="gold">未保存试算</Tag> : null}
          {safe === undefined ? (
            <Tag>等待校验</Tag>
          ) : (
            <Tag color={safe ? 'success' : 'error'}>
              {safe ? '安全' : '不可保存'}
            </Tag>
          )}
        </Space>
      }
    >
      <Row gutter={[12, 12]} align="middle">
        <Col xs={24} md={6}>
          <div style={metricStyle}>
            <Text type="secondary">队列从利润中取走</Text>
            <Title level={3} style={{ margin: '6px 0 0', color: '#B68A20' }}>
              {percent(activeQueueRate)}
            </Title>
            <Text type="secondary">
              {enabled ? '从平台份额内扣除' : '当前开关关闭，不占利润'}
            </Text>
          </div>
        </Col>
        <Col xs={24} md={6}>
          <div style={metricStyle}>
            <Text type="secondary">普通用户订单的平台份额</Text>
            <Space size={8} style={{ marginTop: 8 }}>
              <Text strong>{percent(normalPlatformRate)}</Text>
              <ArrowRightOutlined style={{ color: '#8AA696' }} />
              <Title level={4} style={{ margin: 0, color: normalAfterQueue >= 0 ? '#1F6848' : '#B42318' }}>
                {percent(normalAfterQueue)}
              </Title>
            </Space>
          </div>
        </Col>
        <Col xs={24} md={6}>
          <div style={metricStyle}>
            <Text type="secondary">VIP订单的平台份额</Text>
            <Space size={8} style={{ marginTop: 8 }}>
              <Text strong>{percent(vipPlatformRate)}</Text>
              <ArrowRightOutlined style={{ color: '#8AA696' }} />
              <Title level={4} style={{ margin: 0, color: vipAfterQueue >= 0 ? '#1F6848' : '#B42318' }}>
                {percent(vipAfterQueue)}
              </Title>
            </Space>
          </div>
        </Col>
        <Col xs={24} md={6}>
          <div style={metricStyle}>
            <Text type="secondary">最弱场景收入安全余量</Text>
            <Title
              level={4}
              style={{
                margin: '8px 0 0',
                color:
                  revenueSafetyMargin === null
                    ? '#65766C'
                    : revenueSafetyMargin >= 0
                      ? '#1F6848'
                      : '#B42318',
              }}
            >
              {revenueSafetyMargin === null
                ? '等待服务器试算'
                : percent(revenueSafetyMargin)}
            </Title>
          </div>
        </Col>
      </Row>
      <Text type="secondary" style={{ display: 'block', marginTop: 12 }}>
        队列不是第八份利润：普通/VIP七项比例仍各自合计100%，队列只从各自的平台份额中再次扣除。
      </Text>
    </Card>
  );
}

export default function QueueConfigPage() {
  const [form] = Form.useForm<QueueForm>();
  const queryClient = useQueryClient();
  const { message, modal } = App.useApp();
  const { hasPermission } = usePermission();
  const canSave = hasPermission(PERMISSIONS.CONFIG_UPDATE);
  const [dirty, setDirty] = useState(false);
  const [hasValidationErrors, setHasValidationErrors] = useState(false);
  const [profitSafetyPreviewRevision, setProfitSafetyPreviewRevision] =
    useState(0);

  const { data: configs = [], isLoading } = useQuery({
    queryKey: ['admin', 'configs'],
    queryFn: getConfigs,
  });
  const safetyQuery = useQuery({
    queryKey: ['admin', 'profit-safety-summary'],
    queryFn: getProfitSafetySummary,
  });
  const enabled = Form.useWatch('enabled', form);
  const distributionMode = Form.useWatch(
    'distributionMode',
    form,
  );
  const queueSize = Form.useWatch('queueSize', form) ?? 21;
  const allValues = Form.useWatch([], form) as QueueForm | undefined;
  const profitSafetyValues = useMemo(
    () => serializeQueueFormForProfitSafety(allValues),
    [allValues],
  );
  const profitSafetyPreview = useConfigProfitSafetyPreview({
    configs,
    values: profitSafetyValues,
    schema: PROFIT_SAFETY_SCHEMA,
    sumValid: true,
    hasValidationErrors,
    enabled: configs.length > 0 && dirty && canSave,
    revision: profitSafetyPreviewRevision,
  });
  const displayedSafetySummary =
    profitSafetyPreview.kind === 'candidate'
      ? profitSafetyPreview.summary
      : safetyQuery.data;
  const previewBlocksSave =
    dirty &&
    (profitSafetyPreview.kind !== 'candidate' ||
      !profitSafetyPreview.summary.safe);
  const queueRate =
    Number(allValues?.rewardPercentDisplay ?? DEFAULTS.rewardPercentDisplay) /
    100;
  const normalPlatformRate = Number(
    configValue(configs, 'NORMAL_PLATFORM_PERCENT') ?? 0.49,
  );
  const vipPlatformRate = Number(
    configValue(configs, 'VIP_PLATFORM_PERCENT') ?? 0.5,
  );
  const markConfigDirty = useCallback(() => {
    setDirty(true);
    setProfitSafetyPreviewRevision((revision) => revision + 1);
  }, []);
  const handleFieldsChange = useCallback(
    (
      _: unknown,
      fields: Array<{ errors?: string[]; validating?: boolean }>,
    ) => {
      setHasValidationErrors(
        fields.some(
          (field) =>
            field.validating || (field.errors?.length ?? 0) > 0,
        ),
      );
    },
    [],
  );

  useEffect(() => {
    if (configs.length === 0) return;
    form.setFieldsValue(initialValues(configs));
  }, [configs, form]);

  const currentEnabled =
    configValue(configs, 'QUEUE_REWARD_ENABLED') === true;
  const stateTag = useMemo(
    () =>
      currentEnabled
        ? { color: 'green', text: '当前已开启' }
        : { color: 'default', text: '当前已暂停' },
    [currentEnabled],
  );

  const saveMutation = useMutation({
    mutationFn: async (values: QueueForm) => {
      if (values.randomMinFactor > values.randomMaxFactor) {
        throw new Error('正态随机最小倍数不能大于最大倍数');
      }
      if (values.enabled && !values.activationAt) {
        throw new Error('开启队列奖励时必须设置生效时间');
      }

      const updates = FORM_TO_CONFIG.flatMap((item) => {
        const rawValue = values[item.formKey];
        const serialized = item.serialize
          ? item.serialize(rawValue)
          : rawValue;
        const oldValue = configValue(configs, item.configKey);
        if (JSON.stringify(oldValue) === JSON.stringify(serialized)) {
          return [];
        }
        const existing = configs.find(
          (config) => config.key === item.configKey,
        );
        return [
          {
            key: item.configKey,
            value: {
              value: serialized,
              description:
                (existing &&
                  extractConfigDescription(existing)) ||
                item.description,
            },
          },
        ];
      });
      if (updates.length === 0) return { updated: 0 };
      return batchUpdateConfig({
        updates,
        changeNote:
          values.changeNote || '更新全平台订单队列奖励参数',
      });
    },
    onSuccess: (result) => {
      if (result.updated === 0) {
        message.info('没有检测到配置变更');
        return;
      }
      message.success('队列奖励参数已保存');
      setDirty(false);
      queryClient.invalidateQueries({
        queryKey: ['admin', 'configs'],
      });
      queryClient.invalidateQueries({
        queryKey: ['admin', 'profit-safety-summary'],
      });
    },
    onError: (error) => {
      message.error(getAdminErrorMessage(error, '保存失败'));
    },
  });

  const handleSave = async () => {
    if (previewBlocksSave) {
      message.warning(
        profitSafetyPreview.kind === 'candidate'
          ? '当前参数未通过利润安全校验，不能保存'
          : '请等待未保存参数完成利润安全校验',
      );
      return;
    }
    let values: QueueForm;
    try {
      values = await form.validateFields();
    } catch {
      message.warning('请先修正参数');
      return;
    }

    const isEnabling = values.enabled && !currentEnabled;
    modal.confirm({
      title: isEnabling ? '确认开启全平台订单队列奖励？' : '确认保存参数？',
      icon: isEnabling ? <BellOutlined /> : <SaveOutlined />,
      width: 560,
      content: (
        <Space direction="vertical" size={12}>
          <Text>
            新订单从生效时间开始参加；历史订单不会补入队列。
          </Text>
          <Alert
            type={isEnabling ? 'warning' : 'info'}
            showIcon
            message={`每个新订单位置会观察前面 ${Math.max(
              1,
              values.queueSize - 1,
            )} 个位置`}
            description="实际发出的队列金额会从该订单的平台利润分成中扣减；未分出的预算仍归平台。"
          />
          <Text type="secondary">
            关闭开关只停止新订单入队，已有内部待结算记录仍会继续执行售后检查并按期到账。
          </Text>
        </Space>
      ),
      okText: '确认保存',
      cancelText: '取消',
      onOk: () => saveMutation.mutateAsync(values),
    });
  };

  return (
    <PermissionGate permission={PERMISSIONS.CONFIG_READ}>
      <div style={{ padding: 24 }}>
        <Space
          direction="vertical"
          size={18}
          style={{ width: '100%' }}
        >
          <Card
            loading={isLoading}
            styles={{ body: { padding: 0 } }}
          >
            <div
              style={{
                background:
                  'linear-gradient(115deg, #123E2D 0%, #1F6848 100%)',
                color: '#fff',
                padding: '24px 28px',
              }}
            >
              <Space
                align="start"
                style={{
                  justifyContent: 'space-between',
                  width: '100%',
                }}
              >
                <div>
                  <Text
                    style={{
                      color: '#E8C86F',
                      fontSize: 12,
                      fontWeight: 700,
                      letterSpacing: 1.5,
                    }}
                  >
                    GLOBAL ORDER RELAY
                  </Text>
                  <Title
                    level={2}
                    style={{ color: '#fff', margin: '5px 0 6px' }}
                  >
                    全平台订单队列奖励
                  </Title>
                  <Text style={{ color: 'rgba(255,255,255,.72)' }}>
                    独立于普通树、VIP 树和直推奖励；所有用户、所有商户共用一条队列。
                  </Text>
                </div>
                <Tag color={stateTag.color}>{stateTag.text}</Tag>
              </Space>
            </div>
          </Card>

          <ProfitSafetyStatus
            summary={safetyQuery.data}
            loading={safetyQuery.isLoading}
            error={safetyQuery.error}
            previewState={profitSafetyPreview}
          />

          <QueueProfitGate
            enabled={Boolean(enabled)}
            queueRate={queueRate}
            normalPlatformRate={normalPlatformRate}
            vipPlatformRate={vipPlatformRate}
            summary={displayedSafetySummary}
            candidate={profitSafetyPreview.kind === 'candidate'}
          />

          <Alert
            type="info"
            showIcon
            message="资金口径"
            description="奖励比例按订单利润计算，实际发出金额从平台利润分成扣除；只有缺少商品成本时会留下零出资位置，金额守恒失败等其他对账异常不会入队或推进队列。"
          />

          <Card title="运行开关与队列结构">
            <Form<QueueForm>
              form={form}
              layout="vertical"
              initialValues={{
                ...DEFAULTS,
                activationAt: null,
                changeNote: '',
              }}
              onValuesChange={markConfigDirty}
              onFieldsChange={handleFieldsChange}
            >
              <Row gutter={[20, 8]}>
                <Col xs={24} md={8}>
                  <Form.Item
                    name="enabled"
                    label="新订单入队"
                    valuePropName="checked"
                  >
                    <Switch
                      checkedChildren="开启"
                      unCheckedChildren="暂停"
                    />
                  </Form.Item>
                </Col>
                <Col xs={24} md={8}>
                  <Form.Item
                    name="queueSize"
                    label="每轮人数"
                    rules={[{ required: true }]}
                  >
                    <InputNumber
                      min={2}
                      max={100}
                      precision={0}
                      addonAfter="人"
                      style={{ width: '100%' }}
                    />
                  </Form.Item>
                </Col>
                <Col xs={24} md={8}>
                  <Form.Item
                    name="activationAt"
                    label="生效时间"
                    rules={[
                      {
                        validator: (_, value) =>
                          enabled && !value
                            ? Promise.reject(
                                new Error('开启时必须设置生效时间'),
                              )
                            : Promise.resolve(),
                      },
                    ]}
                  >
                    <DatePicker
                      showTime
                      format="YYYY-MM-DD HH:mm:ss"
                      style={{ width: '100%' }}
                    />
                  </Form.Item>
                </Col>
              </Row>

              <Divider orientation="left">资金与拆单</Divider>
              <Row gutter={[20, 8]}>
                <Col xs={24} md={8}>
                  <Form.Item
                    name="rewardPercentDisplay"
                    label="订单利润用于队列的比例"
                    rules={[{ required: true }]}
                    extra="平台允许 1%–10%"
                  >
                    <InputNumber
                      min={1}
                      max={10}
                      step={0.1}
                      precision={2}
                      addonAfter="%"
                      style={{ width: '100%' }}
                    />
                  </Form.Item>
                </Col>
                <Col xs={24} md={8}>
                  <Form.Item
                    name="splitUnitAmount"
                    label="大单拆分金额单元"
                    rules={[{ required: true }]}
                    extra="只按完整单元拆分；不足一个单元也产生一个位置"
                  >
                    <InputNumber
                      min={0.01}
                      max={1_000_000}
                      precision={2}
                      addonBefore="¥"
                      style={{ width: '100%' }}
                    />
                  </Form.Item>
                </Col>
                <Col xs={24} md={8}>
                  <Form.Item
                    name="distributionMode"
                    label="红包分配方式"
                  >
                    <Radio.Group
                      optionType="button"
                      buttonStyle="solid"
                      options={[
                        { label: '平均分配', value: 'AVERAGE' },
                        {
                          label: '正态随机',
                          value: 'NORMAL_RANDOM',
                        },
                      ]}
                    />
                  </Form.Item>
                </Col>
                <Col xs={24} md={8}>
                  <Form.Item
                    name="maxPositionsPerOrder"
                    label="单笔订单位置上限"
                    rules={[{ required: true }]}
                    extra="防止异常小金额单元导致单笔订单生成过多位置"
                  >
                    <InputNumber
                      min={1}
                      max={500}
                      precision={0}
                      addonAfter="个"
                      style={{ width: '100%' }}
                    />
                  </Form.Item>
                </Col>
              </Row>

              {distributionMode === 'NORMAL_RANDOM' ? (
                <>
                  <Divider orientation="left">正态随机边界</Divider>
                  <Alert
                    type="warning"
                    showIcon
                    message="随机只改变每个人拿到的份额，不改变本单奖励总额和用户收取上限。"
                    style={{ marginBottom: 18 }}
                  />
                  <Row gutter={[20, 8]}>
                    <Col xs={24} md={8}>
                      <Form.Item
                        name="randomStddev"
                        label="权重标准差"
                        rules={[{ required: true }]}
                      >
                        <InputNumber
                          min={0}
                          max={1}
                          step={0.05}
                          precision={2}
                          style={{ width: '100%' }}
                        />
                      </Form.Item>
                    </Col>
                    <Col xs={24} md={8}>
                      <Form.Item
                        name="randomMinFactor"
                        label="最小权重倍数"
                        dependencies={['randomMaxFactor']}
                        rules={[
                          { required: true },
                          ({ getFieldValue }) => ({
                            validator: (_, value) =>
                              Number(value) <=
                              Number(
                                getFieldValue('randomMaxFactor'),
                              )
                                ? Promise.resolve()
                                : Promise.reject(
                                    new Error('不能大于最大倍数'),
                                  ),
                          }),
                        ]}
                      >
                        <InputNumber
                          min={0.01}
                          max={10}
                          step={0.05}
                          precision={2}
                          style={{ width: '100%' }}
                        />
                      </Form.Item>
                    </Col>
                    <Col xs={24} md={8}>
                      <Form.Item
                        name="randomMaxFactor"
                        label="最大权重倍数"
                        dependencies={['randomMinFactor']}
                        rules={[
                          { required: true },
                          ({ getFieldValue }) => ({
                            validator: (_, value) =>
                              Number(value) >=
                              Number(
                                getFieldValue('randomMinFactor'),
                              )
                                ? Promise.resolve()
                                : Promise.reject(
                                    new Error('不能小于最小倍数'),
                                  ),
                          }),
                        ]}
                      >
                        <InputNumber
                          min={0.01}
                          max={10}
                          step={0.05}
                          precision={2}
                          style={{ width: '100%' }}
                        />
                      </Form.Item>
                    </Col>
                  </Row>
                </>
              ) : null}

              <Divider orientation="left">变更说明</Divider>
              <Form.Item name="changeNote">
                <Input.TextArea
                  maxLength={200}
                  showCount
                  placeholder="例如：试运营阶段改为 21 人、利润 1%，从指定时间开始"
                  autoSize={{ minRows: 2, maxRows: 4 }}
                />
              </Form.Item>

              <Space>
                <Button
                  type="primary"
                  icon={<SaveOutlined />}
                  loading={saveMutation.isPending}
                  disabled={!dirty || !canSave || previewBlocksSave}
                  onClick={handleSave}
                >
                  保存参数
                </Button>
                <Button
                  icon={<PauseCircleOutlined />}
                  disabled={!dirty}
                  onClick={() => {
                    form.setFieldsValue(initialValues(configs));
                    setDirty(false);
                    setHasValidationErrors(false);
                    setProfitSafetyPreviewRevision(
                      (revision) => revision + 1,
                    );
                  }}
                >
                  放弃未保存修改
                </Button>
                <Text type="secondary">
                  当前配置：{queueSize} 人一轮，前序{' '}
                  {Math.max(1, queueSize - 1)} 个位置参与分配
                </Text>
              </Space>
              {!canSave ? (
                <Text
                  type="warning"
                  style={{ display: 'block', marginTop: 10 }}
                >
                  当前账号缺少 config:update 权限，只能查看。
                </Text>
              ) : null}
            </Form>
          </Card>
        </Space>
      </div>
    </PermissionGate>
  );
}
