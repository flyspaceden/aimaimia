import { useRef } from 'react';
import { ProTable } from '@ant-design/pro-components';
import type { ActionType, ProColumns } from '@ant-design/pro-components';
import { Tag, Button } from 'antd';
import { EyeOutlined } from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import { getMembers } from '@/api/bonus';
import type { BonusMember } from '@/types';
import { memberTierColors as tierColors } from '@/constants/statusMaps';
import dayjs from 'dayjs';

export default function MemberListPage() {
  const actionRef = useRef<ActionType>(null);
  const navigate = useNavigate();

  const columns: ProColumns<BonusMember>[] = [
    {
      title: '用户 ID',
      dataIndex: 'userId',
      width: 140,
      search: false,
      ellipsis: true,
    },
    {
      title: '昵称',
      dataIndex: ['user', 'profile', 'nickname'],
      width: 120,
      search: false,
      render: (_: unknown, r: BonusMember) => r.user?.profile?.nickname || '-',
    },
    {
      title: '等级',
      dataIndex: 'tier',
      width: 100,
      valueType: 'select',
      initialValue: 'VIP',
      valueEnum: { NORMAL: { text: '普通' }, VIP: { text: 'VIP' } },
      render: (_: unknown, r: BonusMember) => (
        <Tag color={tierColors[r.tier] || 'default'}>
          {r.tier === 'VIP' ? 'VIP' : '普通'}
        </Tag>
      ),
    },
    {
      title: '推荐码',
      dataIndex: 'referralCode',
      width: 120,
      search: false,
      render: (_: unknown, r: BonusMember) => r.referralCode || '-',
    },
    {
      title: '可用余额',
      dataIndex: ['wallet', 'balance'],
      width: 120,
      search: false,
      render: (_: unknown, r: BonusMember) =>
        r.wallet != null ? `¥${r.wallet.balance.toFixed(2)}` : '-',
    },
    {
      title: '冻结金额',
      dataIndex: ['wallet', 'frozen'],
      width: 120,
      search: false,
      render: (_: unknown, r: BonusMember) =>
        r.wallet != null ? `¥${r.wallet.frozen.toFixed(2)}` : '-',
    },
    {
      title: '奖励树层级',
      dataIndex: 'treeLevel',
      width: 100,
      search: false,
      render: (_: unknown, r: BonusMember) =>
        r.treeLevel != null ? r.treeLevel : '-',
    },
    {
      title: '自购次数',
      dataIndex: 'selfPurchaseCount',
      width: 100,
      search: false,
      render: (_: unknown, r: BonusMember) =>
        r.selfPurchaseCount != null ? r.selfPurchaseCount : '-',
    },
    {
      title: 'VIP 开通时间',
      dataIndex: 'vipPurchasedAt',
      width: 160,
      search: false,
      render: (_: unknown, r: BonusMember) =>
        r.vipPurchasedAt ? dayjs(r.vipPurchasedAt).format('YYYY-MM-DD HH:mm') : '-',
    },
    {
      title: '加入时间',
      dataIndex: 'createdAt',
      width: 160,
      search: false,
      render: (_: unknown, r: BonusMember) => dayjs(r.createdAt).format('YYYY-MM-DD HH:mm'),
    },
    {
      title: '操作',
      width: 80,
      search: false,
      render: (_: unknown, r: BonusMember) => (
        <Button
          type="link"
          size="small"
          icon={<EyeOutlined />}
          onClick={() => navigate(`/bonus/members/${r.userId}`)}
        >
          查看
        </Button>
      ),
    },
  ];

  return (
    <div style={{ padding: 24 }}>
      <ProTable<BonusMember>
        headerTitle="VIP 会员"
        actionRef={actionRef}
        rowKey="id"
        columns={columns}
        request={async (params) => {
          const { current, pageSize, tier } = params;
          const res = await getMembers({ page: current, pageSize, tier });
          return { data: res.items, total: res.total, success: true };
        }}
        scroll={{ x: 1400 }}
        search={{ labelWidth: 'auto' }}
        pagination={{ defaultPageSize: 20 }}
      />
    </div>
  );
}
