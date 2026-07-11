import { Alert, Space, Tag, Typography } from 'antd';
import { Link } from 'react-router-dom';
import type { ProfitSafetyScenarioKey, ProfitSafetySummary } from '@/types';
import { shouldLinkCaptainSettings } from './captainProfitV3';
import type { ConfigProfitSafetyPreviewState } from '@/hooks/useConfigProfitSafetyPreview';
import { getProfitSafetyStatusPresentation } from '@/utils/configProfitSafetyPreview';

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
  previewState,
}: {
  summary?: ProfitSafetySummary;
  loading?: boolean;
  error?: Error | null;
  previewState?: ConfigProfitSafetyPreviewState;
}) {
  const displaySummary = previewState?.kind === 'candidate' ? previewState.summary : summary;
  const presentation = getProfitSafetyStatusPresentation({
    kind: previewState?.kind ?? 'saved',
    summary: displaySummary,
    loading,
    error: previewState?.kind === 'error' ? previewState.error : error,
    linkCaptain: shouldLinkCaptainSettings(displaySummary),
  });
  if (!presentation || !presentation.summary) {
    return presentation ? (
      <Alert
        type={presentation.type}
        showIcon
        message={presentation.message}
        description={presentation.description}
        style={{ marginBottom: 16 }}
      />
    ) : null;
  }

  const failedScenario = presentation.summary.scenarios.find((scenario) => !scenario.safe);
  const limitingSku = presentation.summary.limitingSkus[0];
  const description = presentation.summary.safe ? (
    <Space size={[12, 4]} wrap>
      <Text>已校验 {presentation.summary.evaluatedSkuCount} 个在售普通 SKU</Text>
      <Text type="secondary">平台所需留存 {percent(presentation.summary.platformRequiredRevenueRate)}</Text>
      <Text type="secondary">团长最高利润奖励 {percent(presentation.summary.captainMaximumProfitRate)}</Text>
    </Space>
  ) : (
    <Space size={[8, 4]} wrap>
      {failedScenario ? <Tag color="error">{SCENARIO_LABELS[failedScenario.key]}</Tag> : null}
      {limitingSku ? <Text>限制 SKU：{limitingSku.skuId}</Text> : null}
      <Text type="danger">利润缺口 {percent(presentation.summary.shortfall)}</Text>
      {presentation.summary.errors.length > 0 ? <Text type="secondary">{presentation.summary.errors.join('、')}</Text> : null}
    </Space>
  );

  return (
    <Alert
      type={presentation.type}
      showIcon
      message={presentation.message}
      description={description}
      action={presentation.linkCaptain ? <Link to="/captain/settings">处理团长冲突</Link> : undefined}
      style={{ marginBottom: 16 }}
    />
  );
}
