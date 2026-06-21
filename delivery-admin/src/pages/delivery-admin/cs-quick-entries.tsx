import { useQuery } from '@tanstack/react-query';
import { Table, Tag, Typography } from 'antd';
import { ProCard } from '@ant-design/pro-components';
import type { ColumnsType } from 'antd/es/table';
import { getDeliveryConfig } from '@/api/delivery-management';
import { PageHeader } from './components';
import { getCustomerServiceDefaults } from './cs-helpers';

type QuickEntryRow = {
  id: string;
  label: string;
  action: string;
  enabled: boolean;
  sortOrder: number;
};

export default function DeliveryCsQuickEntriesPage() {
  const configQuery = useQuery({
    queryKey: ['delivery-config', 'customer-service-defaults'],
    queryFn: () => getDeliveryConfig('CUSTOMER_SERVICE'),
  });

  const defaults = getCustomerServiceDefaults(configQuery.data);
  const rows: QuickEntryRow[] = defaults.quickQuestions.map((question, index) => ({
    id: String(index + 1),
    label: question,
    action: '发送常见问题',
    enabled: true,
    sortOrder: index + 1,
  }));

  const columns: ColumnsType<QuickEntryRow> = [
    { title: '入口名称', dataIndex: 'label', ellipsis: true },
    { title: '动作', dataIndex: 'action', width: 140 },
    { title: '状态', dataIndex: 'enabled', width: 100, render: (enabled: boolean) => <Tag color={enabled ? 'green' : 'default'}>{enabled ? '启用' : '停用'}</Tag> },
    { title: '排序', dataIndex: 'sortOrder', width: 90 },
  ];

  return (
    <div style={{ padding: 24 }}>
      <PageHeader
        title="配送快捷入口配置"
        subtitle="展示配送 App 客服入口可用的常见问题入口。"
      />

      <ProCard title="快捷入口" headerBordered>
        <Table<QuickEntryRow>
          rowKey="id"
          columns={columns}
          dataSource={rows}
          loading={configQuery.isLoading}
          locale={{ emptyText: '暂无快捷入口，请在坐席快捷回复中维护默认问题' }}
          pagination={false}
        />
        <Typography.Text type="secondary">
          后续补齐配送快捷入口独立接口后，本页会支持拖拽排序、新增入口和启停开关。
        </Typography.Text>
      </ProCard>
    </div>
  );
}
