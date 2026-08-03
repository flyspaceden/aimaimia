import { useQuery } from '@tanstack/react-query';
import { Button, Space, Table, Tag, Typography } from 'antd';
import { ProCard } from '@ant-design/pro-components';
import type { ColumnsType } from 'antd/es/table';
import { useNavigate } from 'react-router-dom';
import { getDeliveryCustomerServiceConfig } from '@/api/delivery-management';
import { PageHeader } from './components';
import { getCustomerServiceDefaults } from './cs-helpers';
import useAuthStore from '@/store/useAuthStore';

type QuickEntryRow = {
  id: string;
  label: string;
  action: string;
  enabled: boolean;
  sortOrder: number;
};

export default function DeliveryCsQuickEntriesPage() {
  const navigate = useNavigate();
  const canWrite = useAuthStore((state) => state.hasPermission('delivery:customer-service:write'));
  const configQuery = useQuery({
    queryKey: ['delivery-config', 'customer-service-defaults'],
    queryFn: getDeliveryCustomerServiceConfig,
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
        subtitle="查看配送 App 客服页的快捷问题入口，入口内容由坐席快捷回复配置统一维护。"
        extra={<Button type={canWrite ? 'primary' : 'default'} onClick={() => navigate('/cs/quick-replies')}>{canWrite ? '维护入口内容' : '查看入口配置'}</Button>}
      />

      <ProCard title="快捷入口" headerBordered>
        <Space direction="vertical" size={12} style={{ width: '100%' }}>
          <Typography.Text type="secondary">
            买家点击快捷入口后会带入对应常见问题，便于客服快速识别咨询场景。
          </Typography.Text>
        <Table<QuickEntryRow>
          rowKey="id"
          columns={columns}
          dataSource={rows}
          loading={configQuery.isLoading}
          locale={{ emptyText: '暂无快捷入口，请在坐席快捷回复中维护默认问题' }}
          pagination={false}
        />
        </Space>
      </ProCard>
    </div>
  );
}
