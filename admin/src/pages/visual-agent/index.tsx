import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Alert, App, Button, Card, Checkbox, Col, Descriptions, Empty, Form, Image, Input, InputNumber, List, Modal, Row, Select, Space, Spin, Statistic, Table, Tag, Typography } from 'antd';
import { CheckCircleOutlined, CloseCircleOutlined, FundProjectionScreenOutlined, SafetyCertificateOutlined } from '@ant-design/icons';
import {
  adjustVisualCredits,
  approvePaidVisualCandidateFacts,
  getPaidVisualCandidate,
  getPendingPaidVisualCandidates,
  getVisualCreditAccount,
  getVisualCreditLedger,
  getVisualWelcomePolicy,
  grantVisualWelcomeCredits,
  listVisualRateCards,
  rejectPaidVisualCandidateFacts,
  saveVisualRateCard,
  saveVisualWelcomePolicy,
  type PaidVisualCandidateQueueItem,
  type VisualRateCard,
} from '@/api/visualAgent';
import useAuthStore from '@/store/useAuthStore';
import { PERMISSIONS } from '@/constants/permissions';

const { Text, Title } = Typography;
const DEFAULT_SCOPE = { tenantId: 'aimai-product-agent', clientId: 'aimai-product-adapter-v1', adapterNamespace: 'aimai-product' };
const directionOptions = ['PRESERVE_REAL_SCENE', 'CATALOG_STUDIO', 'PRODUCT_RETOUCH'];
const riskOptions = ['STRICT_FACTS', 'CONSERVATIVE_FACTS', 'ORGANIC_FACTS', 'STANDARD_FACTS'];

type Scope = typeof DEFAULT_SCOPE;

function QueueItem({ item, selected, onSelect }: { item: PaidVisualCandidateQueueItem; selected: boolean; onSelect: () => void }) {
  return (
    <List.Item onClick={onSelect} style={{ cursor: 'pointer', padding: '12px 14px', background: selected ? '#eef6ff' : undefined, borderLeft: selected ? '3px solid #1677ff' : '3px solid transparent' }}>
      <List.Item.Meta
        title={<Space size={6}><Text strong>{item.product.title}</Text><Tag color="gold">待事实复核</Tag></Space>}
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
  const [accountForm] = Form.useForm<{ ownerType: string; ownerId: string }>();
  const [rateCardOpen, setRateCardOpen] = useState(false);
  const [selectedCandidateId, setSelectedCandidateId] = useState<string>();
  const [accountScope, setAccountScope] = useState<{ ownerType: string; ownerId: string }>();
  const canReviewCandidates = useAuthStore((state) => state.hasPermission(PERMISSIONS.PRODUCTS_AUDIT));

  const policy = useQuery({ queryKey: ['visual-agent', 'welcome-policy', scope.tenantId], queryFn: () => getVisualWelcomePolicy(scope.tenantId) });
  const rateCards = useQuery({ queryKey: ['visual-agent', 'rate-cards', scope], queryFn: () => listVisualRateCards(scope.tenantId, scope.clientId, scope.adapterNamespace) });
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
    onSuccess: async () => { message.success('欢迎额度策略已保存；不会自动向商家发放额度'); await refreshConfiguration(); },
  });
  const saveRateCard = useMutation({
    mutationFn: async (values: Record<string, unknown>) => {
      let outputSpec: Record<string, unknown>;
      try {
        outputSpec = JSON.parse(String(values.outputSpec || '{}'));
      } catch {
        throw new Error('输出规格必须是合法 JSON');
      }
      return saveVisualRateCard(scope.tenantId, {
        clientId: scope.clientId,
        adapterNamespace: scope.adapterNamespace,
        code: String(values.code),
        displayName: String(values.displayName),
        description: String(values.description),
        modelProfile: String(values.modelProfile),
        outputSpec,
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
  });
  const grantWelcome = useMutation({
    mutationFn: () => grantVisualWelcomeCredits(scope.tenantId, accountScope!.ownerType, accountScope!.ownerId),
    onSuccess: async () => { message.success('欢迎图片额度已按幂等规则发放'); await refreshAccount(); },
  });
  const approveCandidate = useMutation({
    mutationFn: () => approvePaidVisualCandidateFacts(selectedCandidate!),
    onSuccess: async () => { message.success('事实复核已通过；候选仍需由商家显式采用'); await refreshCandidates(); },
  });
  const rejectCandidate = useMutation({
    mutationFn: (reason: string) => rejectPaidVisualCandidateFacts(selectedCandidate!, reason),
    onSuccess: async () => { message.success('已驳回候选并保留审计原因'); await refreshCandidates(); },
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
      candidateCount: 1, creditCost: 15, status: 'PAUSED', version: 'v1', outputSpec: '{\n  "resolution": "1K"\n}',
      allowedDirections: ['PRESERVE_REAL_SCENE'], allowedRiskProfiles: ['STANDARD_FACTS'],
    });
    setRateCardOpen(true);
  };
  const askAdjustment = () => {
    if (!accountScope) return;
    let reason = '';
    let availableDelta = 0;
    modal.confirm({
      title: '人工调整图片额度',
      content: <Space direction="vertical" style={{ width: '100%', marginTop: 12 }}><InputNumber style={{ width: '100%' }} placeholder="正数增加，负数扣减" onChange={(value) => { availableDelta = Number(value ?? 0); }} /><Input.TextArea rows={3} placeholder="必须填写业务原因" onChange={(event) => { reason = event.target.value; }} /></Space>,
      okText: '确认调整',
      okButtonProps: { danger: availableDelta < 0 },
      onOk: async () => {
        if (!Number.isInteger(availableDelta) || availableDelta === 0 || !reason.trim()) return Promise.reject(new Error('请输入非零整数额度和调整原因'));
        await adjustVisualCredits(scope.tenantId, accountScope.ownerType, accountScope.ownerId, { availableDelta, reason: reason.trim(), idempotencyKey: crypto.randomUUID() });
        message.success('图片额度已调整');
        await refreshAccount();
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
        if (!reason.trim()) return Promise.reject(new Error('请填写驳回原因'));
        await rejectCandidate.mutateAsync(reason.trim());
      },
    });
  };

  return (
    <div style={{ maxWidth: 1480, margin: '0 auto', padding: '4px 0 28px' }}>
      <div style={{ marginBottom: 18 }}>
        <Space align="baseline" wrap><Title level={3} style={{ marginBottom: 4 }}>AI Visual Agent 管理</Title><Tag color="purple">平台高权限</Tag></Space>
        <Text type="secondary">管理商家图片额度、对外报价和事实复核。这里不会显示 Provider Key，也不能直接启用真实模型。</Text>
      </div>
      <Alert showIcon type="warning" icon={<SafetyCertificateOutlined />} message="配置不等于开通" description="费率卡只控制面向商家的报价；真实百炼模型、额度发放、数据库迁移和任何扣费调用仍需独立发布授权与运行时开关。" style={{ marginBottom: 16 }} />

      <Card size="small" title="管理范围" extra={<Tag color="blue">所有资源按 Tenant / Client / Adapter 隔离</Tag>} style={{ marginBottom: 16 }}>
        <Form form={scopeForm} layout="inline" initialValues={scope} onFinish={(values) => setScope(values as Scope)}>
          <Form.Item name="tenantId" label="Tenant" rules={[{ required: true }]}><Input style={{ width: 220 }} /></Form.Item>
          <Form.Item name="clientId" label="Client" rules={[{ required: true }]}><Input style={{ width: 240 }} /></Form.Item>
          <Form.Item name="adapterNamespace" label="Adapter" rules={[{ required: true }]}><Input style={{ width: 190 }} /></Form.Item>
          <Form.Item><Button htmlType="submit">切换范围</Button></Form.Item>
        </Form>
      </Card>

      <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
        <Col xs={24} xl={10}>
          <Card title="新商家欢迎额度" extra={<Tag color={policy.data?.enabled ? 'green' : 'default'}>{policy.data?.enabled ? '启用中' : '未启用'}</Tag>} style={{ height: '100%' }}>
            <Text type="secondary">默认建议为 200 图片额度（展示服务面值 ¥20）。保存策略不会自动发放；每个账单主体的实际发放走幂等流水。</Text>
            <Form form={policyForm} layout="vertical" initialValues={{ enabled: policy.data?.enabled ?? false, grantCredits: policy.data?.grantCredits ?? 200, creditValueCents: policy.data?.creditValueCents ?? 2000, policyVersion: policy.data?.policyVersion ?? 'WELCOME_200_V1' }} onFinish={(values) => savePolicy.mutate(values)} style={{ marginTop: 12 }}>
              <Row gutter={12}><Col span={8}><Form.Item name="grantCredits" label="赠送额度" rules={[{ required: true }]}><InputNumber min={1} precision={0} style={{ width: '100%' }} /></Form.Item></Col><Col span={8}><Form.Item name="creditValueCents" label="服务面值（分）" rules={[{ required: true }]}><InputNumber min={0} precision={0} style={{ width: '100%' }} /></Form.Item></Col><Col span={8}><Form.Item name="enabled" label="是否启用" valuePropName="checked"><Checkbox>启用策略</Checkbox></Form.Item></Col></Row>
              <Form.Item name="policyVersion" label="策略版本" rules={[{ required: true }]}><Input /></Form.Item>
              <Button type="primary" htmlType="submit" loading={savePolicy.isPending}>保存欢迎额度策略</Button>
            </Form>
          </Card>
        </Col>
        <Col xs={24} xl={14}>
          <Card title="商家图片额度账户" extra={<Tag color="gold">独立于奖励积分 / 红包 / 订单支付</Tag>} style={{ height: '100%' }}>
            <Form form={accountForm} layout="inline" initialValues={{ ownerType: 'COMPANY' }} onFinish={(values) => setAccountScope(values)}>
              <Form.Item name="ownerType" label="主体类型" rules={[{ required: true }]}><Select style={{ width: 130 }} options={[{ value: 'COMPANY', label: '商户 Company' }, { value: 'RESTAURANT', label: '餐厅主体' }, { value: 'EXTERNAL', label: '外部主体' }]} /></Form.Item>
              <Form.Item name="ownerId" label="主体 ID" rules={[{ required: true, message: '请输入受控账单主体 ID' }]}><Input style={{ width: 260 }} placeholder="例如 Company ID" /></Form.Item>
              <Form.Item><Button htmlType="submit">查询账户</Button></Form.Item>
            </Form>
            {accountScope && <><Row gutter={12} style={{ marginTop: 18 }}><Col span={8}><Statistic title="可用额度" value={accountStats?.availableCredits ?? 0} loading={creditAccount.isLoading} /></Col><Col span={8}><Statistic title="冻结额度" value={accountStats?.reservedCredits ?? 0} loading={creditAccount.isLoading} /></Col><Col span={8}><Space direction="vertical"><Button loading={grantWelcome.isPending} onClick={() => grantWelcome.mutate()}>发放欢迎额度</Button><Button danger onClick={askAdjustment}>人工调整</Button></Space></Col></Row>
              <Table size="small" rowKey="id" pagination={false} loading={creditLedger.isLoading} style={{ marginTop: 12 }} dataSource={creditLedger.data} columns={[{ title: '时间', dataIndex: 'createdAt', render: (value) => new Date(value).toLocaleString('zh-CN') }, { title: '类型', dataIndex: 'type', render: (value) => <Tag>{value}</Tag> }, { title: '可用变化', dataIndex: 'availableDelta' }, { title: '冻结变化', dataIndex: 'reservedDelta' }, { title: '余额', render: (_, row) => `${row.availableBalanceAfter} / ${row.reservedBalanceAfter}` }, { title: '原因', dataIndex: 'reason', ellipsis: true }]} />
            </>}
          </Card>
        </Col>
      </Row>

      <Card title="费率卡（面向商家的固定报价）" extra={<Button type="primary" onClick={() => openRateCard()}>新增费率卡</Button>} style={{ marginBottom: 16 }}>
        <Text type="secondary">新报价才使用新版本；默认“暂停”，由平台在完成模型白名单、预算和验收后明确启用。</Text>
        <Table style={{ marginTop: 12 }} rowKey="id" loading={rateCards.isLoading} dataSource={selectedRateCards} pagination={false} columns={[{ title: '商家方案', render: (_, row) => <Space direction="vertical" size={0}><Text strong>{row.displayName}</Text><Text type="secondary" style={{ fontSize: 12 }}>{row.code} · {row.version}</Text></Space> }, { title: '额度 / 候选', render: (_, row) => `${row.creditCost} / ${row.candidateCount}` }, { title: '模型档', dataIndex: 'modelProfile' }, { title: '事实审核', dataIndex: 'requiresHumanReview', render: (value) => value ? <Tag color="gold">需要人工复核</Tag> : <Tag color="green">按策略自动验真</Tag> }, { title: '状态', dataIndex: 'status', render: (value) => <Tag color={value === 'ACTIVE' ? 'green' : value === 'PAUSED' ? 'orange' : 'default'}>{value}</Tag> }, { title: '操作', render: (_, row) => <Button type="link" onClick={() => openRateCard(row)}>编辑</Button> }]} />
      </Card>

      <Card title="付费候选事实复核" extra={<Tag color="gold">候选不会自动发布</Tag>}>
        {canReviewCandidates ? <><Text type="secondary">先核对原图与候选的包装、型号、数量、颜色、规格、材质与可见瑕疵；通过只会让商家可显式采用，已上架商品仍要走封面变更审核。</Text>
        <div style={{ display: 'grid', gridTemplateColumns: '300px minmax(0, 1fr)', gap: 16, marginTop: 14 }}>
          <Card size="small" title={`待复核 ${candidates.data?.length ?? 0}`} bodyStyle={{ padding: 0 }}>
            {candidates.isLoading ? <div style={{ padding: 28, textAlign: 'center' }}><Spin /></div> : candidates.data?.length ? <List dataSource={candidates.data} renderItem={(item) => <QueueItem item={item} selected={item.id === selectedCandidate} onSelect={() => setSelectedCandidateId(item.id)} />} /> : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无待复核付费候选" style={{ margin: '44px 0' }} />}
          </Card>
          <Card size="small">
            {candidateDetail.isLoading ? <div style={{ padding: 72, textAlign: 'center' }}><Spin /></div> : candidateDetail.data ? <>
              <Descriptions size="small" column={{ xs: 1, sm: 3 }} style={{ marginBottom: 16 }}><Descriptions.Item label="商品">{candidateDetail.data.product.title}</Descriptions.Item><Descriptions.Item label="商户">{candidateDetail.data.company.name}</Descriptions.Item><Descriptions.Item label="生成时间">{new Date(candidateDetail.data.task.createdAt).toLocaleString('zh-CN')}</Descriptions.Item></Descriptions>
              {candidateDetail.data.task.verification && <Alert type={candidateDetail.data.task.verification.state === 'LOCAL_AND_OCR_FACTS_VERIFIED' ? 'success' : 'warning'} showIcon message={candidateDetail.data.task.verification.state === 'LOCAL_AND_OCR_FACTS_VERIFIED' ? '系统已通过结构与文字一致性核对' : '系统验真要求继续人工复核'} description={candidateDetail.data.task.verification.ocr?.state === 'MATCHED' ? '前后文字核对一致；仍请复核包装、型号、数量、颜色、规格与可见瑕疵。' : '系统不会把二维码、条码或 OCR 的不确定结果当作“没有商品事实”。'} style={{ marginBottom: 16 }} />}
              <Alert showIcon type="warning" icon={<FundProjectionScreenOutlined />} message="事实复核不是美感投票" description="改善光线、反光、构图可以接受；任何包装文字、型号、数量、颜色、规格、材质或可见瑕疵的不一致都应驳回。" style={{ marginBottom: 16 }} />
              <Row gutter={[16, 16]}><Col xs={24} md={12}><Card size="small" title="受管原图证据"><Image src={candidateDetail.data.source.displayUrl} width="100%" style={{ maxHeight: 360, objectFit: 'contain', background: '#fafafa' }} /></Card></Col><Col xs={24} md={12}><Card size="small" title="AI 候选（未公开）"><Image src={candidateDetail.data.candidate.displayUrl} width="100%" style={{ maxHeight: 360, objectFit: 'contain', background: '#fafafa' }} /></Card></Col></Row>
              <Space style={{ marginTop: 16 }}><Button type="primary" icon={<CheckCircleOutlined />} loading={approveCandidate.isPending} onClick={() => approveCandidate.mutate()}>通过事实复核</Button><Button danger icon={<CloseCircleOutlined />} onClick={askRejectCandidate}>驳回候选</Button></Space>
            </> : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="从左侧选择一个待复核候选" />}
          </Card>
        </div>
        </> : <Alert type="info" showIcon message="候选事实复核需要商品审核权限" description="你仍可管理额度和费率卡；如需查看并复核付费候选，请申请 products:audit 权限。" />}
      </Card>

      <Modal title="费率卡" open={rateCardOpen} onCancel={() => setRateCardOpen(false)} onOk={() => rateCardForm.submit()} confirmLoading={saveRateCard.isPending} width={760} okText="保存费率卡">
        <Form form={rateCardForm} layout="vertical" onFinish={(values) => saveRateCard.mutate(values)}>
          <Row gutter={12}><Col span={12}><Form.Item name="code" label="稳定编码" rules={[{ required: true }]}><Input placeholder="STANDARD_REAL_SCENE" /></Form.Item></Col><Col span={12}><Form.Item name="version" label="版本" rules={[{ required: true }]}><Input /></Form.Item></Col></Row>
          <Row gutter={12}><Col span={12}><Form.Item name="displayName" label="商家看到的方案名" rules={[{ required: true }]}><Input /></Form.Item></Col><Col span={12}><Form.Item name="modelProfile" label="服务器模型档" rules={[{ required: true }]}><Input /></Form.Item></Col></Row>
          <Form.Item name="description" label="商家说明" rules={[{ required: true }]}><Input.TextArea rows={2} /></Form.Item>
          <Row gutter={12}><Col span={12}><Form.Item name="allowedDirections" label="允许方向" rules={[{ required: true }]}><Select mode="multiple" options={directionOptions.map((value) => ({ value }))} /></Form.Item></Col><Col span={12}><Form.Item name="allowedRiskProfiles" label="允许风险档" rules={[{ required: true }]}><Select mode="multiple" options={riskOptions.map((value) => ({ value }))} /></Form.Item></Col></Row>
          <Row gutter={12}><Col span={8}><Form.Item name="creditCost" label="图片额度" rules={[{ required: true }]}><InputNumber min={0} precision={0} style={{ width: '100%' }} /></Form.Item></Col><Col span={8}><Form.Item name="candidateCount" label="候选张数" rules={[{ required: true }]}><InputNumber min={1} precision={0} style={{ width: '100%' }} /></Form.Item></Col><Col span={8}><Form.Item name="status" label="状态" rules={[{ required: true }]}><Select options={[{ value: 'PAUSED', label: 'PAUSED（默认）' }, { value: 'ACTIVE', label: 'ACTIVE' }, { value: 'RETIRED', label: 'RETIRED' }]} /></Form.Item></Col></Row>
          <Row gutter={12}><Col span={12}><Form.Item name="candidateRole" label="候选角色" rules={[{ required: true }]}><Select options={[{ value: 'FACT_MAIN_IMAGE', label: 'FACT_MAIN_IMAGE' }, { value: 'DETAIL_IMAGE', label: 'DETAIL_IMAGE' }, { value: 'MARKETING_IMAGE', label: 'MARKETING_IMAGE' }]} /></Form.Item></Col><Col span={12}><Form.Item name="requiresHumanReview" label="人工事实复核" valuePropName="checked"><Checkbox>生成后必须人工复核</Checkbox></Form.Item></Col></Row>
          <Form.Item name="outputSpec" label="输出规格 JSON" rules={[{ required: true }]}><Input.TextArea rows={4} style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }} /></Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
