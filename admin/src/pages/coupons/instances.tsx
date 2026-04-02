import { useRef } from 'react';
import { ProTable } from '@ant-design/pro-components';
import type { ActionType, ProColumns } from '@ant-design/pro-components';
import { Tag, Button, Space, Popconfirm, message } from 'antd';
import { RollbackOutlined } from '@ant-design/icons';
import { getInstances, revokeInstance } from '@/api/coupon';
import type { CouponInstance } from '@/api/coupon';
import { couponInstanceStatusMap } from '@/constants/statusMaps';
import PermissionGate from '@/components/PermissionGate';
import { PERMISSIONS } from '@/constants/permissions';
import dayjs from 'dayjs';

export default function InstanceListPage() {
  const actionRef = useRef<ActionType>(null);

  // 撤回红包
  const handleRevoke = async (id: string) => {
    try {
      await revokeInstance(id);
      message.success('红包已撤回');
      actionRef.current?.reload();
    } catch (err) {
      message.error(err instanceof Error ? err.message : '撤回失败');
    }
  };

  // 判断是否即将过期（3天内）
  const isNearExpiry = (expiresAt: string): boolean => {
    const diff = dayjs(expiresAt).diff(dayjs(), 'day');
    return diff >= 0 && diff <= 3;
  };

  const columns: ProColumns<CouponInstance>[] = [
    {
      title: '用户',
      width: 140,
      search: false,
      render: (_: unknown, r: CouponInstance) =>
        r.user?.profile?.nickname || r.userId,
    },
    {
      title: '用户ID',
      dataIndex: 'userId',
      width: 180,
      ellipsis: true,
    },
    {
      title: '活动名称',
      width: 160,
      search: false,
      ellipsis: true,
      render: (_: unknown, r: CouponInstance) =>
        r.campaign?.name || r.campaignId,
    },
    {
      title: '抵扣规则',
      width: 140,
      search: false,
      render: (_: unknown, r: CouponInstance) => {
        if (r.discountType === 'FIXED') {
          return r.minOrderAmount > 0
            ? `满${r.minOrderAmount}减${r.discountValue}`
            : `立减${r.discountValue}元`;
        }
        const disc = (100 - r.discountValue) / 10;
        let text = `${disc}折`;
        if (r.maxDiscountAmount) text += `(最高${r.maxDiscountAmount})`;
        return text;
      },
    },
    {
      title: '发放时间',
      dataIndex: 'issuedAt',
      width: 160,
      search: false,
      render: (_: unknown, r: CouponInstance) =>
        dayjs(r.issuedAt).format('YYYY-MM-DD HH:mm'),
    },
    {
      title: '过期时间',
      dataIndex: 'expiresAt',
      width: 160,
      search: false,
      render: (_: unknown, r: CouponInstance) => {
        const expired = dayjs(r.expiresAt).isBefore(dayjs());
        const nearExpiry = isNearExpiry(r.expiresAt);
        return (
          <span style={{ color: expired ? '#ff4d4f' : nearExpiry ? '#faad14' : undefined }}>
            {dayjs(r.expiresAt).format('YYYY-MM-DD HH:mm')}
            {nearExpiry && !expired && ' (即将过期)'}
          </span>
        );
      },
    },
    {
      title: '状态',
      dataIndex: 'status',
      width: 100,
      valueType: 'select',
      valueEnum: Object.fromEntries(
        Object.entries(couponInstanceStatusMap).map(([k, v]) => [k, { text: v.text }]),
      ),
      render: (_: unknown, r: CouponInstance) => {
        const s = couponInstanceStatusMap[r.status];
        return <Tag color={s?.color}>{s?.text || r.status}</Tag>;
      },
    },
    {
      title: '使用订单',
      dataIndex: 'usedOrderId',
      width: 160,
      search: false,
      ellipsis: true,
      render: (_: unknown, r: CouponInstance) =>
        r.usedOrderId ? (
          <a href={`/orders/${r.usedOrderId}`} target="_blank" rel="noreferrer">
            {r.usedOrderId}
          </a>
        ) : (
          '-'
        ),
    },
    {
      title: '抵扣金额',
      dataIndex: 'usedAmount',
      width: 100,
      search: false,
      render: (_: unknown, r: CouponInstance) =>
        r.usedAmount != null ? `¥${r.usedAmount.toFixed(2)}` : '-',
    },
    {
      title: '操作',
      key: 'action',
      width: 100,
      search: false,
      render: (_: unknown, record: CouponInstance) => (
        <Space>
          {record.status === 'AVAILABLE' && (
            <PermissionGate permission={PERMISSIONS.COUPON_MANAGE}>
              <Popconfirm
                title="确认撤回该红包？"
                description="撤回后用户将无法使用该红包"
                onConfirm={() => handleRevoke(record.id)}
              >
                <Button type="link" size="small" danger icon={<RollbackOutlined />}>
                  撤回
                </Button>
              </Popconfirm>
            </PermissionGate>
          )}
        </Space>
      ),
    },
  ];

  return (
    <div>
      <ProTable<CouponInstance>
        headerTitle="红包发放记录"
        actionRef={actionRef}
        rowKey="id"
        columns={columns}
        request={async (params) => {
          const { current, pageSize, status, userId } = params;
          const res = await getInstances({
            page: current,
            pageSize,
            status: status || undefined,
            userId: userId || undefined,
          });
          return { data: res.items, total: res.total, success: true };
        }}
        scroll={{ x: 1200 }}
        search={{ labelWidth: 'auto' }}
        pagination={{ defaultPageSize: 20 }}
      />
    </div>
  );
}
