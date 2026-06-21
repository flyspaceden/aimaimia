import { useQuery } from '@tanstack/react-query';
import { Table, Tag, Typography } from 'antd';
import { ProCard } from '@ant-design/pro-components';
import type { ColumnsType } from 'antd/es/table';
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
        subtitle="配送专属 FAQ 接口接入前，本页展示当前配送客服默认常见问题。"
      />

      <ProCard title="常见问题" headerBordered>
        <Table<FaqRow>
          rowKey="id"
          columns={columns}
          dataSource={rows}
          loading={configQuery.isLoading}
          locale={{ emptyText: '暂无常见问题，请在坐席快捷回复中维护默认问题' }}
          pagination={false}
        />
        <Typography.Text type="secondary">
          后续补齐配送 FAQ 独立接口后，本页会切换为新增、编辑、启停和测试命中的完整管理页。
        </Typography.Text>
      </ProCard>
    </div>
  );
}
