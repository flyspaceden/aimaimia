import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  App, Breadcrumb, Card, Row, Col, Statistic, Descriptions, Tabs, Tag, Avatar,
  Button, Space, Table, Spin, Result, Empty, Modal, Input, Typography,
} from 'antd';
import { ProTable } from '@ant-design/pro-components';
import type { ProColumns } from '@ant-design/pro-components';
import {
  ArrowLeftOutlined, UserOutlined,
  ShoppingCartOutlined, EnvironmentOutlined, HeartOutlined, StarOutlined,
  WalletOutlined, LockOutlined, RiseOutlined,
} from '@ant-design/icons';
import { getAppUser, toggleAppUserBan } from '@/api/app-users';
import { getOrders } from '@/api/orders';
import { getMemberDetail } from '@/api/bonus';
import { getInstances } from '@/api/coupon';
import type { AppUserDetail, Order, BonusMemberDetail } from '@/types';
import { userStatusMap as statusMap, memberTierColors, orderStatusMap, couponInstanceStatusMap } from '@/constants/statusMaps';
import PermissionGate from '@/components/PermissionGate';
import { PERMISSIONS } from '@/constants/permissions';
import dayjs from 'dayjs';

// 认证方式映射
const providerMap: Record<string, string> = {
  PHONE: '手机号',
  WECHAT: '微信',
  APPLE: 'Apple',
  EMAIL: '邮箱',
};

// 性别映射
const genderMap: Record<string, string> = {
  MALE: '男',
  FEMALE: '女',
};

export default function UserDetailPage() {
  const { message } = App.useApp();
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  // 封禁弹窗
  const [banModal, setBanModal] = useState<{ open: boolean; reason: string }>({ open: false, reason: '' });
  // 当前激活的 Tab
  const [activeTab, setActiveTab] = useState('info');

  // 用户详情
  const { data: user, isLoading, error } = useQuery<AppUserDetail>({
    queryKey: ['admin', 'app-user', id],
    queryFn: () => getAppUser(id!),
    enabled: !!id,
  });

  // 奖励详情（仅在切换到奖励 Tab 时才加载）
  const { data: memberDetail, isLoading: memberLoading } = useQuery<BonusMemberDetail>({
    queryKey: ['admin', 'member-detail', id],
    queryFn: () => getMemberDetail(id!),
    enabled: !!id && activeTab === 'rewards',
  });

  // 封禁处理
  const handleToggleBan = async () => {
    if (!user) return;
    const newStatus = user.status === 'ACTIVE' ? 'BANNED' : 'ACTIVE';
    if (newStatus === 'BANNED' && banModal.reason.trim().length < 5) {
      message.warning('请输入至少 5 个字的封禁原因');
      return;
    }
    try {
      await toggleAppUserBan(user.id, newStatus, banModal.reason || undefined);
      message.success(newStatus === 'BANNED' ? '已封禁' : '已解封');
      setBanModal({ open: false, reason: '' });
      queryClient.invalidateQueries({ queryKey: ['admin', 'app-user', id] });
      queryClient.invalidateQueries({ queryKey: ['admin', 'app-user-stats'] });
    } catch {
      message.error('操作失败，请重试');
    }
  };

  if (isLoading) return <div style={{ padding: 24, textAlign: 'center' }}><Spin size="large" /></div>;
  if (error || !user) return <Result status="error" title="用户不存在" extra={<Button onClick={() => navigate('/users')}>返回列表</Button>} />;

  // ====== 订单列定义 ======
  const orderColumns: ProColumns<Order>[] = [
    {
      title: '订单号', dataIndex: 'orderNo', width: 180,
      render: (_: unknown, r: Order) => (
        <Button type="link" size="small" onClick={() => navigate(`/orders/${r.id}`)}>{r.orderNo}</Button>
      ),
    },
    {
      title: '商品', dataIndex: 'itemsSummary', width: 200, ellipsis: true,
      render: (_: unknown, r: Order) => r.itemsSummary || (r.items?.[0]?.productTitle ?? '-'),
    },
    {
      title: '金额', dataIndex: 'totalAmount', width: 100,
      render: (_: unknown, r: Order) => `¥${r.totalAmount.toFixed(2)}`,
    },
    {
      title: '状态', dataIndex: 'status', width: 100,
      render: (_: unknown, r: Order) => {
        const s = orderStatusMap[r.status];
        return <Tag color={s?.color}>{s?.text}</Tag>;
      },
    },
    {
      title: '下单时间', dataIndex: 'createdAt', width: 160,
      render: (_: unknown, r: Order) => dayjs(r.createdAt).format('YYYY-MM-DD HH:mm'),
    },
  ];

  // ====== Tab 内容 ======
  const tabItems = [
    {
      key: 'info',
      label: '基本信息',
      children: (
        <Descriptions bordered column={2} size="small">
          <Descriptions.Item label="用户 ID">
            <Space>
              <Typography.Text copyable={{ text: user.id }}>{user.id}</Typography.Text>
            </Space>
          </Descriptions.Item>
          <Descriptions.Item label="手机号">{user.phone || '-'}</Descriptions.Item>
          <Descriptions.Item label="昵称">{user.nickname || '-'}</Descriptions.Item>
          <Descriptions.Item label="会员类型">
            <Tag color={memberTierColors[user.memberTier || 'NORMAL'] || 'default'}>
              {user.memberTier === 'VIP' ? 'VIP' : '普通'}
            </Tag>
          </Descriptions.Item>
          <Descriptions.Item label="性别">{user.gender ? (genderMap[user.gender] || user.gender) : '未设置'}</Descriptions.Item>
          <Descriptions.Item label="生日">{user.birthday ? dayjs(user.birthday).format('YYYY-MM-DD') : '未设置'}</Descriptions.Item>
          <Descriptions.Item label="所在城市">{user.city || '未设置'}</Descriptions.Item>
          <Descriptions.Item label="积分">{user.points}</Descriptions.Item>
          <Descriptions.Item label="成长值">{user.growthPoints}</Descriptions.Item>
          <Descriptions.Item label="状态">
            <Tag color={statusMap[user.status]?.color}>{statusMap[user.status]?.text}</Tag>
          </Descriptions.Item>
          <Descriptions.Item label="注册时间">{dayjs(user.createdAt).format('YYYY-MM-DD HH:mm:ss')}</Descriptions.Item>
          <Descriptions.Item label="最后更新">{dayjs(user.updatedAt).format('YYYY-MM-DD HH:mm:ss')}</Descriptions.Item>
          <Descriptions.Item label="登录方式" span={2}>
            <Space>
              {user.authIdentitiesMasked?.map((auth, i) => (
                <Tag key={i}>{providerMap[auth.provider] || auth.provider}: {auth.identifierMasked}</Tag>
              ))}
            </Space>
          </Descriptions.Item>
        </Descriptions>
      ),
    },
    {
      key: 'orders',
      label: '订单记录',
      children: (
        <ProTable<Order>
          columns={orderColumns}
          rowKey="id"
          search={false}
          options={false}
          request={async (params) => {
            const { current, pageSize } = params;
            const res = await getOrders({ page: current, pageSize, userId: id });
            return { data: res.items, total: res.total, success: true };
          }}
          pagination={{ defaultPageSize: 10 }}
        />
      ),
    },
    {
      key: 'rewards',
      label: '奖励账户',
      children: memberLoading ? (
        <div style={{ textAlign: 'center', padding: 40 }}><Spin /></div>
      ) : memberDetail?.wallet ? (
        <>
          <Row gutter={16} style={{ marginBottom: 16 }}>
            <Col span={8}>
              <Card size="small">
                <Statistic title="可用余额" value={memberDetail.wallet.balance} prefix={<><WalletOutlined /> ¥</>} precision={2} />
              </Card>
            </Col>
            <Col span={8}>
              <Card size="small">
                <Statistic title="冻结金额" value={memberDetail.wallet.frozen} prefix={<><LockOutlined /> ¥</>} precision={2} />
              </Card>
            </Col>
            <Col span={8}>
              <Card size="small">
                <Statistic title="累计收入" value={memberDetail.wallet.totalEarned} prefix={<><RiseOutlined /> ¥</>} precision={2} />
              </Card>
            </Col>
          </Row>
          <Table
            dataSource={memberDetail.ledgers?.slice(0, 10)}
            rowKey="id"
            size="small"
            pagination={false}
            columns={[
              { title: '类型', dataIndex: 'entryType', width: 80, render: (v: string) => v === 'CREDIT' ? <Tag color="green">收入</Tag> : <Tag color="red">支出</Tag> },
              { title: '金额', dataIndex: 'amount', width: 100, render: (v: number) => `¥${v.toFixed(2)}` },
              { title: '状态', dataIndex: 'status', width: 80, render: (v: string) => <Tag>{v}</Tag> },
              { title: '时间', dataIndex: 'createdAt', width: 160, render: (v: string) => dayjs(v).format('YYYY-MM-DD HH:mm') },
            ]}
          />
          <div style={{ marginTop: 16, textAlign: 'center' }}>
            <Button type="link" onClick={() => navigate(`/bonus/members/${id}`)}>查看完整奖励详情 →</Button>
          </div>
        </>
      ) : (
        <Empty description="该用户尚未加入奖励体系" />
      ),
    },
    {
      key: 'coupons',
      label: '优惠券',
      children: (
        <ProTable
          rowKey="id"
          search={false}
          options={false}
          request={async (params) => {
            const { current, pageSize } = params;
            const res = await getInstances({ page: current, pageSize, userId: id });
            return { data: res.items, total: res.total, success: true };
          }}
          columns={[
            { title: '优惠券', dataIndex: ['campaign', 'name'], width: 180, ellipsis: true,
              render: (_: unknown, r: any) => r.campaign?.name || '-' },
            { title: '面额', dataIndex: 'discountValue', width: 100,
              render: (_: unknown, r: any) => r.discountType === 'PERCENT' ? `${r.discountValue}%` : `¥${r.discountValue}` },
            { title: '状态', dataIndex: 'status', width: 80,
              render: (_: unknown, r: any) => {
                const s = couponInstanceStatusMap[r.status];
                return <Tag color={s?.color}>{s?.text}</Tag>;
              },
            },
            { title: '领取时间', dataIndex: 'createdAt', width: 160,
              render: (_: unknown, r: any) => dayjs(r.createdAt).format('YYYY-MM-DD HH:mm') },
            { title: '使用时间', dataIndex: 'usedAt', width: 160,
              render: (_: unknown, r: any) => r.usedAt ? dayjs(r.usedAt).format('YYYY-MM-DD HH:mm') : '-' },
          ]}
          pagination={{ defaultPageSize: 10 }}
        />
      ),
    },
  ];

  return (
    <div style={{ padding: 24 }}>
      {/* 返回按钮 + 面包屑 */}
      <Space style={{ marginBottom: 16 }}>
        <Button icon={<ArrowLeftOutlined />} onClick={() => navigate('/users')}>返回</Button>
        <Breadcrumb items={[
          { title: <a onClick={() => navigate('/users')}>用户管理</a> },
          { title: '用户详情' },
        ]} />
      </Space>

      {/* 用户信息卡 */}
      <Card style={{ marginBottom: 16 }}>
        <Row align="middle" gutter={24}>
          <Col>
            <Avatar src={user.avatarUrl} icon={<UserOutlined />} size={64} />
          </Col>
          <Col flex="auto">
            <Space size={8} align="center">
              <span style={{ fontSize: 20, fontWeight: 600 }}>{user.nickname || '-'}</span>
              <Tag color={memberTierColors[user.memberTier || 'NORMAL'] || 'default'}>
                {user.memberTier === 'VIP' ? 'VIP' : '普通'}
              </Tag>
              <Tag color={statusMap[user.status]?.color}>{statusMap[user.status]?.text}</Tag>
            </Space>
            <div style={{ color: 'rgba(0,0,0,0.45)', marginTop: 4 }}>ID: {user.id}</div>
          </Col>
        </Row>
        <Row gutter={16} style={{ marginTop: 16 }}>
          <Col span={6}>
            <Statistic title="订单数" value={user.orderCount} prefix={<ShoppingCartOutlined />} />
          </Col>
          <Col span={6}>
            <Statistic title="收货地址" value={user.addressCount} prefix={<EnvironmentOutlined />} />
          </Col>
          <Col span={6}>
            <Statistic title="关注数" value={user.followCount} prefix={<HeartOutlined />} />
          </Col>
          <Col span={6}>
            <Statistic title="积分" value={user.points} prefix={<StarOutlined />} />
          </Col>
        </Row>
      </Card>

      {/* Tabs */}
      <Card>
        <Tabs items={tabItems} activeKey={activeTab} onChange={setActiveTab} />
      </Card>

      {/* 操作区 */}
      <Card style={{ marginTop: 16 }}>
        <PermissionGate permission={PERMISSIONS.USERS_BAN}>
          {user.status !== 'DELETED' && (
            <Button
              danger={user.status === 'ACTIVE'}
              type={user.status === 'ACTIVE' ? 'primary' : 'default'}
              onClick={() => setBanModal({ open: true, reason: '' })}
            >
              {user.status === 'ACTIVE' ? '封禁用户' : '解封用户'}
            </Button>
          )}
        </PermissionGate>
      </Card>

      {/* 封禁/解封弹窗 */}
      <Modal
        title={user.status === 'ACTIVE' ? '确认封禁用户' : '确认解封用户'}
        open={banModal.open}
        onCancel={() => setBanModal({ open: false, reason: '' })}
        onOk={handleToggleBan}
        okText={user.status === 'ACTIVE' ? '确认封禁' : '确认解封'}
        okButtonProps={{ danger: user.status === 'ACTIVE' }}
      >
        <p>用户：{user.nickname || '-'}（{user.phoneMasked || '-'}）</p>
        {user.status === 'ACTIVE' ? (
          <>
            <p style={{ marginBottom: 8 }}>封禁原因：</p>
            <Input.TextArea
              rows={3}
              placeholder="请输入封禁原因（至少 5 个字）"
              value={banModal.reason}
              onChange={(e) => setBanModal((prev) => ({ ...prev, reason: e.target.value }))}
            />
            <p style={{ marginTop: 8, color: '#faad14', fontSize: 13 }}>封禁后该用户将无法登录和使用 App</p>
          </>
        ) : (
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
      </Modal>
    </div>
  );
}
