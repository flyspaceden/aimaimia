import { useEffect, useRef, useState } from 'react';
import dayjs from 'dayjs';
import {
  ProForm,
  ProFormText,
  ProFormTextArea,
  ProFormDigit,
  ProFormSelect,
  ProFormDateTimePicker,
  ProFormSwitch,
  ProFormDependency,
  ProFormGroup,
} from '@ant-design/pro-components';
import type { ProFormInstance } from '@ant-design/pro-components';
import { Alert, App, Drawer, Card, Typography, Space, Button } from 'antd';
import {
  GiftOutlined,
  DollarOutlined,
  SettingOutlined,
  CalendarOutlined,
  SaveOutlined,
} from '@ant-design/icons';
import { createCampaign, updateCampaign } from '@/api/coupon';
import type { CouponCampaign, CouponTriggerType, CouponDistributionMode, CouponDiscountType } from '@/api/coupon';
import { getCategories } from '@/api/categories';
import type { AdminCategory } from '@/api/categories';
import { getCompanies } from '@/api/companies';

// 触发类型选项
const triggerTypeOptions = [
  { label: '新用户注册', value: 'REGISTER' },
  { label: '首次下单', value: 'FIRST_ORDER' },
  { label: '生日', value: 'BIRTHDAY' },
  { label: '邀请新用户', value: 'INVITE' },
  { label: '推荐码分享', value: 'SHARE' },
  { label: '累计消费', value: 'CUMULATIVE_SPEND' },
  { label: '久未下单唤醒', value: 'WIN_BACK' },
  { label: '节日活动', value: 'HOLIDAY' },
  { label: '限时抢', value: 'FLASH' },
  { label: '手动发放（积分兑换）', value: 'MANUAL' },
];

// 发放方式选项
const distributionModeOptions = [
  { label: '系统自动发放', value: 'AUTO' },
  { label: '用户主动领取', value: 'CLAIM' },
  { label: '管理员手动发放', value: 'MANUAL' },
];

// 抵扣类型选项
const discountTypeOptions = [
  { label: '固定金额（如减10元）', value: 'FIXED' },
  { label: '百分比折扣（如打9折）', value: 'PERCENT' },
];

const TRIGGER_DISTRIBUTION_MODE_MAP: Record<CouponTriggerType, CouponDistributionMode> = {
  REGISTER: 'AUTO',
  FIRST_ORDER: 'AUTO',
  BIRTHDAY: 'AUTO',
  CHECK_IN: 'AUTO',
  INVITE: 'AUTO',
  REVIEW: 'AUTO',
  SHARE: 'AUTO',
  CUMULATIVE_SPEND: 'AUTO',
  WIN_BACK: 'AUTO',
  HOLIDAY: 'CLAIM',
  FLASH: 'CLAIM',
  MANUAL: 'MANUAL',
};

const FLEXIBLE_DISTRIBUTION_TRIGGER_TYPES: CouponTriggerType[] = [
  'CUMULATIVE_SPEND',
  'WIN_BACK',
  'HOLIDAY',
  'FLASH',
];

const AUTO_TARGET_MODE_OPTIONS = [
  { label: '普通用户', value: 'NORMAL_USERS' },
  { label: 'VIP用户', value: 'VIP_USERS' },
  { label: '全部用户', value: 'ALL_USERS' },
];

const EVERGREEN_TRIGGER_TYPES: CouponTriggerType[] = [
  'REGISTER',
  'FIRST_ORDER',
  'BIRTHDAY',
  'INVITE',
  'SHARE',
  'CUMULATIVE_SPEND',
  'WIN_BACK',
  'MANUAL',
];

type SelectOption = { label: string; value: string };

const isDistributionModeFlexible = (triggerType?: CouponTriggerType) =>
  !!triggerType && FLEXIBLE_DISTRIBUTION_TRIGGER_TYPES.includes(triggerType);

const getDefaultDistributionMode = (triggerType?: CouponTriggerType): CouponDistributionMode => {
  if (!triggerType) return 'AUTO';
  return TRIGGER_DISTRIBUTION_MODE_MAP[triggerType] ?? 'AUTO';
};

const getDistributionModeOptions = (triggerType?: CouponTriggerType) => {
  if (isDistributionModeFlexible(triggerType)) {
    return distributionModeOptions.filter((option) => option.value === 'AUTO' || option.value === 'CLAIM');
  }
  const defaultMode = getDefaultDistributionMode(triggerType);
  return distributionModeOptions.filter((option) => option.value === defaultMode);
};

const buildCategoryOptions = (categories: AdminCategory[]): SelectOption[] =>
  categories
    .filter((category) => category.isActive)
    .sort((a, b) => {
      if (a.path !== b.path) return a.path.localeCompare(b.path, 'zh-CN');
      return a.sortOrder - b.sortOrder;
    })
    .map((category) => ({
      label: category.path.replace(/^\/+/, '') || category.name,
      value: category.id,
    }));

interface CampaignFormDrawerProps {
  open: boolean;
  campaign: CouponCampaign | null; // null 表示新建
  onClose: () => void;
  onSuccess: (campaign?: CouponCampaign) => void;
}

export default function CampaignFormDrawer({
  open,
  campaign,
  onClose,
  onSuccess,
}: CampaignFormDrawerProps) {
  const { message } = App.useApp();
  const isEdit = !!campaign;
  const formRef = useRef<ProFormInstance | undefined>(undefined);
  const [categoryOptions, setCategoryOptions] = useState<SelectOption[]>([]);
  const [companyOptions, setCompanyOptions] = useState<SelectOption[]>([]);
  const [categoryOptionsLoading, setCategoryOptionsLoading] = useState(false);
  const [companyOptionsLoading, setCompanyOptionsLoading] = useState(false);

  useEffect(() => {
    if (!open) return;

    let cancelled = false;
    setCategoryOptionsLoading(true);
    setCompanyOptionsLoading(true);

    getCategories()
      .then((categories) => {
        if (!cancelled) {
          setCategoryOptions(buildCategoryOptions(categories));
        }
      })
      .catch(() => {
        if (!cancelled) {
          setCategoryOptions([]);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setCategoryOptionsLoading(false);
        }
      });

    getCompanies({ pageSize: 200, status: 'ACTIVE' })
      .then((res) => {
        if (!cancelled) {
          setCompanyOptions(
            res.items.map((company) => ({
              label: company.shortName || company.name,
              value: company.id,
            })),
          );
        }
      })
      .catch(() => {
        if (!cancelled) {
          setCompanyOptions([]);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setCompanyOptionsLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [open]);

  // 构建初始值
  const getInitialValues = () =>
    campaign
      ? {
          name: campaign.name,
          description: campaign.description,
          triggerType: campaign.triggerType,
          distributionMode: campaign.distributionMode,
          discountType: campaign.discountType,
          discountValue: campaign.discountValue,
          maxDiscountAmount: campaign.maxDiscountAmount,
          minOrderAmount: campaign.minOrderAmount,
          applicableCategories: campaign.applicableCategories,
          applicableCompanyIds: campaign.applicableCompanyIds,
          stackable: campaign.stackable,
          stackGroup: campaign.stackGroup,
          totalQuota: campaign.totalQuota,
          maxPerUser: campaign.maxPerUser,
          growthExchangeEnabled: campaign.growthExchangeEnabled,
          validDays: campaign.validDays,
          startAt: campaign.startAt ? dayjs(campaign.startAt) : undefined,
          endAt: campaign.endAt ? dayjs(campaign.endAt) : undefined,
          noEndAt: !campaign.endAt,
          triggerConfig_requiredDays:
            (campaign.triggerConfig as Record<string, unknown>)?.requiredDays ??
            (campaign.triggerConfig as Record<string, unknown>)?.checkInDays,
          triggerConfig_spendThreshold: (campaign.triggerConfig as Record<string, unknown>)
            ?.spendThreshold,
          triggerConfig_inactiveDays: (campaign.triggerConfig as Record<string, unknown>)
            ?.inactiveDays,
          triggerConfig_autoTargetMode: (campaign.triggerConfig as Record<string, unknown>)
            ?.autoTargetMode,
        }
      : {
          distributionMode: 'AUTO',
          discountType: 'FIXED',
          minOrderAmount: 0,
          stackable: false,
          maxPerUser: 1,
          growthExchangeEnabled: false,
          validDays: 7,
          totalQuota: 100,
          noEndAt: false,
        };

  /** 提交逻辑 */
  const handleFinish = async (values: Record<string, unknown>) => {
    try {
      // 构建触发配置
      const triggerConfig: Record<string, unknown> = {};
      if (values.triggerType === 'CUMULATIVE_SPEND' && values.triggerConfig_spendThreshold) {
        triggerConfig.spendThreshold = values.triggerConfig_spendThreshold;
      }
      if (values.triggerType === 'WIN_BACK' && values.triggerConfig_inactiveDays) {
        triggerConfig.inactiveDays = values.triggerConfig_inactiveDays;
      }

      if (values.noEndAt && Number(values.validDays ?? 0) <= 0) {
        message.error('长期活动必须设置领取后有效天数');
        return false;
      }

      const triggerType = values.triggerType as CouponTriggerType;
      const isManualTrigger = triggerType === 'MANUAL';
      const selectedDistributionMode = (
        isDistributionModeFlexible(triggerType)
          ? values.distributionMode
          : getDefaultDistributionMode(triggerType)
      ) as CouponDistributionMode;
      if (
        selectedDistributionMode === 'AUTO' &&
        (triggerType === 'HOLIDAY' || triggerType === 'FLASH') &&
        values.triggerConfig_autoTargetMode
      ) {
        triggerConfig.autoTargetMode = values.triggerConfig_autoTargetMode;
      }
      if (isManualTrigger && Number(values.validDays ?? 0) <= 0) {
        message.error('手动发放红包必须设置领取后有效天数');
        return false;
      }

      const payload = {
        name: values.name as string,
        description: values.description as string | undefined,
        triggerType,
        distributionMode: selectedDistributionMode,
        triggerConfig: Object.keys(triggerConfig).length > 0 ? triggerConfig : undefined,
        discountType: values.discountType as CouponDiscountType,
        discountValue: values.discountValue as number,
        maxDiscountAmount: values.maxDiscountAmount as number | undefined,
        minOrderAmount: (values.minOrderAmount as number) || 0,
        applicableCategories: (values.applicableCategories as string[]) || [],
        applicableCompanyIds: (values.applicableCompanyIds as string[]) || [],
        stackable: (values.stackable as boolean) ?? false,
        stackGroup: values.stackGroup as string | undefined,
        totalQuota: values.totalQuota as number,
        maxPerUser: (values.maxPerUser as number) || 1,
        growthExchangeEnabled: isManualTrigger ? Boolean(values.growthExchangeEnabled) : false,
        validDays: Number(values.validDays ?? 7),
        startAt: isManualTrigger
          ? dayjs().toISOString()
          : dayjs(values.startAt as string | number | Date | dayjs.Dayjs).toISOString(),
        endAt: isManualTrigger
          ? null
          : values.noEndAt
          ? null
          : dayjs(values.endAt as string | number | Date | dayjs.Dayjs).toISOString(),
      };

      let savedCampaign: CouponCampaign;
      if (isEdit) {
        savedCampaign = await updateCampaign(campaign!.id, payload);
        message.success('活动更新成功');
      } else {
        savedCampaign = await createCampaign(payload);
        message.success('活动创建成功');
      }
      onSuccess(savedCampaign);
      onClose();
    } catch (err) {
      message.error(err instanceof Error ? err.message : '操作失败');
    }
  };

  /** 分区标题 */
  const SectionTitle = ({ icon, title }: { icon: React.ReactNode; title: string }) => (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
      <span style={{ color: '#1E40AF', fontSize: 16 }}>{icon}</span>
      <Typography.Text strong style={{ fontSize: 15 }}>{title}</Typography.Text>
    </div>
  );

  return (
    <Drawer
      title={isEdit ? '编辑红包活动' : '新建红包活动'}
      open={open}
      onClose={onClose}
      width="75vw"
      destroyOnClose
      extra={
        <Space>
          <Button onClick={onClose}>取消</Button>
          <Button
            type="primary"
            icon={<SaveOutlined />}
            onClick={() => formRef.current?.submit()}
          >
            {isEdit ? '保存修改' : '创建活动'}
          </Button>
        </Space>
      }
    >
      <ProForm
        formRef={formRef}
        onFinish={handleFinish}
        initialValues={getInitialValues()}
        submitter={false}
        layout="vertical"
      >
        {/* ===== 基本信息 ===== */}
        <Card
          size="small"
          title={<SectionTitle icon={<GiftOutlined />} title="基本信息" />}
          style={{ marginBottom: 16 }}
        >
          <ProFormText
            name="name"
            label="活动名称"
            placeholder="如：2026春节红包"
            rules={[{ required: true, message: '请输入活动名称' }]}
          />
          <ProFormTextArea
            name="description"
            label="活动描述"
            placeholder="活动描述（选填）"
            fieldProps={{ rows: 2 }}
          />
          <ProFormGroup>
            <ProFormSelect
              name="triggerType"
              label="触发类型"
              width="md"
              options={triggerTypeOptions}
              rules={[{ required: true, message: '请选择触发类型' }]}
              placeholder="选择触发条件类型"
              fieldProps={{
                onChange: (value) => {
                  const triggerType = value as CouponTriggerType;
                  const nextDistributionMode = getDefaultDistributionMode(triggerType);
                  formRef.current?.setFieldsValue({
                    distributionMode: nextDistributionMode,
                    growthExchangeEnabled: triggerType === 'MANUAL'
                      ? formRef.current?.getFieldValue('growthExchangeEnabled')
                      : false,
                    triggerConfig_autoTargetMode: undefined,
                    ...(!EVERGREEN_TRIGGER_TYPES.includes(triggerType) ? { noEndAt: false } : {}),
                  });
                },
              }}
            />
            <ProFormDependency name={['triggerType']}>
              {({ triggerType }) => {
                const currentTriggerType = triggerType as CouponTriggerType | undefined;
                const isDistributionModeFlexible = !!currentTriggerType &&
                  FLEXIBLE_DISTRIBUTION_TRIGGER_TYPES.includes(currentTriggerType);
                return (
                  <ProFormSelect
                    name="distributionMode"
                    label="发放方式"
                    width="md"
                    fieldProps={{ disabled: !isDistributionModeFlexible }}
                    options={getDistributionModeOptions(currentTriggerType)}
                    rules={[{ required: true, message: '请选择发放方式' }]}
                  />
                );
              }}
            </ProFormDependency>
          </ProFormGroup>

          {/* 根据触发类型动态显示额外配置 */}
          <ProFormDependency name={['triggerType', 'distributionMode']}>
            {({ triggerType, distributionMode }) => {
              if (triggerType === 'CUMULATIVE_SPEND') {
                return (
                  <ProFormDigit
                    name="triggerConfig_spendThreshold"
                    label="累计消费阈值（元）"
                    width="md"
                    min={0.01}
                    fieldProps={{ precision: 2, step: 10 }}
                    placeholder="累计消费达到此金额后发放"
                    extra="用户累计消费达到该金额后自动发放红包"
                    rules={[{ required: true, message: '请输入累计消费门槛' }]}
                  />
                );
              }
              if (triggerType === 'WIN_BACK') {
                return (
                  <ProFormDigit
                    name="triggerConfig_inactiveDays"
                    label="未下单天数"
                    width="md"
                    min={1}
                    fieldProps={{ precision: 0 }}
                    placeholder="用户超过此天数未下单后发放"
                    extra="用户最近一次下单距今超过该天数后自动发放红包"
                    rules={[{ required: true, message: '请输入未下单天数' }]}
                  />
                );
              }
              if (triggerType === 'MANUAL') {
                return (
                  <Space direction="vertical" size={12} style={{ width: '100%', marginTop: 8 }}>
                    <Alert
                      type="info"
                      showIcon
                      message="手动发放对象"
                      description="普通手动红包上架后会打开手动发放窗口，可搜索选择指定买家、普通用户、VIP用户或全部用户；勾选“积分兑换专用”后不会走普通手动发放入口，只作为积分成长兑换红包池。"
                    />
                    <ProFormSwitch
                      name="growthExchangeEnabled"
                      label="积分兑换专用"
                      extra="仅用于积分成长兑换。勾选后，该红包活动不会走普通手动发放入口，只能作为积分兑换专用红包池。"
                    />
                  </Space>
                );
              }
              if (triggerType === 'HOLIDAY') {
                return (
                  <Space direction="vertical" size={8} style={{ width: '100%', marginTop: 8 }}>
                    {distributionMode === 'AUTO' && (
                      <ProFormSelect
                        name="triggerConfig_autoTargetMode"
                        label="自动发放对象"
                        width="md"
                        options={AUTO_TARGET_MODE_OPTIONS}
                        rules={[{ required: true, message: '请选择自动发放对象' }]}
                      />
                    )}
                    <Alert
                      type="info"
                      showIcon
                      message="节日活动"
                      description="节日活动适合固定节日或营销周期，例如春节、中秋、周年庆；可选择用户主动领取，也可选择系统按普通用户、VIP用户或全部用户自动发放。"
                    />
                  </Space>
                );
              }
              if (triggerType === 'FLASH') {
                return (
                  <Space direction="vertical" size={8} style={{ width: '100%', marginTop: 8 }}>
                    {distributionMode === 'AUTO' && (
                      <ProFormSelect
                        name="triggerConfig_autoTargetMode"
                        label="自动发放对象"
                        width="md"
                        options={AUTO_TARGET_MODE_OPTIONS}
                        rules={[{ required: true, message: '请选择自动发放对象' }]}
                      />
                    )}
                    <Alert
                      type="warning"
                      showIcon
                      message="限时抢"
                      description="限时抢适合短时间、强库存或强名额约束，例如 2 小时限量领取；可选择用户主动抢领，也可选择系统按普通用户、VIP用户或全部用户自动发放。"
                    />
                  </Space>
                );
              }
              return null;
            }}
          </ProFormDependency>
        </Card>

        {/* ===== 抵扣规则 ===== */}
        <Card
          size="small"
          title={<SectionTitle icon={<DollarOutlined />} title="抵扣规则" />}
          style={{ marginBottom: 16 }}
        >
          <ProFormGroup>
            <ProFormSelect
              name="discountType"
              label="抵扣类型"
              width="md"
              options={discountTypeOptions}
              rules={[{ required: true, message: '请选择抵扣类型' }]}
              fieldProps={{
                onChange: (value) => {
                  if (value !== 'FIXED') return;
                  const discountValue = Number(formRef.current?.getFieldValue('discountValue') ?? 0);
                  const minOrderAmount = Number(formRef.current?.getFieldValue('minOrderAmount') ?? 0);
                  if (discountValue > 0 && minOrderAmount < discountValue) {
                    formRef.current?.setFieldValue('minOrderAmount', discountValue);
                  }
                },
              }}
            />
            <ProFormDependency name={['discountType']}>
              {({ discountType }) => (
                <ProFormDigit
                  name="discountValue"
                  label={discountType === 'PERCENT' ? '折扣比例（%）' : '抵扣金额（元）'}
                  width="md"
                  min={0}
                  max={discountType === 'PERCENT' ? 100 : undefined}
                  fieldProps={{
                    precision: 2,
                    step: discountType === 'PERCENT' ? 1 : 0.5,
                    onChange: (value) => {
                      if (discountType !== 'FIXED') return;
                      const nextDiscountValue = Number(value ?? 0);
                      const minOrderAmount = Number(formRef.current?.getFieldValue('minOrderAmount') ?? 0);
                      if (nextDiscountValue > 0 && minOrderAmount < nextDiscountValue) {
                        formRef.current?.setFieldValue('minOrderAmount', nextDiscountValue);
                      }
                    },
                  }}
                  rules={[{ required: true, message: '请输入抵扣值' }]}
                  extra={
                    discountType === 'PERCENT'
                      ? '范围 0-100，如填 10 表示打九折'
                      : '固定抵扣金额（元）'
                  }
                />
              )}
            </ProFormDependency>
          </ProFormGroup>
          <ProFormGroup>
            <ProFormDependency name={['discountType']}>
              {({ discountType }) =>
                discountType === 'PERCENT' ? (
                  <ProFormDigit
                    name="maxDiscountAmount"
                    label="最高抵扣金额（元）"
                    width="md"
                    min={0}
                    fieldProps={{ precision: 2 }}
                    extra="百分比折扣时的最高抵扣限额（选填）"
                  />
                ) : null
              }
            </ProFormDependency>
            <ProFormDependency name={['discountType', 'discountValue']}>
              {({ discountType, discountValue }) => (
                <ProFormDigit
                  name="minOrderAmount"
                  label="最低消费门槛（元）"
                  width="md"
                  min={discountType === 'FIXED' && discountValue ? Number(discountValue) : 0}
                  fieldProps={{
                    precision: 2,
                    step: 10,
                    disabled: discountType === 'FIXED' && !discountValue,
                  }}
                  rules={[
                    {
                      validator(_: unknown, value: unknown) {
                        const currentDiscountType = formRef.current?.getFieldValue('discountType');
                        const currentDiscountValue = Number(
                          formRef.current?.getFieldValue('discountValue') ?? 0,
                        );
                        const currentMinOrderAmount = Number(value ?? 0);
                        if (
                          currentDiscountType === 'FIXED' &&
                          currentDiscountValue > 0 &&
                          currentMinOrderAmount < currentDiscountValue
                        ) {
                          return Promise.reject(new Error('最低消费门槛不能低于抵扣金额'));
                        }
                        return Promise.resolve();
                      },
                    },
                  ]}
                  extra={
                    discountType === 'FIXED'
                      ? '先填写抵扣金额，再设置最低消费门槛；固定金额红包门槛不能低于抵扣金额'
                      : '0 表示无门槛'
                  }
                />
              )}
            </ProFormDependency>
          </ProFormGroup>
        </Card>

        {/* ===== 发放限制 ===== */}
        <Card
          size="small"
          title={<SectionTitle icon={<SettingOutlined />} title="发放限制" />}
          style={{ marginBottom: 16 }}
        >
          <ProFormGroup>
            <ProFormDigit
              name="totalQuota"
              label="总发放量"
              width="sm"
              min={1}
              fieldProps={{ precision: 0 }}
              rules={[{ required: true, message: '请输入总发放量' }]}
            />
            <ProFormDigit
              name="maxPerUser"
              label="每人限领"
              width="sm"
              min={1}
              fieldProps={{ precision: 0 }}
            />
            <ProFormDigit
              name="validDays"
              label="有效天数"
              width="sm"
              min={0}
              fieldProps={{ precision: 0 }}
              extra="0 = 跟随活动结束；不限结束时间时必须大于 0"
            />
          </ProFormGroup>

          <ProFormGroup>
            <ProFormSwitch
              name="stackable"
              label="允许叠加"
              extra="开启后同组红包可叠加使用"
            />
            <ProFormDependency name={['stackable']}>
              {({ stackable }) =>
                stackable ? (
                  <ProFormText
                    name="stackGroup"
                    label="叠加分组标识"
                    width="md"
                    placeholder="如：spring2026"
                    extra="相同分组标识的红包可叠加（选填）"
                  />
                ) : null
              }
            </ProFormDependency>
          </ProFormGroup>

          <ProFormGroup>
            <ProFormSelect
              name="applicableCategories"
              label="限定品类"
              width="md"
              mode="multiple"
              options={categoryOptions}
              placeholder="不选则不限品类"
              extra="选择后仅商品自身品类 ID 命中时可用；不选则不限品类"
              fieldProps={{
                loading: categoryOptionsLoading,
                showSearch: true,
                optionFilterProp: 'label',
              }}
            />
            <ProFormSelect
              name="applicableCompanyIds"
              label="限定店铺"
              width="md"
              mode="multiple"
              options={companyOptions}
              placeholder="不选则不限店铺"
              extra="选择后仅这些店铺的商品订单可用；不选则不限店铺"
              fieldProps={{
                loading: companyOptionsLoading,
                showSearch: true,
                optionFilterProp: 'label',
              }}
            />
          </ProFormGroup>
        </Card>

        {/* ===== 活动时间 ===== */}
        <ProFormDependency name={['triggerType', 'noEndAt']}>
          {({ triggerType, noEndAt }) => {
            if (triggerType === 'MANUAL') {
              return (
                <Card
                  size="small"
                  title={<SectionTitle icon={<CalendarOutlined />} title="发放时间" />}
                >
                  <Alert
                    type="info"
                    showIcon
                    message="手动发放无需配置活动开始或截止时间"
                    description="普通手动红包的发放时间在上架后的手动发放窗口中选择；积分兑换专用池由用户兑换成功时发放。单张红包仍按“有效天数”过期。"
                  />
                </Card>
              );
            }

            const canNoEndAt = EVERGREEN_TRIGGER_TYPES.includes(triggerType as CouponTriggerType);
            return (
              <Card
                size="small"
                title={<SectionTitle icon={<CalendarOutlined />} title="活动时间" />}
              >
                <ProFormGroup>
                  {triggerType !== 'MANUAL' && (
                    <ProFormDateTimePicker
                      name="startAt"
                      label="开始时间"
                      width="md"
                      rules={[{ required: true, message: '请选择开始时间' }]}
                      fieldProps={{ style: { width: '100%' } }}
                    />
                  )}
                </ProFormGroup>
                {canNoEndAt && (
                  <ProFormSwitch
                    name="noEndAt"
                    label="不限结束时间"
                    extra="适用于注册、首单、生日、分享、累计消费和久未下单唤醒等长期规则"
                  />
                )}
                {!noEndAt ? (
                  <ProFormDateTimePicker
                    name="endAt"
                    label="结束时间"
                    width="md"
                    dependencies={['startAt']}
                    rules={[
                      { required: true, message: '请选择结束时间' },
                      ({ getFieldValue }) => ({
                        validator(_, value) {
                          const startAt = getFieldValue('startAt');
                          if (!value || !startAt) return Promise.resolve();
                          if (dayjs(value).isAfter(dayjs(startAt))) return Promise.resolve();
                          return Promise.reject(new Error('结束时间必须晚于开始时间'));
                        },
                      }),
                    ]}
                    fieldProps={{ style: { width: '100%' } }}
                  />
                ) : (
                  <Typography.Text type="secondary">
                    长期有效；单张红包仍按“有效天数”过期。
                  </Typography.Text>
                )}
              </Card>
            );
          }}
        </ProFormDependency>
      </ProForm>
    </Drawer>
  );
}
