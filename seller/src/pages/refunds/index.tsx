import { useRef } from 'react';
import { Tag } from 'antd';
import { ProTable } from '@ant-design/pro-components';
import type { ActionType, ProColumns } from '@ant-design/pro-components';
import { getRefunds } from '@/api/refunds';
import { refundStatusMap } from '@/constants/statusMaps';
import type { Refund } from '@/types';
import { filterContactInfo } from '@/utils/privacy';
import dayjs from 'dayjs';

export default function RefundListPage({
  embedded = false,
}: {
  embedded?: boolean;
}) {
  const actionRef = useRef<ActionType>(null);

  const columns: ProColumns<Refund>[] = [
    { title: '退款单号', dataIndex: 'id', ellipsis: true, width: 180 },
    {
      title: '退款金额',
      dataIndex: 'amount',
      width: 100,
      search: false,
      render: (_, r) => `¥${r.amount.toFixed(2)}`,
    },
    {
      title: '原因',
      dataIndex: 'reason',
      ellipsis: true,
      width: 200,
      search: false,
      render: (_, r) => filterContactInfo(r.reason) || '-',
    },
    {
      title: '状态',
      dataIndex: 'status',
      width: 100,
      valueEnum: Object.fromEntries(
        Object.entries(refundStatusMap).map(([k, v]) => [k, { text: v.text }]),
      ),
      render: (_, r) => {
        const s = refundStatusMap[r.status];
        return <Tag color={s?.color}>{s?.text || r.status}</Tag>;
      },
    },
    {
      title: '买家',
      width: 100,
      search: false,
      render: (_, r) => r.order?.buyerAlias || '-',
    },
    {
      title: '地区',
      width: 120,
      search: false,
      render: (_, r) => r.order?.regionText || '-',
    },
    {
      title: '申请时间',
      dataIndex: 'createdAt',
      width: 120,
      search: false,
      render: (_, r) => dayjs(r.createdAt).format('YYYY-MM-DD'),
    },
  ];

  return (
    <ProTable<Refund>
      headerTitle={embedded ? undefined : '退款记录'}
      actionRef={actionRef}
      columns={columns}
      rowKey="id"
      scroll={{ x: 'max-content' }}
      request={async (params) => {
        const res = await getRefunds({
          page: params.current || 1,
          pageSize: params.pageSize || 20,
          status: params.status || '',
        });
        return { data: res.items, total: res.total, success: true };
      }}
      pagination={{ defaultPageSize: 20 }}
      search={{ labelWidth: 'auto' }}
    />
  );
}
