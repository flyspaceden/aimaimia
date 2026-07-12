import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import dayjs, { type Dayjs } from 'dayjs';
import type { InputNumberProps } from 'antd';
import { Link } from 'react-router-dom';
import {
  Alert,
  App,
  Button,
  Card,
  Col,
  DatePicker,
  Divider,
  Form,
  Grid,
  Input,
  InputNumber,
  Row,
  Select,
  Space,
  Switch,
  Table,
  Tag,
  Tooltip,
  Typography,
} from 'antd';
import { QuestionCircleOutlined, SafetyCertificateOutlined, SaveOutlined, SettingOutlined } from '@ant-design/icons';
import { getCaptainSettings, updateCaptainSettings } from '@/api/captain';
import { getProfitSafetySummary, previewProfitSafety } from '@/api/config';
import PermissionGate from '@/components/PermissionGate';
import { PERMISSIONS } from '@/constants/permissions';
import { useUnsavedChanges } from '@/hooks/useUnsavedChanges';
import { getAdminErrorMessage } from '@/utils/adminErrorMessage';
import { formatProfitSafetySummaryError } from '@/utils/configProfitSafetyPreview';
import {
  getProfitSafetyGuidance,
  getSystemConfigCompletenessNotice,
  type ProfitSafetyAction,
} from '@/utils/profitSafetyGuidance';
import type { CaptainSeafoodConfig, ProfitSafetyLimitingSku, ProfitSafetyScenario, ProfitSafetySummary } from '@/types';

const { Text } = Typography;

const PROGRAM_CODE = 'SEAFOOD_PREPACKAGED' as const;

const DEFAULT_FORM_VALUES: CaptainSeafoodConfig = {
  schemaVersion: 3,
  enabled: false,
  programCode: PROGRAM_CODE,
  programName: '预包装海鲜团长经营激励',
  effectiveFrom: '2026-07-31T16:00:00.000Z',
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
    directProfitRate: 0,
  },
  monthlyQualification: {
    minDirectEffectiveBuyers: 12,
    minDirectMonthlyGmv: 8000,
    minNewEffectiveBuyers: 1,
  },
  monthlyRewards: {
    baseTierGmv: 25000,
    baseManagementProfitRate: 0,
    growthTierGmv: 70000,
    growthBonusProfitRate: 0,
    excellentTierGmv: 140000,
    cultivationBonusProfitRate: 0,
    performanceBonusProfitRate: 0,
  },
  unitEconomics: {
    fulfillmentCostRate: 0,
  },
  caps: {
    maxTotalIncentiveProfitRate: 0,
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
    related: '首次从 V2 切换到 V3 必须从未来自然月起生效；V3 后续修改只影响之后支付的新订单，旧订单继续使用支付快照。',
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
  directProfitRate: {
    summary: '逐单奖励 = 本单团长适用商品的可分润利润 C × 该比例。C 是统一优惠后利润 D 中命中团长适用范围的子集，不是销售额。只给付款客户直接绑定的一名团长，没有二级。',
    related: '直接奖励率 + 四项月度利润奖励率 必须小于等于团长总利润激励上限。D≤0 时 C=0，本单不分润。',
  },
  freezeDaysAfterReceived: {
    summary: '逐单佣金至少在确认收货后冻结指定天数；如退货窗口更晚，则以更晚的时间为准。退款成功或售后完成不会释放佣金。',
    related: '冻结期使用订单归因当时保存的配置快照，后续改配置不会追溯改变旧订单。',
  },
  minCommissionBase: {
    summary: '单笔订单中命中范围的商品实付金额低于此值时，不创建团长佣金。运费、平台红包和消费积分抵扣不计入。',
    related: '适用范围决定哪些商品进入门槛；通过门槛后，逐单奖励仍按可分润利润 C 计算。',
  },
  minDirectEffectiveBuyers: {
    summary: '当月至少有这么多不同的直接客户产生正向有效净商品成交，才通过月度资格。注册、绑定或无效订单不计入。',
    related: '需同时满足资格线直接客户 GMV、新增有效直接客户和退款风控条件。',
  },
  minDirectMonthlyGmv: {
    summary: '月度资格线只汇总该团长直接客户的有效净商品 GMV，不包含任何下级团长、间接客户或历史二级订单。',
    related: 'D≤0 时订单不分润，但命中团长范围的优惠后净商品 GMV 仍可计入资格和档位；8,000 是资格线，25,000/70,000/140,000 是累进档位。',
  },
  minNewEffectiveBuyers: {
    summary: '当月新绑定且当月产生正向直接成交的客户数。仅新增绑定或仅注册不计入。',
    related: '与有效直接成交客户一起构成月度资格，不会给发展下级团长计数。',
  },
  baseTierGmv: {
    summary: '通过月度资格后，直接客户有效净 GMV 达到此值，开始计算管理津贴和经营绩效奖。',
    related: '增长档和卓越档在此基础上继续叠加，不是替换基础档奖励。',
  },
  baseManagementProfitRate: {
    summary: '通过 8,000 元资格线并达到 25,000 元基础档后，对当月各有效订单的可分润利润 C 按该比例累计管理津贴。分母是 C，不是 GMV。',
    related: '8,000 是资格线，25,000/70,000/140,000 是累进档位；GMV 只决定是否达标，奖励金额按 C 计算。',
  },
  growthTierGmv: {
    summary: '通过月度资格且 GMV 达到此值时，在基础档奖励之外增加增长奖。',
    related: '必须不低于基础档 GMV，且不高于卓越档 GMV。',
  },
  growthBonusProfitRate: {
    summary: '通过资格并达到 70,000 元增长档后，对当月各有效订单的 C 按该比例追加增长奖。分母是 C。',
    related: '与基础档利润奖励累加，并共同占用团长总利润激励上限。',
  },
  excellentTierGmv: {
    summary: '通过月度资格且 GMV 达到此值时，在基础档和增长档奖励之外增加有效成交辅导奖。',
    related: '必须不低于增长档 GMV。',
  },
  cultivationBonusProfitRate: {
    summary: '通过资格并达到 140,000 元卓越档后，对当月各有效订单的 C 按该比例追加有效成交辅导奖。分母是 C。',
    related: '只衡量直接客户的真实成交，不奖励注册数，不按下级团长或间接订单计提。',
  },
  performanceBonusProfitRate: {
    summary: '基础档达标后，对当月各有效订单的 C 按该比例计算经营绩效奖，100% 记入本团长。分母是 C。',
    related: '不存在团队池或 40/60 分配；与其他团长利润奖励共用同一资金上限。',
  },
  maxTotalIncentiveProfitRate: {
    summary: '团长直接奖励与四项月度奖励对可分润利润 C 的最高合计比例，超过不能保存。',
    related: '团长最高比例与会员树奖励、产业基金、邀请人直推共同占用 D；平台实际留存还必须覆盖履约、风险与目标净利。',
  },
  fulfillmentCostRate: {
    summary: '标准履约成本占 VIP 必然折扣后商品收入的比例，用于配置保存时的单品利润安全校验，不在单笔订单里再扣一次。',
    related: '每个活跃普通 SKU 都必须满足 g_sku × (1 - 会员树 - 产业基金 - 邀请人直推 - 团长最高奖励) ≥ 履约成本 + 冷链风险预留 + 目标净利。',
  },
  targetNetProfitRate: {
    summary: '平台要保留的最低净利占 VIP 必然折扣后商品收入的比例，只用于后台保存时的单品安全校验。',
    related: '与标准履约成本率、冷链风险预留率相加，必须由各 SKU 在扣除会员和团长外部分配后的平台留存覆盖。',
  },
  coldChainRiskReserveRate: {
    summary: '为冷链波动、售后和退换货保留的比例，分母是 VIP 必然折扣后商品收入，不会自动生成单独资金流水。',
    related: '与履约成本率、目标净利率一起构成平台最低留存线，任一买家/邀请人组合突破都会拒绝保存。',
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

function normalizeConfig(values: Partial<CaptainSeafoodConfig> | Record<string, any>): CaptainSeafoodConfig {
  const isV3 = values?.schemaVersion === 3;
  const profitValues = isV3 ? values as CaptainSeafoodConfig : DEFAULT_FORM_VALUES;
  return {
    schemaVersion: 3,
    enabled: Boolean(values.enabled),
    programCode: PROGRAM_CODE,
    programName: values.programName || DEFAULT_FORM_VALUES.programName,
    effectiveFrom: isV3 && typeof values.effectiveFrom === 'string'
      ? values.effectiveFrom
      : DEFAULT_FORM_VALUES.effectiveFrom,
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
      directProfitRate: toNumber(profitValues.perOrderCommission?.directProfitRate),
    },
    monthlyQualification: {
      minDirectEffectiveBuyers: toNumber(values.monthlyQualification?.minDirectEffectiveBuyers),
      minDirectMonthlyGmv: toNumber(values.monthlyQualification?.minDirectMonthlyGmv),
      minNewEffectiveBuyers: toNumber(values.monthlyQualification?.minNewEffectiveBuyers),
    },
    monthlyRewards: {
      baseTierGmv: toNumber(values.monthlyRewards?.baseTierGmv),
      baseManagementProfitRate: toNumber(profitValues.monthlyRewards?.baseManagementProfitRate),
      growthTierGmv: toNumber(values.monthlyRewards?.growthTierGmv),
      growthBonusProfitRate: toNumber(profitValues.monthlyRewards?.growthBonusProfitRate),
      excellentTierGmv: toNumber(values.monthlyRewards?.excellentTierGmv),
      cultivationBonusProfitRate: toNumber(profitValues.monthlyRewards?.cultivationBonusProfitRate),
      performanceBonusProfitRate: toNumber(profitValues.monthlyRewards?.performanceBonusProfitRate),
    },
    unitEconomics: {
      fulfillmentCostRate: toNumber(profitValues.unitEconomics?.fulfillmentCostRate),
    },
    caps: {
      maxTotalIncentiveProfitRate: toNumber(profitValues.caps?.maxTotalIncentiveProfitRate),
      targetNetProfitRate: toNumber(profitValues.caps?.targetNetProfitRate, 0.09),
      coldChainRiskReserveRate: toNumber(profitValues.caps?.coldChainRiskReserveRate, 0.02),
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

function SafetyActionLinks({ actions }: { actions: ProfitSafetyAction[] }) {
  if (actions.length === 0) return null;
  return (
    <Space wrap>
      {actions.map((action, index) => (
        <Link key={action.id} to={action.to}>
          <Button size="small" type={index === 0 ? 'primary' : 'default'}>{action.label}</Button>
        </Link>
      ))}
    </Space>
  );
}

function SafetySummaryPanel({
  summary,
  error,
  onRetry,
}: {
  summary?: ProfitSafetySummary | null;
  error?: unknown;
  onRetry: () => void;
}) {
  const [showAllPaths, setShowAllPaths] = useState(false);
  if (error) {
    return (
      <Alert
        type="error"
        showIcon
        message="平台利润安全结果读取失败"
        description={getAdminErrorMessage(error, '请检查网络或服务状态后重新读取')}
        action={<Button size="small" onClick={onRetry}>重新读取</Button>}
      />
    );
  }
  if (!summary) {
    return <Alert type="info" showIcon message="正在读取平台利润安全校验结果" />;
  }
  const guidance = getProfitSafetyGuidance(summary);
  const systemCompletenessNotice = getSystemConfigCompletenessNotice(summary);
  const canExpandScenarioCalculation = guidance.state === 'safe' || guidance.state === 'disabled';
  const limitingByScenario = new Map(
    summary.limitingSkus.map((sku) => [sku.scenarioKey, sku]),
  );
  const visibleScenarios = guidance.state === 'risk'
    ? guidance.riskScenarios as ProfitSafetyScenario[]
    : showAllPaths
      ? summary.scenarios
      : [];
  const visibleLimitingSkus = summary.limitingSkus.filter((sku) => sku.shortfall > 0);
  const columns = [
    { title: '下单买家身份', dataIndex: 'buyerPath', width: 120, render: (value: string) => value === 'VIP' ? 'VIP' : '普通' },
    { title: '直接邀请人身份', dataIndex: 'inviterPath', width: 130, render: (value: string) => value === 'VIP' ? 'VIP' : '普通' },
    { title: '本组合外部分润', dataIndex: 'externalProfitRate', width: 130, render: (value: number) => formatPercent(value) },
    { title: '商品利润中平台可留存', dataIndex: 'platformRetainedRevenueRate', width: 165, render: (value: number) => formatPercent(value) },
    { title: '平台最低留存要求', dataIndex: 'platformRequiredRevenueRate', width: 150, render: (value: number) => formatPercent(value) },
    {
      title: '余量/缺口',
      key: 'headroom',
      width: 120,
      render: (_: unknown, row: ProfitSafetyScenario) => {
        const headroom = row.platformRetainedRevenueRate - row.platformRequiredRevenueRate;
        return <Text type={headroom < 0 ? 'danger' : 'success'}>{formatPercent(headroom)}</Text>;
      },
    },
    {
      title: '限制商品',
      key: 'limitingProduct',
      width: 220,
      render: (_: unknown, row: ProfitSafetyScenario) => {
        const sku = limitingByScenario.get(row.key);
        if (!sku) return '-';
        return (
          <Space direction="vertical" size={0}>
            <Text>{sku.productTitle || '商品名称待补充'}{sku.skuTitle ? `｜${sku.skuTitle}` : ''}</Text>
            <Text type="secondary" copyable={{ text: sku.skuId, tooltips: ['复制规格编号', '已复制'] }}>规格编号</Text>
          </Space>
        );
      },
    },
    { title: '结果', dataIndex: 'safe', width: 90, render: (value: boolean) => <Tag color={value ? 'success' : 'error'}>{value ? '安全' : '拦截'}</Tag> },
  ];
  const limitingSkuColumns = [
    {
      title: '限制商品',
      key: 'product',
      width: 230,
      render: (_: unknown, row: ProfitSafetyLimitingSku) => (
        <Space direction="vertical" size={0}>
          <Text>{row.productTitle || '商品名称待补充'}{row.skuTitle ? `｜${row.skuTitle}` : ''}</Text>
          <Text type="secondary" copyable={{ text: row.skuId, tooltips: ['复制规格编号', '已复制'] }}>规格编号</Text>
        </Space>
      ),
    },
    { title: '售价', dataIndex: 'price', width: 100, render: (value: number) => `¥${value.toFixed(2)}` },
    { title: '成本', dataIndex: 'cost', width: 100, render: (value: number | null) => value == null ? '缺失' : `¥${value.toFixed(2)}` },
    { title: '毛利率', dataIndex: 'grossMarginRate', width: 110, render: (value: number) => formatPercent(value) },
    { title: '平台留存率', dataIndex: 'platformRetainedRevenueRate', width: 120, render: (value: number) => formatPercent(value) },
    { title: '最低要求', dataIndex: 'platformRequiredRevenueRate', width: 110, render: (value: number) => formatPercent(value) },
    { title: '缺口', dataIndex: 'shortfall', width: 100, render: (value: number) => <Text type={value > 0 ? 'danger' : undefined}>{formatPercent(value)}</Text> },
    { title: '原因', dataIndex: 'reason', width: 260, render: (value: string) => formatProfitSafetySummaryError(value) },
  ];
  return (
    <Space direction="vertical" size={10} style={{ width: '100%' }}>
      <Alert
        type={guidance.alertType}
        showIcon
        message={guidance.title}
        description={(
          <Space direction="vertical" size={6}>
            <Text>{guidance.description}</Text>
            {guidance.actions.map((action) => (
              <Text key={action.id} type="secondary">{action.label}：{action.description}</Text>
            ))}
            <SafetyActionLinks actions={guidance.actions} />
          </Space>
        )}
      />
      {systemCompletenessNotice ? (
        <Alert
          type="info"
          showIcon
          message="系统基础配置待完善"
          description={(
            <Space direction="vertical" size={6}>
              <Text>{systemCompletenessNotice.message}</Text>
              <SafetyActionLinks actions={systemCompletenessNotice.actions} />
            </Space>
          )}
        />
      ) : null}
      {visibleScenarios.length > 0 ? (
        <Table<ProfitSafetyScenario>
          rowKey="key"
          size="small"
          pagination={false}
          scroll={{ x: 1100 }}
          columns={columns}
          dataSource={visibleScenarios}
        />
      ) : canExpandScenarioCalculation ? (
        <Button type="link" style={{ alignSelf: 'flex-start', paddingInline: 0 }} onClick={() => setShowAllPaths(true)}>
          查看四种买家与推荐人组合测算
        </Button>
      ) : (
        <Text type="secondary">完成利润安全参数后，系统会展示四种买家与直接邀请人组合的正式测算。</Text>
      )}
      {showAllPaths && guidance.state !== 'risk' ? (
        <Button type="link" style={{ alignSelf: 'flex-start', paddingInline: 0 }} onClick={() => setShowAllPaths(false)}>
          收起组合测算
        </Button>
      ) : null}
      {guidance.state === 'risk' && visibleLimitingSkus.length > 0 ? (
        <>
          <Text strong>需要处理的商品利润明细</Text>
          <Table<ProfitSafetyLimitingSku>
            rowKey={(row) => `${row.skuId}:${row.scenarioKey}`}
            size="small"
            pagination={false}
            scroll={{ x: 1140 }}
            columns={limitingSkuColumns}
            dataSource={visibleLimitingSkus}
          />
        </>
      ) : null}
    </Space>
  );
}

export default function CaptainSettingsPage() {
  const { message } = App.useApp();
  const screens = Grid.useBreakpoint();
  const queryClient = useQueryClient();
  const [form] = Form.useForm<CaptainSeafoodConfig>();
  const [dirty, setDirty] = useState(false);
  const [checking, setChecking] = useState(false);
  const [safetySummary, setSafetySummary] = useState<ProfitSafetySummary | null>(null);
  useUnsavedChanges(dirty);

  const { data, isLoading } = useQuery({
    queryKey: ['admin', 'captain', 'settings'],
    queryFn: getCaptainSettings,
  });
  const safetyQuery = useQuery({
    queryKey: ['admin', 'profit-safety-summary'],
    queryFn: getProfitSafetySummary,
  });

  useEffect(() => {
    if (data) {
      form.setFieldsValue(normalizeConfig(data));
      setDirty(false);
    }
  }, [data, form]);

  useEffect(() => {
    if (safetyQuery.data) setSafetySummary(safetyQuery.data);
  }, [safetyQuery.data]);

  const mutation = useMutation({
    mutationFn: updateCaptainSettings,
    onSuccess: (next) => {
      message.success('团长配置已保存');
      form.setFieldsValue(normalizeConfig(next));
      setDirty(false);
      queryClient.invalidateQueries({ queryKey: ['admin', 'captain', 'settings'] });
      queryClient.invalidateQueries({ queryKey: ['admin', 'profit-safety-summary'] });
    },
    onError: (err: Error & { details?: Partial<ProfitSafetySummary> }) => {
      if (err.details?.scenarios) {
        setSafetySummary({
          safe: false,
          scenarios: err.details.scenarios,
          limitingSkus: err.details.limitingSkus ?? [],
          shortfall: err.details.shortfall ?? 0,
          evaluatedSkuCount: err.details.evaluatedSkuCount ?? 0,
          platformRequiredRevenueRate: err.details.platformRequiredRevenueRate ?? 0,
          captainMaximumProfitRate: err.details.captainMaximumProfitRate ?? 0,
          captainConfiguredCap: err.details.captainConfiguredCap ?? 0,
          captainConfigState: err.details.captainConfigState ?? 'INVALID',
          errors: err.details.errors ?? [],
          profitSafetyConfigCompleteness: err.details.profitSafetyConfigCompleteness,
          ruleConfigCompleteness: err.details.ruleConfigCompleteness,
        });
      }
      message.error(getAdminErrorMessage(err, '保存失败'));
    },
  });

  const watched = Form.useWatch([], form) as CaptainSeafoodConfig | undefined;
  const economics = useMemo(() => {
    const totalIncentiveRate =
      readRate(watched, ['perOrderCommission', 'directProfitRate']) +
      readRate(watched, ['monthlyRewards', 'baseManagementProfitRate']) +
      readRate(watched, ['monthlyRewards', 'growthBonusProfitRate']) +
      readRate(watched, ['monthlyRewards', 'cultivationBonusProfitRate']) +
      readRate(watched, ['monthlyRewards', 'performanceBonusProfitRate']);
    const maxTotalIncentiveRate = readRate(watched, ['caps', 'maxTotalIncentiveProfitRate']);
    return {
      totalIncentiveRate,
      maxTotalIncentiveRate,
      exceedsCap: totalIncentiveRate - maxTotalIncentiveRate > 0.000001,
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
    setChecking(true);
    try {
      const summary = await previewProfitSafety({ captainConfig: next });
      setSafetySummary(summary);
      if (!summary.safe) {
        message.error('当前参数未通过平台利润安全校验');
        return;
      }
      mutation.mutate(next);
    } catch (error) {
      message.error(getAdminErrorMessage(error, '利润安全预检失败，请稍后重试'));
    } finally {
      setChecking(false);
    }
  };

  const rateRules = [{ required: true, message: '请输入比例' }];
  const amountRules = [{ required: true, message: '请输入金额' }];

  return (
    <div style={{ padding: screens.md ? 24 : 0, minWidth: 0, width: '100%' }}>
      <Card
        loading={isLoading}
        title={<Space><SettingOutlined />团长配置</Space>}
        extra={
          <PermissionGate permission={PERMISSIONS.CAPTAIN_SETTINGS}>
            <Button type="primary" icon={<SaveOutlined />} loading={checking || mutation.isPending} onClick={handleSubmit}>
              保存配置
            </Button>
          </PermissionGate>
        }
      >
        <Space direction="vertical" size={16} style={{ width: '100%' }}>
          {data && (data as any).schemaVersion === 2 ? (
            <Alert
              type="warning"
              showIcon
              message="当前是历史销售额规则"
              description="历史 V2 只继续用于旧订单和旧月结。本页不会把销售额比例换算成利润比例；保存时将以 0 起始的 V3 利润参数创建新规则。"
            />
          ) : null}
          <Alert
            type={!watched?.enabled ? 'info' : economics.exceedsCap ? 'error' : 'info'}
            showIcon
            icon={<SafetyCertificateOutlined />}
            message={!watched?.enabled
              ? '团长激励未启用，当前按 0% 团长奖励测算'
              : `团长最高利润激励 ${formatPercent(economics.totalIncentiveRate)} / 封顶 ${formatPercent(economics.maxTotalIncentiveRate)}`}
            description={!watched?.enabled
              ? '当前不会产生新的团长佣金；VIP 与普通用户路径仍会继续进行利润安全测算。'
              : '团长奖励是 VIP/普通分润之外的独立路径，但只能从该订单实际平台留存利润中占用，不是第八份无来源资金。'}
          />
          <SafetySummaryPanel
            summary={safetySummary}
            error={safetyQuery.isError ? safetyQuery.error : null}
            onRetry={() => { void safetyQuery.refetch(); }}
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
                  rules={[{ required: true, message: '请选择 V3 生效时间' }]}
                  getValueProps={(value: string | null | undefined) => ({ value: value ? dayjs(value) : null })}
                  getValueFromEvent={(value: Dayjs | null) => value?.toISOString() ?? null}
                >
                  <DatePicker showTime allowClear={false} placeholder="选择 V3 生效时间" style={{ width: '100%' }} />
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

            <SectionTitle>逐单利润奖励</SectionTitle>
            <Row gutter={16}>
              <Col xs={24} md={8}>
                <Form.Item name={['perOrderCommission', 'directProfitRate']} label={<FieldLabel label="直接客户利润奖励率" help={FIELD_HELP.directProfitRate} />} rules={rateRules}>
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
                <Form.Item name={['monthlyRewards', 'baseManagementProfitRate']} label={<FieldLabel label="管理津贴利润率" help={FIELD_HELP.baseManagementProfitRate} />} rules={rateRules}>
                  <PercentInput min={0} max={100} precision={2} step={0.1} style={{ width: '100%' }} />
                </Form.Item>
              </Col>
              <Col xs={24} md={6}>
                <Form.Item name={['monthlyRewards', 'growthTierGmv']} label={<FieldLabel label="增长档 GMV" help={FIELD_HELP.growthTierGmv} />} rules={amountRules}>
                  <InputNumber min={0} precision={2} style={{ width: '100%' }} addonAfter="元" />
                </Form.Item>
              </Col>
              <Col xs={24} md={6}>
                <Form.Item name={['monthlyRewards', 'growthBonusProfitRate']} label={<FieldLabel label="增长奖利润率" help={FIELD_HELP.growthBonusProfitRate} />} rules={rateRules}>
                  <PercentInput min={0} max={100} precision={2} step={0.1} style={{ width: '100%' }} />
                </Form.Item>
              </Col>
              <Col xs={24} md={6}>
                <Form.Item name={['monthlyRewards', 'excellentTierGmv']} label={<FieldLabel label="卓越档 GMV" help={FIELD_HELP.excellentTierGmv} />} rules={amountRules}>
                  <InputNumber min={0} precision={2} style={{ width: '100%' }} addonAfter="元" />
                </Form.Item>
              </Col>
              <Col xs={24} md={6}>
                <Form.Item name={['monthlyRewards', 'cultivationBonusProfitRate']} label={<FieldLabel label="有效成交辅导奖利润率" help={FIELD_HELP.cultivationBonusProfitRate} />} rules={rateRules}>
                  <PercentInput min={0} max={100} precision={2} step={0.1} style={{ width: '100%' }} />
                </Form.Item>
              </Col>
              <Col xs={24} md={6}>
                <Form.Item name={['monthlyRewards', 'performanceBonusProfitRate']} label={<FieldLabel label="经营绩效奖利润率" help={FIELD_HELP.performanceBonusProfitRate} />} rules={rateRules}>
                  <PercentInput min={0} max={100} precision={2} step={0.1} style={{ width: '100%' }} />
                </Form.Item>
              </Col>
            </Row>

            <SectionTitle>平台利润底线与税务</SectionTitle>
            <Row gutter={16}>
              <Col xs={24} md={6}>
                <Form.Item name={['caps', 'maxTotalIncentiveProfitRate']} label={<FieldLabel label="团长总利润激励封顶" help={FIELD_HELP.maxTotalIncentiveProfitRate} />} rules={rateRules}>
                  <PercentInput min={0} max={100} precision={2} step={0.1} style={{ width: '100%' }} />
                </Form.Item>
              </Col>
              <Col xs={24} md={6}>
                <Form.Item name={['unitEconomics', 'fulfillmentCostRate']} label={<FieldLabel label="标准履约成本率" help={FIELD_HELP.fulfillmentCostRate} />} rules={rateRules}>
                  <PercentInput min={0} max={100} precision={2} step={0.1} style={{ width: '100%' }} />
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
