import { Alert, Space, Tag, Typography } from 'antd';
import { Link } from 'react-router-dom';
import type { ProfitSafetyScenarioKey, ProfitSafetySummary } from '@/types';
import { shouldLinkCaptainSettings } from './captainProfitV3';

const { Text } = Typography;

const SCENARIO_LABELS: Record<ProfitSafetyScenarioKey, string> = {
  VIP_BUYER_VIP_INVITER: 'VIP 买家 / VIP 邀请人',
  VIP_BUYER_NORMAL_INVITER: 'VIP 买家 / 普通邀请人',
  NORMAL_BUYER_VIP_INVITER: '普通买家 / VIP 邀请人',
  NORMAL_BUYER_NORMAL_INVITER: '普通买家 / 普通邀请人',
};

function percent(value: number) {
  return `${(value * 100).toFixed(2)}%`;
}

export default function ProfitSafetyStatus({
  summary,
  loading = false,
  error,
}: {
  summary?: ProfitSafetySummary;
  loading?: boolean;
  error?: Error | null;
}) {
  if (loading) {
    return <Alert type="info" showIcon message="正在读取服务器利润安全状态" style={{ marginBottom: 16 }} />;
  }
  if (error) {
    return (
      <Alert
        type="warning"
        showIcon
        message="利润安全状态暂不可用"
        description={error.message}
        style={{ marginBottom: 16 }}
      />
    );
  }
  if (!summary) return null;

  const failedScenario = summary.scenarios.find((scenario) => !scenario.safe);
  const limitingSku = summary.limitingSkus[0];
  const linkCaptain = shouldLinkCaptainSettings(summary);
  const description = summary.safe ? (
    <Space size={[12, 4]} wrap>
      <Text>已校验 {summary.evaluatedSkuCount} 个在售普通 SKU</Text>
      <Text type="secondary">平台所需留存 {percent(summary.platformRequiredRevenueRate)}</Text>
      <Text type="secondary">团长最高利润奖励 {percent(summary.captainMaximumProfitRate)}</Text>
    </Space>
  ) : (
    <Space size={[8, 4]} wrap>
      {failedScenario ? <Tag color="error">{SCENARIO_LABELS[failedScenario.key]}</Tag> : null}
      {limitingSku ? <Text>限制 SKU：{limitingSku.skuId}</Text> : null}
      <Text type="danger">利润缺口 {percent(summary.shortfall)}</Text>
      {summary.errors.length > 0 ? <Text type="secondary">{summary.errors.join('、')}</Text> : null}
    </Space>
  );

  return (
    <Alert
      type={summary.safe ? 'success' : 'error'}
      showIcon
      message={summary.safe ? '服务器利润安全校验通过' : '服务器利润安全校验未通过'}
      description={description}
      action={linkCaptain ? <Link to="/captain/settings">处理团长冲突</Link> : undefined}
      style={{ marginBottom: 16 }}
    />
  );
}
