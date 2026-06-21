import { useQuery } from '@tanstack/react-query';
import { Card } from 'antd';
import { useParams } from 'react-router-dom';
import { getDeliveryUnit } from '@/api/delivery-management';
import { DetailDescriptions, JsonBlock, NotFoundPanel, PageHeader, StatusPill } from './components';
import { formatAddress, formatDateTime } from './utils';

export default function DeliveryUnitDetailPage() {
  const { id } = useParams<{ id: string }>();
  const query = useQuery({
    queryKey: ['delivery-unit-detail', id],
    queryFn: () => getDeliveryUnit(id ?? ''),
    enabled: Boolean(id),
  });

  if (!id) {
    return <NotFoundPanel title="缺少配送单位编号" />;
  }

  if (query.isError) {
    return <NotFoundPanel title="配送单位不存在或无法加载" subtitle={(query.error as Error).message} />;
  }

  const data = query.data;

  return (
    <div style={{ padding: 24 }}>
      <PageHeader
        title="单位详情"
        subtitle="查看单位基础档案、禁用原因和扩展字段。"
      />
      <Card loading={query.isLoading}>
        {data ? (
          <DetailDescriptions
            items={[
              { key: 'id', label: '单位编号', children: data.id },
              { key: 'name', label: '单位名称', children: data.name },
              { key: 'user', label: '所属用户', children: data.user?.nickname || data.user?.phone || data.userId },
              { key: 'contactName', label: '联系人', children: data.contactName },
              { key: 'contactPhone', label: '联系电话', children: data.contactPhone },
              { key: 'status', label: '状态', children: <StatusPill value={data.status} /> },
              { key: 'address', label: '地址', children: formatAddress(data) },
              { key: 'remark', label: '备注', children: data.remark ?? '-' },
              { key: 'disabledReason', label: '禁用原因', children: data.disabledReason ?? '-' },
              { key: 'createdAt', label: '创建时间', children: formatDateTime(data.createdAt) },
              { key: 'updatedAt', label: '更新时间', children: formatDateTime(data.updatedAt) },
            ]}
          />
        ) : null}
      </Card>

      <Card title="扩展字段" style={{ marginTop: 16 }}>
        <JsonBlock value={data?.extraFields} />
      </Card>
    </div>
  );
}
