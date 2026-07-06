import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  App, Breadcrumb, Card, Row, Col, Statistic, Descriptions, Tabs, Tag, Avatar,
  Button, Space, Table, Spin, Result, Empty, Modal, Input, Alert, Typography,
} from 'antd';
import { ProTable } from '@ant-design/pro-components';
import type { ProColumns } from '@ant-design/pro-components';
import {
  ArrowLeftOutlined, UserOutlined,
  ShoppingCartOutlined, EnvironmentOutlined, HeartOutlined, StarOutlined,
  WalletOutlined, LockOutlined, RiseOutlined, MessageOutlined,
} from '@ant-design/icons';
import { getAppUser, toggleAppUserBan } from '@/api/app-users';
import { createCsOutreach } from '@/api/cs';
import { getOrders } from '@/api/orders';
import { getMemberDetail } from '@/api/bonus';
import { getInstances } from '@/api/coupon';
import { getDigitalAssetAccount } from '@/api/digital-assets';
import type { AppUserDetail, AppUserRecommendationUser, Order, BonusMemberDetail } from '@/types';
import { userStatusMap as statusMap, memberTierColors, orderStatusMap, couponInstanceStatusMap, rewardEntryTypeMap, rewardLedgerStatusMap, rewardRefTypeMap, rewardAccountTypeMap } from '@/constants/statusMaps';
import PermissionGate from '@/components/PermissionGate';
import BuyerIdentityText from '@/components/BuyerIdentityText';
import { PERMISSIONS } from '@/constants/permissions';
import { usePermission } from '@/hooks/usePermission';
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

const recommendationCodeTypeMap: Record<string, { text: string; color: string }> = {
  NORMAL_SHARE: { text: '普通分享码', color: 'green' },
  VIP_REFERRAL: { text: 'VIP 推荐码', color: 'gold' },
};

const normalShareCodeStatusMap: Record<string, { text: string; color: string }> = {
  ACTIVE: { text: '可分享', color: 'green' },
  DISABLED: { text: '已停用', color: 'default' },
};

const directRelationStatusMap: Record<string, { text: string; color: string }> = {
  ACTIVE: { text: '关系有效', color: 'green' },
  SUPERSEDED_BY_VIP_TREE: { text: '已转入 VIP 关系', color: 'blue' },
  INVALIDATED_BY_INVITEE_VIP_UPGRADE: { text: '因对方升级 VIP 结束', color: 'orange' },
  ADMIN_VOIDED: { text: '已作废', color: 'default' },
};

const normalShareRewardStatusMap: Record<string, { text: string; color: string }> = {
  PENDING: { text: '待奖励', color: 'default' },
  REGISTER_REWARDED: { text: '注册已奖', color: 'green' },
  FIRST_ORDER_PENDING: { text: '待首单', color: 'orange' },
  ISSUED: { text: '首单已奖', color: 'green' },
  REVERSED: { text: '已冲正', color: 'red' },
  VOIDED: { text: '已作废', color: 'default' },
};

const normalShareSourceMap: Record<string, string> = {
  APP: 'App',
  DEFERRED_LINK: '延迟链接',
  ADMIN: '后台',
};

function renderMappedTag(value: string | null | undefined, map: Record<string, { text: string; color: string }>) {
  if (!value) return <Typography.Text type="secondary">-</Typography.Text>;
  const item = map[value];
  return <Tag color={item?.color || 'default'}>{item?.text || value}</Tag>;
}

function formatDateTime(value?: string | null) {
  return value ? dayjs(value).format('YYYY-MM-DD HH:mm') : '-';
}

export default function UserDetailPage() {
  const { message } = App.useApp();
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { hasPermission } = usePermission();

  // 封禁弹窗
  const [banModal, setBanModal] = useState<{ open: boolean; reason: string }>({ open: false, reason: '' });
  const [outreachModal, setOutreachModal] = useState({
    open: false,
    initialMessage: '',
    inviteTitle: '',
  });
  const [outreachSubmitting, setOutreachSubmitting] = useState(false);
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

  const { data: digitalAsset } = useQuery({
    queryKey: ['admin', 'digital-assets', 'account', id],
    queryFn: () => getDigitalAssetAccount(id!),
    enabled: !!id && hasPermission(PERMISSIONS.DIGITAL_ASSETS_READ),
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

  const handleCreateOutreach = async () => {
    if (!user?.buyerNo) {
      message.warning('该用户没有买家编号，无法发起客服会话');
      return;
    }
    if (user.status !== 'ACTIVE') {
      message.warning('只能联系 ACTIVE 状态的买家');
      return;
    }
    if (!outreachModal.initialMessage.trim()) {
      message.warning('请输入初始消息');
      return;
    }

    setOutreachSubmitting(true);
    try {
      const result = await createCsOutreach({
        buyerNo: user.buyerNo,
        initialMessage: outreachModal.initialMessage.trim(),
        inviteTitle: outreachModal.inviteTitle.trim() || undefined,
      });
      if (result.reused) {
        message.success('已打开该买家的现有会话');
      } else if (result.claimed) {
        message.success('已接管该买家的现有会话');
      } else {
        message.success('已发起客服会话');
      }
      setOutreachModal({ open: false, initialMessage: '', inviteTitle: '' });
      navigate(`/cs/workstation?sessionId=${encodeURIComponent(result.sessionId)}`);
    } catch (err) {
      message.error(err instanceof Error ? err.message : '发起失败');
    } finally {
      setOutreachSubmitting(false);
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

  const renderRecommendationUser = (summary?: AppUserRecommendationUser | null) => {
    if (!summary) return <Typography.Text type="secondary">无</Typography.Text>;
    return (
      <Space direction="vertical" size={0}>
        <BuyerIdentityText
          buyerNo={summary.buyerNo}
          userId={summary.id}
          nickname={summary.nickname || summary.phoneMasked || '-'}
          compact
        />
        <Space size={4} wrap>
          <Tag color={summary.memberTier === 'VIP' ? 'gold' : 'default'}>
            {summary.memberTier === 'VIP' ? 'VIP' : '普通'}
          </Tag>
          {summary.phoneMasked ? <Typography.Text type="secondary">{summary.phoneMasked}</Typography.Text> : null}
        </Space>
      </Space>
    );
  };

  const renderCurrentRecommendationCode = () => {
    const visibleCode = user.recommendation.visibleCode;
    if (!visibleCode) return <Typography.Text type="secondary">未生成</Typography.Text>;
    const type = recommendationCodeTypeMap[visibleCode.type];
    return (
      <Space direction="vertical" size={4}>
        <Space wrap>
          <Tag color={type?.color || 'default'}>{type?.text || visibleCode.type}</Tag>
          <Typography.Text code copyable={{ text: visibleCode.code }}>{visibleCode.code}</Typography.Text>
          {renderMappedTag(visibleCode.status, normalShareCodeStatusMap)}
        </Space>
        <Typography.Text copyable={{ text: visibleCode.url }} style={{ wordBreak: 'break-all' }}>
          {visibleCode.url}
        </Typography.Text>
      </Space>
    );
  };

  const renderFirstOrder = (order: AppUserDetail['recommendation']['directNormalInvitees'][number]['firstOrder']) => {
    if (!order) return <Typography.Text type="secondary">未首单</Typography.Text>;
    return (
      <Space direction="vertical" size={0}>
        <Button type="link" size="small" style={{ padding: 0 }} onClick={() => navigate(`/orders/${order.id}`)}>
          {order.orderNo || order.id}
        </Button>
        <Typography.Text type="secondary">¥{Number(order.totalAmount || 0).toFixed(2)}</Typography.Text>
      </Space>
    );
  };

  const recommendation = user.recommendation;

  // ====== Tab 内容 ======
  const tabItems = [
    {
      key: 'info',
      label: '基本信息',
      children: (
        <Descriptions bordered column={2} size="small">
          <Descriptions.Item label="买家身份">
            <BuyerIdentityText
              buyerNo={user.buyerNo}
              userId={user.id}
              nickname={user.nickname || user.phone || '-'}
            />
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
      key: 'recommendation',
      label: '推荐关系',
      children: (
        <Space direction="vertical" size={16} style={{ width: '100%' }}>
          <Alert
            showIcon
            type="info"
            message="用户详情里的推荐关系用于核查单个用户的上下级"
            description="这里展示当前有效推荐人、当前可展示推荐码、收到的普通/VIP 推荐关系，以及该用户直接邀请的普通用户和 VIP 用户。规则配置仍在“推荐与拉新”和 VIP/普通系统配置中管理。"
          />

          <Descriptions bordered size="small" column={2}>
            <Descriptions.Item label="当前推荐码" span={2}>
              {renderCurrentRecommendationCode()}
            </Descriptions.Item>
            <Descriptions.Item label="当前有效推荐人">
              {renderRecommendationUser(recommendation.currentInviter)}
            </Descriptions.Item>
            <Descriptions.Item label="普通分享码">
              {recommendation.normalShareProfile ? (
                <Space direction="vertical" size={4}>
                  <Space wrap>
                    <Typography.Text code copyable={{ text: recommendation.normalShareProfile.code }}>
                      {recommendation.normalShareProfile.code}
                    </Typography.Text>
                    {renderMappedTag(recommendation.normalShareProfile.status, normalShareCodeStatusMap)}
                  </Space>
                  {recommendation.normalShareProfile.disabledReason ? (
                    <Typography.Text type="secondary">{recommendation.normalShareProfile.disabledReason}</Typography.Text>
                  ) : null}
                </Space>
              ) : (
                <Typography.Text type="secondary">未生成</Typography.Text>
              )}
            </Descriptions.Item>
            <Descriptions.Item label="直接普通邀请">
              {recommendation.counts.directNormalInvitees} 人（有效 {recommendation.counts.activeNormalInvitees} 人）
            </Descriptions.Item>
            <Descriptions.Item label="直接 VIP 邀请">
              {recommendation.counts.directVipInvitees} 人
            </Descriptions.Item>
          </Descriptions>

          <Row gutter={16}>
            <Col xs={24} lg={12}>
              <Card size="small" title="收到的普通分享关系">
                {recommendation.normalBindingReceived ? (
                  <Descriptions bordered size="small" column={1}>
                    <Descriptions.Item label="推荐人">
                      {renderRecommendationUser(recommendation.normalBindingReceived.inviter)}
                    </Descriptions.Item>
                    <Descriptions.Item label="分享码">
                      <Typography.Text code>{recommendation.normalBindingReceived.code}</Typography.Text>
                    </Descriptions.Item>
                    <Descriptions.Item label="来源">
                      {normalShareSourceMap[recommendation.normalBindingReceived.source] || recommendation.normalBindingReceived.source}
                    </Descriptions.Item>
                    <Descriptions.Item label="关系状态">
                      {renderMappedTag(recommendation.normalBindingReceived.relationStatus, directRelationStatusMap)}
                    </Descriptions.Item>
                    <Descriptions.Item label="有效推荐人">
                      {renderRecommendationUser(recommendation.normalBindingReceived.effectiveInviter)}
                    </Descriptions.Item>
                    <Descriptions.Item label="绑定时间">
                      {formatDateTime(recommendation.normalBindingReceived.boundAt)}
                    </Descriptions.Item>
                    <Descriptions.Item label="奖励状态">
                      {renderMappedTag(recommendation.normalBindingReceived.rewardStatus, normalShareRewardStatusMap)}
                    </Descriptions.Item>
                    <Descriptions.Item label="失效原因">
                      {recommendation.normalBindingReceived.relationInvalidReason || '-'}
                    </Descriptions.Item>
                  </Descriptions>
                ) : (
                  <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="没有收到普通分享关系" />
                )}
              </Card>
            </Col>
            <Col xs={24} lg={12}>
              <Card size="small" title="收到的 VIP 推荐关系">
                {recommendation.vipReferralReceived ? (
                  <Descriptions bordered size="small" column={1}>
                    <Descriptions.Item label="推荐人">
                      {renderRecommendationUser(recommendation.vipReferralReceived.inviter)}
                    </Descriptions.Item>
                    <Descriptions.Item label="使用的 VIP 推荐码">
                      <Typography.Text code>{recommendation.vipReferralReceived.codeUsed}</Typography.Text>
                    </Descriptions.Item>
                    <Descriptions.Item label="渠道">
                      {recommendation.vipReferralReceived.channel || '-'}
                    </Descriptions.Item>
                    <Descriptions.Item label="绑定时间">
                      {formatDateTime(recommendation.vipReferralReceived.createdAt)}
                    </Descriptions.Item>
                  </Descriptions>
                ) : (
                  <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="没有收到 VIP 推荐关系" />
                )}
              </Card>
            </Col>
          </Row>

          <Card size="small" title="直接邀请的普通用户">
            <Table
              rowKey="id"
              size="small"
              dataSource={recommendation.directNormalInvitees}
              pagination={recommendation.directNormalInvitees.length > 5 ? { pageSize: 5 } : false}
              columns={[
                {
                  title: '被推荐人',
                  dataIndex: 'invitee',
                  width: 240,
                  render: (value) => renderRecommendationUser(value),
                },
                {
                  title: '分享码',
                  dataIndex: 'code',
                  width: 120,
                  render: (value) => <Typography.Text code>{value}</Typography.Text>,
                },
                {
                  title: '关系状态',
                  dataIndex: 'relationStatus',
                  width: 130,
                  render: (value) => renderMappedTag(value, directRelationStatusMap),
                },
                {
                  title: '奖励状态',
                  dataIndex: 'rewardStatus',
                  width: 120,
                  render: (value) => renderMappedTag(value, normalShareRewardStatusMap),
                },
                {
                  title: '首单',
                  dataIndex: 'firstOrder',
                  width: 150,
                  render: (value) => renderFirstOrder(value),
                },
                {
                  title: '绑定时间',
                  dataIndex: 'boundAt',
                  width: 160,
                  render: (value) => formatDateTime(value),
                },
              ]}
            />
          </Card>

          <Card size="small" title="直接邀请的 VIP 用户">
            <Table
              rowKey="userId"
              size="small"
              dataSource={recommendation.directVipInvitees}
              pagination={recommendation.directVipInvitees.length > 5 ? { pageSize: 5 } : false}
              columns={[
                {
                  title: 'VIP 用户',
                  dataIndex: 'user',
                  width: 260,
                  render: (value) => renderRecommendationUser(value),
                },
                {
                  title: 'TA 的推荐码',
                  dataIndex: 'referralCode',
                  width: 150,
                  render: (value) => value ? <Typography.Text code>{value}</Typography.Text> : '-',
                },
                {
                  title: 'VIP 开通时间',
                  dataIndex: 'vipPurchasedAt',
                  width: 170,
                  render: (value) => formatDateTime(value),
                },
                {
                  title: '更新时间',
                  dataIndex: 'updatedAt',
                  width: 170,
                  render: (value) => formatDateTime(value),
                },
              ]}
            />
          </Card>
        </Space>
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
              {
                title: '账户', dataIndex: ['account', 'type'], width: 110,
                render: (v: string | undefined) => {
                  if (!v) return '-';
                  const m = rewardAccountTypeMap[v];
                  return <Tag color={m?.color || 'default'}>{m?.text || v}</Tag>;
                },
              },
              {
                title: '类型', dataIndex: 'entryType', width: 80,
                render: (v: string) => {
                  const m = rewardEntryTypeMap[v];
                  return <Tag color={m?.color || 'default'}>{m?.text || v}</Tag>;
                },
              },
              { title: '金额', dataIndex: 'amount', width: 100, render: (v: number) => `¥${v.toFixed(2)}` },
              {
                title: '状态', dataIndex: 'status', width: 80,
                render: (v: string) => {
                  const m = rewardLedgerStatusMap[v];
                  return <Tag color={m?.color || 'default'}>{m?.text || v}</Tag>;
                },
              },
              {
                title: '关联类型', dataIndex: 'refType', width: 100,
                render: (v: string | null) => (v ? (rewardRefTypeMap[v] || v) : '-'),
              },
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
            <div style={{ marginTop: 4 }}>
              <BuyerIdentityText
                buyerNo={user.buyerNo}
                userId={user.id}
                phone={user.phone || undefined}
                compact
              />
            </div>
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

      <PermissionGate permission={PERMISSIONS.DIGITAL_ASSETS_READ}>
        <Card style={{ marginBottom: 16 }}>
          <Row align="middle" gutter={16}>
            <Col span={8}>
              <Statistic
                title="累计消费金额"
                value={digitalAsset?.account?.cumulativeSpendAmount ?? 0}
                precision={2}
                prefix={<><WalletOutlined /> ¥</>}
              />
            </Col>
            <Col span={10}>
              <Space wrap>
                {(digitalAsset?.modules ?? []).map((item) => (
                  <Tag key={item.key} color="default">{item.title} · 待开放</Tag>
                ))}
              </Space>
            </Col>
            <Col span={6} style={{ textAlign: 'right' }}>
              <Button onClick={() => navigate('/digital-assets')}>查看数字资产台账</Button>
            </Col>
          </Row>
        </Card>
      </PermissionGate>

      {/* Tabs */}
      <Card>
        <Tabs items={tabItems} activeKey={activeTab} onChange={setActiveTab} />
      </Card>

      {/* 操作区 */}
      <Card style={{ marginTop: 16 }}>
        <Space wrap>
          <PermissionGate permission={PERMISSIONS.CS_OUTREACH}>
            <Button
              icon={<MessageOutlined />}
              disabled={!user.buyerNo || user.status !== 'ACTIVE'}
              onClick={() => setOutreachModal({ open: true, initialMessage: '', inviteTitle: '' })}
            >
              联系买家
            </Button>
          </PermissionGate>
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
        </Space>
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

      <Modal
        title="联系买家"
        open={outreachModal.open}
        onCancel={() => setOutreachModal({ open: false, initialMessage: '', inviteTitle: '' })}
        onOk={handleCreateOutreach}
        okText="发起对话"
        confirmLoading={outreachSubmitting}
      >
        <Space direction="vertical" style={{ width: '100%' }} size={12}>
          <div>
            <div style={{ marginBottom: 6, color: '#64748b' }}>买家编号</div>
            <Input value={user.buyerNo || ''} disabled />
          </div>
          <div>
            <div style={{ marginBottom: 6, color: '#64748b' }}>邀请标题</div>
            <Input
              maxLength={80}
              placeholder="选填，默认：平台客服邀请沟通"
              value={outreachModal.inviteTitle}
              onChange={(e) => setOutreachModal((prev) => ({ ...prev, inviteTitle: e.target.value }))}
            />
          </div>
          <div>
            <div style={{ marginBottom: 6, color: '#64748b' }}>初始消息</div>
            <Input.TextArea
              rows={5}
              maxLength={5000}
              showCount
              placeholder="输入客服要发给买家的第一条消息"
              value={outreachModal.initialMessage}
              onChange={(e) => setOutreachModal((prev) => ({ ...prev, initialMessage: e.target.value }))}
            />
          </div>
        </Space>
      </Modal>
    </div>
  );
}
