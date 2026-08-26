import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Alert, App, Button, Card, Descriptions, Empty, Image, Input, List, Space, Spin, Tag, Typography } from 'antd';
import { CheckCircleOutlined, CloseCircleOutlined, EyeOutlined } from '@ant-design/icons';
import {
  approveProductMediaRevision,
  getPendingProductMediaRevisions,
  getProductMediaRevision,
  rejectProductMediaRevision,
  type ProductMediaRevisionQueueItem,
} from '@/api/productMediaRevisions';

const { Text, Title } = Typography;

const truthChecks = [
  ['quantityConfirmed', '数量与配件完整'],
  ['labelsConfirmed', '包装文字 / 型号未变'],
  ['factsConfirmed', '颜色、规格和事实一致'],
] as const;

const optimizationLabels: Record<string, string> = {
  WHITE_BACKGROUND: '保真白底候选',
  FREE_TUNE: '免费实景调优',
  BACKGROUND_GENERATION: '背景生成候选',
};

const factScanLabels: Record<string, { label: string; color: string; description: string }> = {
  VERIFIED_EMPTY: { label: '已验证无商品事实', color: 'green', description: '扫描在生成候选时未发现需要保护的文字、二维码或条码。' },
  FACTS_DETECTED: { label: '发现商品事实', color: 'orange', description: '图片含有需要保护的文字、二维码或条码，不能作为自由调优依据。' },
  INCONCLUSIVE: { label: '扫描结论不确定', color: 'red', description: '系统没有把“未识别到”当作“没有事实”，因此不会自动放行。' },
  RECONCILING: { label: '等待对账', color: 'gold', description: '扫描结果或调用状态仍待对账，不能作为自动放行依据。' },
  SCANNING: { label: '扫描中', color: 'blue', description: '尚未形成可用于候选的事实结论。' },
  FAILED: { label: '扫描失败', color: 'red', description: '扫描失败不会被当作无事实。' },
  EXPIRED: { label: '扫描已过期', color: 'default', description: '过期扫描不能用于新的自动处理。' },
};

function QueueLabel({ item, selected, onSelect }: { item: ProductMediaRevisionQueueItem; selected: boolean; onSelect: () => void }) {
  return (
    <List.Item
      onClick={onSelect}
      style={{ cursor: 'pointer', padding: '12px 14px', background: selected ? '#e6f4ff' : undefined, borderLeft: selected ? '3px solid #1677ff' : '3px solid transparent' }}
    >
      <List.Item.Meta
        title={<Space size={6}><Text strong>{item.product.title}</Text><Tag color="gold">待核验</Tag></Space>}
        description={<Space direction="vertical" size={0}><Text type="secondary">{item.company.name}</Text><Text type="secondary" style={{ fontSize: 12 }}>{new Date(item.createdAt).toLocaleString('zh-CN')}</Text></Space>}
      />
    </List.Item>
  );
}

export default function ProductMediaRevisionPage() {
  const { message, modal } = App.useApp();
  const queryClient = useQueryClient();
  const [selectedId, setSelectedId] = useState<string>();
  const queue = useQuery({ queryKey: ['admin', 'product-media-revisions', 'pending'], queryFn: getPendingProductMediaRevisions, refetchInterval: 30_000 });
  // A queue refresh can remove the reviewed item. Derive the fallback rather
  // than synchronously setting state in an effect, which avoids an extra
  // render and keeps the current selection stable whenever it still exists.
  const selectedRevisionId = selectedId && queue.data?.some((item) => item.id === selectedId)
    ? selectedId
    : queue.data?.[0]?.id;

  const detail = useQuery({
    queryKey: ['admin', 'product-media-revision', selectedRevisionId],
    queryFn: () => getProductMediaRevision(selectedRevisionId!),
    enabled: Boolean(selectedRevisionId),
    // Candidate URLs expire after five minutes; renew before an attentive
    // reviewer reaches a broken image midway through a comparison.
    refetchInterval: 240_000,
  });
  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: ['admin', 'product-media-revisions'] });
    await queryClient.invalidateQueries({ queryKey: ['admin', 'product-media-revision'] });
  };
  const approve = useMutation({ mutationFn: approveProductMediaRevision, onSuccess: async () => { message.success('封面变更已通过，公开图已原子切换'); await refresh(); } });
  const reject = useMutation({ mutationFn: ({ id, note }: { id: string; note: string }) => rejectProductMediaRevision(id, note), onSuccess: async () => { message.success('已驳回封面变更'); await refresh(); } });
  const selected = useMemo(() => queue.data?.find((item) => item.id === selectedRevisionId), [queue.data, selectedRevisionId]);

  const askReject = () => {
    if (!selectedRevisionId) return;
    let reason = '';
    modal.confirm({
      title: '驳回封面变更',
      content: <Input.TextArea autoFocus rows={3} placeholder="请说明需要重拍、补图或修正的事实问题" onChange={(event) => { reason = event.target.value; }} />,
      okText: '确认驳回',
      okButtonProps: { danger: true, loading: reject.isPending },
      onOk: async () => {
        if (!reason.trim()) return Promise.reject(new Error('请填写驳回原因'));
        await reject.mutateAsync({ id: selectedRevisionId, note: reason.trim() });
      },
    });
  };

  return (
    <div style={{ maxWidth: 1440, margin: '0 auto', padding: '4px 0 24px' }}>
      <div style={{ marginBottom: 18 }}>
        <Title level={3} style={{ marginBottom: 4 }}>商品封面变更审核</Title>
        <Text type="secondary">先核对真实商品，再决定是否替换买家正在看到的封面。候选图从不因提交而自动公开。</Text>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '300px minmax(0, 1fr)', gap: 16 }}>
        <Card title={`待审核 ${queue.data?.length ?? 0}`} bodyStyle={{ padding: 0 }}>
          {queue.isLoading ? <div style={{ padding: 28, textAlign: 'center' }}><Spin /></div> : queue.data?.length ? <List dataSource={queue.data} renderItem={(item) => <QueueLabel item={item} selected={item.id === selectedRevisionId} onSelect={() => setSelectedId(item.id)} />} /> : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无待审核封面变更" style={{ margin: '44px 0' }} />}
        </Card>
        <Card>
          {detail.isLoading ? <div style={{ padding: 72, textAlign: 'center' }}><Spin /></div> : detail.data ? <>
            <Descriptions size="small" column={{ xs: 1, sm: 3 }} style={{ marginBottom: 16 }}>
              <Descriptions.Item label="商品">{detail.data.product.title}</Descriptions.Item>
              <Descriptions.Item label="商户">{detail.data.company.name}</Descriptions.Item>
              <Descriptions.Item label="提交时间">{new Date(detail.data.revision.createdAt).toLocaleString('zh-CN')}</Descriptions.Item>
            </Descriptions>
            <Alert type="info" showIcon icon={<EyeOutlined />} message="审核标准：候选可改善展示光线或白底，但数量、型号、包装文字、颜色、规格和可见瑕疵必须保持真实。" style={{ marginBottom: 16 }} />
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
              <Card size="small" title="当前公开图" styles={{ body: { background: '#fafafa' } }}>
                <Image.PreviewGroup>{detail.data.product.media.length ? detail.data.product.media.map((media) => <Image key={media.id} src={media.url} width={128} height={160} style={{ objectFit: 'cover', marginRight: 8, marginBottom: 8 }} />) : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="无当前图片" />}</Image.PreviewGroup>
              </Card>
              <Card size="small" title="申请替换图" styles={{ body: { background: '#f6ffed' } }}>
                <Image.PreviewGroup>{detail.data.proposedMedia.map((media) => <Space key={media.assetId} direction="vertical" size={4} style={{ marginRight: 8, marginBottom: 8 }}><Image src={media.displayUrl} width={128} height={160} style={{ objectFit: 'cover' }} />{media.isEvidenceImage && <Tag color="blue">原实拍证据</Tag>}</Space>)}</Image.PreviewGroup>
              </Card>
            </div>
            <Card size="small" title="商家真实性确认" style={{ marginTop: 16 }}>
              <Space wrap>{truthChecks.map(([key, label]) => <Tag key={key} color={detail.data.revision.attestation?.[key] ? 'green' : 'red'}>{detail.data.revision.attestation?.[key] ? '已确认' : '缺失'} · {label}</Tag>)}</Space>
            </Card>
            <Card size="small" title="生成与事实凭证" style={{ marginTop: 16 }}>
              {detail.data.reviewContext.optimization ? (() => {
                const optimization = detail.data.reviewContext.optimization;
                const factScan = detail.data.reviewContext.factScan;
                const scanLabel = factScan ? factScanLabels[factScan.status] : null;
                return <Space direction="vertical" size={10} style={{ width: '100%' }}>
                  <Descriptions size="small" column={{ xs: 1, sm: 3 }}>
                    <Descriptions.Item label="候选类型"><Tag color={optimization.kind === 'FREE_TUNE' ? 'green' : 'blue'}>{optimizationLabels[optimization.kind] || optimization.kind}</Tag></Descriptions.Item>
                    <Descriptions.Item label="处理器">{optimization.provider === 'deterministic-sharp' ? '本地确定性处理（无模型调用）' : optimization.provider || '未记录'}</Descriptions.Item>
                    <Descriptions.Item label="费用"><Tag color={optimization.costTier === 'FREE' ? 'green' : 'gold'}>{optimization.costTier === 'FREE' ? '免费' : '待对账'}</Tag></Descriptions.Item>
                  </Descriptions>
                  {factScan && scanLabel ? <Alert
                    type={factScan.status === 'VERIFIED_EMPTY' && factScan.freeTuneEligible ? 'success' : factScan.status === 'FACTS_DETECTED' ? 'warning' : 'info'}
                    showIcon
                    message={<Space wrap><span>{scanLabel.description}</span><Tag color={scanLabel.color}>{scanLabel.label}</Tag></Space>}
                    description={`文字：${factScan.textDetected ? '检测到' : '未检测到'}；二维码：${factScan.qrCodesDetected}；条码：${factScan.barcodeStatus}。仅显示最小事实摘要，不展示 OCR 原文。`}
                  /> : <Alert type="info" showIcon message="此候选未使用事实扫描放行" description="白底候选仍需保留原图证据并按三项真实性确认审核。" />}
                </Space>;
              })() : <Text type="secondary">这是一项普通封面变更申请，不包含自动生成候选。</Text>}
            </Card>
            <Space style={{ marginTop: 18 }}>
              <Button type="primary" icon={<CheckCircleOutlined />} loading={approve.isPending} onClick={() => selectedRevisionId && approve.mutate(selectedRevisionId)}>通过并切换公开图</Button>
              <Button danger icon={<CloseCircleOutlined />} loading={reject.isPending} onClick={askReject}>驳回并说明原因</Button>
            </Space>
          </> : <Empty description={selected ? '候选图已失效或不可预览' : '从左侧选择一项审核'} />}
        </Card>
      </div>
    </div>
  );
}
