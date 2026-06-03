import { useEffect, useState } from 'react';
import { ProForm, ProFormDigit } from '@ant-design/pro-components';
import { App, Card, Divider } from 'antd';
import {
  getWithdrawRules,
  updateWithdrawRules,
  type WithdrawRules,
} from '@/api/bonus';
import PermissionGate from '@/components/PermissionGate';
import { PERMISSIONS } from '@/constants/permissions';

export default function WithdrawRulesPage() {
  const { message } = App.useApp();
  const [rules, setRules] = useState<WithdrawRules | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getWithdrawRules()
      .then(setRules)
      .finally(() => setLoading(false));
  }, []);

  const onFinish = async (values: Partial<WithdrawRules>) => {
    const updated = await updateWithdrawRules(values);
    setRules(updated);
    message.success('已保存');
  };

  return (
    <PermissionGate permission={PERMISSIONS.BONUS_MANAGE_RULES}>
      <div style={{ padding: 24 }}>
        <Card title="提现与抵扣规则配置" loading={loading && !rules}>
          {rules && (
            <ProForm<Partial<WithdrawRules>>
              layout="vertical"
              grid
              initialValues={rules}
              onFinish={onFinish}
              submitter={{ searchConfig: { submitText: '保存配置' } }}
            >
              <Divider orientation="left">提现参数</Divider>
              <ProFormDigit
                colProps={{ md: 8 }}
                name="withdrawTaxRate"
                label="代扣比例"
                fieldProps={{ step: 0.01, precision: 2, min: 0, max: 0.5 }}
                extra="例：0.20 表示 20%"
              />
              <ProFormDigit
                colProps={{ md: 8 }}
                name="withdrawMinAmount"
                label="单笔最低（元）"
                fieldProps={{ min: 0, precision: 2 }}
              />
              <ProFormDigit
                colProps={{ md: 8 }}
                name="withdrawMaxAmount"
                label="单笔最高（元）"
                fieldProps={{ min: 0, precision: 2 }}
              />
              <ProFormDigit
                colProps={{ md: 8 }}
                name="withdrawDailyMaxCount"
                label="每日最多次数"
                fieldProps={{ min: 1, max: 100, precision: 0 }}
              />
              <ProFormDigit
                colProps={{ md: 8 }}
                name="withdrawCooldownSeconds"
                label="冷却时间（秒）"
                fieldProps={{ min: 0, max: 86400, precision: 0 }}
              />
              <ProFormDigit
                colProps={{ md: 8 }}
                name="withdrawYearlyMaxAmount"
                label="年累计上限（元）"
                fieldProps={{ min: 0, precision: 2 }}
              />

              <Divider orientation="left">抵扣参数</Divider>
              <ProFormDigit
                colProps={{ md: 8 }}
                name="deductionRatioNormal"
                label="普通用户比例"
                fieldProps={{ step: 0.01, precision: 2, min: 0, max: 1 }}
                extra="例：0.10 表示 10%"
              />
              <ProFormDigit
                colProps={{ md: 8 }}
                name="deductionRatioVip"
                label="VIP 用户比例"
                fieldProps={{ step: 0.01, precision: 2, min: 0, max: 1 }}
                extra="例：0.15 表示 15%"
              />
              <ProFormDigit
                colProps={{ md: 8 }}
                name="deductionMinOrderAmount"
                label="最低订单门槛（元）"
                fieldProps={{ min: 0, precision: 2 }}
              />
              {/* A2-H2: deductionAllowCouponStack 后端业务代码暂未读取此开关，v1.0 默认允许叠加。
                  避免管理员误以为已禁用，UI 入口先移除。后续若需启用，需先在
                  backend/src/modules/order/checkout.service.ts 锁定红包前补 rules.deductionAllowCouponStack 校验 */}

              <Divider orientation="left">通道与监控</Divider>
              <ProFormDigit
                colProps={{ md: 8 }}
                name="withdrawProviderFeeAmount"
                label="通道手续费（元/笔）"
                fieldProps={{ min: 0, precision: 2 }}
                extra="v1.0 默认 0"
              />
              <ProFormDigit
                colProps={{ md: 8 }}
                name="withdrawYearlyAlertThreshold"
                label="年累计告警阈值"
                fieldProps={{ step: 0.05, precision: 2, min: 0, max: 1 }}
                extra="0.80 表示 80%"
              />
            </ProForm>
          )}
        </Card>
      </div>
    </PermissionGate>
  );
}
