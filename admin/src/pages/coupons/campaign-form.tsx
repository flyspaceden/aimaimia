import { useRef } from 'react';
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
import { Drawer, message, Card, Typography, Space, Button } from 'antd';
import {
  GiftOutlined,
  DollarOutlined,
  SettingOutlined,
  CalendarOutlined,
  SaveOutlined,
} from '@ant-design/icons';
import { createCampaign, updateCampaign } from '@/api/coupon';
import type { CouponCampaign, CouponTriggerType, CouponDistributionMode, CouponDiscountType } from '@/api/coupon';

// 触发类型选项
const triggerTypeOptions = [
  { label: '新用户注册', value: 'REGISTER' },
  { label: '首次下单', value: 'FIRST_ORDER' },
  { label: '生日', value: 'BIRTHDAY' },
  { label: '签到', value: 'CHECK_IN' },
  { label: '邀请新用户', value: 'INVITE' },
  { label: '好评', value: 'REVIEW' },
  { label: '分享', value: 'SHARE' },
  { label: '累计消费', value: 'CUMULATIVE_SPEND' },
  { label: '复购激励', value: 'WIN_BACK' },
  { label: '节日活动', value: 'HOLIDAY' },
  { label: '限时抢', value: 'FLASH' },
  { label: '手动发放', value: 'MANUAL' },
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

interface CampaignFormDrawerProps {
  open: boolean;
  campaign: CouponCampaign | null; // null 表示新建
  onClose: () => void;
  onSuccess: () => void;
}

export default function CampaignFormDrawer({
  open,
  campaign,
  onClose,
  onSuccess,
}: CampaignFormDrawerProps) {
  const isEdit = !!campaign;
  const formRef = useRef<ProFormInstance | undefined>(undefined);

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
          validDays: campaign.validDays,
          startAt: campaign.startAt,
          endAt: campaign.endAt,
          triggerConfig_requiredDays:
            (campaign.triggerConfig as Record<string, unknown>)?.requiredDays ??
            (campaign.triggerConfig as Record<string, unknown>)?.checkInDays,
          triggerConfig_spendThreshold: (campaign.triggerConfig as Record<string, unknown>)
            ?.spendThreshold,
          triggerConfig_inactiveDays: (campaign.triggerConfig as Record<string, unknown>)
            ?.inactiveDays,
        }
      : {
          distributionMode: 'AUTO',
          discountType: 'FIXED',
          minOrderAmount: 0,
          stackable: true,
          maxPerUser: 1,
          validDays: 7,
          totalQuota: 100,
        };

  /** 提交逻辑 */
  const handleFinish = async (values: Record<string, unknown>) => {
    try {
      // 构建触发配置
      const triggerConfig: Record<string, unknown> = {};
      if (values.triggerType === 'CHECK_IN' && values.triggerConfig_requiredDays) {
        triggerConfig.requiredDays = values.triggerConfig_requiredDays;
      }
      if (values.triggerType === 'CUMULATIVE_SPEND' && values.triggerConfig_spendThreshold) {
        triggerConfig.spendThreshold = values.triggerConfig_spendThreshold;
      }
      if (values.triggerType === 'WIN_BACK' && values.triggerConfig_inactiveDays) {
        triggerConfig.inactiveDays = values.triggerConfig_inactiveDays;
      }

      const payload = {
        name: values.name as string,
        description: values.description as string | undefined,
        triggerType: values.triggerType as CouponTriggerType,
        distributionMode: values.distributionMode as CouponDistributionMode,
        triggerConfig: Object.keys(triggerConfig).length > 0 ? triggerConfig : undefined,
        discountType: values.discountType as CouponDiscountType,
        discountValue: values.discountValue as number,
        maxDiscountAmount: values.maxDiscountAmount as number | undefined,
        minOrderAmount: (values.minOrderAmount as number) || 0,
        applicableCategories: (values.applicableCategories as string[]) || [],
        applicableCompanyIds: (values.applicableCompanyIds as string[]) || [],
        stackable: (values.stackable as boolean) ?? true,
        stackGroup: values.stackGroup as string | undefined,
        totalQuota: values.totalQuota as number,
        maxPerUser: (values.maxPerUser as number) || 1,
        validDays: (values.validDays as number) || 7,
        startAt: values.startAt as string,
        endAt: values.endAt as string,
      };

      if (isEdit) {
        await updateCampaign(campaign!.id, payload);
        message.success('活动更新成功');
      } else {
        await createCampaign(payload);
        message.success('活动创建成功');
      }
      onSuccess();
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
            />
            <ProFormSelect
              name="distributionMode"
              label="发放方式"
              width="md"
              options={distributionModeOptions}
              rules={[{ required: true, message: '请选择发放方式' }]}
            />
          </ProFormGroup>

          {/* 根据触发类型动态显示额外配置 */}
          <ProFormDependency name={['triggerType']}>
            {({ triggerType }) => {
              if (triggerType === 'CHECK_IN') {
                return (
                  <ProFormDigit
                    name="triggerConfig_requiredDays"
                    label="连续签到天数"
                    width="md"
                    min={1}
                    fieldProps={{ precision: 0 }}
                    placeholder="满足签到天数后发放"
                    extra="用户连续签到达到该天数后自动发放红包"
                  />
                );
              }
              if (triggerType === 'CUMULATIVE_SPEND') {
                return (
                  <ProFormDigit
                    name="triggerConfig_spendThreshold"
                    label="累计消费阈值（元）"
                    width="md"
                    min={0}
                    fieldProps={{ precision: 2, step: 10 }}
                    placeholder="累计消费达到此金额后发放"
                    extra="用户累计消费达到该金额后自动发放红包"
                  />
                );
              }
              if (triggerType === 'WIN_BACK') {
                return (
                  <ProFormDigit
                    name="triggerConfig_inactiveDays"
                    label="沉默天数"
                    width="md"
                    min={1}
                    fieldProps={{ precision: 0 }}
                    placeholder="用户超过此天数未下单后发放"
                    extra="用户最近一次下单距今超过该天数后自动发放红包"
                  />
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
            />
            <ProFormDependency name={['discountType']}>
              {({ discountType }) => (
                <ProFormDigit
                  name="discountValue"
                  label={discountType === 'PERCENT' ? '折扣比例（%）' : '抵扣金额（元）'}
                  width="md"
                  min={0}
                  max={discountType === 'PERCENT' ? 100 : undefined}
                  fieldProps={{ precision: 2, step: discountType === 'PERCENT' ? 1 : 0.5 }}
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
            <ProFormDigit
              name="minOrderAmount"
              label="最低消费门槛（元）"
              width="md"
              min={0}
              fieldProps={{ precision: 2, step: 10 }}
              extra="0 表示无门槛"
            />
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
              extra="0 = 跟随活动结束"
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
              mode="tags"
              placeholder="不选则不限品类"
              extra="输入品类名称并回车添加"
            />
            <ProFormSelect
              name="applicableCompanyIds"
              label="限定店铺"
              width="md"
              mode="tags"
              placeholder="预留功能，暂可不设"
              extra="输入店铺 ID 并回车添加"
            />
          </ProFormGroup>
        </Card>

        {/* ===== 活动时间 ===== */}
        <Card
          size="small"
          title={<SectionTitle icon={<CalendarOutlined />} title="活动时间" />}
        >
          <ProFormGroup>
            <ProFormDateTimePicker
              name="startAt"
              label="开始时间"
              width="md"
              rules={[{ required: true, message: '请选择开始时间' }]}
              fieldProps={{ style: { width: '100%' } }}
            />
            <ProFormDateTimePicker
              name="endAt"
              label="结束时间"
              width="md"
              rules={[{ required: true, message: '请选择结束时间' }]}
              fieldProps={{ style: { width: '100%' } }}
            />
          </ProFormGroup>
        </Card>
      </ProForm>
    </Drawer>
  );
}
