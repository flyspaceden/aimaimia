import { useParams, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  Breadcrumb,
  Card,
  Row,
  Col,
  Statistic,
  Descriptions,
  Divider,
  Table,
  Tag,
  Button,
  Spin,
  Result,
} from 'antd';
import {
  ArrowLeftOutlined,
  WalletOutlined,
  LockOutlined,
  RiseOutlined,
} from '@ant-design/icons';
import { getMemberDetail } from '@/api/bonus';
import type { BonusMemberDetail } from '@/types';
import BuyerIdentityText from '@/components/BuyerIdentityText';
import dayjs from 'dayjs';

// 流水类型映射（与 schema.prisma RewardEntryType 枚举对齐）
const entryTypeMap: Record<string, { text: string; color: string }> = {
  FREEZE: { text: '冻结', color: 'orange' },
  RELEASE: { text: '释放', color: 'green' },
  WITHDRAW: { text: '提现', color: 'blue' },
  VOID: { text: '作废', color: 'default' },
  ADJUST: { text: '调账', color: 'purple' },
  DEDUCT: { text: '抵扣', color: 'magenta' },
};

// 流水状态映射（与 schema.prisma RewardLedgerStatus 枚举对齐）
const ledgerStatusMap: Record<string, { text: string; color: string }> = {
  AVAILABLE: { text: '可用', color: 'green' },
  FROZEN: { text: '冻结', color: 'orange' },
  WITHDRAWN: { text: '已提现', color: 'blue' },
  VOIDED: { text: '已作废', color: 'default' },
  RESERVED: { text: '预留', color: 'cyan' },
  RETURN_FROZEN: { text: '售后冻结', color: 'gold' },
};

// 关联类型映射（refType 字段，由业务代码写入，非 Prisma enum）
const refTypeMap: Record<string, string> = {
  ORDER: '订单',
  CHECKOUT: '下单',
  CHECKOUT_SESSION: '结算',
  WITHDRAW: '提现',
  AFTER_SALE: '售后',
  REFUND_RESTORE: '退款回填',
  FREEZE_EXPIRE: '冻结过期',
  VIP_REFERRAL: 'VIP 推荐奖励',
};

// 提现状态映射（与 schema.prisma WithdrawStatus 枚举对齐）
const withdrawStatusMap: Record<string, { text: string; color: string }> = {
  REQUESTED: { text: '待审核', color: 'processing' },
  PROCESSING: { text: '处理中', color: 'processing' },
  APPROVED: { text: '已批准', color: 'success' },
  REJECTED: { text: '已拒绝', color: 'error' },
  PAID: { text: '已打款', color: 'green' },
  FAILED: { text: '失败', color: 'red' },
};

// 提现渠道映射（与 schema.prisma WithdrawChannel 枚举对齐）
const withdrawChannelMap: Record<string, string> = {
  WECHAT: '微信',
  ALIPAY: '支付宝',
  BANKCARD: '银行卡',
};

export default function MemberDetailPage() {
  const { userId } = useParams<{ userId: string }>();
  const navigate = useNavigate();

  const { data, isLoading, error } = useQuery<BonusMemberDetail>({
    queryKey: ['admin', 'member-detail', userId],
    queryFn: () => getMemberDetail(userId!),
    enabled: !!userId,
  });

  if (isLoading) {
    return (
      <div style={{ padding: 24, textAlign: 'center', paddingTop: 100 }}>
        <Spin size="large" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div style={{ padding: 24 }}>
        <Result
          status="error"
          title="加载失败"
          subTitle="无法获取会员详情"
          extra={<Button onClick={() => navigate(-1)}>返回</Button>}
        />
      </div>
    );
  }

  const d = data;
  const buildTreeLink = (path: '/bonus/vip-tree' | '/bonus/normal-tree') => {
    const params = new URLSearchParams({
      userId: d.userId,
      source: 'member-detail',
      sourceLabel: '会员详情',
    });
    return `${path}?${params.toString()}`;
  };

  // 收支流水列
  const ledgerColumns = [
    {
      title: '类型',
      dataIndex: 'entryType',
      width: 80,
      render: (v: string) => {
        const m = entryTypeMap[v];
        return m ? <Tag color={m.color}>{m.text}</Tag> : v;
      },
    },
    {
      title: '金额',
      dataIndex: 'amount',
      width: 100,
      render: (v: number) => `¥${v.toFixed(2)}`,
    },
    {
      title: '状态',
      dataIndex: 'status',
      width: 80,
      render: (v: string) => {
        const m = ledgerStatusMap[v];
        return m ? <Tag color={m.color}>{m.text}</Tag> : v;
      },
    },
    {
      title: '关联类型',
      dataIndex: 'refType',
      width: 130,
      render: (v: string | null) => (v ? refTypeMap[v] ?? v : '-'),
    },
    {
      title: '时间',
      dataIndex: 'createdAt',
      width: 160,
      render: (v: string) => dayjs(v).format('YYYY-MM-DD HH:mm'),
    },
  ];

  // 提现记录列
  const withdrawColumns = [
    {
      title: '金额',
      dataIndex: 'amount',
      width: 100,
      render: (v: number) => `¥${v.toFixed(2)}`,
    },
    {
      title: '状态',
      dataIndex: 'status',
      width: 100,
      render: (v: string) => {
        const m = withdrawStatusMap[v];
        return m ? <Tag color={m.color}>{m.text}</Tag> : v;
      },
    },
    {
      title: '渠道',
      dataIndex: 'channel',
      width: 100,
      render: (v: string | null) => (v ? withdrawChannelMap[v] ?? v : '-'),
    },
    {
      title: '时间',
      dataIndex: 'createdAt',
      width: 160,
      render: (v: string) => dayjs(v).format('YYYY-MM-DD HH:mm'),
    },
  ];

  return (
    <div style={{ padding: 24 }}>
      {/* 面包屑导航 */}
      <Breadcrumb
        style={{ marginBottom: 12 }}
        items={[
          { title: <a onClick={() => navigate('/')}>首页</a> },
          { title: <a onClick={() => navigate('/bonus/members')}>会员管理</a> },
          { title: '会员详情' },
        ]}
      />
      <Button
        icon={<ArrowLeftOutlined />}
        onClick={() => navigate(-1)}
        style={{ marginBottom: 16 }}
      >
        返回
      </Button>

      {/* 钱包概览 */}
      <Divider orientation="left">钱包概览</Divider>
      <Row gutter={[16, 16]} style={{ marginBottom: 24 }}>
        <Col xs={24} sm={8}>
          <Card hoverable style={{ borderLeft: '3px solid #1677ff' }}>
            <Statistic
              title="可用余额"
              value={d.wallet.balance}
              precision={2}
              prefix={<WalletOutlined />}
              suffix="元"
              valueStyle={{ color: '#1677ff' }}
            />
          </Card>
        </Col>
        <Col xs={24} sm={8}>
          <Card hoverable style={{ borderLeft: '3px solid #faad14' }}>
            <Statistic
              title="冻结金额"
              value={d.wallet.frozen}
              precision={2}
              prefix={<LockOutlined />}
              suffix="元"
              valueStyle={{ color: '#faad14' }}
            />
          </Card>
        </Col>
        <Col xs={24} sm={8}>
          <Card hoverable style={{ borderLeft: '3px solid #52c41a' }}>
            <Statistic
              title="累计收入"
              value={d.wallet.totalEarned}
              precision={2}
              prefix={<RiseOutlined />}
              suffix="元"
              valueStyle={{ color: '#52c41a' }}
            />
          </Card>
        </Col>
      </Row>

      {/* 基础信息 */}
      <Divider orientation="left">基础信息</Divider>
      <Card style={{ marginBottom: 24 }}>
        <Descriptions column={{ xs: 1, sm: 2, lg: 3 }} bordered size="small">
          <Descriptions.Item label="买家身份">
            <BuyerIdentityText
              buyerNo={d.buyerNo}
              userId={d.userId}
              nickname={d.nickname || d.phone || '-'}
            />
          </Descriptions.Item>
          <Descriptions.Item label="昵称">{d.nickname ?? '-'}</Descriptions.Item>
          <Descriptions.Item label="手机号">{d.phone ?? '-'}</Descriptions.Item>
          {d.avatarUrl && (
            <Descriptions.Item label="头像">
              <img
                src={d.avatarUrl}
                alt="avatar"
                style={{ width: 40, height: 40, borderRadius: '50%' }}
              />
            </Descriptions.Item>
          )}
          <Descriptions.Item label="等级">
            <Tag color={d.tier === 'VIP' ? 'gold' : 'default'}>{d.tier}</Tag>
          </Descriptions.Item>
          <Descriptions.Item label="VIP 开通时间">
            {d.vipPurchasedAt ? dayjs(d.vipPurchasedAt).format('YYYY-MM-DD HH:mm') : '-'}
          </Descriptions.Item>
        </Descriptions>
      </Card>

      {/* 奖励位置 */}
      <Divider orientation="left">奖励位置</Divider>
      <Row gutter={[16, 16]} style={{ marginBottom: 24 }}>
        {/* VIP 奖励位置 — 仅 VIP 用户且存在节点时展示 */}
        {d.tree && d.tier === 'VIP' && (
          <Col xs={24} lg={12}>
            <Card
              title="VIP 奖励位置"
              extra={
                <Button
                  type="link"
                  size="small"
                  onClick={() => navigate(buildTreeLink('/bonus/vip-tree'))}
                >
                  查看完整结构 →
                </Button>
              }
            >
              <Descriptions column={{ xs: 1, sm: 2 }} bordered size="small">
                <Descriptions.Item label="层级">{d.tree.level}</Descriptions.Item>
                <Descriptions.Item label="位置">{d.tree.position}</Descriptions.Item>
                <Descriptions.Item label="上级">{d.tree.parentUserId ?? '根节点'}</Descriptions.Item>
                <Descriptions.Item label="下级数量">{d.tree.childCount}</Descriptions.Item>
                <Descriptions.Item label="自购单数">{d.tree.selfPurchaseCount}</Descriptions.Item>
                <Descriptions.Item label="解锁层级">{d.tree.unlockedLevel}</Descriptions.Item>
                <Descriptions.Item label="状态" span={2}>
                  {d.tree.exitedAt ? (
                    <Tag color="red">已退出 ({dayjs(d.tree.exitedAt).format('YYYY-MM-DD')})</Tag>
                  ) : (
                    <Tag color="green">正常</Tag>
                  )}
                </Descriptions.Item>
              </Descriptions>
            </Card>
          </Col>
        )}

        {/* 普通奖励位置 — 所有用户都有 */}
        <Col xs={24} lg={d.tier === 'VIP' && d.tree ? 12 : 24}>
          <Card
            title="普通奖励账户"
            extra={
              <Button
                type="link"
                size="small"
                onClick={() => navigate(buildTreeLink('/bonus/normal-tree'))}
              >
                查看完整结构 →
              </Button>
            }
          >
            <Descriptions column={{ xs: 1, sm: 2 }} bordered size="small">
              <Descriptions.Item label="等级">
                <Tag color={d.tier === 'VIP' ? 'gold' : 'default'}>{d.tier}</Tag>
              </Descriptions.Item>
              <Descriptions.Item label="推荐码">{d.referralCode ?? '-'}</Descriptions.Item>
              <Descriptions.Item label="邀请人">
                {d.inviterUserId ? (
                  <a onClick={() => navigate(`/bonus/members/${d.inviterUserId}`)}>
                    {d.inviterUserId}
                  </a>
                ) : '-'}
              </Descriptions.Item>
            </Descriptions>
          </Card>
        </Col>
      </Row>

      {/* 收支与提现 */}
      <Divider orientation="left">收支与提现</Divider>
      <Row gutter={[16, 16]}>
        {/* 收支流水 */}
        <Col xs={24} lg={14}>
          <Card title="收支流水（最近 20 条）" style={{ marginBottom: 24 }}>
            <Table
              columns={ledgerColumns}
              dataSource={d.ledgers ?? []}
              rowKey="id"
              pagination={false}
              size="small"
              scroll={{ x: 600, y: 320 }}
            />
          </Card>
        </Col>

        {/* 提现记录 */}
        <Col xs={24} lg={10}>
          <Card title="提现记录（最近 10 条）" style={{ marginBottom: 24 }}>
            <Table
              columns={withdrawColumns}
              dataSource={d.withdrawals ?? []}
              rowKey="id"
              pagination={false}
              size="small"
              scroll={{ x: 600, y: 320 }}
            />
          </Card>
        </Col>
      </Row>
    </div>
  );
}
