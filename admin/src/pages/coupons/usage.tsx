import { useRef } from 'react';
import { ProTable } from '@ant-design/pro-components';
import type { ActionType, ProColumns } from '@ant-design/pro-components';
import { getUsageRecords } from '@/api/coupon';
import type { CouponUsageRecord } from '@/api/coupon';
import dayjs from 'dayjs';

export default function UsageRecordPage() {
  const actionRef = useRef<ActionType>(null);

  const columns: ProColumns<CouponUsageRecord>[] = [
    {
      title: '订单编号',
      width: 180,
      ellipsis: true,
      render: (_: unknown, r: CouponUsageRecord) =>
        r.order?.orderNo ? (
          <a href={`/orders/${r.orderId}`} target="_blank" rel="noreferrer">
            {r.order.orderNo}
          </a>
        ) : (
          r.orderId
        ),
    },
    {
      title: '订单ID',
      dataIndex: 'orderId',
      width: 180,
      ellipsis: true,
      hideInTable: true,
    },
    {
      title: '用户',
      width: 140,
      search: false,
      render: (_: unknown, r: CouponUsageRecord) =>
        r.couponInstance?.user?.profile?.nickname || '-',
    },
    {
      title: '活动名称',
      width: 180,
      search: false,
      ellipsis: true,
      render: (_: unknown, r: CouponUsageRecord) =>
        r.couponInstance?.campaign?.name || '-',
    },
    {
      title: '抵扣金额',
      dataIndex: 'discountAmount',
      width: 120,
      search: false,
      render: (_: unknown, r: CouponUsageRecord) => (
        <span style={{ color: '#f5222d', fontWeight: 500 }}>
          -¥{r.discountAmount.toFixed(2)}
        </span>
      ),
    },
    {
      title: '使用时间',
      dataIndex: 'createdAt',
      width: 180,
      search: false,
      render: (_: unknown, r: CouponUsageRecord) =>
        dayjs(r.createdAt).format('YYYY-MM-DD HH:mm:ss'),
    },
  ];

  return (
    <div>
      <ProTable<CouponUsageRecord>
        headerTitle="红包使用记录"
        actionRef={actionRef}
        rowKey="id"
        columns={columns}
        request={async (params) => {
          const { current, pageSize, orderId } = params;
          const res = await getUsageRecords({
            page: current,
            pageSize,
            orderId: orderId || undefined,
          });
          return { data: res.items, total: res.total, success: true };
        }}
        scroll={{ x: 900 }}
        search={{ labelWidth: 'auto' }}
        pagination={{ defaultPageSize: 20 }}
      />
    </div>
  );
}
