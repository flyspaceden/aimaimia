import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Button, Card, Drawer, Input, Space, Table } from 'antd';
import type { ColumnsType, TablePaginationConfig } from 'antd/es/table';
import { getDeliveryAuditLogs } from '@/api/delivery-management';
import type { DeliveryAuditLog } from '@/types/delivery-management';
import { JsonBlock, PageHeader } from './components';
import { formatDateTime, getErrorMessage } from './utils';

export default function DeliveryAuditPage() {
  const [keywordInput, setKeywordInput] = useState('');
  const [keyword, setKeyword] = useState('');
  const [selected, setSelected] = useState<DeliveryAuditLog | null>(null);
  const [pagination, setPagination] = useState<TablePaginationConfig>({
    current: 1,
    pageSize: 20,
  });

  const query = useQuery({
    queryKey: ['delivery-audit', pagination.current, pagination.pageSize, keyword],
    queryFn: () =>
      getDeliveryAuditLogs({
        page: pagination.current,
        pageSize: pagination.pageSize,
        keyword,
      }),
  });

  const columns: ColumnsType<DeliveryAuditLog> = [
    { title: '日志 ID', dataIndex: 'id', key: 'id', width: 150, ellipsis: true },
    { title: '模块', dataIndex: 'module', key: 'module', width: 140 },
    { title: '动作', dataIndex: 'action', key: 'action', width: 120 },
    { title: '目标类型', dataIndex: 'targetType', key: 'targetType', width: 130 },
    { title: '目标 ID', dataIndex: 'targetId', key: 'targetId', width: 150, ellipsis: true },
    { title: '摘要', dataIndex: 'summary', key: 'summary', ellipsis: true },
    { title: '操作者', dataIndex: 'actorId', key: 'actorId', width: 150, ellipsis: true },
    { title: '时间', dataIndex: 'createdAt', key: 'createdAt', width: 150, render: formatDateTime },
    {
      title: '操作',
      key: 'actionView',
      width: 100,
      fixed: 'right',
      render: (_, record) => (
        <Button type="link" size="small" onClick={() => setSelected(record)}>
          查看
        </Button>
      ),
    },
  ];

  return (
    <div style={{ padding: 24 }}>
      <PageHeader
        title="配送审计日志"
        subtitle="支持按 module / action / summary 模糊检索。"
        extra={(
          <Input.Search
            allowClear
            placeholder="搜模块、动作或摘要"
            style={{ width: 280 }}
            value={keywordInput}
            onChange={(event) => setKeywordInput(event.target.value)}
            onSearch={(value) => {
              setKeyword(value.trim());
              setPagination((prev) => ({ ...prev, current: 1 }));
            }}
          />
        )}
      />

      <Card>
        <Table<DeliveryAuditLog>
          rowKey="id"
          columns={columns}
          dataSource={query.data?.items ?? []}
          loading={query.isLoading}
          scroll={{ x: 1320 }}
          locale={{ emptyText: query.isError ? getErrorMessage(query.error) : '暂无审计日志' }}
          pagination={{
            current: query.data?.page ?? pagination.current,
            pageSize: query.data?.pageSize ?? pagination.pageSize,
            total: query.data?.total ?? 0,
            showSizeChanger: true,
          }}
          onChange={(nextPagination) => setPagination(nextPagination)}
        />
      </Card>

      <Drawer
        open={Boolean(selected)}
        width={720}
        title="审计详情"
        onClose={() => setSelected(null)}
      >
        {selected ? (
          <Space direction="vertical" size={16} style={{ width: '100%' }}>
            <div>
              <strong>{selected.module}</strong> / {selected.action}
            </div>
            <div>{selected.summary || '无摘要'}</div>
            <div>目标: {selected.targetType || '-'} / {selected.targetId || '-'}</div>
            <div>操作者: {selected.actorType} / {selected.actorId || '-'}</div>
            <div>IP: {selected.ip || '-'}</div>
            <div>时间: {formatDateTime(selected.createdAt)}</div>
            <Card size="small" title="Before">
              <JsonBlock value={selected.before} />
            </Card>
            <Card size="small" title="After">
              <JsonBlock value={selected.after} />
            </Card>
            <Card size="small" title="Diff">
              <JsonBlock value={selected.diff} />
            </Card>
          </Space>
        ) : null}
      </Drawer>
    </div>
  );
}
