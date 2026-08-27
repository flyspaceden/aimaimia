import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Alert, App, Button, Card, Descriptions, Empty, Image, Input, List, Space, Spin, Tag, Typography } from 'antd';
import { EyeOutlined, RollbackOutlined } from '@ant-design/icons';
import {
  getProductMediaRevision,
  getPublishedProductMediaRevisions,
  rollbackProductMediaRevision,
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
  BACKGROUND_GENERATION: 'AI 生成候选',
};

function RevisionLabel({ item, selected, onSelect }: { item: ProductMediaRevisionQueueItem; selected: boolean; onSelect: () => void }) {
  const rolledBack = item.status === 'ROLLED_BACK_BY_ADMIN';
  return (
    <List.Item
      onClick={onSelect}
      style={{ cursor: 'pointer', padding: '12px 14px', background: selected ? '#e6f4ff' : undefined, borderLeft: selected ? '3px solid #1677ff' : '3px solid transparent' }}
    >
      <List.Item.Meta
        title={<Space size={6}><Text strong>{item.product.title}</Text><Tag color={rolledBack ? 'default' : 'blue'}>{rolledBack ? '已回滚' : '已发布'}</Tag></Space>}
        description={<Space direction="vertical" size={0}><Text type="secondary">{item.company.name}</Text><Text type="secondary" style={{ fontSize: 12 }}>{new Date(item.createdAt).toLocaleString('zh-CN')}</Text></Space>}
      />
    </List.Item>
  );
}

function MediaGallery({ title, media, tone }: { title: string; media: Array<{ assetId: string; displayUrl: string; isEvidenceImage: boolean }>; tone: 'before' | 'after' }) {
  return (
    <Card size="small" title={title} styles={{ body: { background: tone === 'before' ? '#fafafa' : '#f6ffed' } }}>
      {media.length ? <Image.PreviewGroup>{media.map((item) => <Space key={item.assetId} direction="vertical" size={4} style={{ marginRight: 8, marginBottom: 8 }}><Image src={item.displayUrl} width={128} height={160} style={{ objectFit: 'cover' }} />{item.isEvidenceImage && <Tag color="blue">原实拍证据</Tag>}</Space>)}</Image.PreviewGroup> : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="无可恢复图片" />}
    </Card>
  );
}

export default function ProductMediaRevisionPage() {
  const { message, modal } = App.useApp();
  const queryClient = useQueryClient();
  const [selectedId, setSelectedId] = useState<string>();
  const queue = useQuery({ queryKey: ['admin', 'product-media-revisions', 'published'], queryFn: getPublishedProductMediaRevisions, refetchInterval: 30_000 });
  const selectedRevisionId = selectedId && queue.data?.some((item) => item.id === selectedId)
    ? selectedId
    : queue.data?.[0]?.id;
  const detail = useQuery({
    queryKey: ['admin', 'product-media-revision', selectedRevisionId],
    queryFn: () => getProductMediaRevision(selectedRevisionId!),
    enabled: Boolean(selectedRevisionId),
    refetchInterval: 240_000,
  });
  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: ['admin', 'product-media-revisions'] });
    await queryClient.invalidateQueries({ queryKey: ['admin', 'product-media-revision'] });
  };
  const rollback = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) => rollbackProductMediaRevision(id, reason),
    onSuccess: async () => {
      message.success('公开商品图已恢复到商家变更前的历史版本，商家已收到通知。');
      await refresh();
    },
    onError: (error) => message.error(error instanceof Error ? error.message : '图片回滚失败，请刷新后重试'),
  });
  const selected = useMemo(() => queue.data?.find((item) => item.id === selectedRevisionId), [queue.data, selectedRevisionId]);
  const askRollback = () => {
    if (!selectedRevisionId) return;
    let reason = '';
    modal.confirm({
      title: '回滚公开商品图片',
      content: <Input.TextArea autoFocus rows={3} placeholder="说明不符合平台规则的具体原因；这会通知商家并恢复其变更前图片" onChange={(event) => { reason = event.target.value; }} />,
      okText: '恢复历史图片',
      okButtonProps: { danger: true, loading: rollback.isPending },
      onOk: async () => {
        if (!reason.trim()) {
          message.warning('请填写回滚原因');
          return Promise.reject(new Error('请填写回滚原因'));
        }
        await rollback.mutateAsync({ id: selectedRevisionId, reason: reason.trim() });
      },
    });
  };

  const canRollback = detail.data?.revision.status === 'APPLIED_BY_SELLER'
    && detail.data.product.mediaVersion === detail.data.revision.appliedMediaVersion;
  return (
    <div style={{ maxWidth: 1440, margin: '0 auto', padding: '4px 0 24px' }}>
      <div style={{ marginBottom: 18 }}>
        <Title level={3} style={{ marginBottom: 4 }}>商品图片巡检与回滚</Title>
        <Text type="secondary">商家采用候选后立即更新公开图。平台在事后巡检中发现不符合规则时，可恢复到这次变更前的历史版本；不会覆盖更晚的商家修改。</Text>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '300px minmax(0, 1fr)', gap: 16 }}>
        <Card title={`图片变更记录 ${queue.data?.length ?? 0}`} bodyStyle={{ padding: 0 }}>
          {queue.isError ? <Alert type="error" showIcon message="图片变更记录加载失败" description={queue.error instanceof Error ? queue.error.message : '请检查网络后重试'} action={<Button size="small" onClick={() => queue.refetch()}>重新加载</Button>} style={{ margin: 12 }} /> : queue.isLoading ? <div style={{ padding: 28, textAlign: 'center' }}><Spin /></div> : queue.data?.length ? <List dataSource={queue.data} renderItem={(item) => <RevisionLabel item={item} selected={item.id === selectedRevisionId} onSelect={() => setSelectedId(item.id)} />} /> : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无需要巡检的已发布图片变更" style={{ margin: '44px 0' }} />}
        </Card>
        <Card>
          {detail.isError ? <Alert type="error" showIcon message="图片变更详情加载失败" description={detail.error instanceof Error ? detail.error.message : '请刷新后重试'} action={<Button size="small" onClick={() => detail.refetch()}>重新加载</Button>} /> : detail.isLoading ? <div style={{ padding: 72, textAlign: 'center' }}><Spin /></div> : detail.data ? <>
            <Descriptions size="small" column={{ xs: 1, sm: 3 }} style={{ marginBottom: 16 }}>
              <Descriptions.Item label="商品">{detail.data.product.title}</Descriptions.Item>
              <Descriptions.Item label="商户">{detail.data.company.name}</Descriptions.Item>
              <Descriptions.Item label="公开时间">{detail.data.revision.appliedAt ? new Date(detail.data.revision.appliedAt).toLocaleString('zh-CN') : new Date(detail.data.revision.createdAt).toLocaleString('zh-CN')}</Descriptions.Item>
            </Descriptions>
            {detail.data.revision.status === 'ROLLED_BACK_BY_ADMIN' ? <Alert type="info" showIcon message="该图片变更已回滚" description={`${detail.data.revision.rolledBackAt ? new Date(detail.data.revision.rolledBackAt).toLocaleString('zh-CN') : ''}${detail.data.revision.reviewNote ? ` · 原因：${detail.data.revision.reviewNote}` : ''}`} style={{ marginBottom: 16 }} /> : <Alert type="warning" showIcon icon={<EyeOutlined />} message="事后巡检标准" description="核对商品本体、包装文字、型号、数量、颜色、规格和可见瑕疵是否真实。确认不符合时再回滚；不需要对每一次正常换图做预审批。" style={{ marginBottom: 16 }} />}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
              <MediaGallery title="商家变更前的历史图片" media={detail.data.previousMedia} tone="before" />
              <MediaGallery title="商家采用后发布的图片" media={detail.data.proposedMedia} tone="after" />
            </div>
            <Card size="small" title="商家真实性确认" style={{ marginTop: 16 }}>
              <Space wrap>{truthChecks.map(([key, label]) => <Tag key={key} color={detail.data.revision.attestation?.[key] ? 'green' : 'red'}>{detail.data.revision.attestation?.[key] ? '已确认' : '缺失'} · {label}</Tag>)}</Space>
            </Card>
            {detail.data.reviewContext.optimization && <Card size="small" title="候选与系统验真摘要" style={{ marginTop: 16 }}>
              <Descriptions size="small" column={{ xs: 1, sm: 3 }}>
                <Descriptions.Item label="候选类型"><Tag color={detail.data.reviewContext.optimization.kind === 'FREE_TUNE' ? 'green' : 'blue'}>{optimizationLabels[detail.data.reviewContext.optimization.kind] || detail.data.reviewContext.optimization.kind}</Tag></Descriptions.Item>
                <Descriptions.Item label="处理器">{detail.data.reviewContext.optimization.provider === 'deterministic-sharp' ? '本地确定性处理（无模型调用）' : detail.data.reviewContext.optimization.provider || '未记录'}</Descriptions.Item>
                <Descriptions.Item label="费用"><Tag color={detail.data.reviewContext.optimization.costTier === 'FREE' ? 'green' : 'gold'}>{detail.data.reviewContext.optimization.costTier === 'FREE' ? '免费' : '已按模型计费'}</Tag></Descriptions.Item>
              </Descriptions>
            </Card>}
            <Space style={{ marginTop: 18 }}>
              <Button danger type="primary" icon={<RollbackOutlined />} disabled={!canRollback} loading={rollback.isPending} onClick={askRollback}>恢复到变更前图片并通知商家</Button>
              {!canRollback && <Text type="secondary">该记录已经回滚，或商家后来又更新了图片；平台不会覆盖较新的版本。</Text>}
            </Space>
          </> : <Empty description={selected ? '该历史图片已不可预览' : '从左侧选择一项图片变更'} />}
        </Card>
      </div>
    </div>
  );
}
