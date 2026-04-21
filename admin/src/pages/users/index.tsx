import { useRef, useState } from 'react';
import { ProTable } from '@ant-design/pro-components';
import type { ActionType, ProColumns } from '@ant-design/pro-components';
import { App, Avatar, Tag, Button, Space, Card, Row, Col, Statistic, Modal, Input, Skeleton } from 'antd';
import {
  UserOutlined,
  EyeOutlined,
  TeamOutlined,
  CrownOutlined,
  UserAddOutlined,
  StopOutlined,
} from '@ant-design/icons';
import { getAppUsers, getAppUserStats, toggleAppUserBan } from '@/api/app-users';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import PermissionGate from '@/components/PermissionGate';
import type { AppUser } from '@/types';
import { userStatusMap as statusMap, memberTierColors } from '@/constants/statusMaps';
import { PERMISSIONS } from '@/constants/permissions';
import dayjs from 'dayjs';

// 统计卡片配置
const statCardConfig = [
  { key: 'totalUsers' as const, title: '总用户数', icon: <TeamOutlined />, color: '#1E40AF' },
  { key: 'vipUsers' as const, title: 'VIP 用户', icon: <CrownOutlined />, color: '#D97706' },
  { key: 'todayRegistered' as const, title: '今日注册', icon: <UserAddOutlined />, color: '#059669' },
  { key: 'bannedUsers' as const, title: '已封禁', icon: <StopOutlined />, color: '#DC2626' },
];

export default function UserListPage() {
  const { message } = App.useApp();
  const actionRef = useRef<ActionType>(null);
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  // 封禁弹窗状态
  const [banModal, setBanModal] = useState<{ open: boolean; record: AppUser | null; reason: string }>({
    open: false, record: null, reason: '',
  });

  // 统计数据
  const { data: stats, isLoading: statsLoading } = useQuery({
    queryKey: ['admin', 'app-user-stats'],
    queryFn: getAppUserStats,
    staleTime: 30_000,
  });

  // 封禁/解封处理
  const handleToggleBan = async () => {
    const { record, reason } = banModal;
    if (!record) return;
    const newStatus = record.status === 'ACTIVE' ? 'BANNED' : 'ACTIVE';
    if (newStatus === 'BANNED' && reason.trim().length < 5) {
      message.warning('请输入至少 5 个字的封禁原因');
      return;
    }
    try {
      await toggleAppUserBan(record.id, newStatus, reason || undefined);
      message.success(newStatus === 'BANNED' ? '已封禁' : '已解封');
      setBanModal({ open: false, record: null, reason: '' });
      actionRef.current?.reload();
      queryClient.invalidateQueries({ queryKey: ['admin', 'app-user-stats'] });
    } catch {
      message.error('操作失败，请重试');
    }
  };

  const columns: ProColumns<AppUser>[] = [
    {
      title: '用户',
      dataIndex: 'nickname',
      width: 200,
      render: (_: unknown, r: AppUser) => (
        <Space>
          <Avatar src={r.avatarUrl} icon={<UserOutlined />} size="small" />
          <div>
            <div>{r.nickname || r.phone || '-'}</div>
            <div style={{ fontSize: 12, color: 'rgba(0,0,0,0.45)' }}>{r.id.slice(0, 8)}</div>
          </div>
        </Space>
      ),
    },
    { title: '手机号', dataIndex: 'phone', width: 140 },
    {
      title: '会员',
      dataIndex: 'memberTier',
      width: 90,
      valueType: 'select',
      valueEnum: {
        VIP: { text: 'VIP' },
        NORMAL: { text: '普通' },
      },
      render: (_: unknown, r: AppUser) => (
        <Tag color={memberTierColors[r.memberTier] || 'default'}>
          {r.memberTier === 'VIP' ? 'VIP' : '普通'}
        </Tag>
      ),
    },
    {
      title: '订单数',
      dataIndex: 'orderCount',
      width: 80,
      search: false,
      render: (_: unknown, r: AppUser) => (
        <Button type="link" size="small" onClick={() => navigate(`/orders?userId=${r.id}`)}>
          {r.orderCount}
        </Button>
      ),
    },
    {
      title: '状态',
      dataIndex: 'status',
      width: 80,
      valueType: 'select',
      valueEnum: {
        ACTIVE: { text: '正常' },
        BANNED: { text: '已封禁' },
      },
      render: (_: unknown, r: AppUser) => {
        const s = statusMap[r.status];
        return <Tag color={s?.color}>{s?.text}</Tag>;
      },
    },
    {
      title: '注册时间',
      dataIndex: 'createdAt',
      width: 160,
      valueType: 'dateRange',
      search: {
        transform: (v: string[]) => ({ startDate: v[0], endDate: v[1] }),
      },
      render: (_: unknown, r: AppUser) => dayjs(r.createdAt).format('YYYY-MM-DD HH:mm'),
    },
    {
      title: '操作',
      key: 'action',
      width: 120,
      search: false,
      render: (_: unknown, record: AppUser) => (
        <Space size={0}>
          <Button type="link" size="small" icon={<EyeOutlined />}
            onClick={() => navigate(`/users/${record.id}`)}>
            详情
          </Button>
          <PermissionGate permission={PERMISSIONS.USERS_BAN}>
            {record.status !== 'DELETED' && (
              <Button type="link" size="small" danger={record.status === 'ACTIVE'}
                onClick={() => setBanModal({ open: true, record, reason: '' })}>
                {record.status === 'ACTIVE' ? '封禁' : '解封'}
              </Button>
            )}
          </PermissionGate>
        </Space>
      ),
    },
  ];

  return (
    <div style={{ padding: 24 }}>
      {/* 统计卡片 */}
      <Row gutter={16} style={{ marginBottom: 16 }}>
        {statCardConfig.map((card) => (
          <Col span={6} key={card.key}>
            <Card size="small">
              {statsLoading ? (
                <Skeleton paragraph={false} active />
              ) : (
                <Statistic
                  title={card.title}
                  value={stats?.[card.key] ?? 0}
                  prefix={<span style={{ color: card.color }}>{card.icon}</span>}
                />
              )}
            </Card>
          </Col>
        ))}
      </Row>

      {/* 用户表格 */}
      <ProTable<AppUser>
        headerTitle="用户管理"
        actionRef={actionRef}
        rowKey="id"
        columns={columns}
        scroll={{ x: 900 }}
        request={async (params) => {
          const { current, pageSize, status, nickname: keyword, memberTier: tier, startDate, endDate } = params;
          const res = await getAppUsers({ page: current, pageSize, status, keyword, tier, startDate, endDate });
          return { data: res.items, total: res.total, success: true };
        }}
        search={{ labelWidth: 'auto' }}
        pagination={{ defaultPageSize: 20 }}
        onRow={(record) => ({
          style: {
            borderLeft: record.memberTier === 'VIP'
              ? '3px solid #D97706'
              : record.status === 'BANNED'
                ? '3px solid #DC2626'
                : '3px solid transparent',
          },
        })}
      />

      {/* 封禁/解封弹窗 */}
      <Modal
        title={banModal.record?.status === 'ACTIVE' ? '确认封禁用户' : '确认解封用户'}
        open={banModal.open}
        onCancel={() => setBanModal({ open: false, record: null, reason: '' })}
        onOk={handleToggleBan}
        okText={banModal.record?.status === 'ACTIVE' ? '确认封禁' : '确认解封'}
        okButtonProps={{
          danger: banModal.record?.status === 'ACTIVE',
        }}
      >
        {banModal.record && (
          <>
            <p>用户：{banModal.record.nickname || '-'}（{banModal.record.phone || '-'}）</p>
            {banModal.record.status === 'ACTIVE' && (
              <>
                <p style={{ marginBottom: 8 }}>封禁原因：</p>
                <Input.TextArea
                  rows={3}
                  placeholder="请输入封禁原因（至少 5 个字）"
                  value={banModal.reason}
                  onChange={(e) => setBanModal((prev) => ({ ...prev, reason: e.target.value }))}
                />
                <p style={{ marginTop: 8, color: '#faad14', fontSize: 13 }}>
                  封禁后该用户将无法登录和使用 App
                </p>
              </>
            )}
            {banModal.record.status === 'BANNED' && (
              <>
                <p style={{ marginBottom: 8 }}>解封备注（选填）：</p>
                <Input.TextArea
                  rows={2}
                  placeholder="选填"
                  value={banModal.reason}
                  onChange={(e) => setBanModal((prev) => ({ ...prev, reason: e.target.value }))}
                />
              </>
            )}
          </>
        )}
      </Modal>
    </div>
  );
}
