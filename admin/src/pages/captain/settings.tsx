import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
import ScopeEntitySelect from './ScopeEntitySelect';
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
  meaning: string;
  example: string;
  related?: string;
};

const FIELD_HELP = {
  enabled: {
    meaning: '这是团长奖励的总开关。关闭后，新客户不能再绑定团长码，新支付订单也不会产生团长奖励；已经绑定的客户、已经冻结的奖励和历史记录不会被删除。',
    example: '今天关闭开关后，客户明天下单不会产生新奖励；团长账户里原来冻结的 100 元仍会保留，并按原订单规则继续处理。',
    related: '只有开启后，“生效时间”和“适用范围”才会决定哪些新订单参加。',
  },
  programName: {
    meaning: '这是后台和团长端看到的活动名称，只影响显示文字，不会改变奖励金额。',
    example: '把名称改成“舟山海鲜团长计划”，页面会显示新名称，但所有比例、门槛和适用商品都保持原样。',
  },
  effectiveFrom: {
    meaning: '从这个时间开始支付的订单，才使用这份团长配置。之前已经支付的订单不会补算，也不会被新参数改写。',
    example: '设置为 8 月 1 日 00:00：7 月 31 日 23:59 支付的订单仍按旧规则，8 月 1 日 00:01 支付的订单按新规则。',
    related: '修改配置只影响之后支付的新订单，旧订单始终保留付款时的规则。',
  },
  categoryIds: {
    meaning: '选择哪些商品类目参加团长奖励。系统会用商品自身保存的类目进行匹配。',
    example: '选择“速冻海鲜”后，所属类目正好是“速冻海鲜”的鳕鱼礼盒参加；如果该商品又被放进“不参与奖励的商品”，它仍然不参加。',
    related: '类目按精确归属匹配，选上级类目不会自动包含未选中的子类目。适用类目、商品、商户任一命中即可；排除商品优先。',
  },
  productIds: {
    meaning: '单独指定参加团长奖励的商品，适合只开放少量商品试运行。',
    example: '只选择“深海鳕鱼礼盒”，即使它所在的类目和商户都没有被选中，这个商品仍然参加。',
    related: '适用类目、适用商品、适用商户三项只要命中一项即可；排除商品的优先级最高。',
  },
  companyIds: {
    meaning: '选择哪些商户的普通商品参加团长奖励。选中商户后，该商户符合订单规则的商品都会参加。',
    example: '选择“舟山海味旗舰店”后，这家店的普通商品都参加；其中某个低毛利商品可以再放入排除名单。',
    related: '适用类目、适用商品、适用商户三项只要命中一项即可；排除商品的优先级最高。',
  },
  excludedProductIds: {
    meaning: '这里选择的商品一定不产生团长奖励，即使它同时命中了适用类目、适用商品或适用商户。',
    example: '“特价鳕鱼”属于已选中的速冻海鲜类目，但把它加入这里后，客户购买它仍不会产生团长奖励。',
    related: '适合排除低毛利、特殊履约或临时促销商品。',
  },
  directProfitRate: {
    meaning: '客户每完成一笔符合条件的订单，直接绑定他的团长可以拿走多少可分润利润。这里按利润计算，不按销售额计算，而且只给一名直接团长。',
    example: '一笔订单中符合范围商品的可分润利润是 40 元，比例填 10%，团长逐单奖励就是 4 元；如果可分润利润为 0，就没有奖励。',
    related: '它会和四项月度奖励一起占用“团长奖励合计上限”，没有二级团长奖励。',
  },
  freezeDaysAfterReceived: {
    meaning: '逐单奖励在客户确认收货后还要等待多少天，等待结束且没有未完成售后，才可以转为可结算。',
    example: '填 7 天，客户 8 月 1 日确认收货，最早 8 月 8 日释放；如果退换货期限到 8 月 12 日，则要等到更晚的 8 月 12 日。',
    related: '退款或售后成功会按订单规则冲回奖励；后续修改天数不会改变旧订单。',
  },
  minCommissionBase: {
    meaning: '一笔订单里，参加团长活动的商品在各种优惠和抵扣后的净商品金额，至少达到多少元才计算逐单奖励。运费不算。',
    example: '门槛填 100 元：符合范围商品优惠后只剩 80 元，不计奖励；优惠后是 150 元则通过门槛，但奖励金额仍按利润计算，不是按 150 元计算。',
    related: '先由适用范围筛出商品，再判断这项金额门槛。',
  },
  minDirectEffectiveBuyers: {
    meaning: '团长当月至少要有多少名不同的直接客户完成有效购买，才能取得当月的月度奖励资格。只注册、只绑定但没有有效购买的人不算。',
    example: '填 12 人：当月只有 11 名直接客户完成有效购买，不发月度奖励；达到 12 人后，还要继续检查销售额和新增客户条件。',
    related: '有效客户数、月度资格最低销售额、新增有效客户数三项必须同时满足。',
  },
  minDirectMonthlyGmv: {
    meaning: '团长的直接客户当月购买符合范围商品的优惠后销售额，至少达到多少元，团长才有资格拿月度奖励。不统计任何间接客户。',
    example: '填 8,000 元：当月直接客户有效销售额为 7,900 元，不具备月度资格；达到 8,500 元后通过这一项检查。',
    related: '这只是月度资格线；25,000、70,000、140,000 元是通过资格后继续判断奖励档位的门槛。',
  },
  minNewEffectiveBuyers: {
    meaning: '团长当月至少要新增多少名“新绑定并且完成有效购买”的直接客户。只新注册或只绑定、没有购买的人不算。',
    example: '填 1 人：本月新绑定 3 人，但只有 1 人完成有效购买，则新增有效客户数是 1，刚好达标。',
    related: '这里只统计直接客户，不统计发展了多少团长，也没有二级人数。',
  },
  baseTierGmv: {
    meaning: '团长通过月度资格后，直接客户当月有效销售额达到这个门槛，才开始获得基础档管理津贴和经营绩效奖。',
    example: '填 25,000 元：当月销售额 24,999 元没有基础档奖励；达到 25,000 元后开始计算基础档奖励。',
    related: '增长档和卓越档是在基础档之上继续加奖，不会替换基础档。',
  },
  baseManagementProfitRate: {
    meaning: '达到基础档后，团长从当月符合条件商品的可分润利润中，按这个比例获得管理津贴。销售额只决定是否达档，实际奖励仍按利润计算。',
    example: '当月符合条件商品的可分润利润合计为 6,000 元，比例填 0.5%，管理津贴是 30 元。',
    related: '必须先通过月度资格并达到基础档销售额门槛。',
  },
  growthTierGmv: {
    meaning: '团长通过月度资格后，当月直接客户有效销售额达到这个门槛，就在基础档奖励之外再获得增长档加奖。',
    example: '填 70,000 元：销售额达到 70,000 元时，同时保留基础档奖励，并开始增加增长档奖励。',
    related: '增长档门槛不能低于基础档，也不能高于卓越档。',
  },
  growthBonusProfitRate: {
    meaning: '达到增长档后，在基础档奖励之外，再从当月符合条件商品的可分润利润中按这个比例加奖。',
    example: '当月可分润利润合计为 20,000 元，增长奖比例填 1%，增长奖是 200 元，并且基础档奖励仍然保留。',
    related: '增长奖会与其他团长奖励相加，并共同受奖励合计上限约束。',
  },
  excellentTierGmv: {
    meaning: '团长通过月度资格后，当月直接客户有效销售额达到这个最高档门槛，就可以在基础档、增长档之外再获得卓越档辅导奖。',
    example: '填 140,000 元：当月达到 140,000 元时，基础档和增长档奖励继续保留，同时开始计算卓越档辅导奖。',
    related: '卓越档门槛必须大于或等于增长档门槛。',
  },
  cultivationBonusProfitRate: {
    meaning: '达到卓越档后，从当月符合条件商品的可分润利润中，按这个比例给团长增加辅导奖。它奖励真实直接客户成交，不奖励单纯拉人注册。',
    example: '当月可分润利润合计为 40,000 元，比例填 0.6%，辅导奖是 240 元。',
    related: '只统计直接客户真实成交，不统计下级团长或间接订单。',
  },
  performanceBonusProfitRate: {
    meaning: '达到基础档后，从当月符合条件商品的可分润利润中，按这个比例计算经营绩效奖，全部给当前团长。',
    example: '当月可分润利润合计为 20,000 元，比例填 1%，经营绩效奖是 200 元。',
    related: '没有团队池，也没有 40/60 分配；它会和其他团长奖励一起占用奖励合计上限。',
  },
  maxTotalIncentiveProfitRate: {
    meaning: '这是所有团长奖励比例加起来允许达到的最高值，用来防止逐单奖励和月度奖励叠加过高。超过这个上限时，配置不能保存。',
    example: '逐单 9% + 管理津贴 2.2% + 增长奖 0.7% + 辅导奖 0.6% + 绩效奖 1% = 13.5%。上限填 14.5% 可以保存，填 13% 就不能保存。',
    related: '通过这项检查后，系统还会继续检查 VIP/普通奖励、履约成本、风险预留和目标净利，确保平台整体不亏。',
  },
  fulfillmentCostRate: {
    meaning: '平台预计每卖出 100 元优惠后商品收入，需要拿出多少比例支付包装、冷链、仓储、客服等履约成本。它只用于保存配置时检查利润安全，不会在订单里重复扣钱。',
    example: '比例填 10.5%，某商品优惠后收入为 100 元，系统会按 10.5 元履约成本检查平台是否还有足够利润。',
    related: '履约成本、冷链售后预留和目标净利三项相加，就是平台必须保留的最低金额。',
  },
  targetNetProfitRate: {
    meaning: '扣完商品成本、用户奖励、团长奖励、履约成本和风险预留后，平台希望至少留下多少净利润。配置不满足时不能保存。',
    example: '目标净利填 8%，某商品优惠后收入为 100 元，所有成本和奖励扣完后至少还要给平台留下 8 元。',
    related: '它要和预计履约成本比例、冷链和售后预留比例一起看。',
  },
  coldChainRiskReserveRate: {
    meaning: '平台为冷链涨价、破损补发、退款和其他售后波动预留多少空间。它是利润安全预算，不会自动转入一个单独账户。',
    example: '比例填 2%，某商品优惠后收入为 100 元，系统会预留 2 元风险空间再判断配置是否安全。',
    related: '它与预计履约成本比例、目标净利率共同组成平台最低留存要求。',
  },
  taxEnabled: {
    meaning: '开启后，月度结算会同时显示税前奖励、预计代扣税额和税后应付金额。这里只负责计算和记录，不代替财务实际申报与付款。',
    example: '团长税前月度奖励为 1,000 元，代扣税率为 20%，结算会显示代扣 200 元、税后 800 元。',
    related: '关闭后不计算代扣金额；开启时由“代扣税率”决定扣多少。',
  },
  withholdingRate: {
    meaning: '月度奖励中预计代扣税额所使用的比例。税额等于税前月度奖励乘以这个比例。',
    example: '税前奖励 2,000 元，税率填 20%，预计代扣 400 元，税后应付 1,600 元。',
    related: '只有开启“代扣劳务个税”时，这个比例才生效。',
  },
  maxMonthlyRefundRate: {
    meaning: '当月直接客户的退款金额占有效销售额的比例超过多少时，系统把这个团长标记为退款风险。',
    example: '警戒线填 15%，当月有效销售额 10,000 元、退款 1,600 元，退款率为 16%，超过警戒线。',
    related: '是否真的暂停月度奖励，由“超出警戒线时暂停月度奖励”开关决定。',
  },
  holdSettlementOnRisk: {
    meaning: '开启后，只要团长当月退款率超过警戒线，就暂停发放当月的月度奖励；逐单奖励仍然按每笔订单的退款和售后结果单独处理。',
    example: '警戒线 15%，实际退款率 16%：开关开启时当月管理津贴和档位加奖为 0；关闭时只记录风险，不自动取消月度奖励。',
    related: '它只控制月度奖励资格，不会跳过单笔订单原有的冻结、释放和退款冲回。',
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
        placement="topLeft"
        styles={{
          body: {
            width: 'min(380px, calc(100vw - 32px))',
            maxWidth: 'calc(100vw - 32px)',
            boxSizing: 'border-box',
            whiteSpace: 'normal',
            overflowWrap: 'anywhere',
          },
        }}
        title={
          <div style={{ width: '100%', lineHeight: 1.65, whiteSpace: 'normal', overflowWrap: 'anywhere' }}>
            <div>
              <span style={{ color: '#91caff', fontWeight: 600 }}>什么意思：</span>
              {help.meaning}
            </div>
            <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px solid rgba(255,255,255,0.18)' }}>
              <span style={{ color: '#b7eb8f', fontWeight: 600 }}>举个例子：</span>
              {help.example}
            </div>
            {help.related ? (
              <div style={{ marginTop: 10, opacity: 0.9 }}>
                <span style={{ color: '#ffd591', fontWeight: 600 }}>还要一起看：</span>
                {help.related}
              </div>
            ) : null}
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

function SafetyActionLinks({
  actions,
  onCaptainSettings,
}: {
  actions: ProfitSafetyAction[];
  onCaptainSettings?: () => void;
}) {
  if (actions.length === 0) return null;
  return (
    <Space wrap>
      {actions.map((action, index) => {
        const button = (
          <Button
            key={action.id}
            size="small"
            type={index === 0 ? 'primary' : 'default'}
            onClick={action.id === 'captain-settings' ? onCaptainSettings : undefined}
          >
            {action.label}
          </Button>
        );
        return action.id === 'captain-settings' && onCaptainSettings
          ? button
          : <Link key={action.id} to={action.to}>{button}</Link>;
      })}
    </Space>
  );
}

function SafetySummaryPanel({
  summary,
  error,
  onRetry,
  onCaptainSettings,
}: {
  summary?: ProfitSafetySummary | null;
  error?: unknown;
  onRetry: () => void;
  onCaptainSettings: () => void;
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
            <SafetyActionLinks actions={guidance.actions} onCaptainSettings={onCaptainSettings} />
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
              <SafetyActionLinks actions={systemCompletenessNotice.actions} onCaptainSettings={onCaptainSettings} />
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
  const configurationSectionRef = useRef<HTMLDivElement>(null);
  const captainEnableControlRef = useRef<HTMLDivElement>(null);
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
  const scrollToCaptainConfiguration = useCallback(() => {
    configurationSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    window.setTimeout(() => {
      captainEnableControlRef.current?.querySelector<HTMLElement>('button')?.focus();
    }, 350);
    message.info('已定位到团长基础开关，请按需开启后继续填写配置');
  }, [message]);
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
    // Form only returns registered fields; the V3 contract metadata is not editable.
    const next = normalizeConfig({
      ...values,
      schemaVersion: 3,
      programCode: PROGRAM_CODE,
    });
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
          {watched?.enabled ? (
            <Alert
              type={economics.exceedsCap ? 'error' : 'info'}
              showIcon
              icon={<SafetyCertificateOutlined />}
              message={`团长最高利润激励 ${formatPercent(economics.totalIncentiveRate)} / 封顶 ${formatPercent(economics.maxTotalIncentiveRate)}`}
              description="团长奖励是 VIP/普通分润之外的独立路径，但只能从该订单实际平台留存利润中占用，不是第八份无来源资金。"
            />
          ) : null}
          <SafetySummaryPanel
            summary={safetySummary}
            error={safetyQuery.isError ? safetyQuery.error : null}
            onRetry={() => { void safetyQuery.refetch(); }}
            onCaptainSettings={scrollToCaptainConfiguration}
          />

          <Form
            form={form}
            layout="vertical"
            initialValues={DEFAULT_FORM_VALUES}
            onValuesChange={() => setDirty(true)}
          >
            <div ref={configurationSectionRef} style={{ scrollMarginTop: 24 }}>
              <SectionTitle>基础开关</SectionTitle>
              <Row gutter={16}>
                <Col xs={24} md={8}>
                  <div ref={captainEnableControlRef}>
                    <Form.Item name="enabled" label={<FieldLabel label="启用团长激励" help={FIELD_HELP.enabled} />} valuePropName="checked">
                      <Switch checkedChildren="启用" unCheckedChildren="关闭" />
                    </Form.Item>
                  </div>
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
            </div>

            <SectionTitle>适用范围</SectionTitle>
            <Row gutter={16}>
              <Col xs={24} md={12}>
                <Form.Item name={['scope', 'categoryIds']} label={<FieldLabel label="适用类目" help={FIELD_HELP.categoryIds} />}>
                  <ScopeEntitySelect type="CATEGORY" placeholder="点击选择，或搜索类目名称、路径和 ID" />
                </Form.Item>
              </Col>
              <Col xs={24} md={12}>
                <Form.Item name={['scope', 'productIds']} label={<FieldLabel label="适用商品" help={FIELD_HELP.productIds} />}>
                  <ScopeEntitySelect type="PRODUCT" placeholder="点击选择，或搜索商品名称、商户和 ID" />
                </Form.Item>
              </Col>
              <Col xs={24} md={12}>
                <Form.Item name={['scope', 'companyIds']} label={<FieldLabel label="适用商户" help={FIELD_HELP.companyIds} />}>
                  <ScopeEntitySelect type="COMPANY" placeholder="点击选择，或搜索商户名称、简称和 ID" />
                </Form.Item>
              </Col>
              <Col xs={24} md={12}>
                <Form.Item name={['scope', 'excludedProductIds']} label={<FieldLabel label="不参与奖励的商品" help={FIELD_HELP.excludedProductIds} />}>
                  <ScopeEntitySelect type="PRODUCT" placeholder="点击选择需要排除的商品，或搜索名称和 ID" />
                </Form.Item>
              </Col>
            </Row>

            <SectionTitle>逐单利润奖励</SectionTitle>
            <Row gutter={16}>
              <Col xs={24} md={8}>
                <Form.Item name={['perOrderCommission', 'directProfitRate']} label={<FieldLabel label="直接客户逐单奖励比例" help={FIELD_HELP.directProfitRate} />} rules={rateRules}>
                  <PercentInput min={0} max={100} precision={2} step={0.1} style={{ width: '100%' }} />
                </Form.Item>
              </Col>
              <Col xs={24} md={8}>
                <Form.Item name={['orderRules', 'freezeDaysAfterReceived']} label={<FieldLabel label="确认收货后等待天数" help={FIELD_HELP.freezeDaysAfterReceived} />} rules={[{ required: true }]}>
                  <InputNumber min={0} max={365} precision={0} style={{ width: '100%' }} addonAfter="天" />
                </Form.Item>
              </Col>
              <Col xs={24} md={8}>
                <Form.Item name={['orderRules', 'minCommissionBase']} label={<FieldLabel label="单笔订单最低参加金额" help={FIELD_HELP.minCommissionBase} />} rules={amountRules}>
                  <InputNumber min={0} precision={2} style={{ width: '100%' }} addonAfter="元" />
                </Form.Item>
              </Col>
            </Row>

            <SectionTitle>团长资格</SectionTitle>
            <Row gutter={16}>
              <Col xs={24} md={6}>
                <Form.Item name={['monthlyQualification', 'minDirectEffectiveBuyers']} label={<FieldLabel label="月度有效直接客户数" help={FIELD_HELP.minDirectEffectiveBuyers} />} rules={[{ required: true }]}>
                  <InputNumber min={0} precision={0} style={{ width: '100%' }} addonAfter="人" />
                </Form.Item>
              </Col>
              <Col xs={24} md={6}>
                <Form.Item name={['monthlyQualification', 'minDirectMonthlyGmv']} label={<FieldLabel label="月度资格最低销售额" help={FIELD_HELP.minDirectMonthlyGmv} />} rules={amountRules}>
                  <InputNumber min={0} precision={2} style={{ width: '100%' }} addonAfter="元" />
                </Form.Item>
              </Col>
              <Col xs={24} md={6}>
                <Form.Item name={['monthlyQualification', 'minNewEffectiveBuyers']} label={<FieldLabel label="月度新增有效客户数" help={FIELD_HELP.minNewEffectiveBuyers} />} rules={[{ required: true }]}>
                  <InputNumber min={0} precision={0} style={{ width: '100%' }} addonAfter="人" />
                </Form.Item>
              </Col>
            </Row>

            <SectionTitle>月度激励</SectionTitle>
            <Row gutter={16}>
              <Col xs={24} md={6}>
                <Form.Item name={['monthlyRewards', 'baseTierGmv']} label={<FieldLabel label="基础档销售额门槛" help={FIELD_HELP.baseTierGmv} />} rules={amountRules}>
                  <InputNumber min={0} precision={2} style={{ width: '100%' }} addonAfter="元" />
                </Form.Item>
              </Col>
              <Col xs={24} md={6}>
                <Form.Item name={['monthlyRewards', 'baseManagementProfitRate']} label={<FieldLabel label="基础档管理津贴比例" help={FIELD_HELP.baseManagementProfitRate} />} rules={rateRules}>
                  <PercentInput min={0} max={100} precision={2} step={0.1} style={{ width: '100%' }} />
                </Form.Item>
              </Col>
              <Col xs={24} md={6}>
                <Form.Item name={['monthlyRewards', 'growthTierGmv']} label={<FieldLabel label="增长档销售额门槛" help={FIELD_HELP.growthTierGmv} />} rules={amountRules}>
                  <InputNumber min={0} precision={2} style={{ width: '100%' }} addonAfter="元" />
                </Form.Item>
              </Col>
              <Col xs={24} md={6}>
                <Form.Item name={['monthlyRewards', 'growthBonusProfitRate']} label={<FieldLabel label="增长档加奖比例" help={FIELD_HELP.growthBonusProfitRate} />} rules={rateRules}>
                  <PercentInput min={0} max={100} precision={2} step={0.1} style={{ width: '100%' }} />
                </Form.Item>
              </Col>
              <Col xs={24} md={6}>
                <Form.Item name={['monthlyRewards', 'excellentTierGmv']} label={<FieldLabel label="卓越档销售额门槛" help={FIELD_HELP.excellentTierGmv} />} rules={amountRules}>
                  <InputNumber min={0} precision={2} style={{ width: '100%' }} addonAfter="元" />
                </Form.Item>
              </Col>
              <Col xs={24} md={6}>
                <Form.Item name={['monthlyRewards', 'cultivationBonusProfitRate']} label={<FieldLabel label="卓越档辅导奖比例" help={FIELD_HELP.cultivationBonusProfitRate} />} rules={rateRules}>
                  <PercentInput min={0} max={100} precision={2} step={0.1} style={{ width: '100%' }} />
                </Form.Item>
              </Col>
              <Col xs={24} md={6}>
                <Form.Item name={['monthlyRewards', 'performanceBonusProfitRate']} label={<FieldLabel label="经营绩效奖比例" help={FIELD_HELP.performanceBonusProfitRate} />} rules={rateRules}>
                  <PercentInput min={0} max={100} precision={2} step={0.1} style={{ width: '100%' }} />
                </Form.Item>
              </Col>
            </Row>

            <SectionTitle>平台利润底线与税务</SectionTitle>
            <Row gutter={16}>
              <Col xs={24} md={6}>
                <Form.Item name={['caps', 'maxTotalIncentiveProfitRate']} label={<FieldLabel label="团长奖励合计上限" help={FIELD_HELP.maxTotalIncentiveProfitRate} />} rules={rateRules}>
                  <PercentInput min={0} max={100} precision={2} step={0.1} style={{ width: '100%' }} />
                </Form.Item>
              </Col>
              <Col xs={24} md={6}>
                <Form.Item name={['unitEconomics', 'fulfillmentCostRate']} label={<FieldLabel label="预计履约成本比例" help={FIELD_HELP.fulfillmentCostRate} />} rules={rateRules}>
                  <PercentInput min={0} max={100} precision={2} step={0.1} style={{ width: '100%' }} />
                </Form.Item>
              </Col>
              <Col xs={24} md={6}>
                <Form.Item name={['caps', 'targetNetProfitRate']} label={<FieldLabel label="目标净利率" help={FIELD_HELP.targetNetProfitRate} />} rules={rateRules}>
                  <PercentInput min={0} max={100} precision={2} step={0.1} style={{ width: '100%' }} />
                </Form.Item>
              </Col>
              <Col xs={24} md={6}>
                <Form.Item name={['caps', 'coldChainRiskReserveRate']} label={<FieldLabel label="冷链和售后预留比例" help={FIELD_HELP.coldChainRiskReserveRate} />} rules={rateRules}>
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
                <Form.Item name={['risk', 'maxMonthlyRefundRate']} label={<FieldLabel label="月退款率警戒线" help={FIELD_HELP.maxMonthlyRefundRate} />} rules={rateRules}>
                  <PercentInput min={0} max={100} precision={2} step={1} style={{ width: '100%' }} />
                </Form.Item>
              </Col>
              <Col xs={24} md={6}>
                <Form.Item name={['risk', 'holdSettlementOnRisk']} label={<FieldLabel label="超出警戒线时暂停月度奖励" help={FIELD_HELP.holdSettlementOnRisk} />} valuePropName="checked">
                  <Switch />
                </Form.Item>
              </Col>
            </Row>

            <Divider style={{ margin: '8px 0 16px' }} />
            <Row justify="end">
              <Col flex="none">
                <PermissionGate permission={PERMISSIONS.CAPTAIN_SETTINGS}>
                  <Button
                    type="primary"
                    size="large"
                    icon={<SaveOutlined />}
                    loading={checking || mutation.isPending}
                    onClick={handleSubmit}
                  >
                    保存配置
                  </Button>
                </PermissionGate>
              </Col>
            </Row>
          </Form>
        </Space>
      </Card>
    </div>
  );
}
