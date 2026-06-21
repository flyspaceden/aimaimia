import { useQuery } from '@tanstack/react-query';
import { Button, Space, Table, Tag, Typography } from 'antd';
import { ProCard } from '@ant-design/pro-components';
import type { ColumnsType } from 'antd/es/table';
import { useNavigate } from 'react-router-dom';
import { getDeliveryConfig } from '@/api/delivery-management';
import { PageHeader } from './components';
import { getCustomerServiceDefaults } from './cs-helpers';

type FaqRow = {
  id: string;
  question: string;
  answer: string;
  source: string;
};

export default function DeliveryCsFaqPage() {
  const navigate = useNavigate();
  const configQuery = useQuery({
    queryKey: ['delivery-config', 'customer-service-defaults'],
    queryFn: () => getDeliveryConfig('CUSTOMER_SERVICE'),
  });

  const defaults = getCustomerServiceDefaults(configQuery.data);
  const rows: FaqRow[] = defaults.quickQuestions.map((question, index) => ({
    id: String(index + 1),
    question,
    answer: defaults.defaultReply,
    source: '配送客服默认配置',
  }));

  const columns: ColumnsType<FaqRow> = [
    { title: '问题', dataIndex: 'question', ellipsis: true },
    { title: '默认答复', dataIndex: 'answer', ellipsis: true },
    { title: '来源', dataIndex: 'source', width: 160, render: (value: string) => <Tag>{value}</Tag> },
  ];

  return (
    <div style={{ padding: 24 }}>
      <PageHeader
        title="配送 FAQ 管理"
        subtitle="查看配送 App 客服入口展示的常见问题，问题内容由坐席快捷回复配置统一维护。"
        extra={<Button type="primary" onClick={() => navigate('/cs/quick-replies')}>维护常见问题</Button>}
      />

      <ProCard title="常见问题" headerBordered>
        <Space direction="vertical" size={12} style={{ width: '100%' }}>
          <Typography.Text type="secondary">
            本页用于核对买家侧常见问题展示效果；需要新增、删除或调整问题时，请进入“坐席快捷回复”维护。
          </Typography.Text>
        <Table<FaqRow>
          rowKey="id"
          columns={columns}
          dataSource={rows}
          loading={configQuery.isLoading}
          locale={{ emptyText: '暂无常见问题，请在坐席快捷回复中维护默认问题' }}
          pagination={false}
        />
        </Space>
      </ProCard>
    </div>
  );
}
