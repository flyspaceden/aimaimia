import { useState } from 'react';
import { Table, Tag, Space, Tabs, Typography } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import {
  CustomerServiceOutlined,
} from '@ant-design/icons';
import { useQuery } from '@tanstack/react-query';
import { getCsTickets, type CsTicket } from '@/api/cs';
import dayjs from 'dayjs';

const { Text } = Typography;

// 工单状态 Tab
const STATUS_TABS = [
  { key: 'ALL', label: '全部' },
  { key: 'OPEN', label: '待处理' },
  { key: 'IN_PROGRESS', label: '处理中' },
  { key: 'RESOLVED', label: '已解决' },
  { key: 'CLOSED', label: '已关闭' },
];

// 类别颜色映射
const categoryColorMap: Record<string, string> = {
  ORDER: 'blue',
  PRODUCT: 'cyan',
  DELIVERY: 'orange',
  PAYMENT: 'gold',
  REFUND: 'red',
  ACCOUNT: 'purple',
  OTHER: 'default',
};

// 优先级颜色映射
const priorityColorMap: Record<string, string> = {
  LOW: 'default',
  MEDIUM: 'blue',
  HIGH: 'orange',
  URGENT: 'red',
};

// 状态颜色映射
const statusColorMap: Record<string, string> = {
  OPEN: 'warning',
  IN_PROGRESS: 'processing',
  RESOLVED: 'success',
  CLOSED: 'default',
};

export default function CsTicketsPage() {
  const [activeTab, setActiveTab] = useState('ALL');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);

  const { data, isLoading } = useQuery({
    queryKey: ['admin', 'cs', 'tickets', activeTab, page, pageSize],
    queryFn: () =>
      getCsTickets({
        ...(activeTab !== 'ALL' ? { status: activeTab } : {}),
        page,
        pageSize,
      }),
  });

  const columns: ColumnsType<CsTicket> = [
    {
      title: '工单号',
      dataIndex: 'id',
      width: 100,
      ellipsis: true,
      render: (id: string) => (
        <Text copyable={{ text: id }} style={{ fontSize: 12 }}>
          {id.slice(0, 8)}...
        </Text>
      ),
    },
    {
      title: '用户',
      dataIndex: ['user', 'profile', 'nickname'],
      width: 120,
      render: (_: unknown, record: CsTicket) =>
        record.user?.profile?.nickname || <Text type="secondary">未设置昵称</Text>,
    },
    {
      title: '类别',
      dataIndex: 'category',
      width: 100,
      render: (category: string) => (
        <Tag color={categoryColorMap[category] || 'default'}>{category}</Tag>
      ),
    },
    {
      title: '优先级',
      dataIndex: 'priority',
      width: 80,
      render: (priority: string) => (
        <Tag color={priorityColorMap[priority] || 'default'}>{priority}</Tag>
      ),
    },
    {
      title: '状态',
      dataIndex: 'status',
      width: 90,
      render: (status: string) => (
        <Tag color={statusColorMap[status] || 'default'}>{status}</Tag>
      ),
    },
    {
      title: 'AI摘要',
      dataIndex: 'summary',
      width: 200,
      ellipsis: true,
      render: (summary: string | null) =>
        summary || <Text type="secondary">-</Text>,
    },
    {
      title: '处理人',
      dataIndex: 'resolvedBy',
      width: 100,
      render: (val: string | null) =>
        val || <Text type="secondary">-</Text>,
    },
    {
      title: '创建时间',
      dataIndex: 'createdAt',
      width: 160,
      render: (val: string) => dayjs(val).format('YYYY-MM-DD HH:mm'),
    },
  ];

  // 展开行渲染：显示关联会话列表
  const expandedRowRender = (record: CsTicket) => {
    if (!record.sessions || record.sessions.length === 0) {
      return <Text type="secondary">暂无关联会话</Text>;
    }
    const sessionColumns: ColumnsType<CsTicket['sessions'][number]> = [
      {
        title: '会话ID',
        dataIndex: 'id',
        width: 200,
        render: (id: string) => (
          <Text style={{ fontSize: 12 }}>{id.slice(0, 12)}...</Text>
        ),
      },
      {
        title: '状态',
        dataIndex: 'status',
        width: 120,
        render: (status: string) => <Tag>{status}</Tag>,
      },
      {
        title: '创建时间',
        dataIndex: 'createdAt',
        width: 160,
        render: (val: string) => dayjs(val).format('YYYY-MM-DD HH:mm'),
      },
    ];
    return (
      <Table
        columns={sessionColumns}
        dataSource={record.sessions}
        rowKey="id"
        pagination={false}
        size="small"
      />
    );
  };

  return (
    <div style={{ padding: 24 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <Space>
          <CustomerServiceOutlined style={{ fontSize: 18 }} />
          <span style={{ fontSize: 16, fontWeight: 500 }}>工单管理</span>
        </Space>
      </div>

      <Tabs
        activeKey={activeTab}
        onChange={(key) => {
          setActiveTab(key);
          setPage(1);
        }}
        items={STATUS_TABS.map((t) => ({ key: t.key, label: t.label }))}
        style={{ marginBottom: 16 }}
      />

      <Table<CsTicket>
        columns={columns}
        dataSource={data?.items || []}
        rowKey="id"
        loading={isLoading}
        expandable={{ expandedRowRender }}
        pagination={{
          current: page,
          pageSize,
          total: data?.total || 0,
          showSizeChanger: true,
          showQuickJumper: true,
          onChange: (p, ps) => {
            setPage(p);
            setPageSize(ps);
          },
        }}
        size="middle"
        scroll={{ x: 1000 }}
      />
    </div>
  );
}
