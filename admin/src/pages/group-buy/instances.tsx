import { useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ProTable } from '@ant-design/pro-components';
import type { ActionType, ProColumns } from '@ant-design/pro-components';
import { Button, Card, Descriptions, Drawer, Space, Table, Typography } from 'antd';
import dayjs from 'dayjs';
import { getGroupBuyInstance, getGroupBuyInstances } from '@/api/group-buy';
import type {
  AdminGroupBuyInstance,
  AdminGroupBuyReferral,
  GroupBuyInstanceStatus,
} from '@/types';
import {
  GroupBuyUser,
  StatusTag,
  codeStatusMap,
  instanceStatusMap,
  ledgerTypeMap,
  money,
  referralStatusMap,
} from './common';

const getTargetCount = (record: AdminGroupBuyInstance) => {
  if (Array.isArray(record.tierSnapshot) && record.tierSnapshot.length > 0) {
    return record.tierSnapshot.length;
  }
  return Math.max(record.validReferralCount, record._count?.referrals ?? 0, record.candidateCount ?? 0);
};

export default function GroupBuyInstancesPage() {
  const actionRef = useRef<ActionType>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const { data: detail, isLoading } = useQuery({
    queryKey: ['admin', 'group-buy', 'instance', selectedId],
    queryFn: () => getGroupBuyInstance(selectedId!),
    enabled: !!selectedId,
  });

  const columns: ProColumns<AdminGroupBuyInstance>[] = [
    {
      title: '分享用户',
      dataIndex: 'keyword',
      width: 260,
      render: (_: unknown, record) => <GroupBuyUser user={record.user} />,
    },
    {
      title: '活动商品',
      dataIndex: 'activityId',
      search: false,
      width: 220,
      render: (_: unknown, record) => (
        <Space direction="vertical" size={0}>
          <Typography.Text>{record.activity?.title || record.activityId}</Typography.Text>
          <Typography.Text type="secondary">{money(record.activity?.price ?? record.priceSnapshot)}</Typography.Text>
        </Space>
      ),
    },
    {
      title: '分享码',
      dataIndex: 'keyword',
      search: false,
      width: 170,
      render: (_: unknown, record) => record.code ? (
        <Space direction="vertical" size={0}>
          <Typography.Text copyable={{ text: record.code.code }} style={{ fontFamily: 'monospace' }}>
            {record.code.code}
          </Typography.Text>
          <StatusTag value={record.code.status} map={codeStatusMap} />
        </Space>
      ) : <Typography.Text type="secondary">待生成</Typography.Text>,
    },
    {
      title: '状态',
      dataIndex: 'status',
      valueType: 'select',
      width: 150,
      valueEnum: {
        QUALIFICATION_PENDING: { text: '待生成分享码' },
        SHARING: { text: '分享中' },
        COMPLETED: { text: '已完成' },
        TERMINATED: { text: '已结束分享' },
        QUALIFICATION_ABANDONED: { text: '已放弃' },
        QUALIFICATION_INVALID: { text: '资格无效' },
        EXPIRED: { text: '已过期' },
      },
      render: (_: unknown, record) => <StatusTag value={record.status} map={instanceStatusMap} />,
    },
    {
      title: '有效进度',
      search: false,
      width: 120,
      render: (_: unknown, record) => `${record.validReferralCount}/${getTargetCount(record)}`,
    },
    {
      title: '初始订单',
      search: false,
      width: 160,
      render: (_: unknown, record) => (
        <Typography.Text copyable={{ text: record.initiatorOrderId }} style={{ fontFamily: 'monospace' }}>
          {record.initiatorOrderId.slice(-10)}
        </Typography.Text>
      ),
    },
    {
      title: '创建时间',
      dataIndex: 'createdAt',
      search: false,
      width: 170,
      render: (_: unknown, record) => dayjs(record.createdAt).format('YYYY-MM-DD HH:mm'),
    },
    {
      title: '操作',
      valueType: 'option',
      width: 100,
      render: (_: unknown, record) => [
        <Button key="detail" type="link" onClick={() => setSelectedId(record.id)}>详情</Button>,
      ],
    },
  ];

  return (
    <div style={{ padding: 24 }}>
      <ProTable<AdminGroupBuyInstance>
        actionRef={actionRef}
        columns={columns}
        rowKey="id"
        request={async (params) => {
          const res = await getGroupBuyInstances({
            page: params.current,
            pageSize: params.pageSize,
            keyword: params.keyword as string | undefined,
            status: params.status as GroupBuyInstanceStatus | undefined,
          });
          return { data: res.items, total: res.total, success: true };
        }}
        pagination={{ defaultPageSize: 20 }}
        options={false}
      />

      <Drawer
        title="团购记录详情"
        width={920}
        open={!!selectedId}
        onClose={() => setSelectedId(null)}
        loading={isLoading}
      >
        {detail ? (
          <Space direction="vertical" size={16} style={{ width: '100%' }}>
            <Card size="small">
              <Descriptions column={2} size="small">
                <Descriptions.Item label="分享用户"><GroupBuyUser user={detail.user} compact={false} /></Descriptions.Item>
                <Descriptions.Item label="活动商品">{detail.activity?.title || detail.activityId}</Descriptions.Item>
                <Descriptions.Item label="状态"><StatusTag value={detail.status} map={instanceStatusMap} /></Descriptions.Item>
                <Descriptions.Item label="分享码">
                  {detail.code ? (
                    <Space>
                      <Typography.Text copyable={{ text: detail.code.code }} style={{ fontFamily: 'monospace' }}>
                        {detail.code.code}
                      </Typography.Text>
                      <StatusTag value={detail.code.status} map={codeStatusMap} />
                    </Space>
                  ) : '待生成'}
                </Descriptions.Item>
                <Descriptions.Item label="有效进度">{detail.validReferralCount}/{getTargetCount(detail)}</Descriptions.Item>
                <Descriptions.Item label="待确认订单">{detail.candidateCount}</Descriptions.Item>
                <Descriptions.Item label="初始订单">{detail.initiatorOrderId}</Descriptions.Item>
                <Descriptions.Item label="记录时间">{dayjs(detail.createdAt).format('YYYY-MM-DD HH:mm')}</Descriptions.Item>
              </Descriptions>
            </Card>

            <Card size="small" title="直接推荐记录">
              <Table<AdminGroupBuyReferral>
                rowKey="id"
                size="small"
                pagination={false}
                dataSource={detail.referrals || []}
                columns={[
                  {
                    title: '序号',
                    render: (_: unknown, row) => row.candidateSequence || '-',
                    width: 70,
                  },
                  {
                    title: '好友',
                    render: (_: unknown, row) => <GroupBuyUser user={row.referredUser} />,
                  },
                  {
                    title: '订单',
                    render: (_: unknown, row) => (
                      <Typography.Text copyable={{ text: row.referredOrderId }} style={{ fontFamily: 'monospace' }}>
                        {row.referredOrderId.slice(-10)}
                      </Typography.Text>
                    ),
                  },
                  {
                    title: '状态',
                    render: (_: unknown, row) => <StatusTag value={row.status} map={referralStatusMap} />,
                  },
                  {
                    title: '返还货款',
                    render: (_: unknown, row) => row.amountSnapshot ? money(row.amountSnapshot) : '-',
                  },
                  {
                    title: '有效时间',
                    render: (_: unknown, row) => row.validAt ? dayjs(row.validAt).format('YYYY-MM-DD HH:mm') : '-',
                  },
                ]}
              />
            </Card>

            <Card size="small" title="返还流水">
              <Table
                rowKey="id"
                size="small"
                pagination={false}
                dataSource={detail.rebateLedgers || []}
                columns={[
                  {
                    title: '类型',
                    render: (_: unknown, row: any) => <StatusTag value={row.type} map={ledgerTypeMap} />,
                  },
                  {
                    title: '金额',
                    render: (_: unknown, row: any) => money(row.amount),
                  },
                  {
                    title: '创建时间',
                    render: (_: unknown, row: any) => dayjs(row.createdAt).format('YYYY-MM-DD HH:mm'),
                  },
                ]}
              />
            </Card>
          </Space>
        ) : null}
      </Drawer>
    </div>
  );
}
