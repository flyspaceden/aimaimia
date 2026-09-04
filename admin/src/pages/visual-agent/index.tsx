import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Alert, App, Button, Card, Checkbox, Col, Descriptions, Empty, Form, Image, Input, InputNumber, List, Modal, Row, Select, Space, Spin, Statistic, Table, Tag, Typography } from 'antd';
import { CheckCircleOutlined, CloseCircleOutlined, FundProjectionScreenOutlined, SafetyCertificateOutlined } from '@ant-design/icons';
import {
  adjustVisualCredits,
  approvePaidVisualCandidateFacts,
  getPaidVisualCandidate,
  getProductVisualTestAccessStatus,
  getPendingPaidVisualCandidates,
  getVisualCreditAccount,
  getVisualCreditLedger,
  getVisualWelcomePolicy,
  grantVisualWelcomeCredits,
  listVisualBudgetPolicies,
  listVisualReconciliations,
  listVisualRateCards,
  rejectPaidVisualCandidateFacts,
  resolveVisualReconciliation,
  saveVisualBudgetPolicy,
  saveVisualRateCard,
  saveVisualWelcomePolicy,
  type PaidVisualCandidateQueueItem,
  type VisualBudgetPolicy,
  type VisualReconciliation,
  type VisualRateCard,
} from '@/api/visualAgent';
import useAuthStore from '@/store/useAuthStore';
import { PERMISSIONS } from '@/constants/permissions';

const { Text, Title } = Typography;
const DEFAULT_SCOPE = { tenantId: 'aimai-product-agent', clientId: 'aimai-product-adapter-v1', adapterNamespace: 'aimai-product' };
const directionOptions = [
  { value: 'PRESERVE_REAL_SCENE', label: '保留真实场景' },
  { value: 'CATALOG_STUDIO', label: '商品棚拍风格' },
  { value: 'PRODUCT_RETOUCH', label: '受控细节修图' },
  { value: 'MARKETING_SCENE', label: '营销展示图' },
];
const riskOptions = [
  { value: 'STRICT_FACTS', label: '事实严格保护' },
  { value: 'CONSERVATIVE_FACTS', label: '事实谨慎保护' },
  { value: 'ORGANIC_FACTS', label: '天然实物保护' },
  { value: 'STANDARD_FACTS', label: '标准事实保护' },
];
const modelOptions = [
  { value: 'BAILIAN_WAN_STANDARD', label: '万相标准 · wan2.7-image' },
  { value: 'BAILIAN_WAN_PRO', label: '万相专业 · wan2.7-image-pro' },
  { value: 'BAILIAN_QWEN_IMAGE', label: '千问图像 · qwen-image-3.0' },
  { value: 'BAILIAN_QWEN_IMAGE_PRO', label: '千问图像专业 · qwen-image-3.0-pro' },
];
const budgetRouteOptions = [
  { value: 'BAILIAN_WAN|wan2.7-image', label: '万相标准 · wan2.7-image' },
  { value: 'BAILIAN_WAN|wan2.7-image-pro', label: '万相专业 · wan2.7-image-pro' },
  { value: 'BAILIAN_QWEN_IMAGE|qwen-image-3.0', label: '千问图像 · qwen-image-3.0' },
  { value: 'BAILIAN_QWEN_IMAGE|qwen-image-3.0-pro', label: '千问图像专业 · qwen-image-3.0-pro' },
];
const budgetScopeOptions = [
  { value: 'PLATFORM', label: '平台总预算' },
  { value: 'PROVIDER', label: '模型服务商预算' },
  { value: 'TENANT', label: '平台租户预算' },
  { value: 'CLIENT', label: '接入客户端预算' },
  { value: 'EXTERNAL_OBJECT', label: '业务对象预算' },
  { value: 'ACTOR', label: '操作人员预算' },
];
const directionLabels = Object.fromEntries(directionOptions.map((item) => [item.value, item.label]));
const budgetScopeLabels = Object.fromEntries(budgetScopeOptions.map((item) => [item.value, item.label]));
const rateCardStatusLabels: Record<string, string> = { ACTIVE: '启用', PAUSED: '暂停', RETIRED: '已停用' };
const modelProfileLabels = Object.fromEntries(modelOptions.map((item) => [item.value, item.label]));
const providerLabels: Record<string, string> = { BAILIAN_WAN: '百炼万相', BAILIAN_QWEN_IMAGE: '百炼千问图像' };
const creditLedgerTypeLabels: Record<string, string> = {
  WELCOME_GRANT: '欢迎图片积分发放',
  MANUAL_ADJUSTMENT: '平台人工调整',
  RESERVE: '生成任务冻结',
  SETTLE: '生成任务结算',
  RELEASE: '未执行图片积分退回',
};

type Scope = typeof DEFAULT_SCOPE;

function canonicalBudgetScopeKey(values: { scope?: VisualBudgetPolicy['scope']; route?: string; targetId?: string }, scope: Scope) {
  const part = (value: string) => `${value.length}:${value}`;
  const provider = String(values.route || '').split('|')[0];
  if (values.scope === 'PLATFORM') return 'GLOBAL';
  if (values.scope === 'PROVIDER') return provider ? `provider:${part(provider)}` : '';
  if (values.scope === 'TENANT') return `tenant:${part(scope.tenantId)}`;
  if (values.scope === 'CLIENT') return `tenant:${part(scope.tenantId)}:client:${part(scope.clientId)}`;
  if (values.scope === 'EXTERNAL_OBJECT' && values.targetId) return `tenant:${part(scope.tenantId)}:client:${part(scope.clientId)}:adapter:${part(scope.adapterNamespace)}:object:${part(values.targetId)}`;
  if (values.scope === 'ACTOR' && values.targetId) return `tenant:${part(scope.tenantId)}:client:${part(scope.clientId)}:adapter:${part(scope.adapterNamespace)}:actor:${part(values.targetId)}`;
  return '';
}

function budgetTargetId(policy: VisualBudgetPolicy) {
  const marker = policy.scope === 'EXTERNAL_OBJECT' ? ':object:' : policy.scope === 'ACTOR' ? ':actor:' : null;
  if (!marker) return '';
  const suffix = policy.scopeKey.split(marker).at(-1) || '';
  const separator = suffix.indexOf(':');
  const length = Number(suffix.slice(0, separator));
  const value = suffix.slice(separator + 1);
  return Number.isInteger(length) && length >= 0 ? value.slice(0, length) : '';
}

function QueueItem({ item, selected, onSelect }: { item: PaidVisualCandidateQueueItem; selected: boolean; onSelect: () => void }) {
  return (
    <List.Item onClick={onSelect} style={{ cursor: 'pointer', padding: '12px 14px', background: selected ? '#eef6ff' : undefined, borderLeft: selected ? '3px solid #1677ff' : '3px solid transparent' }}>
      <List.Item.Meta
        title={<Space size={6}><Text strong>{item.product.title}</Text><Tag color="gold">历史待处理</Tag></Space>}
        description={<Space direction="vertical" size={0}><Text type="secondary">{item.company.name}</Text><Text type="secondary" style={{ fontSize: 12 }}>{new Date(item.createdAt).toLocaleString('zh-CN')}</Text></Space>}
      />
    </List.Item>
  );
}

export default function VisualAgentPage() {
  const { message, modal } = App.useApp();
  const queryClient = useQueryClient();
  const [scope, setScope] = useState<Scope>(DEFAULT_SCOPE);
  const [scopeForm] = Form.useForm<Scope>();
  const [policyForm] = Form.useForm();
  const [rateCardForm] = Form.useForm();
  const [budgetForm] = Form.useForm();
  const [reconciliationForm] = Form.useForm();
  const [accountForm] = Form.useForm<{ ownerType: string; ownerId: string }>();
  const [rateCardOpen, setRateCardOpen] = useState(false);
  const [budgetOpen, setBudgetOpen] = useState(false);
  const [selectedReconciliation, setSelectedReconciliation] = useState<VisualReconciliation>();
  const [selectedCandidateId, setSelectedCandidateId] = useState<string>();
  const [accountScope, setAccountScope] = useState<{ ownerType: string; ownerId: string }>();
  const canReviewCandidates = useAuthStore((state) => state.hasPermission(PERMISSIONS.PRODUCTS_AUDIT));
  const isStaging = import.meta.env.VITE_APP_ENV === 'staging';

  const policy = useQuery({ queryKey: ['visual-agent', 'welcome-policy', scope.tenantId], queryFn: () => getVisualWelcomePolicy(scope.tenantId) });
  const testAccessStatus = useQuery({
    queryKey: ['visual-agent', 'test-access-status'],
    queryFn: getProductVisualTestAccessStatus,
    enabled: isStaging,
  });
  const rateCards = useQuery({ queryKey: ['visual-agent', 'rate-cards', scope], queryFn: () => listVisualRateCards(scope.tenantId, scope.clientId, scope.adapterNamespace) });
  const budgetPolicies = useQuery({ queryKey: ['visual-agent', 'budget-policies'], queryFn: listVisualBudgetPolicies });
  const reconciliations = useQuery({ queryKey: ['visual-agent', 'reconciliations'], queryFn: listVisualReconciliations, refetchInterval: 30_000 });
  const candidates = useQuery({ queryKey: ['visual-agent', 'paid-candidates'], queryFn: getPendingPaidVisualCandidates, enabled: canReviewCandidates, refetchInterval: 30_000 });
  const selectedCandidate = selectedCandidateId && candidates.data?.some((item) => item.id === selectedCandidateId)
    ? selectedCandidateId
    : candidates.data?.[0]?.id;
  const candidateDetail = useQuery({
    queryKey: ['visual-agent', 'paid-candidate', selectedCandidate],
    queryFn: () => getPaidVisualCandidate(selectedCandidate!),
    enabled: canReviewCandidates && Boolean(selectedCandidate),
    refetchInterval: 240_000,
  });
  const creditAccount = useQuery({
    queryKey: ['visual-agent', 'account', scope.tenantId, accountScope?.ownerType, accountScope?.ownerId],
    queryFn: () => getVisualCreditAccount(scope.tenantId, accountScope!.ownerType, accountScope!.ownerId),
    enabled: Boolean(accountScope?.ownerType && accountScope?.ownerId),
  });
  const creditLedger = useQuery({
    queryKey: ['visual-agent', 'ledger', scope.tenantId, accountScope?.ownerType, accountScope?.ownerId],
    queryFn: () => getVisualCreditLedger(scope.tenantId, accountScope!.ownerType, accountScope!.ownerId),
    enabled: Boolean(accountScope?.ownerType && accountScope?.ownerId),
  });

  const refreshConfiguration = async () => {
    await queryClient.invalidateQueries({ queryKey: ['visual-agent', 'welcome-policy', scope.tenantId] });
    await queryClient.invalidateQueries({ queryKey: ['visual-agent', 'rate-cards', scope] });
  };
  const refreshCandidates = async () => {
    await queryClient.invalidateQueries({ queryKey: ['visual-agent', 'paid-candidates'] });
    await queryClient.invalidateQueries({ queryKey: ['visual-agent', 'paid-candidate'] });
  };
  const refreshAccount = async () => {
    await queryClient.invalidateQueries({ queryKey: ['visual-agent', 'account', scope.tenantId] });
    await queryClient.invalidateQueries({ queryKey: ['visual-agent', 'ledger', scope.tenantId] });
  };

  const savePolicy = useMutation({
    mutationFn: (values: { enabled: boolean; grantCredits: number; creditValueCents: number; policyVersion: string }) => saveVisualWelcomePolicy(scope.tenantId, values),
    onSuccess: async () => { message.success('欢迎图片积分策略已保存；不会自动向商家发放图片积分'); await refreshConfiguration(); },
    onError: (error) => message.error(error instanceof Error ? error.message : '欢迎图片积分策略保存失败'),
  });
  const saveRateCard = useMutation({
    mutationFn: async (values: Record<string, unknown>) => {
      return saveVisualRateCard(scope.tenantId, {
        clientId: scope.clientId,
        adapterNamespace: scope.adapterNamespace,
        code: String(values.code),
        displayName: String(values.displayName),
        description: String(values.description),
        modelProfile: String(values.modelProfile),
        outputSpec: { providerManaged: true },
        allowedDirections: values.allowedDirections as string[],
        allowedRiskProfiles: values.allowedRiskProfiles as string[],
        candidateRole: String(values.candidateRole),
        requiresHumanReview: Boolean(values.requiresHumanReview),
        candidateCount: Number(values.candidateCount),
        creditCost: Number(values.creditCost),
        status: values.status as VisualRateCard['status'],
        version: String(values.version),
      });
    },
    onSuccess: async () => { message.success('费率卡已保存；仅新报价采用该版本'); setRateCardOpen(false); await refreshConfiguration(); },
    onError: (error) => message.error(error instanceof Error ? error.message : '费率卡保存失败'),
  });
  const grantWelcome = useMutation({
    mutationFn: () => grantVisualWelcomeCredits(scope.tenantId, accountScope!.ownerType, accountScope!.ownerId),
    onSuccess: async () => { message.success('欢迎图片积分已按幂等规则发放'); await refreshAccount(); },
    onError: (error) => message.error(error instanceof Error ? error.message : '欢迎图片积分发放失败'),
  });
  const approveCandidate = useMutation({
    mutationFn: () => approvePaidVisualCandidateFacts(selectedCandidate!),
    onSuccess: async () => { message.success('历史候选已处理；候选仍需由商家显式采用'); await refreshCandidates(); },
    onError: (error) => message.error(error instanceof Error ? error.message : '历史候选处理失败'),
  });
  const rejectCandidate = useMutation({
    mutationFn: (reason: string) => rejectPaidVisualCandidateFacts(selectedCandidate!, reason),
    onSuccess: async () => { message.success('已驳回候选并保留审计原因'); await refreshCandidates(); },
    onError: (error) => message.error(error instanceof Error ? error.message : '候选驳回失败'),
  });
  const saveBudget = useMutation({
    mutationFn: (values: Record<string, unknown>) => {
      const [provider, model] = String(values.route).split('|');
      return saveVisualBudgetPolicy({
        scope: values.scope as VisualBudgetPolicy['scope'],
        scopeKey: canonicalBudgetScopeKey(values, scope),
        provider: provider as VisualBudgetPolicy['provider'],
        model: model as VisualBudgetPolicy['model'],
        visualMode: values.visualMode as VisualBudgetPolicy['visualMode'],
        reserveCents: Number(values.reserveCents),
        perTaskCapCents: Number(values.perTaskCapCents),
        dailyCapCents: Number(values.dailyCapCents),
        weeklyCapCents: Number(values.weeklyCapCents),
        policyVersion: String(values.policyVersion),
        enabled: Boolean(values.enabled),
      });
    },
    onSuccess: async () => {
      message.success('预算策略已保存；同范围旧活动版本已自动停用');
      setBudgetOpen(false);
      await queryClient.invalidateQueries({ queryKey: ['visual-agent', 'budget-policies'] });
    },
    onError: (error) => message.error(error instanceof Error ? error.message : '预算策略保存失败'),
  });
  const resolveReconciliation = useMutation({
    mutationFn: (values: { decision: 'RELEASED' | 'BILLING_EXCEPTION'; creditDecision: 'RELEASE' | 'SETTLE'; evidenceRef: string }) =>
      resolveVisualReconciliation(selectedReconciliation!.id, values),
    onSuccess: async () => {
      message.success('对账已关闭，模型调用、预算和商家冻结图片积分已同步处理');
      setSelectedReconciliation(undefined);
      await queryClient.invalidateQueries({ queryKey: ['visual-agent', 'reconciliations'] });
    },
    onError: (error) => message.error(error instanceof Error ? error.message : '人工对账失败'),
  });

  const accountStats = creditAccount.data;
  const selectedRateCards = useMemo(() => rateCards.data ?? [], [rateCards.data]);
  useEffect(() => {
    policyForm.setFieldsValue({
      enabled: policy.data?.enabled ?? false,
      grantCredits: policy.data?.grantCredits ?? 200,
      creditValueCents: policy.data?.creditValueCents ?? 2000,
      policyVersion: policy.data?.policyVersion ?? 'WELCOME_200_V1',
    });
  }, [policy.data, policyForm]);
  const openRateCard = (card?: VisualRateCard) => {
    rateCardForm.setFieldsValue(card ? {
      ...card,
      outputSpec: JSON.stringify(card.outputSpec, null, 2),
    } : {
      modelProfile: 'BAILIAN_WAN_STANDARD', candidateRole: 'FACT_MAIN_IMAGE', requiresHumanReview: true,
      candidateCount: 1, creditCost: 15, status: 'PAUSED', version: 'v1',
      allowedDirections: ['PRESERVE_REAL_SCENE'], allowedRiskProfiles: ['STANDARD_FACTS'],
    });
    setRateCardOpen(true);
  };
  const openBudget = (policy?: VisualBudgetPolicy) => {
    budgetForm.setFieldsValue(policy ? {
      ...policy,
      route: `${policy.provider}|${policy.model}`,
      targetId: budgetTargetId(policy),
    } : {
      scope: 'PLATFORM', targetId: '', route: 'BAILIAN_WAN|wan2.7-image', visualMode: 'PRESERVE_REAL_SCENE',
      reserveCents: 20, perTaskCapCents: 50, dailyCapCents: 500, weeklyCapCents: 2000,
      policyVersion: 'v1', enabled: false,
    });
    setBudgetOpen(true);
  };
  const openReconciliation = (item: VisualReconciliation) => {
    reconciliationForm.setFieldsValue({ decision: 'RELEASED', creditDecision: 'RELEASE', evidenceRef: '' });
    setSelectedReconciliation(item);
  };
  const askAdjustment = () => {
    if (!accountScope) return;
    let reason = '';
    let availableDelta = 0;
    modal.confirm({
      title: '人工调整图片积分',
      content: <Space direction="vertical" style={{ width: '100%', marginTop: 12 }}><InputNumber style={{ width: '100%' }} placeholder="正数增加，负数扣减" onChange={(value) => { availableDelta = Number(value ?? 0); }} /><Input.TextArea rows={3} placeholder="必须填写业务原因" onChange={(event) => { reason = event.target.value; }} /></Space>,
      okText: '确认调整',
      okButtonProps: { danger: availableDelta < 0 },
      onOk: async () => {
        if (!Number.isInteger(availableDelta) || availableDelta === 0 || !reason.trim()) {
          message.warning('请输入非零整数图片积分和调整原因');
          return Promise.reject(new Error('请输入非零整数图片积分和调整原因'));
        }
        try {
          await adjustVisualCredits(scope.tenantId, accountScope.ownerType, accountScope.ownerId, { availableDelta, reason: reason.trim(), idempotencyKey: crypto.randomUUID() });
          message.success('图片积分已调整');
          await refreshAccount();
        } catch (error) {
          message.error(error instanceof Error ? error.message : '图片积分调整失败');
          throw error;
        }
      },
    });
  };
  const askRejectCandidate = () => {
    if (!selectedCandidate) return;
    let reason = '';
    modal.confirm({
      title: '驳回付费图片候选',
      content: <Input.TextArea autoFocus rows={3} placeholder="请说明包装、型号、数量、颜色或其他事实问题" onChange={(event) => { reason = event.target.value; }} />,
      okText: '确认驳回',
      okButtonProps: { danger: true, loading: rejectCandidate.isPending },
      onOk: async () => {
        if (!reason.trim()) {
          message.warning('请填写驳回原因');
          return Promise.reject(new Error('请填写驳回原因'));
        }
        await rejectCandidate.mutateAsync(reason.trim());
      },
    });
  };

  return (
    <div style={{ maxWidth: 1480, margin: '0 auto', padding: '4px 0 28px' }}>
      <div style={{ marginBottom: 18 }}>
        <Space align="baseline" wrap><Title level={3} style={{ marginBottom: 4 }}>商品图片智能美化管理</Title><Tag color="purple">平台高权限</Tag></Space>
        <Text type="secondary">管理商家图片积分、服务报价和事后巡检策略。这里不会显示模型服务密钥，也不能直接启用真实模型。</Text>
      </div>
      <Alert showIcon type="warning" icon={<SafetyCertificateOutlined />} message="配置不等于开通" description="费率卡只控制面向商家的报价；真实百炼模型、图片积分发放、数据库迁移和任何扣费调用仍需独立发布授权与运行时开关。" style={{ marginBottom: 16 }} />
      {(policy.isError || rateCards.isError) && <Alert showIcon type="error" message="商品图片智能美化配置加载失败" description="当前页面不能确认真实策略或费率卡，请重新加载后再操作。" action={<Button size="small" onClick={() => { void policy.refetch(); void rateCards.refetch(); }}>重新加载配置</Button>} style={{ marginBottom: 16 }} />}
      {isStaging && testAccessStatus.isError && <Alert
        showIcon
        type="error"
        message="图片积分使用状态读取失败"
        description="当前无法确认商家是否能调用模型，请重新加载后再判断。"
        action={<Button size="small" onClick={() => void testAccessStatus.refetch()}>重新加载状态</Button>}
        style={{ marginBottom: 16 }}
      />}
      {isStaging && !testAccessStatus.isError && testAccessStatus.data && <Alert
        showIcon
        type={testAccessStatus.data.allMerchantsEnabled && testAccessStatus.data.providerReady ? 'success' : 'warning'}
        message={testAccessStatus.data.allMerchantsEnabled && testAccessStatus.data.providerReady
          ? '有图片积分即可使用'
          : testAccessStatus.data.allMerchantsEnabled
            ? '无需单独授权，但模型服务尚未就绪'
            : '测试模型服务暂未开放'}
        description={testAccessStatus.data.allMerchantsEnabled && testAccessStatus.data.providerReady
          ? `所有 ACTIVE 商家的 OWNER/MANAGER 无需单独授权；拥有图片积分即可为自有商品使用模型，每次仍需确认 ${testAccessStatus.data.creditCost} 图片积分。`
          : testAccessStatus.data.allMerchantsEnabled
            ? '商家权限已统一开放，但模型、费率或平台成本保护尚未全部就绪；图片积分不是唯一门槛。'
            : '请先完成模型、费率和平台总成本保护配置；不需要逐个设置商家权限。'}
        style={{ marginBottom: 16 }}
      />}

      <Card size="small" title="管理范围" extra={<Tag color="blue">所有资源按租户、接入客户端和适配器隔离</Tag>} style={{ marginBottom: 16 }}>
        <Form form={scopeForm} layout="inline" initialValues={scope} onFinish={(values) => setScope(values as Scope)}>
          <Form.Item name="tenantId" label="平台租户编号" rules={[{ required: true }]}><Input style={{ width: 220 }} /></Form.Item>
          <Form.Item name="clientId" label="接入客户端编号" rules={[{ required: true }]}><Input style={{ width: 240 }} /></Form.Item>
          <Form.Item name="adapterNamespace" label="适配器命名空间" rules={[{ required: true }]}><Input style={{ width: 190 }} /></Form.Item>
          <Form.Item><Button htmlType="submit">切换范围</Button></Form.Item>
        </Form>
      </Card>

      <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
        <Col xs={24} xl={10}>
          <Card loading={policy.isLoading} title="新商家欢迎图片积分" extra={<Tag color={policy.data?.enabled ? 'green' : 'default'}>{policy.isError ? '加载失败' : policy.data?.enabled ? '启用中' : '未启用'}</Tag>} style={{ height: '100%' }}>
            <Text type="secondary">默认建议为 200 图片积分（展示服务面值 ¥20）。保存策略不会自动发放；每个账单主体的实际发放走幂等流水。</Text>
            <Form form={policyForm} layout="vertical" initialValues={{ enabled: policy.data?.enabled ?? false, grantCredits: policy.data?.grantCredits ?? 200, creditValueCents: policy.data?.creditValueCents ?? 2000, policyVersion: policy.data?.policyVersion ?? 'WELCOME_200_V1' }} onFinish={(values) => savePolicy.mutate(values)} style={{ marginTop: 12 }}>
              <Row gutter={12}><Col span={8}><Form.Item name="grantCredits" label="赠送图片积分" rules={[{ required: true }]}><InputNumber min={1} precision={0} style={{ width: '100%' }} /></Form.Item></Col><Col span={8}><Form.Item name="creditValueCents" label="服务面值（分）" rules={[{ required: true }]}><InputNumber min={0} precision={0} style={{ width: '100%' }} /></Form.Item></Col><Col span={8}><Form.Item name="enabled" label="是否启用" valuePropName="checked"><Checkbox>启用策略</Checkbox></Form.Item></Col></Row>
              <Form.Item name="policyVersion" label="策略版本" rules={[{ required: true }]}><Input /></Form.Item>
              <Button type="primary" htmlType="submit" loading={savePolicy.isPending} disabled={policy.isError}>保存欢迎图片积分策略</Button>
            </Form>
          </Card>
        </Col>
        <Col xs={24} xl={14}>
          <Card title="商家图片积分账户" extra={<Tag color="gold">独立于奖励积分 / 红包 / 订单支付</Tag>} style={{ height: '100%' }}>
            <Form form={accountForm} layout="inline" initialValues={{ ownerType: 'COMPANY' }} onFinish={(values) => setAccountScope(values)}>
              <Form.Item name="ownerType" label="主体类型" rules={[{ required: true }]}><Select style={{ width: 150 }} options={[{ value: 'COMPANY', label: '平台商户' }, { value: 'RESTAURANT', label: '餐厅主体' }, { value: 'EXTERNAL', label: '外部接入主体' }]} /></Form.Item>
              <Form.Item name="ownerId" label="主体编号" rules={[{ required: true, message: '请输入受控账单主体编号' }]}><Input style={{ width: 260 }} placeholder="例如商户编号" /></Form.Item>
              <Form.Item><Button htmlType="submit">查询账户</Button></Form.Item>
            </Form>
            {accountScope && <>{(creditAccount.isError || creditLedger.isError) && <Alert type="error" showIcon message="图片积分账户加载失败" description="无法确认当前余额，已暂停发放和人工调整。" action={<Button size="small" onClick={() => { void creditAccount.refetch(); void creditLedger.refetch(); }}>重新加载</Button>} style={{ marginTop: 12 }} />}<Row gutter={12} style={{ marginTop: 18 }}><Col span={8}><Statistic title="可用图片积分" value={accountStats?.availableCredits ?? 0} loading={creditAccount.isLoading} /></Col><Col span={8}><Statistic title="冻结图片积分" value={accountStats?.reservedCredits ?? 0} loading={creditAccount.isLoading} /></Col><Col span={8}><Space direction="vertical"><Button disabled={creditAccount.isError || creditAccount.isLoading} loading={grantWelcome.isPending} onClick={() => grantWelcome.mutate()}>发放欢迎图片积分</Button><Button disabled={creditAccount.isError || creditAccount.isLoading} danger onClick={askAdjustment}>人工调整</Button></Space></Col></Row>
              <Table size="small" rowKey="id" pagination={false} loading={creditLedger.isLoading} style={{ marginTop: 12 }} dataSource={creditLedger.data} columns={[{ title: '时间', dataIndex: 'createdAt', render: (value) => new Date(value).toLocaleString('zh-CN') }, { title: '类型', dataIndex: 'type', render: (value) => <Tag>{creditLedgerTypeLabels[value] || '其他变动'}</Tag> }, { title: '可用变化', dataIndex: 'availableDelta' }, { title: '冻结变化', dataIndex: 'reservedDelta' }, { title: '余额', render: (_, row) => `${row.availableBalanceAfter} / ${row.reservedBalanceAfter}` }, { title: '原因', dataIndex: 'reason', ellipsis: true }]} />
            </>}
          </Card>
        </Col>
      </Row>

      <Card title="费率卡（面向商家的固定报价）" extra={<Button type="primary" onClick={() => openRateCard()}>新增费率卡</Button>} style={{ marginBottom: 16 }}>
        <Text type="secondary">新报价才使用新版本；默认“暂停”，由平台在完成模型白名单、预算和验收后明确启用。</Text>
        <Table style={{ marginTop: 12 }} rowKey="id" loading={rateCards.isLoading} dataSource={selectedRateCards} pagination={false} locale={{ emptyText: rateCards.isError ? '费率卡加载失败，请先重新加载配置' : '暂无费率卡' }} columns={[{ title: '商家方案', render: (_, row) => <Space direction="vertical" size={0}><Text strong>{row.displayName}</Text><Text type="secondary" style={{ fontSize: 12 }}>{row.code} · {row.version}</Text></Space> }, { title: '图片积分 / 候选', render: (_, row) => `${row.creditCost} / ${row.candidateCount}` }, { title: '模型档', dataIndex: 'modelProfile', render: (value) => modelProfileLabels[value] || value }, { title: '巡检策略', dataIndex: 'requiresHumanReview', render: (value) => value ? <Tag color="gold">发布后优先巡检</Tag> : <Tag color="green">按策略自动验真</Tag> }, { title: '状态', dataIndex: 'status', render: (value) => <Tag color={value === 'ACTIVE' ? 'green' : value === 'PAUSED' ? 'orange' : 'default'}>{rateCardStatusLabels[value] || '未知状态'}</Tag> }, { title: '操作', render: (_, row) => <Button type="link" onClick={() => openRateCard(row)}>编辑</Button> }]} />
      </Card>

      <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
        <Col xs={24} xl={14}>
          <Card title="模型服务六层预算策略" extra={<Button type="primary" onClick={() => openBudget()}>新增预算策略</Button>} style={{ height: '100%' }}>
            <Alert type="info" showIcon message="真实模型调用必须同时命中六层活动策略" description="平台、模型服务商、平台租户、接入客户端、业务对象和操作人员缺一不可；六层的每次预占成本必须一致。保存活动版本时会自动停用同一精确范围的旧版本。" style={{ marginBottom: 12 }} />
            {budgetPolicies.isError && <Alert type="error" showIcon message="预算策略加载失败" action={<Button size="small" onClick={() => budgetPolicies.refetch()}>重新加载</Button>} style={{ marginBottom: 12 }} />}
            <Table<VisualBudgetPolicy>
              size="small"
              rowKey="id"
              loading={budgetPolicies.isLoading}
              dataSource={budgetPolicies.data}
              pagination={{ pageSize: 8 }}
              scroll={{ x: 980 }}
              columns={[
                { title: '范围', dataIndex: 'scope', width: 150, render: (value, row) => <Space direction="vertical" size={0}><Tag>{budgetScopeLabels[value] || '未知范围'}</Tag><Text type="secondary" ellipsis style={{ maxWidth: 180, fontSize: 11 }}>{row.scopeKey}</Text></Space> },
                { title: '模型路线', width: 210, render: (_, row) => <Space direction="vertical" size={0}><Text>{providerLabels[row.provider] || row.provider}</Text><Text type="secondary">{row.model}</Text></Space> },
                { title: '模式', dataIndex: 'visualMode', width: 170, render: (value) => directionLabels[value] || '未知模式' },
                { title: '预占 / 单次', width: 110, render: (_, row) => `${row.reserveCents} / ${row.perTaskCapCents} 分` },
                { title: '日 / 周上限', width: 130, render: (_, row) => `${row.dailyCapCents} / ${row.weeklyCapCents} 分` },
                { title: '版本', width: 100, render: (_, row) => <Space><Tag color={row.enabled ? 'green' : 'default'}>{row.enabled ? '启用' : '停用'}</Tag>{row.policyVersion}</Space> },
                { title: '操作', width: 70, fixed: 'right', render: (_, row) => <Button type="link" onClick={() => openBudget(row)}>编辑</Button> },
              ]}
            />
          </Card>
        </Col>
        <Col xs={24} xl={10}>
          <Card title="模型调用人工对账" extra={<Tag color={reconciliations.data?.length ? 'red' : 'green'}>{reconciliations.data?.length ?? 0} 项待处理</Tag>} style={{ height: '100%' }}>
            <Text type="secondary">只处理模型服务控制台或账单已经给出证据的调用。释放或结算商家冻结图片积分与调用状态会在同一事务中完成。</Text>
            {reconciliations.isError && <Alert type="error" showIcon message="对账队列加载失败" action={<Button size="small" onClick={() => reconciliations.refetch()}>重新加载</Button>} style={{ marginTop: 12 }} />}
            <Table<VisualReconciliation>
              size="small"
              rowKey="id"
              loading={reconciliations.isLoading}
              dataSource={reconciliations.data}
              pagination={{ pageSize: 6 }}
              style={{ marginTop: 12 }}
              columns={[
                { title: '调用', render: (_, row) => <Space direction="vertical" size={0}><Text strong>{row.model}</Text><Text type="secondary" style={{ fontSize: 11 }}>{row.externalObjectId}</Text></Space> },
                { title: '原因', dataIndex: 'reconciliationReason', ellipsis: true },
                { title: '冻结图片积分', width: 100, render: (_, row) => row.creditQuote ? `${row.creditQuote.creditCost} 图片积分` : '无' },
                { title: '操作', width: 90, render: (_, row) => <Button danger size="small" onClick={() => openReconciliation(row)}>处理对账</Button> },
              ]}
            />
          </Card>
        </Col>
      </Row>

      <Card title="历史付费候选处理" extra={<Tag color="gold">新候选不做发布前预审批</Tag>}>
        {canReviewCandidates ? <><Text type="secondary">这里只兼容已存在的待复核候选。新候选在未发现明确事实不一致时可由商家显式采用；已上架商品采用后立即发布，并由商品图片巡检台承接事后回滚。</Text>
        <div style={{ display: 'grid', gridTemplateColumns: '300px minmax(0, 1fr)', gap: 16, marginTop: 14 }}>
          <Card size="small" title={`待复核 ${candidates.data?.length ?? 0}`} bodyStyle={{ padding: 0 }}>
            {candidates.isError ? <Alert type="error" showIcon message="历史候选加载失败" action={<Button size="small" onClick={() => candidates.refetch()}>重新加载</Button>} style={{ margin: 12 }} /> : candidates.isLoading ? <div style={{ padding: 28, textAlign: 'center' }}><Spin /></div> : candidates.data?.length ? <List dataSource={candidates.data} renderItem={(item) => <QueueItem item={item} selected={item.id === selectedCandidate} onSelect={() => setSelectedCandidateId(item.id)} />} /> : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无待复核付费候选" style={{ margin: '44px 0' }} />}
          </Card>
          <Card size="small">
            {candidateDetail.isError ? <Alert type="error" showIcon message="历史候选详情加载失败" action={<Button size="small" onClick={() => candidateDetail.refetch()}>重新加载</Button>} /> : candidateDetail.isLoading ? <div style={{ padding: 72, textAlign: 'center' }}><Spin /></div> : candidateDetail.data ? <>
              <Descriptions size="small" column={{ xs: 1, sm: 3 }} style={{ marginBottom: 16 }}><Descriptions.Item label="商品">{candidateDetail.data.product.title}</Descriptions.Item><Descriptions.Item label="商户">{candidateDetail.data.company.name}</Descriptions.Item><Descriptions.Item label="生成时间">{new Date(candidateDetail.data.task.createdAt).toLocaleString('zh-CN')}</Descriptions.Item></Descriptions>
              {candidateDetail.data.task.verification && <Alert type={candidateDetail.data.task.verification.state === 'LOCAL_AND_OCR_FACTS_VERIFIED' ? 'success' : 'warning'} showIcon message={candidateDetail.data.task.verification.state === 'LOCAL_AND_OCR_FACTS_VERIFIED' ? '系统已通过结构与文字一致性核对' : '系统会将不确定结果提升为事后巡检优先'} description={candidateDetail.data.task.verification.ocr?.state === 'MATCHED' ? '前后文字核对一致；仍请复核包装、型号、数量、颜色、规格与可见瑕疵。' : '系统不会把二维码、条码或 OCR 的不确定结果当作“没有商品事实”。'} style={{ marginBottom: 16 }} />}
              <Alert showIcon type="warning" icon={<FundProjectionScreenOutlined />} message="事实复核不是美感投票" description="改善光线、反光、构图可以接受；任何包装文字、型号、数量、颜色、规格、材质或可见瑕疵的不一致都应驳回。" style={{ marginBottom: 16 }} />
              <Row gutter={[16, 16]}><Col xs={24} md={12}><Card size="small" title="受管原图证据"><Image src={candidateDetail.data.source.displayUrl} width="100%" style={{ maxHeight: 360, objectFit: 'contain', background: '#fafafa' }} /></Card></Col><Col xs={24} md={12}><Card size="small" title="智能美化候选（未公开）"><Image src={candidateDetail.data.candidate.displayUrl} width="100%" style={{ maxHeight: 360, objectFit: 'contain', background: '#fafafa' }} /></Card></Col></Row>
              <Space style={{ marginTop: 16 }}><Button type="primary" icon={<CheckCircleOutlined />} loading={approveCandidate.isPending} onClick={() => approveCandidate.mutate()}>处理历史候选</Button><Button danger icon={<CloseCircleOutlined />} onClick={askRejectCandidate}>拒绝历史候选</Button></Space>
            </> : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="从左侧选择一个待复核候选" />}
          </Card>
        </div>
        </> : <Alert type="info" showIcon message="历史候选处理需要商品审核权限" description="你仍可管理图片积分和费率卡；如需查看历史候选，请申请 products:audit 权限。" />}
      </Card>

      <Modal title="费率卡" open={rateCardOpen} onCancel={() => setRateCardOpen(false)} onOk={() => rateCardForm.submit()} confirmLoading={saveRateCard.isPending} width={760} okText="保存费率卡">
        <Form form={rateCardForm} layout="vertical" onFinish={(values) => saveRateCard.mutate(values)}>
          <Row gutter={12}><Col span={12}><Form.Item name="code" label="稳定编码" rules={[{ required: true }]}><Input placeholder="STANDARD_REAL_SCENE" /></Form.Item></Col><Col span={12}><Form.Item name="version" label="版本" rules={[{ required: true }]}><Input /></Form.Item></Col></Row>
          <Row gutter={12}><Col span={12}><Form.Item name="displayName" label="商家看到的方案名" rules={[{ required: true }]}><Input /></Form.Item></Col><Col span={12}><Form.Item name="modelProfile" label="服务器模型档" rules={[{ required: true }]}><Select options={modelOptions} /></Form.Item></Col></Row>
          <Form.Item name="description" label="商家说明" rules={[{ required: true }]}><Input.TextArea rows={2} /></Form.Item>
          <Row gutter={12}><Col span={12}><Form.Item name="allowedDirections" label="允许的美化方向" rules={[{ required: true }]}><Select mode="multiple" options={directionOptions} /></Form.Item></Col><Col span={12}><Form.Item name="allowedRiskProfiles" label="允许的事实保护级别" rules={[{ required: true }]}><Select mode="multiple" options={riskOptions} /></Form.Item></Col></Row>
          <Row gutter={12}><Col span={8}><Form.Item name="creditCost" label="图片积分" rules={[{ required: true }]}><InputNumber min={0} precision={0} style={{ width: '100%' }} /></Form.Item></Col><Col span={8}><Form.Item name="candidateCount" label="候选张数" extra="当前每次报价固定交付 1 张已验真候选" rules={[{ required: true }]}><InputNumber min={1} max={1} precision={0} style={{ width: '100%' }} /></Form.Item></Col><Col span={8}><Form.Item name="status" label="状态" rules={[{ required: true }]}><Select options={[{ value: 'PAUSED', label: '暂停（默认）' }, { value: 'ACTIVE', label: '启用' }, { value: 'RETIRED', label: '已停用' }]} /></Form.Item></Col></Row>
          <Row gutter={12}><Col span={12}><Form.Item name="candidateRole" label="候选用途" rules={[{ required: true }]}><Select options={[{ value: 'FACT_MAIN_IMAGE', label: '商品主图（FACT_MAIN_IMAGE）' }, { value: 'DETAIL_IMAGE', label: '商品详情图（DETAIL_IMAGE）' }, { value: 'MARKETING_IMAGE', label: '营销展示图（MARKETING_IMAGE）' }]} /></Form.Item></Col><Col span={12}><Form.Item name="requiresHumanReview" label="巡检优先策略" valuePropName="checked"><Checkbox>无法完全自动确认时提升事后巡检优先级</Checkbox></Form.Item></Col></Row>
          <Alert type="info" showIcon message="输出尺寸由当前模型安全能力控制" description="平台暂不向商家承诺后台尚未真实传递给模型的分辨率或比例；每次报价固定生成 1 张候选。" />
        </Form>
      </Modal>

      <Modal title="模型服务预算策略" open={budgetOpen} onCancel={() => setBudgetOpen(false)} onOk={() => budgetForm.submit()} confirmLoading={saveBudget.isPending} width={820} okText="保存预算策略">
        <Form form={budgetForm} layout="vertical" onFinish={(values) => saveBudget.mutate(values)}>
          <Alert type="warning" showIcon message="预算策略不会自动开通模型" description="只有六层精确策略、模型服务密钥、运行时开关和真实验收同时就绪，模型任务才可能执行。" style={{ marginBottom: 14 }} />
          <Row gutter={12}><Col span={8}><Form.Item name="scope" label="预算层级" rules={[{ required: true }]}><Select options={budgetScopeOptions} /></Form.Item></Col><Col span={16}><Form.Item name="targetId" label="业务对象或操作人员编号" extra="仅业务对象和操作人员层级需要填写" dependencies={['scope']} rules={[({ getFieldValue }) => ({ validator: async (_, value) => { if (['EXTERNAL_OBJECT', 'ACTOR'].includes(getFieldValue('scope')) && !String(value || '').trim()) throw new Error('该预算层级必须填写目标编号'); } })]}><Input placeholder="例如商品编号或员工编号" /></Form.Item></Col></Row>
          <Row gutter={12}><Col span={12}><Form.Item name="route" label="模型服务路线" rules={[{ required: true }]}><Select options={budgetRouteOptions} /></Form.Item></Col><Col span={12}><Form.Item name="visualMode" label="美化模式" rules={[{ required: true }]}><Select options={directionOptions} /></Form.Item></Col></Row>
          <Form.Item noStyle shouldUpdate>{({ getFieldsValue }) => <Alert type="info" showIcon message="将保存到精确范围键" description={canonicalBudgetScopeKey(getFieldsValue(), scope) || '请先补齐预算层级、模型路线和目标 ID'} style={{ marginBottom: 14 }} />}</Form.Item>
          <Row gutter={12}>
            <Col span={6}><Form.Item name="reserveCents" label="预占成本（分）" rules={[{ required: true }]}><InputNumber min={1} precision={0} style={{ width: '100%' }} /></Form.Item></Col>
            <Col span={6}><Form.Item name="perTaskCapCents" label="单次上限（分）" rules={[{ required: true }]}><InputNumber min={1} precision={0} style={{ width: '100%' }} /></Form.Item></Col>
            <Col span={6}><Form.Item name="dailyCapCents" label="每日上限（分）" rules={[{ required: true }]}><InputNumber min={1} precision={0} style={{ width: '100%' }} /></Form.Item></Col>
            <Col span={6}><Form.Item name="weeklyCapCents" label="每周上限（分）" rules={[{ required: true }]}><InputNumber min={1} precision={0} style={{ width: '100%' }} /></Form.Item></Col>
          </Row>
          <Row gutter={12}><Col span={12}><Form.Item name="policyVersion" label="策略版本" rules={[{ required: true }]}><Input /></Form.Item></Col><Col span={12}><Form.Item name="enabled" label="是否启用" valuePropName="checked"><Checkbox>启用该精确范围版本</Checkbox></Form.Item></Col></Row>
        </Form>
      </Modal>

      <Modal
        title="关闭模型调用对账"
        open={Boolean(selectedReconciliation)}
        onCancel={() => setSelectedReconciliation(undefined)}
        confirmLoading={resolveReconciliation.isPending}
        okText="按证据关闭对账"
        okButtonProps={{ danger: true }}
        onOk={async () => {
          const values = await reconciliationForm.validateFields();
          if (values.decision === 'RELEASED' && values.creditDecision !== 'RELEASE') {
            message.warning('模型服务商明确未计费时，必须把商家冻结图片积分退回');
            return;
          }
          await resolveReconciliation.mutateAsync(values);
        }}
      >
        {selectedReconciliation && <>
          <Descriptions size="small" column={2} style={{ marginBottom: 14 }}>
            <Descriptions.Item label="模型服务商 / 模型">{providerLabels[selectedReconciliation.provider] || selectedReconciliation.provider} / {selectedReconciliation.model}</Descriptions.Item>
            <Descriptions.Item label="业务对象">{selectedReconciliation.externalObjectId}</Descriptions.Item>
            <Descriptions.Item label="模型任务编号">{selectedReconciliation.providerTaskId || '未取得'}</Descriptions.Item>
            <Descriptions.Item label="商家冻结图片积分">{selectedReconciliation.creditQuote?.creditCost ?? 0}</Descriptions.Item>
          </Descriptions>
          <Form form={reconciliationForm} layout="vertical">
            <Form.Item name="decision" label="模型调用结论" rules={[{ required: true }]}><Select options={[{ value: 'RELEASED', label: '明确未计费，释放模型服务预算' }, { value: 'BILLING_EXCEPTION', label: '存在计费异常，停用对应模型策略' }]} /></Form.Item>
            <Form.Item name="creditDecision" label="商家图片积分结论" rules={[{ required: true }]}><Select options={[{ value: 'RELEASE', label: '退回冻结图片积分' }, { value: 'SETTLE', label: '按已生成/已计费规则结算图片积分' }]} /></Form.Item>
            <Form.Item name="evidenceRef" label="模型服务控制台或账单证据编号" rules={[{ required: true, message: '必须填写可追溯的证据编号' }, { pattern: /^[A-Za-z0-9._:/-]{1,200}$/, message: '证据编号只能使用字母、数字和 . _ : / -' }]}><Input placeholder="例如 provider:task-123:no-charge" /></Form.Item>
          </Form>
        </>}
      </Modal>
    </div>
  );
}
