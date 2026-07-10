import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import dayjs, { type Dayjs } from 'dayjs';
import type { InputNumberProps } from 'antd';
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
  Row,
  Select,
  Space,
  Switch,
  Tooltip,
  Typography,
} from 'antd';
import { QuestionCircleOutlined, SaveOutlined, SettingOutlined } from '@ant-design/icons';
import { getCaptainSettings, updateCaptainSettings } from '@/api/captain';
import PermissionGate from '@/components/PermissionGate';
import { PERMISSIONS } from '@/constants/permissions';
import { useUnsavedChanges } from '@/hooks/useUnsavedChanges';
import type { CaptainSeafoodConfig } from '@/types';

const { Text } = Typography;

const PROGRAM_CODE = 'SEAFOOD_PREPACKAGED' as const;
const GROSS_MARGIN_RATE = 0.35;
const FIXED_COST_RATE = 0.105;

const DEFAULT_FORM_VALUES: CaptainSeafoodConfig = {
  schemaVersion: 2,
  enabled: false,
  programCode: PROGRAM_CODE,
  programName: '预包装海鲜团长经营激励',
  effectiveFrom: null,
  scope: {
    categoryIds: [],
    productIds: [],
    companyIds: [],
    excludedProductIds: [],
    includeVipPackage: false,
    includeGroupBuy: false,
    includePrize: false,
  },
  orderRules: {
    freezeDaysAfterReceived: 7,
    minCommissionBase: 0,
    includeShippingFee: false,
    includeCouponDiscount: false,
    includeRewardDeduction: false,
  },
  perOrderCommission: {
    directRate: 0.11,
  },
  monthlyQualification: {
    minDirectEffectiveBuyers: 12,
    minDirectMonthlyGmv: 8000,
    minNewEffectiveBuyers: 1,
  },
  monthlyRewards: {
    baseTierGmv: 25000,
    baseManagementRate: 0.022,
    growthTierGmv: 70000,
    growthBonusRate: 0.007,
    excellentTierGmv: 140000,
    cultivationBonusRate: 0.006,
    performanceBonusRate: 0.01,
  },
  caps: {
    maxTotalIncentiveRate: 0.155,
    targetNetProfitRate: 0.09,
    coldChainRiskReserveRate: 0.02,
  },
  tax: {
    enabled: true,
    withholdingRate: 0.2,
    incomeType: 'LABOR_SERVICE',
  },
  risk: {
    maxMonthlyRefundRate: 0.15,
    holdSettlementOnRisk: true,
  },
};

type FieldHelp = {
  summary: string;
  related?: string;
};

const FIELD_HELP = {
  enabled: {
    summary: '关闭后会拒绝新的团长码绑定，新的支付订单也不会生成团长佣金。已有关系、冻结佣金和历史台账不会被删除。',
    related: '开启后，生效时间和适用范围才会参与订单归因。',
  },
  programName: {
    summary: '团长端和后台展示的项目名称，不改变佣金比例、适用商品或结算规则。',
  },
  effectiveFrom: {
    summary: '只有实际支付时间不早于此时间的订单，才会创建新的团长归因和冻结佣金；此前订单不会补发。',
    related: '需同时开启团长激励，并命中适用范围。留空代表保存后立即生效。',
  },
  categoryIds: {
    summary: '命中任一类目的普通商品可参与计佣。',
    related: '与商品 ID、商户 ID 是“满足任一即可”；排除商品优先级更高。',
  },
  productIds: {
    summary: '指定商品可参与计佣，适合单品活动或试运行。',
    related: '与类目 ID、商户 ID 是“满足任一即可”；排除商品优先级更高。',
  },
  companyIds: {
    summary: '指定商户的普通商品可参与计佣。',
    related: '与类目 ID、商品 ID 是“满足任一即可”；排除商品优先级更高。',
  },
  excludedProductIds: {
    summary: '指定商品即使同时命中类目、商品或商户范围，也不会产生团长佣金。',
    related: '用于排除低毛利、特殊履约或临时不参与的商品。',
  },
  directRate: {
    summary: '订单只给付款客户已绑定的那一名直接团长计佣，金额等于计佣商品实付金额乘以该比例。不会给上级或间接团长收益。',
    related: '与最低计佣商品实付、总激励率封顶共同决定单品激励空间。',
  },
  freezeDaysAfterReceived: {
    summary: '逐单佣金至少在确认收货后冻结指定天数；如退货窗口更晚，则以更晚的时间为准。退款成功或售后完成不会释放佣金。',
    related: '冻结期使用订单归因当时保存的配置快照，后续改配置不会追溯改变旧订单。',
  },
  minCommissionBase: {
    summary: '单笔订单中命中范围的商品实付金额低于此值时，不创建团长佣金。运费、平台红包和消费积分抵扣不计入。',
    related: '适用范围决定哪些商品进入基数；直接推广成交佣金率按该基数计算。',
  },
  minDirectEffectiveBuyers: {
    summary: '当月至少有这么多不同的直接客户产生正向有效净商品成交，才通过月度资格。注册、绑定或无效订单不计入。',
    related: '需同时满足资格线直接客户 GMV、新增有效直接客户和退款风控条件。',
  },
  minDirectMonthlyGmv: {
    summary: '月度资格线只汇总该团长直接客户的有效净商品 GMV，不包含任何下级团长、间接客户或历史二级订单。',
    related: '达到资格线后，仍需达到各月度档位 GMV 才会产生对应奖励。',
  },
  minNewEffectiveBuyers: {
    summary: '当月新绑定且当月产生正向直接成交的客户数。仅新增绑定或仅注册不计入。',
    related: '与有效直接成交客户一起构成月度资格，不会给发展下级团长计数。',
  },
  baseTierGmv: {
    summary: '通过月度资格后，直接客户有效净 GMV 达到此值，开始计算管理津贴和经营绩效奖。',
    related: '增长档和卓越档在此基础上继续叠加，不是替换基础档奖励。',
  },
  baseManagementRate: {
    summary: '基础档达标后，管理津贴等于当月直接客户有效净 GMV 乘以该比例。',
    related: '与基础档 GMV、总激励率封顶关联。',
  },
  growthTierGmv: {
    summary: '通过月度资格且 GMV 达到此值时，在基础档奖励之外增加增长奖。',
    related: '必须不低于基础档 GMV，且不高于卓越档 GMV。',
  },
  growthBonusRate: {
    summary: '增长档达标后，增长奖等于当月直接客户有效净 GMV 乘以该比例。',
    related: '与基础档奖励累计计算，并计入总激励率封顶。',
  },
  excellentTierGmv: {
    summary: '通过月度资格且 GMV 达到此值时，在基础档和增长档奖励之外增加有效成交辅导奖。',
    related: '必须不低于增长档 GMV。',
  },
  cultivationBonusRate: {
    summary: '卓越档达标后，有效成交辅导奖等于当月直接客户有效净 GMV 乘以该比例。',
    related: '名称仅代表直接客户经营服务，不按下级团长或其销售额分配。',
  },
  performanceBonusRate: {
    summary: '基础档达标后，经营绩效奖等于当月直接客户有效净 GMV 乘以该比例，100% 记入本团长。',
    related: '不再使用团队池或 40/60 分配；与管理津贴同在基础档开始计算。',
  },
  maxTotalIncentiveRate: {
    summary: '最高激励率按直接佣金、管理津贴、增长奖、有效成交辅导奖和经营绩效奖的比例之和计算；超过此值不能保存。',
    related: '默认满配为 15.5%，用于保护商品毛利和履约空间。',
  },
  targetNetProfitRate: {
    summary: '经营测算的目标净利率，用于提示当前参数组合是否低于目标，不改变已生成佣金。',
    related: '测算值 = 毛利率 - 刚性成本 - 总激励率 - 冷链售后预留率。',
  },
  coldChainRiskReserveRate: {
    summary: '经营测算中为冷链波动、售后和退换货预留的比例，不会自动生成单独资金流水。',
    related: '与目标净利率一起决定“扣风险预留后”是否出现预警。',
  },
  taxEnabled: {
    summary: '控制月度结算是否计算税前、代扣和税后金额；不替代财务申报、实际付款和完税凭证流程。',
    related: '代扣税率决定月结中的税额和税后展示。',
  },
  withholdingRate: {
    summary: '月度结算税额 = 月度奖励税前合计乘以该比例；税后金额会在结算列表展示。',
    related: '仅在“代扣劳务个税”开启时生效。',
  },
  maxMonthlyRefundRate: {
    summary: '当月直接客户订单的退款金额占计佣基数比例超过此值时，命中退款风控。',
    related: '只有“命中风控暂停结算”开启时，才会导致当月资格不通过、月度奖励为零。',
  },
  holdSettlementOnRisk: {
    summary: '开启后，超过月退款率冻结阈值的团长当月不通过月度资格；逐单佣金仍按订单售后状态独立冻结、释放或冲回。',
    related: '关闭后，退款率继续记录但不阻断月度奖励资格。',
  },
} satisfies Record<string, FieldHelp>;

function toNumber(value: unknown, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function toArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0) : [];
}

function readRate(config: Partial<CaptainSeafoodConfig> | undefined, path: string[]) {
  let value: unknown = config;
  for (const key of path) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return 0;
    value = (value as Record<string, unknown>)[key];
  }
  return toNumber(value);
}

function formatPercent(value: number, digits = 2) {
  return `${(value * 100).toFixed(digits)}%`;
}

function normalizeConfig(values: CaptainSeafoodConfig): CaptainSeafoodConfig {
  return {
    schemaVersion: 2,
    enabled: Boolean(values.enabled),
    programCode: PROGRAM_CODE,
    programName: values.programName || DEFAULT_FORM_VALUES.programName,
    effectiveFrom: values.effectiveFrom?.trim() || null,
    scope: {
      categoryIds: toArray(values.scope?.categoryIds),
      productIds: toArray(values.scope?.productIds),
      companyIds: toArray(values.scope?.companyIds),
      excludedProductIds: toArray(values.scope?.excludedProductIds),
      includeVipPackage: false,
      includeGroupBuy: false,
      includePrize: false,
    },
    orderRules: {
      freezeDaysAfterReceived: toNumber(values.orderRules?.freezeDaysAfterReceived, 7),
      minCommissionBase: toNumber(values.orderRules?.minCommissionBase),
      includeShippingFee: false,
      includeCouponDiscount: false,
      includeRewardDeduction: false,
    },
    perOrderCommission: {
      directRate: toNumber(values.perOrderCommission?.directRate),
    },
    monthlyQualification: {
      minDirectEffectiveBuyers: toNumber(values.monthlyQualification?.minDirectEffectiveBuyers),
      minDirectMonthlyGmv: toNumber(values.monthlyQualification?.minDirectMonthlyGmv),
      minNewEffectiveBuyers: toNumber(values.monthlyQualification?.minNewEffectiveBuyers),
    },
    monthlyRewards: {
      baseTierGmv: toNumber(values.monthlyRewards?.baseTierGmv),
      baseManagementRate: toNumber(values.monthlyRewards?.baseManagementRate),
      growthTierGmv: toNumber(values.monthlyRewards?.growthTierGmv),
      growthBonusRate: toNumber(values.monthlyRewards?.growthBonusRate),
      excellentTierGmv: toNumber(values.monthlyRewards?.excellentTierGmv),
      cultivationBonusRate: toNumber(values.monthlyRewards?.cultivationBonusRate),
      performanceBonusRate: toNumber(values.monthlyRewards?.performanceBonusRate),
    },
    caps: {
      maxTotalIncentiveRate: toNumber(values.caps?.maxTotalIncentiveRate, 0.155),
      targetNetProfitRate: toNumber(values.caps?.targetNetProfitRate, 0.09),
      coldChainRiskReserveRate: toNumber(values.caps?.coldChainRiskReserveRate, 0.02),
    },
    tax: {
      enabled: Boolean(values.tax?.enabled),
      withholdingRate: toNumber(values.tax?.withholdingRate, 0.2),
      incomeType: 'LABOR_SERVICE',
    },
    risk: {
      maxMonthlyRefundRate: toNumber(values.risk?.maxMonthlyRefundRate, 0.15),
      holdSettlementOnRisk: Boolean(values.risk?.holdSettlementOnRisk),
    },
  };
}

function PercentInput(props: Omit<InputNumberProps<number>, 'value' | 'onChange'> & {
  value?: number;
  onChange?: (value: number | null) => void;
}) {
  const { value, onChange, ...rest } = props;
  return (
    <InputNumber
      {...rest}
      value={value == null ? undefined : Number((value * 100).toFixed(4))}
      onChange={(next) => onChange?.(next == null ? null : Number(next) / 100)}
      addonAfter="%"
    />
  );
}

function SectionTitle({ children }: { children: string }) {
  return (
    <Divider orientation="left" orientationMargin={0}>
      {children}
    </Divider>
  );
}

function FieldLabel({ label, help }: { label: string; help: FieldHelp }) {
  return (
    <Space size={4}>
      <span>{label}</span>
      <Tooltip
        title={
          <div style={{ maxWidth: 320 }}>
            <div>{help.summary}</div>
            {help.related ? <div style={{ marginTop: 8, opacity: 0.85 }}>关联：{help.related}</div> : null}
          </div>
        }
      >
        <span
          aria-label={`${label}说明`}
          tabIndex={0}
          style={{ color: '#1677ff', cursor: 'help', display: 'inline-flex' }}
        >
          <QuestionCircleOutlined />
        </span>
      </Tooltip>
    </Space>
  );
}

export default function CaptainSettingsPage() {
  const { message } = App.useApp();
  const queryClient = useQueryClient();
  const [form] = Form.useForm<CaptainSeafoodConfig>();
  const [dirty, setDirty] = useState(false);
  useUnsavedChanges(dirty);

  const { data, isLoading } = useQuery({
    queryKey: ['admin', 'captain', 'settings'],
    queryFn: getCaptainSettings,
  });

  useEffect(() => {
    if (data) {
      form.setFieldsValue(normalizeConfig(data));
      setDirty(false);
    }
  }, [data, form]);

  const mutation = useMutation({
    mutationFn: updateCaptainSettings,
    onSuccess: (next) => {
      message.success('团长配置已保存');
      form.setFieldsValue(normalizeConfig(next));
      setDirty(false);
      queryClient.invalidateQueries({ queryKey: ['admin', 'captain', 'settings'] });
    },
    onError: (err: Error) => message.error(err.message || '保存失败'),
  });

  const watched = Form.useWatch([], form) as CaptainSeafoodConfig | undefined;
  const economics = useMemo(() => {
    const totalIncentiveRate =
      readRate(watched, ['perOrderCommission', 'directRate']) +
      readRate(watched, ['monthlyRewards', 'baseManagementRate']) +
      readRate(watched, ['monthlyRewards', 'growthBonusRate']) +
      readRate(watched, ['monthlyRewards', 'cultivationBonusRate']) +
      readRate(watched, ['monthlyRewards', 'performanceBonusRate']);
    const maxTotalIncentiveRate = readRate(watched, ['caps', 'maxTotalIncentiveRate']);
    const riskReserveRate = readRate(watched, ['caps', 'coldChainRiskReserveRate']);
    const targetNetProfitRate = readRate(watched, ['caps', 'targetNetProfitRate']);
    const estimatedNetRate = GROSS_MARGIN_RATE - FIXED_COST_RATE - totalIncentiveRate;
    const reserveNetRate = estimatedNetRate - riskReserveRate;
    return {
      totalIncentiveRate,
      maxTotalIncentiveRate,
      targetNetProfitRate,
      estimatedNetRate,
      reserveNetRate,
      exceedsCap: totalIncentiveRate - maxTotalIncentiveRate > 0.000001,
      belowTarget: reserveNetRate + 0.000001 < targetNetProfitRate,
    };
  }, [watched]);

  const handleSubmit = async () => {
    const values = await form.validateFields();
    const next = normalizeConfig(values);
    const scopeCount = next.scope.categoryIds.length + next.scope.productIds.length + next.scope.companyIds.length;
    if (next.enabled && scopeCount === 0) {
      message.error('启用前必须至少配置一个适用类目、商品或商户');
      return;
    }
    if (next.monthlyRewards.baseTierGmv > next.monthlyRewards.growthTierGmv || next.monthlyRewards.growthTierGmv > next.monthlyRewards.excellentTierGmv) {
      message.error('月度档位 GMV 必须满足基础档 ≤ 增长档 ≤ 卓越档');
      return;
    }
    if (economics.exceedsCap) {
      message.error('总激励率不能超过封顶比例');
      return;
    }
    mutation.mutate(next);
  };

  const rateRules = [{ required: true, message: '请输入比例' }];
  const amountRules = [{ required: true, message: '请输入金额' }];

  return (
    <div style={{ padding: 24 }}>
      <Card
        loading={isLoading}
        title={<Space><SettingOutlined />团长配置</Space>}
        extra={
          <PermissionGate permission={PERMISSIONS.CAPTAIN_SETTINGS}>
            <Button type="primary" icon={<SaveOutlined />} loading={mutation.isPending} onClick={handleSubmit}>
              保存配置
            </Button>
          </PermissionGate>
        }
      >
        <Space direction="vertical" size={16} style={{ width: '100%' }}>
          <Alert
            type={economics.exceedsCap || economics.belowTarget ? 'warning' : 'success'}
            showIcon
            message="经济账测算"
            description={
              <Space size={24} wrap>
                <Text>总激励率：<Text strong>{formatPercent(economics.totalIncentiveRate)}</Text></Text>
                <Text>封顶：{formatPercent(economics.maxTotalIncentiveRate)}</Text>
                <Text>预估净利：<Text strong>{formatPercent(economics.estimatedNetRate)}</Text></Text>
                <Text>扣风险预留后：{formatPercent(economics.reserveNetRate)}</Text>
                <Text>目标净利：{formatPercent(economics.targetNetProfitRate)}</Text>
              </Space>
            }
          />

          <Form
            form={form}
            layout="vertical"
            initialValues={DEFAULT_FORM_VALUES}
            onValuesChange={() => setDirty(true)}
          >
            <SectionTitle>基础开关</SectionTitle>
            <Row gutter={16}>
              <Col xs={24} md={8}>
                <Form.Item name="enabled" label={<FieldLabel label="启用团长激励" help={FIELD_HELP.enabled} />} valuePropName="checked">
                  <Switch checkedChildren="启用" unCheckedChildren="关闭" />
                </Form.Item>
              </Col>
              <Col xs={24} md={8}>
                <Form.Item name="programName" label={<FieldLabel label="项目名称" help={FIELD_HELP.programName} />} rules={[{ required: true, message: '请输入项目名称' }]}>
                  <Input />
                </Form.Item>
              </Col>
              <Col xs={24} md={8}>
                <Form.Item
                  name="effectiveFrom"
                  label={<FieldLabel label="生效时间" help={FIELD_HELP.effectiveFrom} />}
                  getValueProps={(value: string | null | undefined) => ({ value: value ? dayjs(value) : null })}
                  getValueFromEvent={(value: Dayjs | null) => value?.toISOString() ?? null}
                >
                  <DatePicker showTime allowClear placeholder="留空立即生效" style={{ width: '100%' }} />
                </Form.Item>
              </Col>
            </Row>

            <SectionTitle>适用范围</SectionTitle>
            <Row gutter={16}>
              <Col xs={24} md={12}>
                <Form.Item name={['scope', 'categoryIds']} label={<FieldLabel label="适用类目 ID" help={FIELD_HELP.categoryIds} />}>
                  <Select mode="tags" tokenSeparators={[',', '，', ' ']} placeholder="输入类目 ID 后回车" />
                </Form.Item>
              </Col>
              <Col xs={24} md={12}>
                <Form.Item name={['scope', 'productIds']} label={<FieldLabel label="适用商品 ID" help={FIELD_HELP.productIds} />}>
                  <Select mode="tags" tokenSeparators={[',', '，', ' ']} placeholder="输入商品 ID 后回车" />
                </Form.Item>
              </Col>
              <Col xs={24} md={12}>
                <Form.Item name={['scope', 'companyIds']} label={<FieldLabel label="适用商户 ID" help={FIELD_HELP.companyIds} />}>
                  <Select mode="tags" tokenSeparators={[',', '，', ' ']} placeholder="输入商户 ID 后回车" />
                </Form.Item>
              </Col>
              <Col xs={24} md={12}>
                <Form.Item name={['scope', 'excludedProductIds']} label={<FieldLabel label="排除商品 ID" help={FIELD_HELP.excludedProductIds} />}>
                  <Select mode="tags" tokenSeparators={[',', '，', ' ']} placeholder="输入排除商品 ID 后回车" />
                </Form.Item>
              </Col>
            </Row>

            <SectionTitle>逐单佣金</SectionTitle>
            <Row gutter={16}>
              <Col xs={24} md={8}>
                <Form.Item name={['perOrderCommission', 'directRate']} label={<FieldLabel label="直接推广成交佣金率" help={FIELD_HELP.directRate} />} rules={rateRules}>
                  <PercentInput min={0} max={100} precision={2} step={0.1} style={{ width: '100%' }} />
                </Form.Item>
              </Col>
              <Col xs={24} md={8}>
                <Form.Item name={['orderRules', 'freezeDaysAfterReceived']} label={<FieldLabel label="确认收货后冻结天数" help={FIELD_HELP.freezeDaysAfterReceived} />} rules={[{ required: true }]}>
                  <InputNumber min={0} max={365} precision={0} style={{ width: '100%' }} addonAfter="天" />
                </Form.Item>
              </Col>
              <Col xs={24} md={8}>
                <Form.Item name={['orderRules', 'minCommissionBase']} label={<FieldLabel label="最低计佣商品实付" help={FIELD_HELP.minCommissionBase} />} rules={amountRules}>
                  <InputNumber min={0} precision={2} style={{ width: '100%' }} addonAfter="元" />
                </Form.Item>
              </Col>
            </Row>

            <SectionTitle>团长资格</SectionTitle>
            <Row gutter={16}>
              <Col xs={24} md={6}>
                <Form.Item name={['monthlyQualification', 'minDirectEffectiveBuyers']} label={<FieldLabel label="有效直接成交客户" help={FIELD_HELP.minDirectEffectiveBuyers} />} rules={[{ required: true }]}>
                  <InputNumber min={0} precision={0} style={{ width: '100%' }} addonAfter="人" />
                </Form.Item>
              </Col>
              <Col xs={24} md={6}>
                <Form.Item name={['monthlyQualification', 'minDirectMonthlyGmv']} label={<FieldLabel label="资格线直接客户 GMV" help={FIELD_HELP.minDirectMonthlyGmv} />} rules={amountRules}>
                  <InputNumber min={0} precision={2} style={{ width: '100%' }} addonAfter="元" />
                </Form.Item>
              </Col>
              <Col xs={24} md={6}>
                <Form.Item name={['monthlyQualification', 'minNewEffectiveBuyers']} label={<FieldLabel label="新增有效直接客户" help={FIELD_HELP.minNewEffectiveBuyers} />} rules={[{ required: true }]}>
                  <InputNumber min={0} precision={0} style={{ width: '100%' }} addonAfter="人" />
                </Form.Item>
              </Col>
            </Row>

            <SectionTitle>月度激励</SectionTitle>
            <Row gutter={16}>
              <Col xs={24} md={6}>
                <Form.Item name={['monthlyRewards', 'baseTierGmv']} label={<FieldLabel label="基础档 GMV" help={FIELD_HELP.baseTierGmv} />} rules={amountRules}>
                  <InputNumber min={0} precision={2} style={{ width: '100%' }} addonAfter="元" />
                </Form.Item>
              </Col>
              <Col xs={24} md={6}>
                <Form.Item name={['monthlyRewards', 'baseManagementRate']} label={<FieldLabel label="管理津贴率" help={FIELD_HELP.baseManagementRate} />} rules={rateRules}>
                  <PercentInput min={0} max={100} precision={2} step={0.1} style={{ width: '100%' }} />
                </Form.Item>
              </Col>
              <Col xs={24} md={6}>
                <Form.Item name={['monthlyRewards', 'growthTierGmv']} label={<FieldLabel label="增长档 GMV" help={FIELD_HELP.growthTierGmv} />} rules={amountRules}>
                  <InputNumber min={0} precision={2} style={{ width: '100%' }} addonAfter="元" />
                </Form.Item>
              </Col>
              <Col xs={24} md={6}>
                <Form.Item name={['monthlyRewards', 'growthBonusRate']} label={<FieldLabel label="增长奖率" help={FIELD_HELP.growthBonusRate} />} rules={rateRules}>
                  <PercentInput min={0} max={100} precision={2} step={0.1} style={{ width: '100%' }} />
                </Form.Item>
              </Col>
              <Col xs={24} md={6}>
                <Form.Item name={['monthlyRewards', 'excellentTierGmv']} label={<FieldLabel label="卓越档 GMV" help={FIELD_HELP.excellentTierGmv} />} rules={amountRules}>
                  <InputNumber min={0} precision={2} style={{ width: '100%' }} addonAfter="元" />
                </Form.Item>
              </Col>
              <Col xs={24} md={6}>
                <Form.Item name={['monthlyRewards', 'cultivationBonusRate']} label={<FieldLabel label="有效成交辅导奖率" help={FIELD_HELP.cultivationBonusRate} />} rules={rateRules}>
                  <PercentInput min={0} max={100} precision={2} step={0.1} style={{ width: '100%' }} />
                </Form.Item>
              </Col>
              <Col xs={24} md={6}>
                <Form.Item name={['monthlyRewards', 'performanceBonusRate']} label={<FieldLabel label="经营绩效奖率" help={FIELD_HELP.performanceBonusRate} />} rules={rateRules}>
                  <PercentInput min={0} max={100} precision={2} step={0.1} style={{ width: '100%' }} />
                </Form.Item>
              </Col>
            </Row>

            <SectionTitle>利润封顶与税务</SectionTitle>
            <Row gutter={16}>
              <Col xs={24} md={6}>
                <Form.Item name={['caps', 'maxTotalIncentiveRate']} label={<FieldLabel label="总激励率封顶" help={FIELD_HELP.maxTotalIncentiveRate} />} rules={rateRules}>
                  <PercentInput min={0} max={15.5} precision={2} step={0.1} style={{ width: '100%' }} />
                </Form.Item>
              </Col>
              <Col xs={24} md={6}>
                <Form.Item name={['caps', 'targetNetProfitRate']} label={<FieldLabel label="目标净利率" help={FIELD_HELP.targetNetProfitRate} />} rules={rateRules}>
                  <PercentInput min={0} max={100} precision={2} step={0.1} style={{ width: '100%' }} />
                </Form.Item>
              </Col>
              <Col xs={24} md={6}>
                <Form.Item name={['caps', 'coldChainRiskReserveRate']} label={<FieldLabel label="冷链售后预留率" help={FIELD_HELP.coldChainRiskReserveRate} />} rules={rateRules}>
                  <PercentInput min={0} max={100} precision={2} step={0.1} style={{ width: '100%' }} />
                </Form.Item>
              </Col>
              <Col xs={24} md={6}>
                <Form.Item name={['tax', 'enabled']} label={<FieldLabel label="代扣劳务个税" help={FIELD_HELP.taxEnabled} />} valuePropName="checked">
                  <Switch />
                </Form.Item>
              </Col>
              <Col xs={24} md={6}>
                <Form.Item name={['tax', 'withholdingRate']} label={<FieldLabel label="代扣税率" help={FIELD_HELP.withholdingRate} />} rules={rateRules}>
                  <PercentInput min={0} max={100} precision={2} step={1} style={{ width: '100%' }} />
                </Form.Item>
              </Col>
            </Row>

            <SectionTitle>风控</SectionTitle>
            <Row gutter={16}>
              <Col xs={24} md={6}>
                <Form.Item name={['risk', 'maxMonthlyRefundRate']} label={<FieldLabel label="月退款率冻结阈值" help={FIELD_HELP.maxMonthlyRefundRate} />} rules={rateRules}>
                  <PercentInput min={0} max={100} precision={2} step={1} style={{ width: '100%' }} />
                </Form.Item>
              </Col>
              <Col xs={24} md={6}>
                <Form.Item name={['risk', 'holdSettlementOnRisk']} label={<FieldLabel label="命中风控暂停结算" help={FIELD_HELP.holdSettlementOnRisk} />} valuePropName="checked">
                  <Switch />
                </Form.Item>
              </Col>
            </Row>
          </Form>
        </Space>
      </Card>
    </div>
  );
}
