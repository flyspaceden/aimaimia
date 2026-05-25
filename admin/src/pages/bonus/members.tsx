import { useRef } from 'react';
import { ProTable } from '@ant-design/pro-components';
import type { ActionType, ProColumns } from '@ant-design/pro-components';
import { Button, Tag, Tooltip, Typography } from 'antd';
import { EyeOutlined } from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import { getMembers } from '@/api/bonus';
import type { BonusMember } from '@/types';
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
      render: (_, r) => (
        <Tooltip title={r.userId}>
          <Typography.Text copyable={{ text: r.userId }} style={{ fontSize: 12 }}>
            …{r.userId.slice(-8)}
          </Typography.Text>
        </Tooltip>
      ),
    },
    {
      title: '昵称',
      dataIndex: ['user', 'profile', 'nickname'],
      width: 120,
      hideInSearch: true,
      render: (_, r) => r.user?.profile?.nickname || '-',
    },
    {
      title: '手机号',
      dataIndex: 'phone',
      width: 130,
      hideInSearch: true,
      render: (_, r) =>
        r.phone ? (
          <Typography.Text copyable={{ text: r.phone }}>{r.phone}</Typography.Text>
        ) : (
          '-'
        ),
    },
    {
      title: '推荐码',
      dataIndex: 'referralCode',
      width: 140,
      hideInSearch: true,
      render: (_, r) =>
        r.referralCode ? (
          <Typography.Text copyable={{ text: r.referralCode }}>
            <Tag color="blue" style={{ fontFamily: 'monospace', marginRight: 4 }}>
              {r.referralCode}
            </Tag>
          </Typography.Text>
        ) : (
          '-'
        ),
    },
    {
      title: '邀请人',
      dataIndex: 'inviterNickname',
      width: 120,
      hideInSearch: true,
      render: (_, r) =>
        r.inviterUserId ? (
          <Tooltip title={r.inviterUserId}>
            <Button
              type="link"
              size="small"
              style={{ padding: 0 }}
              onClick={() => navigate(`/bonus/members/${r.inviterUserId}`)}
            >
              {r.inviterNickname || `…${r.inviterUserId.slice(-8)}`}
            </Button>
          </Tooltip>
        ) : (
          '-'
        ),
    },
    {
      title: (
        <Tooltip title="该会员直接邀请并已升级为 VIP 的下级人数（不含下下级）">
          <span>直邀 VIP</span>
        </Tooltip>
      ),
      dataIndex: 'inviteeVipCount',
      width: 90,
      hideInSearch: true,
      align: 'right',
      render: (_, r) => (
        <Typography.Text strong={r.inviteeVipCount > 0}>
          {r.inviteeVipCount}
        </Typography.Text>
      ),
    },
    {
      title: '可用余额',
      dataIndex: ['wallet', 'balance'],
      width: 110,
      hideInSearch: true,
      align: 'right',
      render: (_, r) => (
        <Typography.Text strong>
          ¥{(r.wallet?.balance ?? 0).toFixed(2)}
        </Typography.Text>
      ),
    },
    {
      title: '冻结金额',
      dataIndex: ['wallet', 'frozen'],
      width: 110,
      hideInSearch: true,
      align: 'right',
      render: (_, r) => {
        const frozen = r.wallet?.frozen ?? 0;
        return (
          <Typography.Text type={frozen > 0 ? 'warning' : undefined}>
            ¥{frozen.toFixed(2)}
          </Typography.Text>
        );
      },
    },
    {
      title: '自购 / 解锁',
      dataIndex: 'selfPurchaseCount',
      width: 110,
      hideInSearch: true,
      align: 'center',
      render: (_, r) => (
        <Tooltip title={`自购 ${r.selfPurchaseCount} 次 → 已解锁前 ${r.unlockedLevel} 层奖励`}>
          <span>
            <Typography.Text strong>{r.selfPurchaseCount}</Typography.Text>
            <Typography.Text type="secondary"> / L{r.unlockedLevel}</Typography.Text>
          </span>
        </Tooltip>
      ),
    },
    {
      title: 'VIP 奖励位置',
      dataIndex: 'treeRootId',
      width: 110,
      hideInSearch: true,
      render: (_, r) =>
        r.treeRootId ? (
          <Tag color="geekblue">
            {r.treeRootId} · L{r.treeLevel ?? '-'}
          </Tag>
        ) : (
          '-'
        ),
    },
    {
      title: 'VIP 礼包',
      dataIndex: ['vipPurchase', 'amount'],
      width: 130,
      hideInSearch: true,
      render: (_, r) =>
        r.vipPurchase ? (
          <Tooltip title={`packageId: ${r.vipPurchase.packageId ?? '(无)'}`}>
            <span>
              <Typography.Text>{r.vipPurchase.packageId ?? '-'}</Typography.Text>
              <br />
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                ¥{r.vipPurchase.amount.toFixed(2)}
              </Typography.Text>
            </span>
          </Tooltip>
        ) : (
          '-'
        ),
    },
    {
      title: 'VIP 开通时间',
      dataIndex: 'vipPurchasedAt',
      width: 160,
      hideInSearch: true,
      render: (_, r) =>
        r.vipPurchasedAt ? dayjs(r.vipPurchasedAt).format('YYYY-MM-DD HH:mm') : '-',
    },
    {
      title: '搜索',
      dataIndex: 'keyword',
      hideInTable: true,
      fieldProps: { placeholder: '昵称 / 手机号 / 推荐码' },
    },
    {
      title: '操作',
      width: 80,
      hideInSearch: true,
      fixed: 'right',
      align: 'center',
      render: (_, r) => (
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
          const { current, pageSize, keyword } = params;
          const res = await getMembers({
            page: current,
            pageSize,
            tier: 'VIP',
            keyword: keyword ? String(keyword).trim() : undefined,
          });
          return { data: res.items, total: res.total, success: true };
        }}
        scroll={{ x: 1500 }}
        search={{ labelWidth: 'auto', defaultCollapsed: false }}
        pagination={{ defaultPageSize: 20, showSizeChanger: true }}
      />
    </div>
  );
}
