import { useRef } from 'react';
import { ProTable } from '@ant-design/pro-components';
import type { ActionType, ProColumns } from '@ant-design/pro-components';
import { App, Button, Space, Typography } from 'antd';
import dayjs from 'dayjs';
import {
  approveCaptainSettlement,
  getCaptainSettlements,
  markCaptainSettlementPaid,
  recalculateCaptainSettlement,
} from '@/api/captain';
import PermissionGate from '@/components/PermissionGate';
import { PERMISSIONS } from '@/constants/permissions';
import type { CaptainMonthlySettlement, CaptainSettlementStatus } from '@/types';
import { CaptainUser, StatusTag, captainSettlementStatusMap, money } from './common';

export default function CaptainSettlementsPage() {
  const actionRef = useRef<ActionType | undefined>(undefined);
  const { message } = App.useApp();

  const runAction = async (fn: () => Promise<unknown>, text: string) => {
    await fn();
    message.success(text);
    actionRef.current?.reload();
  };

  const columns: ProColumns<CaptainMonthlySettlement>[] = [
    { title: '关键词', dataIndex: 'keyword', hideInTable: true },
    { title: '月份', dataIndex: 'month', valueType: 'dateMonth', width: 120 },
    { title: '团长用户 ID', dataIndex: 'userId', hideInTable: true },
    { title: '团长', search: false, width: 230, render: (_, record) => <CaptainUser user={record.captain} /> },
    {
      title: '状态',
      dataIndex: 'status',
      valueType: 'select',
      width: 120,
      valueEnum: Object.fromEntries(Object.entries(captainSettlementStatusMap).map(([key, value]) => [key, { text: value.text }])),
      render: (_, record) => <StatusTag value={record.status as CaptainSettlementStatus} map={captainSettlementStatusMap} />,
    },
    { title: '管理津贴', search: false, width: 120, render: (_, record) => money(record.baseManagementAmount) },
    { title: '增长奖', search: false, width: 120, render: (_, record) => money(record.growthBonusAmount) },
    { title: '辅导奖', search: false, width: 120, render: (_, record) => money(record.cultivationBonusAmount) },
    { title: '团队池', search: false, width: 120, render: (_, record) => money(record.teamPoolAmount) },
    { title: '税前合计', search: false, width: 120, render: (_, record) => <Typography.Text strong>{money(record.totalAmount)}</Typography.Text> },
    { title: '税后', search: false, width: 120, render: (_, record) => money(record.netAmount) },
    { title: '创建时间', search: false, width: 170, render: (_, record) => dayjs(record.createdAt).format('YYYY-MM-DD HH:mm') },
    {
      title: '操作',
      valueType: 'option',
      width: 220,
      render: (_, record) => (
        <Space>
          <PermissionGate permission={PERMISSIONS.CAPTAIN_SETTLEMENT}>
            <Button
              type="link"
              size="small"
              disabled={!['DRAFT', 'PENDING_REVIEW'].includes(record.status)}
              onClick={() => runAction(() => approveCaptainSettlement(record.id), '结算已审核')}
            >
              审核
            </Button>
            <Button
              type="link"
              size="small"
              disabled={record.status !== 'APPROVED'}
              onClick={() => runAction(() => markCaptainSettlementPaid(record.id), '结算已标记支付')}
            >
              标记支付
            </Button>
          </PermissionGate>
          <PermissionGate permission={PERMISSIONS.CAPTAIN_MANAGE}>
            <Button
              type="link"
              size="small"
              disabled={record.status === 'PAID'}
              onClick={() => runAction(() => recalculateCaptainSettlement(record.id), '结算已重算')}
            >
              重算
            </Button>
          </PermissionGate>
        </Space>
      ),
    },
  ];

  return (
    <div style={{ padding: 24 }}>
      <ProTable<CaptainMonthlySettlement>
        actionRef={actionRef}
        columns={columns}
        rowKey="id"
        request={async (params) => {
          const res = await getCaptainSettlements({
            page: params.current,
            pageSize: params.pageSize,
            keyword: params.keyword as string | undefined,
            month: params.month as string | undefined,
            status: params.status as string | undefined,
            userId: params.userId as string | undefined,
          });
          return { data: res.items, total: res.total, success: true };
        }}
        pagination={{ defaultPageSize: 20 }}
        options={false}
        headerTitle="月度结算"
      />
    </div>
  );
}
