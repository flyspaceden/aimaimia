import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { InputNumberProps } from 'antd';
import {
  Alert,
  App,
  Button,
  Card,
  Col,
  Divider,
  Form,
  Input,
  InputNumber,
  Row,
  Select,
  Space,
  Switch,
  Typography,
} from 'antd';
import { SaveOutlined, SettingOutlined } from '@ant-design/icons';
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
    maxSameDeviceEffectiveBuyers: 3,
    maxSameAddressEffectiveBuyers: 5,
    holdSettlementOnRisk: true,
  },
};

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
      maxSameDeviceEffectiveBuyers: toNumber(values.risk?.maxSameDeviceEffectiveBuyers, 3),
      maxSameAddressEffectiveBuyers: toNumber(values.risk?.maxSameAddressEffectiveBuyers, 5),
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
              <Col xs={24} md={6}>
                <Form.Item name="enabled" label="启用团长激励" valuePropName="checked">
                  <Switch checkedChildren="启用" unCheckedChildren="关闭" />
                </Form.Item>
              </Col>
              <Col xs={24} md={6}>
                <Form.Item name="programCode" label="项目代码">
                  <Input disabled />
                </Form.Item>
              </Col>
              <Col xs={24} md={6}>
                <Form.Item name="programName" label="项目名称" rules={[{ required: true, message: '请输入项目名称' }]}>
                  <Input />
                </Form.Item>
              </Col>
              <Col xs={24} md={6}>
                <Form.Item name="effectiveFrom" label="生效时间">
                  <Input allowClear placeholder="留空立即生效" />
                </Form.Item>
              </Col>
            </Row>

            <SectionTitle>适用范围</SectionTitle>
            <Row gutter={16}>
              <Col xs={24} md={12}>
                <Form.Item name={['scope', 'categoryIds']} label="适用类目 ID">
                  <Select mode="tags" tokenSeparators={[',', '，', ' ']} placeholder="输入类目 ID 后回车" />
                </Form.Item>
              </Col>
              <Col xs={24} md={12}>
                <Form.Item name={['scope', 'productIds']} label="适用商品 ID">
                  <Select mode="tags" tokenSeparators={[',', '，', ' ']} placeholder="输入商品 ID 后回车" />
                </Form.Item>
              </Col>
              <Col xs={24} md={12}>
                <Form.Item name={['scope', 'companyIds']} label="适用商户 ID">
                  <Select mode="tags" tokenSeparators={[',', '，', ' ']} placeholder="输入商户 ID 后回车" />
                </Form.Item>
              </Col>
              <Col xs={24} md={12}>
                <Form.Item name={['scope', 'excludedProductIds']} label="排除商品 ID">
                  <Select mode="tags" tokenSeparators={[',', '，', ' ']} placeholder="输入排除商品 ID 后回车" />
                </Form.Item>
              </Col>
              <Col xs={24} md={8}>
                <Form.Item name={['scope', 'includeVipPackage']} label="包含 VIP 礼包" valuePropName="checked">
                  <Switch disabled />
                </Form.Item>
              </Col>
              <Col xs={24} md={8}>
                <Form.Item name={['scope', 'includeGroupBuy']} label="包含团购" valuePropName="checked">
                  <Switch disabled />
                </Form.Item>
              </Col>
              <Col xs={24} md={8}>
                <Form.Item name={['scope', 'includePrize']} label="包含奖品" valuePropName="checked">
                  <Switch disabled />
                </Form.Item>
              </Col>
            </Row>

            <SectionTitle>逐单佣金</SectionTitle>
            <Row gutter={16}>
              <Col xs={24} md={6}>
                <Form.Item name={['perOrderCommission', 'directRate']} label="直接推广成交佣金率" rules={rateRules}>
                  <PercentInput min={0} max={100} precision={2} step={0.1} style={{ width: '100%' }} />
                </Form.Item>
              </Col>
              <Col xs={24} md={6}>
                <Form.Item name={['orderRules', 'freezeDaysAfterReceived']} label="确认收货后冻结天数" rules={[{ required: true }]}>
                  <InputNumber min={0} max={365} precision={0} style={{ width: '100%' }} addonAfter="天" />
                </Form.Item>
              </Col>
              <Col xs={24} md={6}>
                <Form.Item name={['orderRules', 'minCommissionBase']} label="最低计佣商品实付" rules={amountRules}>
                  <InputNumber min={0} precision={2} style={{ width: '100%' }} addonAfter="元" />
                </Form.Item>
              </Col>
              <Col xs={24} md={6}>
                <Form.Item name={['orderRules', 'includeShippingFee']} label="运费计佣" valuePropName="checked">
                  <Switch disabled />
                </Form.Item>
              </Col>
              <Col xs={24} md={6}>
                <Form.Item name={['orderRules', 'includeCouponDiscount']} label="红包抵扣计佣" valuePropName="checked">
                  <Switch disabled />
                </Form.Item>
              </Col>
              <Col xs={24} md={6}>
                <Form.Item name={['orderRules', 'includeRewardDeduction']} label="消费积分抵扣计佣" valuePropName="checked">
                  <Switch disabled />
                </Form.Item>
              </Col>
            </Row>

            <SectionTitle>团长资格</SectionTitle>
            <Row gutter={16}>
              <Col xs={24} md={6}>
                <Form.Item name={['monthlyQualification', 'minDirectEffectiveBuyers']} label="有效直接成交客户" rules={[{ required: true }]}>
                  <InputNumber min={0} precision={0} style={{ width: '100%' }} addonAfter="人" />
                </Form.Item>
              </Col>
              <Col xs={24} md={6}>
                <Form.Item name={['monthlyQualification', 'minDirectMonthlyGmv']} label="资格线直接客户 GMV" rules={amountRules}>
                  <InputNumber min={0} precision={2} style={{ width: '100%' }} addonAfter="元" />
                </Form.Item>
              </Col>
              <Col xs={24} md={6}>
                <Form.Item name={['monthlyQualification', 'minNewEffectiveBuyers']} label="新增有效直接客户" rules={[{ required: true }]}>
                  <InputNumber min={0} precision={0} style={{ width: '100%' }} addonAfter="人" />
                </Form.Item>
              </Col>
            </Row>

            <SectionTitle>月度激励</SectionTitle>
            <Row gutter={16}>
              <Col xs={24} md={6}>
                <Form.Item name={['monthlyRewards', 'baseTierGmv']} label="基础档 GMV" rules={amountRules}>
                  <InputNumber min={0} precision={2} style={{ width: '100%' }} addonAfter="元" />
                </Form.Item>
              </Col>
              <Col xs={24} md={6}>
                <Form.Item name={['monthlyRewards', 'baseManagementRate']} label="管理津贴率" rules={rateRules}>
                  <PercentInput min={0} max={100} precision={2} step={0.1} style={{ width: '100%' }} />
                </Form.Item>
              </Col>
              <Col xs={24} md={6}>
                <Form.Item name={['monthlyRewards', 'growthTierGmv']} label="增长档 GMV" rules={amountRules}>
                  <InputNumber min={0} precision={2} style={{ width: '100%' }} addonAfter="元" />
                </Form.Item>
              </Col>
              <Col xs={24} md={6}>
                <Form.Item name={['monthlyRewards', 'growthBonusRate']} label="增长奖率" rules={rateRules}>
                  <PercentInput min={0} max={100} precision={2} step={0.1} style={{ width: '100%' }} />
                </Form.Item>
              </Col>
              <Col xs={24} md={6}>
                <Form.Item name={['monthlyRewards', 'excellentTierGmv']} label="卓越档 GMV" rules={amountRules}>
                  <InputNumber min={0} precision={2} style={{ width: '100%' }} addonAfter="元" />
                </Form.Item>
              </Col>
              <Col xs={24} md={6}>
                <Form.Item name={['monthlyRewards', 'cultivationBonusRate']} label="有效成交辅导奖率" rules={rateRules}>
                  <PercentInput min={0} max={100} precision={2} step={0.1} style={{ width: '100%' }} />
                </Form.Item>
              </Col>
              <Col xs={24} md={6}>
                <Form.Item name={['monthlyRewards', 'performanceBonusRate']} label="经营绩效奖率" rules={rateRules}>
                  <PercentInput min={0} max={100} precision={2} step={0.1} style={{ width: '100%' }} />
                </Form.Item>
              </Col>
            </Row>

            <SectionTitle>利润封顶与税务</SectionTitle>
            <Row gutter={16}>
              <Col xs={24} md={6}>
                <Form.Item name={['caps', 'maxTotalIncentiveRate']} label="总激励率封顶" rules={rateRules}>
                  <PercentInput min={0} max={15.5} precision={2} step={0.1} style={{ width: '100%' }} />
                </Form.Item>
              </Col>
              <Col xs={24} md={6}>
                <Form.Item name={['caps', 'targetNetProfitRate']} label="目标净利率" rules={rateRules}>
                  <PercentInput min={0} max={100} precision={2} step={0.1} style={{ width: '100%' }} />
                </Form.Item>
              </Col>
              <Col xs={24} md={6}>
                <Form.Item name={['caps', 'coldChainRiskReserveRate']} label="冷链售后预留率" rules={rateRules}>
                  <PercentInput min={0} max={100} precision={2} step={0.1} style={{ width: '100%' }} />
                </Form.Item>
              </Col>
              <Col xs={24} md={6}>
                <Form.Item name={['tax', 'enabled']} label="代扣劳务个税" valuePropName="checked">
                  <Switch />
                </Form.Item>
              </Col>
              <Col xs={24} md={6}>
                <Form.Item name={['tax', 'withholdingRate']} label="代扣税率" rules={rateRules}>
                  <PercentInput min={0} max={100} precision={2} step={1} style={{ width: '100%' }} />
                </Form.Item>
              </Col>
              <Col xs={24} md={6}>
                <Form.Item name={['tax', 'incomeType']} label="收入类型">
                  <Input disabled />
                </Form.Item>
              </Col>
            </Row>

            <SectionTitle>风控</SectionTitle>
            <Row gutter={16}>
              <Col xs={24} md={6}>
                <Form.Item name={['risk', 'maxMonthlyRefundRate']} label="月退款率冻结阈值" rules={rateRules}>
                  <PercentInput min={0} max={100} precision={2} step={1} style={{ width: '100%' }} />
                </Form.Item>
              </Col>
              <Col xs={24} md={6}>
                <Form.Item name={['risk', 'maxSameDeviceEffectiveBuyers']} label="同设备有效买家上限" rules={[{ required: true }]}>
                  <InputNumber min={0} precision={0} style={{ width: '100%' }} addonAfter="人" />
                </Form.Item>
              </Col>
              <Col xs={24} md={6}>
                <Form.Item name={['risk', 'maxSameAddressEffectiveBuyers']} label="同地址有效买家上限" rules={[{ required: true }]}>
                  <InputNumber min={0} precision={0} style={{ width: '100%' }} addonAfter="人" />
                </Form.Item>
              </Col>
              <Col xs={24} md={6}>
                <Form.Item name={['risk', 'holdSettlementOnRisk']} label="命中风控暂停结算" valuePropName="checked">
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
