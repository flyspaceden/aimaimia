import { useEffect, useMemo, useState } from 'react';
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

  useEffect(() => {
    if (!selectedId && queue.data?.[0]?.id) setSelectedId(queue.data[0].id);
    if (selectedId && queue.data && !queue.data.some((item) => item.id === selectedId)) setSelectedId(queue.data[0]?.id);
  }, [queue.data, selectedId]);

  const detail = useQuery({
    queryKey: ['admin', 'product-media-revision', selectedId],
    queryFn: () => getProductMediaRevision(selectedId!),
    enabled: Boolean(selectedId),
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
  const selected = useMemo(() => queue.data?.find((item) => item.id === selectedId), [queue.data, selectedId]);

  const askReject = () => {
    if (!selectedId) return;
    let reason = '';
    modal.confirm({
      title: '驳回封面变更',
      content: <Input.TextArea autoFocus rows={3} placeholder="请说明需要重拍、补图或修正的事实问题" onChange={(event) => { reason = event.target.value; }} />,
      okText: '确认驳回',
      okButtonProps: { danger: true, loading: reject.isPending },
      onOk: async () => {
        if (!reason.trim()) return Promise.reject(new Error('请填写驳回原因'));
        await reject.mutateAsync({ id: selectedId, note: reason.trim() });
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
          {queue.isLoading ? <div style={{ padding: 28, textAlign: 'center' }}><Spin /></div> : queue.data?.length ? <List dataSource={queue.data} renderItem={(item) => <QueueLabel item={item} selected={item.id === selectedId} onSelect={() => setSelectedId(item.id)} />} /> : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无待审核封面变更" style={{ margin: '44px 0' }} />}
        </Card>
        <Card>
          {detail.isLoading ? <div style={{ padding: 72, textAlign: 'center' }}><Spin /></div> : detail.data ? <>
            <Descriptions size="small" column={{ xs: 1, sm: 3 }} style={{ marginBottom: 16 }}>
              <Descriptions.Item label="商品">{detail.data.product.title}</Descriptions.Item>
              <Descriptions.Item label="商户">{detail.data.company.name}</Descriptions.Item>
              <Descriptions.Item label="提交时间">{new Date(detail.data.revision.createdAt).toLocaleString('zh-CN')}</Descriptions.Item>
            </Descriptions>
            <Alert type="info" showIcon icon={<EyeOutlined />} message="审核标准：候选图只能替换展示背景与构图；数量、型号、包装文字、颜色、规格和可见瑕疵必须保持真实。" style={{ marginBottom: 16 }} />
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
              <Card size="small" title="当前公开图" styles={{ body: { background: '#fafafa' } }}>
                <Image.PreviewGroup>{detail.data.product.media.length ? detail.data.product.media.map((media) => <Image key={media.id} src={media.url} width={128} height={160} style={{ objectFit: 'cover', marginRight: 8, marginBottom: 8 }} />) : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="无当前图片" />}</Image.PreviewGroup>
              </Card>
              <Card size="small" title="申请替换图" styles={{ body: { background: '#f6ffed' } }}>
                <Image.PreviewGroup>{detail.data.proposedMedia.map((media) => <Image key={media.assetId} src={media.displayUrl} width={128} height={160} style={{ objectFit: 'cover', marginRight: 8, marginBottom: 8 }} />)}</Image.PreviewGroup>
              </Card>
            </div>
            <Card size="small" title="商家真实性确认" style={{ marginTop: 16 }}>
              <Space wrap>{truthChecks.map(([key, label]) => <Tag key={key} color={detail.data.revision.attestation?.[key] ? 'green' : 'red'}>{detail.data.revision.attestation?.[key] ? '已确认' : '缺失'} · {label}</Tag>)}</Space>
            </Card>
            <Space style={{ marginTop: 18 }}>
              <Button type="primary" icon={<CheckCircleOutlined />} loading={approve.isPending} onClick={() => selectedId && approve.mutate(selectedId)}>通过并切换公开图</Button>
              <Button danger icon={<CloseCircleOutlined />} loading={reject.isPending} onClick={askReject}>驳回并说明原因</Button>
            </Space>
          </> : <Empty description={selected ? '候选图已失效或不可预览' : '从左侧选择一项审核'} />}
        </Card>
      </div>
    </div>
  );
}
