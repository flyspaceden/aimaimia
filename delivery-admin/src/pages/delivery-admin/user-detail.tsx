import { useQuery } from '@tanstack/react-query';
import { Card } from 'antd';
import { useParams } from 'react-router-dom';
import { getDeliveryUser } from '@/api/delivery-management';
import { DetailDescriptions, JsonBlock, NotFoundPanel, PageHeader, StatusPill } from './components';
import { formatDateTime } from './utils';

export default function DeliveryUserDetailPage() {
  const { id } = useParams<{ id: string }>();

  const query = useQuery({
    queryKey: ['delivery-user-detail', id],
    queryFn: () => getDeliveryUser(id ?? ''),
    enabled: Boolean(id),
  });

  if (!id) {
    return <NotFoundPanel title="缺少配送用户 ID" />;
  }

  if (query.isError) {
    return <NotFoundPanel title="配送用户不存在或无法加载" subtitle={(query.error as Error).message} />;
  }

  const data = query.data;

  return (
    <div style={{ padding: 24 }}>
      <PageHeader
        title="用户详情"
        subtitle="配送用户账号、登录状态与当前单位信息。"
      />
      <Card loading={query.isLoading}>
        {data ? (
          <DetailDescriptions
            items={[
              { key: 'id', label: '用户 ID', children: data.id },
              { key: 'phone', label: '手机号', children: data.phone ?? '-' },
              { key: 'nickname', label: '昵称', children: data.nickname ?? '-' },
              { key: 'status', label: '状态', children: <StatusPill value={data.status} /> },
              { key: 'currentUnit', label: '当前单位', children: data.currentUnit?.name ?? '-' },
              { key: 'lockedUntil', label: '锁定至', children: formatDateTime(data.lockedUntil) },
              { key: 'lastLoginAt', label: '最近登录', children: formatDateTime(data.lastLoginAt) },
              { key: 'createdAt', label: '创建时间', children: formatDateTime(data.createdAt) },
              { key: 'updatedAt', label: '更新时间', children: formatDateTime(data.updatedAt) },
            ]}
          />
        ) : null}
      </Card>

      {data?.currentUnit ? (
        <Card title="当前单位" style={{ marginTop: 16 }}>
          <DetailDescriptions
            items={[
              { key: 'unitId', label: '单位 ID', children: data.currentUnit.id },
              { key: 'unitName', label: '单位名称', children: data.currentUnit.name },
              { key: 'contactName', label: '联系人', children: data.currentUnit.contactName },
              { key: 'contactPhone', label: '联系电话', children: data.currentUnit.contactPhone },
              {
                key: 'extraFields',
                label: '扩展字段',
                children: <JsonBlock value={data.currentUnit.extraFields} />,
              },
            ]}
          />
        </Card>
      ) : null}
    </div>
  );
}
