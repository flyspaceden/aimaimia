import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Alert,
  App,
  Avatar,
  Button,
  Card,
  Col,
  Divider,
  Drawer,
  Form,
  Input,
  InputNumber,
  Modal,
  Row,
  Select,
  Space,
  Statistic,
  Switch,
  Table,
  Tabs,
  Tag,
  Typography,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { ProTable } from '@ant-design/pro-components';
import type { ActionType, ProColumns } from '@ant-design/pro-components';
import type { SortOrder } from 'antd/es/table/interface';
import {
  EditOutlined,
  PlusOutlined,
  SettingOutlined,
  UserOutlined,
  WalletOutlined,
} from '@ant-design/icons';
import dayjs from 'dayjs';
import BuyerIdentityText from '@/components/BuyerIdentityText';
import PermissionGate from '@/components/PermissionGate';
import {
  adjustGrowthUser,
  createGrowthExchangeItem,
  getGrowthAccounts,
  getGrowthDashboard,
  getGrowthExchangeItems,
  getGrowthLedgers,
  getGrowthLevels,
  getGrowthRules,
  getGrowthSettings,
  replaceGrowthLevels,
  updateGrowthExchangeItem,
  updateGrowthSettings,
  upsertGrowthRule,
} from '@/api/growth';
import { getCampaigns, type CouponCampaign } from '@/api/coupon';
import { PERMISSIONS } from '@/constants/permissions';
import { useResizableColumns } from '@/components/table/useResizableColumns';
import type {
  AdminGrowthAccountRow,
  AdminGrowthAccountQueryParams,
  AdminGrowthExchangeItem,
  AdminGrowthExchangeItemPayload,
  AdminGrowthLedger,
  AdminGrowthLedgerQueryParams,
  AdminGrowthLevel,
  AdminGrowthRule,
  AdminGrowthSettings,
  AdminGrowthUserSummary,
} from '@/types';

const behaviorCodeLabels: Record<string, string> = {
  REGISTER: '注册登录',
  COMPLETE_PROFILE: '完善资料',
  BIND_PHONE_OR_WECHAT: '绑定手机号/微信',
  CHECK_IN: '签到',
  BROWSE_PRODUCTS: '浏览商品',
  FAVORITE_ITEM: '收藏商品',
  SHARE_CONTENT: '分享内容',
  FIRST_ORDER_RECEIVED: '首单确认收货',
  REVIEW_ORDER: '订单评价',
  REPURCHASE_RECEIVED: '复购确认收货',
  NORMAL_INVITE_REGISTER: '普通邀请注册',
  NORMAL_INVITE_FIRST_ORDER: '普通邀请首单',
  VIP_PURCHASE: '购买 VIP',
  TASK_COMPLETE: '任务完成',
  ADMIN_ADJUST: '后台调整',
  AUTO_VIP_UPGRADE: '累计消费自动成为 VIP',
};

const wiredBehaviorCodes = new Set([
  'REGISTER',
  'CHECK_IN',
  'FIRST_ORDER_RECEIVED',
  'REPURCHASE_RECEIVED',
  'NORMAL_INVITE_REGISTER',
  'NORMAL_INVITE_FIRST_ORDER',
  'TASK_COMPLETE',
  'ADMIN_ADJUST',
]);

const grantTimingLabels: Record<string, string> = {
  IMMEDIATE: '立即发放',
  CONFIRMED_RECEIPT: '确认收货后发放',
  AFTER_SALE_WINDOW: '售后期结束后发放',
  MANUAL: '人工审核后发放',
};

const behaviorUserEffects: Record<string, string> = {
  REGISTER: '用户注册登录后获得一次新手奖励。',
  CHECK_IN: '用户签到后获得积分，成长值按配置发放。',
  FIRST_ORDER_RECEIVED: '用户自己的首单确认收货后发放。',
  REPURCHASE_RECEIVED: '用户复购订单确认收货后发放。',
  NORMAL_INVITE_REGISTER: '普通用户邀请新人注册后，邀请人立即获得奖励。',
  NORMAL_INVITE_FIRST_ORDER: '被邀请人首单确认收货后，邀请人获得首单奖励。',
  TASK_COMPLETE: '任务系统确认完成后发放。',
  ADMIN_ADJUST: '管理员手动调整时写入流水。',
  COMPLETE_PROFILE: '当前还没有前端/后端完成事件，启用也不会自动发放。',
  BIND_PHONE_OR_WECHAT: '当前还没有绑定事件接入，启用也不会自动发放。',
  BROWSE_PRODUCTS: '当前还没有浏览计数事件，启用也不会自动发放。',
  FAVORITE_ITEM: '当前还没有收藏事件接入，启用也不会自动发放。',
  SHARE_CONTENT: '当前还没有分享内容事件接入，启用也不会自动发放。',
  REVIEW_ORDER: '当前还没有评价事件接入，启用也不会自动发放。',
  VIP_PURCHASE: '当前 VIP 购买成长事件未接入，启用也不会自动发放。',
};

const categoryOptions = [
  { label: '新手', value: 'NEWBIE' },
  { label: '日常', value: 'DAILY' },
  { label: '购物', value: 'SHOPPING' },
  { label: '分享', value: 'SHARE' },
  { label: '邀请', value: 'INVITE' },
  { label: '会员', value: 'VIP' },
  { label: '任务', value: 'TASK' },
  { label: '管理', value: 'ADMIN' },
];

const ledgerTypeMap: Record<string, { text: string; color: string }> = {
  POINTS_EARN: { text: '积分入账', color: 'green' },
  POINTS_SPEND: { text: '积分消耗', color: 'orange' },
  POINTS_EXPIRE: { text: '积分过期', color: 'red' },
  POINTS_REVERSE: { text: '积分冲正', color: 'red' },
  GROWTH_EARN: { text: '成长入账', color: 'blue' },
  GROWTH_REVERSE: { text: '成长冲正', color: 'red' },
  ADMIN_ADJUST: { text: '后台调整', color: 'magenta' },
};

const exchangeTypeMap: Record<string, { text: string; color: string }> = {
  COUPON: { text: '平台红包', color: 'red' },
  SHIPPING_COUPON: { text: '运费红包', color: 'orange' },
  LOTTERY_CHANCE: { text: '抽奖机会', color: 'purple' },
  VIP_DISCOUNT_COUPON: { text: 'VIP 优惠红包', color: 'gold' },
  DECORATION: { text: '装饰权益', color: 'cyan' },
};

const exchangeStatusMap: Record<string, { text: string; color: string }> = {
  ACTIVE: { text: '启用', color: 'green' },
  INACTIVE: { text: '停用', color: 'default' },
  SOLD_OUT: { text: '售罄', color: 'red' },
};
const couponDistributionModeLabels: Record<string, string> = {
  AUTO: '系统发放',
  MANUAL: '手动发放',
  CLAIM: '用户领取',
};

const couponExchangeTypes = new Set(['COUPON', 'SHIPPING_COUPON', 'VIP_DISCOUNT_COUPON']);
const exchangeTypeOptions = Object.entries(exchangeTypeMap)
  .filter(([value]) => couponExchangeTypes.has(value))
  .map(([value, meta]) => ({ label: meta.text, value }));
const accountUserTypeOptions = [
  { label: '全部用户', value: 'ALL' },
  { label: '普通用户', value: 'NORMAL' },
  { label: 'VIP 用户', value: 'VIP' },
];
const applicableUserTypeLabels: Record<string, string> = {
  ALL: '全部',
  NORMAL: '普通用户',
  VIP: 'VIP 用户',
};

type GrowthSettingsForm = Omit<
  AdminGrowthSettings,
  'autoVipBySpendEnabled' | 'autoVipCumulativeSpendThreshold'
>;

function formatInt(value?: number | null) {
  return Number(value ?? 0).toLocaleString();
}

function isExchangeIssuableCouponCampaign(campaign: CouponCampaign) {
  const now = Date.now();
  const startAt = new Date(campaign.startAt).getTime();
  const endAt = campaign.endAt ? new Date(campaign.endAt).getTime() : null;
  return (
    campaign.status === 'ACTIVE' &&
    campaign.distributionMode === 'MANUAL' &&
    campaign.growthExchangeEnabled === true &&
    campaign.issuedCount < campaign.totalQuota &&
    startAt <= now &&
    (endAt === null || endAt >= now)
  );
}

function getExchangeCampaignOptionMeta(campaign: CouponCampaign) {
  const remaining = Math.max(campaign.totalQuota - campaign.issuedCount, 0);
  const threshold = campaign.minOrderAmount > 0 ? `满 ${campaign.minOrderAmount} 元可用` : '无门槛';
  const mode = couponDistributionModeLabels[campaign.distributionMode] ?? campaign.distributionMode;
  return { mode, remaining, threshold };
}

function renderExchangeCampaignOption(campaign: CouponCampaign) {
  const { mode, remaining, threshold } = getExchangeCampaignOptionMeta(campaign);
  return (
    <Space direction="vertical" size={2} style={{ width: '100%', whiteSpace: 'normal' }}>
      <Typography.Text strong>{campaign.name}</Typography.Text>
      <Space size={6} wrap>
        <Tag color="geekblue">积分兑换专用</Tag>
        <Tag color="green">{mode}</Tag>
        <Typography.Text type="secondary">剩余 {remaining} 张</Typography.Text>
        <Typography.Text type="secondary">{threshold}</Typography.Text>
      </Space>
    </Space>
  );
}

function renderUser(user: AdminGrowthUserSummary | null | undefined, options?: { copyable?: boolean }) {
  if (!user) return <Typography.Text type="secondary">-</Typography.Text>;
  return (
    <Space>
      <Avatar src={user.avatarUrl ?? undefined} icon={<UserOutlined />} />
      <BuyerIdentityText
        buyerNo={user.buyerNo}
        userId={user.id}
        nickname={user.nickname || user.phone || '-'}
        compact
        copyable={options?.copyable}
      />
    </Space>
  );
}

function getSortParams(sort: Record<string, SortOrder | undefined>): {
  sortBy?: AdminGrowthAccountQueryParams['sortBy'];
  sortOrder?: AdminGrowthAccountQueryParams['sortOrder'];
} {
  const selected = Object.entries(sort ?? {}).find(([, order]) => order === 'ascend' || order === 'descend');
  if (!selected) return {};
  const [field, order] = selected;
  if (!['pointsBalance', 'pointsTotalEarned', 'pointsTotalSpent', 'growthValue', 'updatedAt'].includes(field)) return {};
  return {
    sortBy: field as AdminGrowthAccountQueryParams['sortBy'],
    sortOrder: order as AdminGrowthAccountQueryParams['sortOrder'],
  };
}

function getLedgerSortParams(sort: Record<string, SortOrder | undefined>): {
  sortBy?: AdminGrowthLedgerQueryParams['sortBy'];
  sortOrder?: AdminGrowthLedgerQueryParams['sortOrder'];
} {
  const selected = Object.entries(sort ?? {}).find(([, order]) => order === 'ascend' || order === 'descend');
  if (!selected) return {};
  const [field, order] = selected;
  if (!['createdAt', 'pointsDelta', 'growthDelta'].includes(field)) return {};
  return {
    sortBy: field as AdminGrowthLedgerQueryParams['sortBy'],
    sortOrder: order as AdminGrowthLedgerQueryParams['sortOrder'],
  };
}

function pickGrowthSettings(settings: AdminGrowthSettings): GrowthSettingsForm {
  return {
    growthEnabled: settings.growthEnabled,
    pointsExpireDays: settings.pointsExpireDays,
    pointsExpireRemindDays: settings.pointsExpireRemindDays,
    dailyPointsCap: settings.dailyPointsCap,
    monthlyPointsCap: settings.monthlyPointsCap,
    dailyShareRewardUserCap: settings.dailyShareRewardUserCap,
    monthlyInviteFirstOrderCap: settings.monthlyInviteFirstOrderCap,
    refundReversalEnabled: settings.refundReversalEnabled,
    autoSuspendExchangeRisk: settings.autoSuspendExchangeRisk,
  };
}

export default function GrowthPage() {
  const { message } = App.useApp();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const actionRef = useRef<ActionType>(null);
  const ledgerActionRef = useRef<ActionType>(null);
  const [ruleModalOpen, setRuleModalOpen] = useState(false);
  const [editingRule, setEditingRule] = useState<AdminGrowthRule | null>(null);
  const [exchangeModalOpen, setExchangeModalOpen] = useState(false);
  const [editingExchange, setEditingExchange] = useState<AdminGrowthExchangeItem | null>(null);
  const [adjustingAccount, setAdjustingAccount] = useState<AdminGrowthAccountRow | null>(null);
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [levelDrafts, setLevelDrafts] = useState<AdminGrowthLevel[] | null>(null);
  const [ruleForm] = Form.useForm<AdminGrowthRule>();
  const [exchangeForm] = Form.useForm<AdminGrowthExchangeItemPayload>();
  const [adjustForm] = Form.useForm<{
    pointsDelta: number;
    growthDelta: number;
    reason: string;
  }>();
  const [settingsForm] = Form.useForm<GrowthSettingsForm>();

  const dashboardQuery = useQuery({
    queryKey: ['admin', 'growth', 'dashboard'],
    queryFn: getGrowthDashboard,
  });
  const rulesQuery = useQuery({
    queryKey: ['admin', 'growth', 'rules'],
    queryFn: getGrowthRules,
  });
  const settingsQuery = useQuery({
    queryKey: ['admin', 'growth', 'settings'],
    queryFn: getGrowthSettings,
  });
  const levelsQuery = useQuery({
    queryKey: ['admin', 'growth', 'levels'],
    queryFn: getGrowthLevels,
  });
  const exchangeItemsQuery = useQuery({
    queryKey: ['admin', 'growth', 'exchange-items'],
    queryFn: getGrowthExchangeItems,
  });
  const couponCampaignsQuery = useQuery({
    queryKey: ['admin', 'growth', 'coupon-campaigns'],
    queryFn: () => getCampaigns({ page: 1, pageSize: 200, status: 'ACTIVE' }),
    enabled: exchangeModalOpen,
  });

  useEffect(() => {
    if (settingsQuery.data) {
      settingsForm.setFieldsValue(pickGrowthSettings(settingsQuery.data));
    }
  }, [settingsForm, settingsQuery.data]);

  const currentLevelDrafts = levelDrafts ?? levelsQuery.data ?? [];

  const levelOptions = useMemo(
    () =>
      (levelsQuery.data ?? []).map((level) => ({
        label: `${level.name} (${level.threshold})`,
        value: level.code,
      })),
    [levelsQuery.data],
  );
  const exchangeAvailableCouponCampaigns = useMemo(
    () => (couponCampaignsQuery.data?.items ?? []).filter(isExchangeIssuableCouponCampaign),
    [couponCampaignsQuery.data?.items],
  );

  const saveRuleMutation = useMutation({
    mutationFn: (data: AdminGrowthRule) => upsertGrowthRule(data.code, data),
    onSuccess: () => {
      message.success('行为规则已保存');
      setRuleModalOpen(false);
      setEditingRule(null);
      queryClient.invalidateQueries({ queryKey: ['admin', 'growth'] });
    },
    onError: (error: Error) => message.error(error.message || '保存失败'),
  });
  const toggleRuleMutation = useMutation({
    mutationFn: ({ rule, enabled }: { rule: AdminGrowthRule; enabled: boolean }) =>
      upsertGrowthRule(rule.code, { ...rule, enabled }),
    onSuccess: (_, variables) => {
      message.success(variables.enabled ? '行为规则已生效' : '行为规则已停用');
      queryClient.invalidateQueries({ queryKey: ['admin', 'growth'] });
    },
    onError: (error: Error) => message.error(error.message || '状态更新失败'),
  });

  const saveSettingsMutation = useMutation({
    mutationFn: updateGrowthSettings,
    onSuccess: (settings) => {
      message.success('成长设置已保存');
      settingsForm.setFieldsValue(pickGrowthSettings(settings));
      queryClient.invalidateQueries({ queryKey: ['admin', 'growth'] });
    },
    onError: (error: Error) => message.error(error.message || '保存失败'),
  });

  const saveLevelsMutation = useMutation({
    mutationFn: replaceGrowthLevels,
    onSuccess: (levels) => {
      message.success('成长等级已保存');
      setLevelDrafts(levels);
      queryClient.invalidateQueries({
        queryKey: ['admin', 'growth', 'levels'],
      });
    },
    onError: (error: Error) => message.error(error.message || '保存失败'),
  });

  const saveExchangeMutation = useMutation({
    mutationFn: (data: AdminGrowthExchangeItemPayload) =>
      editingExchange ? updateGrowthExchangeItem(editingExchange.id, data) : createGrowthExchangeItem(data),
    onSuccess: () => {
      message.success('兑换项已保存');
      setExchangeModalOpen(false);
      setEditingExchange(null);
      queryClient.invalidateQueries({ queryKey: ['admin', 'growth'] });
    },
    onError: (error: Error) => message.error(error.message || '保存失败'),
  });

  const adjustMutation = useMutation({
    mutationFn: ({
      userId,
      data,
    }: {
      userId: string;
      data: { pointsDelta: number; growthDelta: number; reason: string };
    }) => adjustGrowthUser(userId, data),
    onSuccess: () => {
      message.success('调整已写入流水');
      setAdjustingAccount(null);
      adjustForm.resetFields();
      actionRef.current?.reload();
      queryClient.invalidateQueries({ queryKey: ['admin', 'growth'] });
    },
    onError: (error: Error) => message.error(error.message || '调整失败'),
  });

  const openRuleModal = (rule: AdminGrowthRule) => {
    setEditingRule(rule);
    ruleForm.setFieldsValue({
      ...rule,
      startAt: rule.startAt ? dayjs(rule.startAt).format('YYYY-MM-DDTHH:mm') : null,
      endAt: rule.endAt ? dayjs(rule.endAt).format('YYYY-MM-DDTHH:mm') : null,
    } as unknown as Parameters<typeof ruleForm.setFieldsValue>[0]);
    setRuleModalOpen(true);
  };

  const openExchangeModal = (item?: AdminGrowthExchangeItem) => {
    setEditingExchange(item ?? null);
    exchangeForm.setFieldsValue(
      item
        ? {
            ...item,
            startAt: item.startAt ? dayjs(item.startAt).format('YYYY-MM-DDTHH:mm') : null,
            endAt: item.endAt ? dayjs(item.endAt).format('YYYY-MM-DDTHH:mm') : null,
          }
        : {
            type: 'COUPON',
            name: '',
            pointsCost: 100,
            status: 'ACTIVE',
            sortOrder: 0,
            perUserDailyLimit: 1,
            perUserMonthlyLimit: 5,
          },
    );
    setExchangeModalOpen(true);
  };

  const accountColumns: ProColumns<AdminGrowthAccountRow>[] = [
    {
      title: '用户',
      dataIndex: 'keyword',
      width: 280,
      render: (_: unknown, record) => (
        <Button
          type="link"
          style={{ padding: 0, height: 'auto', textAlign: 'left' }}
          onClick={() => setSelectedUserId(record.userId)}
        >
          {renderUser(record.user, { copyable: false })}
        </Button>
      ),
    },
    {
      title: '用户身份',
      dataIndex: 'userType',
      width: 120,
      valueType: 'select',
      initialValue: 'ALL',
      fieldProps: { options: accountUserTypeOptions },
      render: (_: unknown, record) =>
        record.user?.vipStatus === 'VIP' ? (
          <Tag color="gold">VIP 用户</Tag>
        ) : (
          <Tag color="blue">普通用户</Tag>
        ),
    },
    {
      title: '等级',
      dataIndex: 'levelCode',
      width: 130,
      valueType: 'select',
      fieldProps: { options: levelOptions },
      render: (_: unknown, record) =>
        record.currentLevel ? (
          <Tag color="blue">{record.currentLevel.name}</Tag>
        ) : (
          <Typography.Text type="secondary">未定级</Typography.Text>
        ),
    },
    {
      title: '积分余额',
      dataIndex: 'pointsBalance',
      search: false,
      sorter: true,
      width: 120,
      render: (_: unknown, record) => <Typography.Text strong>{formatInt(record.pointsBalance)}</Typography.Text>,
    },
    {
      title: '累计获得',
      dataIndex: 'pointsTotalEarned',
      search: false,
      sorter: true,
      width: 120,
      render: (_: unknown, record) => formatInt(record.pointsTotalEarned),
    },
    {
      title: '累计消耗',
      dataIndex: 'pointsTotalSpent',
      search: false,
      sorter: true,
      width: 120,
      render: (_: unknown, record) => formatInt(record.pointsTotalSpent),
    },
    {
      title: '成长值',
      dataIndex: 'growthValue',
      search: false,
      sorter: true,
      width: 120,
      render: (_: unknown, record) => <Typography.Text strong>{formatInt(record.growthValue)}</Typography.Text>,
    },
    {
      title: '更新时间',
      dataIndex: 'updatedAt',
      search: false,
      sorter: true,
      width: 170,
      render: (_: unknown, record) => dayjs(record.updatedAt).format('YYYY-MM-DD HH:mm'),
    },
    {
      title: '操作',
      valueType: 'option',
      width: 180,
      render: (_: unknown, record) => [
        <Button key="ledger" type="link" onClick={() => setSelectedUserId(record.userId)}>
          流水
        </Button>,
        <PermissionGate key="adjust" permission={PERMISSIONS.GROWTH_ADJUST_USER}>
          <Button
            type="link"
            onClick={() => {
              setAdjustingAccount(record);
              adjustForm.setFieldsValue({
                pointsDelta: 0,
                growthDelta: 0,
                reason: '',
              });
            }}
          >
            调整
          </Button>
        </PermissionGate>,
        <Button key="user-detail" type="link" onClick={() => navigate(`/users/${record.userId}`)}>
          用户详情
        </Button>,
      ],
    },
  ];
  const resizableTable = useResizableColumns(accountColumns, {
    storageKey: 'admin:growth:accounts:columns',
    defaultWidth: 130,
  });

  const ruleColumns: ColumnsType<AdminGrowthRule> = [
    {
      title: '行为',
      dataIndex: 'code',
      width: 180,
      render: (code: string, record) => (
        <Typography.Text strong>{behaviorCodeLabels[code] ?? record.name}</Typography.Text>
      ),
    },
    {
      title: '分类',
      dataIndex: 'categoryCode',
      width: 90,
      render: (value: string) => categoryOptions.find((item) => item.value === value)?.label ?? value,
    },
    {
      title: '奖励',
      width: 160,
      render: (_, record) => (
        <Space>
          <Tag color="green">积分 {record.pointsReward}</Tag>
          <Tag color="blue">成长 {record.growthReward}</Tag>
        </Space>
      ),
    },
    {
      title: '发放时机',
      dataIndex: 'grantTiming',
      width: 150,
      render: (value: string) => grantTimingLabels[value] ?? value,
    },
    {
      title: '生效状态',
      width: 150,
      render: (_, record) => {
        const wired = wiredBehaviorCodes.has(record.code);
        const updatingThisRule =
          toggleRuleMutation.isPending && toggleRuleMutation.variables?.rule.code === record.code;
        const statusSwitch = (
          <Switch
            checked={wired && record.enabled}
            checkedChildren="生效"
            unCheckedChildren="停用"
            disabled={!wired || toggleRuleMutation.isPending}
            loading={updatingThisRule}
            onChange={(checked) => toggleRuleMutation.mutate({ rule: record, enabled: checked })}
          />
        );

        return (
          <Space>
            <PermissionGate
              permission={PERMISSIONS.GROWTH_MANAGE_RULES}
              fallback={
                <Switch
                  checked={wired && record.enabled}
                  checkedChildren="生效"
                  unCheckedChildren="停用"
                  disabled
                />
              }
            >
              {statusSwitch}
            </PermissionGate>
            {!wired ? <Tag color="orange">未接入</Tag> : null}
          </Space>
        );
      },
    },
    {
      title: '限制',
      width: 180,
      render: (_, record) => (
        <Space wrap>
          {record.dailyLimit ? <Tag>日 {record.dailyLimit}</Tag> : null}
          {record.weeklyLimit ? <Tag>周 {record.weeklyLimit}</Tag> : null}
          {record.monthlyLimit ? <Tag>月 {record.monthlyLimit}</Tag> : null}
          {record.lifetimeLimit ? <Tag>总 {record.lifetimeLimit}</Tag> : null}
          {!record.dailyLimit && !record.weeklyLimit && !record.monthlyLimit && !record.lifetimeLimit ? (
            <Typography.Text type="secondary">不限</Typography.Text>
          ) : null}
        </Space>
      ),
    },
    {
      title: '用户',
      dataIndex: 'applicableUserType',
      width: 110,
      render: (value: string) => <Tag>{applicableUserTypeLabels[value] ?? '未设置'}</Tag>,
    },
    {
      title: '用户看到什么',
      width: 230,
      render: (_, record) => (
        <Typography.Text type="secondary">
          {behaviorUserEffects[record.code] ?? '用户完成该行为后按本行规则获得积分和成长值。'}
        </Typography.Text>
      ),
    },
    {
      title: '操作',
      width: 100,
      render: (_, record) => (
        <PermissionGate permission={PERMISSIONS.GROWTH_MANAGE_RULES}>
          <Button type="link" icon={<EditOutlined />} onClick={() => openRuleModal(record)}>
            编辑
          </Button>
        </PermissionGate>
      ),
    },
  ];

  const levelColumns: ColumnsType<AdminGrowthLevel> = [
    {
      title: '等级名称',
      dataIndex: 'name',
      width: 180,
      render: (value: string, _record, index) => (
        <Input value={value} onChange={(event) => patchLevel(index, { name: event.target.value })} />
      ),
    },
    {
      title: '成长阈值',
      dataIndex: 'threshold',
      width: 150,
      render: (value: number, _record, index) => (
        <InputNumber
          min={0}
          precision={0}
          style={{ width: '100%' }}
          value={value}
          onChange={(nextValue) => patchLevel(index, { threshold: Number(nextValue ?? 0) })}
        />
      ),
    },
    {
      title: '展示称号',
      dataIndex: 'titleLabel',
      width: 180,
      render: (value: string | null, _record, index) => (
        <Input
          value={value ?? ''}
          onChange={(event) => patchLevel(index, { titleLabel: event.target.value || null })}
        />
      ),
    },
    {
      title: '月兑换上限',
      dataIndex: 'monthlyExchangeLimit',
      width: 140,
      render: (value: number | null, _record, index) => (
        <InputNumber
          min={0}
          precision={0}
          style={{ width: '100%' }}
          value={value ?? undefined}
          placeholder="不限"
          onChange={(nextValue) =>
            patchLevel(index, {
              monthlyExchangeLimit: nextValue === null ? null : Number(nextValue),
            })
          }
        />
      ),
    },
    {
      title: '启用',
      dataIndex: 'enabled',
      width: 90,
      render: (enabled: boolean, _record, index) => (
        <Switch checked={enabled} onChange={(checked) => patchLevel(index, { enabled: checked })} />
      ),
    },
    {
      title: '操作',
      width: 90,
      render: (_, _record, index) => (
        <Button
          type="link"
          danger
          disabled={currentLevelDrafts.length <= 1}
          onClick={() =>
            setLevelDrafts((current) =>
              (current ?? levelsQuery.data ?? []).filter((__, currentIndex) => currentIndex !== index),
            )
          }
        >
          删除
        </Button>
      ),
    },
  ];

  const exchangeColumns: ColumnsType<AdminGrowthExchangeItem> = [
    {
      title: '兑换项',
      dataIndex: 'name',
      width: 220,
      render: (name: string, record) => (
        <Space direction="vertical" size={0}>
          <Typography.Text strong>{name}</Typography.Text>
          {record.description ? <Typography.Text type="secondary">{record.description}</Typography.Text> : null}
        </Space>
      ),
    },
    {
      title: '类型',
      dataIndex: 'type',
      width: 130,
      render: (type: string) => {
        const meta = exchangeTypeMap[type] ?? { text: type, color: 'default' };
        return <Tag color={meta.color}>{meta.text}</Tag>;
      },
    },
    {
      title: '成本',
      dataIndex: 'pointsCost',
      width: 100,
      render: (value: number) => <Typography.Text strong>{formatInt(value)}</Typography.Text>,
    },
    {
      title: '红包活动',
      dataIndex: 'couponCampaignId',
      width: 180,
      render: (_: unknown, record) =>
        record.couponCampaign?.name ?? <Typography.Text type="secondary">-</Typography.Text>,
    },
    {
      title: '库存',
      width: 160,
      render: (_, record) => (
        <Space direction="vertical" size={0}>
          <Typography.Text>
            总 {record.issuedTotal}/{record.stockTotal ?? '不限'}
          </Typography.Text>
          <Typography.Text type="secondary">
            日 {record.issuedToday}/{record.stockDaily ?? '不限'}
          </Typography.Text>
        </Space>
      ),
    },
    {
      title: '限制',
      width: 180,
      render: (_, record) => (
        <Space wrap>
          {record.requiredLevel ? <Tag color="blue">{record.requiredLevel.name}</Tag> : <Tag>无等级</Tag>}
          {record.perUserDailyLimit ? <Tag>日 {record.perUserDailyLimit}</Tag> : null}
          {record.perUserMonthlyLimit ? <Tag>月 {record.perUserMonthlyLimit}</Tag> : null}
        </Space>
      ),
    },
    {
      title: '状态',
      dataIndex: 'status',
      width: 90,
      render: (status: string) => {
        const meta = exchangeStatusMap[status] ?? {
          text: status,
          color: 'default',
        };
        return <Tag color={meta.color}>{meta.text}</Tag>;
      },
    },
    {
      title: '操作',
      width: 110,
      render: (_, record) => (
        <PermissionGate permission={PERMISSIONS.GROWTH_MANAGE_EXCHANGE}>
          <Button type="link" icon={<EditOutlined />} onClick={() => openExchangeModal(record)}>
            编辑
          </Button>
        </PermissionGate>
      ),
    },
  ];

  const ledgerColumns: ProColumns<AdminGrowthLedger>[] = [
    {
      title: '用户',
      dataIndex: 'userId',
      width: 260,
      render: (_: unknown, record) => renderUser(record.user),
    },
    {
      title: '类型',
      dataIndex: 'type',
      valueType: 'select',
      fieldProps: {
        options: Object.entries(ledgerTypeMap).map(([value, meta]) => ({
          label: meta.text,
          value,
        })),
      },
      width: 120,
      render: (_: unknown, record) => {
        const meta = ledgerTypeMap[record.type] ?? {
          text: record.type,
          color: 'default',
        };
        return <Tag color={meta.color}>{meta.text}</Tag>;
      },
    },
    {
      title: '行为',
      dataIndex: 'behaviorCode',
      width: 180,
      render: (_: unknown, record) =>
        record.behaviorCode ? (
          <Typography.Text>{behaviorCodeLabels[record.behaviorCode] ?? record.behaviorCode}</Typography.Text>
        ) : (
          <Typography.Text type="secondary">-</Typography.Text>
        ),
    },
    {
      title: '积分变动',
      dataIndex: 'pointsDelta',
      search: false,
      sorter: true,
      width: 120,
      render: (_: unknown, record) => (
        <Typography.Text type={record.pointsDelta < 0 ? 'danger' : undefined}>
          {record.pointsDelta > 0 ? '+' : ''}
          {record.pointsDelta}
        </Typography.Text>
      ),
    },
    {
      title: '成长变动',
      dataIndex: 'growthDelta',
      search: false,
      sorter: true,
      width: 120,
      render: (_: unknown, record) => (
        <Typography.Text type={record.growthDelta < 0 ? 'danger' : undefined}>
          {record.growthDelta > 0 ? '+' : ''}
          {record.growthDelta}
        </Typography.Text>
      ),
    },
    {
      title: '时间',
      dataIndex: 'createdAt',
      search: false,
      sorter: true,
      defaultSortOrder: 'descend',
      width: 170,
      render: (_: unknown, record) => dayjs(record.createdAt).format('YYYY-MM-DD HH:mm'),
    },
  ];
  const ruleResizableTable = useResizableColumns(ruleColumns, {
    storageKey: 'admin:growth:rules:columns',
    defaultWidth: 130,
  });
  const levelResizableTable = useResizableColumns(levelColumns, {
    storageKey: 'admin:growth:levels:columns',
    defaultWidth: 130,
  });
  const exchangeResizableTable = useResizableColumns(exchangeColumns, {
    storageKey: 'admin:growth:exchange:columns',
    defaultWidth: 130,
  });
  const ledgerResizableTable = useResizableColumns(ledgerColumns, {
    storageKey: 'admin:growth:ledgers:columns',
    defaultWidth: 130,
  });
  const drawerLedgerResizableTable = useResizableColumns(
    ledgerColumns.filter((column) => column.dataIndex !== 'userId'),
    {
      storageKey: 'admin:growth:drawer-ledgers:columns',
      defaultWidth: 130,
    },
  );

  function patchLevel(index: number, patch: Partial<AdminGrowthLevel>) {
    setLevelDrafts((current) =>
      (current ?? levelsQuery.data ?? []).map((item, currentIndex) =>
        currentIndex === index ? { ...item, ...patch } : item,
      ),
    );
  }

  function addLevel() {
    const last = [...currentLevelDrafts].sort((a, b) => a.threshold - b.threshold).at(-1);
    setLevelDrafts((current) => [
      ...(current ?? levelsQuery.data ?? []),
      {
        code: `L${(current ?? levelsQuery.data ?? []).length + 1}`,
        name: `成长${(current ?? levelsQuery.data ?? []).length + 1}`,
        threshold: last ? last.threshold + 1000 : 0,
        benefits: null,
        avatarFrameType: null,
        titleLabel: null,
        monthlyExchangeLimit: null,
        sortOrder: (current ?? levelsQuery.data ?? []).length,
        enabled: true,
      },
    ]);
  }

  function saveLevels() {
    const normalized = currentLevelDrafts
      .map((level, index) => ({
        ...level,
        code: level.code.trim(),
        name: level.name.trim(),
        threshold: Number(level.threshold ?? 0),
        sortOrder: Number(level.sortOrder ?? index),
      }))
      .sort((a, b) => a.threshold - b.threshold);
    if (!normalized.some((level) => level.threshold === 0)) {
      message.error('成长等级必须包含 threshold=0 的起始等级');
      return;
    }
    saveLevelsMutation.mutate(normalized);
  }

  const overview = dashboardQuery.data;

  return (
    <div style={{ padding: 24 }}>
      <Alert
        showIcon
        type="info"
        message="积分成长只管理积分、成长值、等级、兑换和流水"
        description={
          <Space direction="vertical" size={4}>
            <Typography.Text>
              统一管理普通用户和 VIP 用户的积分、成长值、等级、兑换和流水。积分=可消耗，可用于兑换红包和权益；成长值=不可消耗，只用于升级和解锁等级权益。
            </Typography.Text>
            <Typography.Text>
              配置顺序：先开全局，再配行为，接着配等级，最后配兑换。推荐关系、普通分享码、VIP 推荐码和自动升级 VIP 统一到“推荐与拉新”页面查看。
            </Typography.Text>
            <Space wrap>
              <Tag color="blue">先开全局</Tag>
              <Tag color="green">再配行为</Tag>
              <Tag color="purple">接着配等级</Tag>
              <Tag color="orange">最后配兑换</Tag>
            </Space>
          </Space>
        }
        style={{ marginBottom: 16 }}
      />
      <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
        <Col xs={24} sm={12} xl={6}>
          <Card>
            <Statistic
              loading={dashboardQuery.isLoading}
              title="成长账户总数"
              value={overview?.accountCount ?? 0}
              prefix={<UserOutlined />}
            />
          </Card>
        </Col>
        <Col xs={24} sm={12} xl={6}>
          <Card>
            <Statistic
              loading={dashboardQuery.isLoading}
              title="普通用户 / VIP 用户"
              value={`${formatInt(overview?.normalAccountCount ?? 0)} / ${formatInt(overview?.vipAccountCount ?? 0)}`}
              prefix={<WalletOutlined />}
            />
          </Card>
        </Col>
        <Col xs={24} sm={12} xl={6}>
          <Card>
            <Statistic
              loading={dashboardQuery.isLoading}
              title="平台积分余额"
              value={overview?.totalPointsBalance ?? 0}
              formatter={(value) => formatInt(Number(value ?? 0))}
              prefix={<WalletOutlined />}
            />
          </Card>
        </Col>
        <Col xs={24} sm={12} xl={6}>
          <Card>
            <Statistic
              loading={dashboardQuery.isLoading}
              title="平台成长值"
              value={overview?.totalGrowthValue ?? 0}
              formatter={(value) => formatInt(Number(value ?? 0))}
              prefix={<SettingOutlined />}
            />
          </Card>
        </Col>
      </Row>

      <Tabs
        items={[
          {
            key: 'settings',
            label: '全局设置',
            children: (
              <Card loading={settingsQuery.isLoading}>
                <Alert
                  showIcon
                  type="warning"
                  message="全局设置控制成长体系是否运行"
                  description="这里是总开关和风控上限。修改后通常只影响之后产生的积分、成长值、兑换和邀请奖励，不会重算历史流水。"
                  style={{ marginBottom: 16 }}
                />
                <Form<GrowthSettingsForm>
                  form={settingsForm}
                  layout="vertical"
                  onFinish={(values) => saveSettingsMutation.mutate(values)}
                >
                  <Row gutter={16}>
                    <Col xs={24} md={8}>
                      <Form.Item
                        name="growthEnabled"
                        label="成长体系总开关"
                        valuePropName="checked"
                        extra="关闭后，用户端不应继续产生新的积分和成长值。"
                      >
                        <Switch checkedChildren="启用" unCheckedChildren="关闭" />
                      </Form.Item>
                    </Col>
                    <Col xs={24} md={8}>
                      <Form.Item
                        name="refundReversalEnabled"
                        label="退款冲正"
                        valuePropName="checked"
                        extra="开启后，退款/退货会冲回对应积分和成长值。"
                      >
                        <Switch checkedChildren="启用" unCheckedChildren="关闭" />
                      </Form.Item>
                    </Col>
                    <Col xs={24} md={8}>
                      <Form.Item
                        name="autoSuspendExchangeRisk"
                        label="异常兑换自动暂停"
                        valuePropName="checked"
                        extra="用于风控兜底，异常时暂停兑换项，避免积分被集中消耗。"
                      >
                        <Switch checkedChildren="启用" unCheckedChildren="关闭" />
                      </Form.Item>
                    </Col>
                  </Row>
                  <Divider />
                  <Row gutter={16}>
                    <Col xs={24} md={8}>
                      <Form.Item name="pointsExpireDays" label="积分有效期（天）" rules={[{ required: true }]} extra="积分过期会扣减可用积分；成长值不会过期。">
                        <InputNumber min={1} precision={0} style={{ width: '100%' }} />
                      </Form.Item>
                    </Col>
                    <Col xs={24} md={8}>
                      <Form.Item name="pointsExpireRemindDays" label="过期提醒提前（天）" rules={[{ required: true }]} extra="用于后续消息提醒，设置 0 表示不提前提醒。">
                        <InputNumber min={0} precision={0} style={{ width: '100%' }} />
                      </Form.Item>
                    </Col>
                    <Col xs={24} md={8}>
                      <Form.Item name="dailyPointsCap" label="每日积分获取上限" rules={[{ required: true }]} extra="限制单个用户每天通过行为规则最多获得多少积分。">
                        <InputNumber min={0} precision={0} style={{ width: '100%' }} />
                      </Form.Item>
                    </Col>
                    <Col xs={24} md={8}>
                      <Form.Item name="monthlyPointsCap" label="每月积分获取上限" rules={[{ required: true }]} extra="限制单个用户每月通过行为规则最多获得多少积分。">
                        <InputNumber min={0} precision={0} style={{ width: '100%' }} />
                      </Form.Item>
                    </Col>
                    <Col xs={24} md={8}>
                      <Form.Item
                        name="dailyShareRewardUserCap"
                        label="每日邀请注册奖励上限"
                        rules={[{ required: true }]}
                        extra="限制单个邀请人每天通过邀请注册拿奖励的人数。"
                      >
                        <InputNumber min={0} precision={0} style={{ width: '100%' }} />
                      </Form.Item>
                    </Col>
                    <Col xs={24} md={8}>
                      <Form.Item
                        name="monthlyInviteFirstOrderCap"
                        label="每月邀请首单奖励上限"
                        rules={[{ required: true }]}
                        extra="限制单个邀请人每月通过好友首单拿奖励的人数。"
                      >
                        <InputNumber min={0} precision={0} style={{ width: '100%' }} />
                      </Form.Item>
                    </Col>
                  </Row>
                  <PermissionGate permission={PERMISSIONS.GROWTH_MANAGE_RULES}>
                    <Button type="primary" htmlType="submit" loading={saveSettingsMutation.isPending}>
                      保存设置
                    </Button>
                  </PermissionGate>
                </Form>
              </Card>
            ),
          },
          {
            key: 'accounts',
            label: '成长账户',
            children: (
              <Card>
                <Alert
                  showIcon
                  type="info"
                  message="成长账户用于查看所有买家的积分、成长值和成长等级"
                  description="这里按所有有效买家展示，包含普通用户和 VIP 用户。手动调整会写入流水，适合客服补偿、异常修正，不适合批量运营发奖。推荐关系和推荐码请到“推荐与拉新”页面查看。"
                  style={{ marginBottom: 16 }}
                />
                <ProTable<AdminGrowthAccountRow>
                  actionRef={actionRef}
                  rowKey="id"
                  columns={resizableTable.columns}
                  components={resizableTable.components}
                  request={async (params, sort) => {
                    const sortParams = getSortParams(sort as Record<string, SortOrder | undefined>);
                    const res = await getGrowthAccounts({
                      page: params.current,
                      pageSize: params.pageSize,
                      keyword: params.keyword as string | undefined,
                      levelCode: params.levelCode as string | undefined,
                      userType: params.userType as 'ALL' | 'NORMAL' | 'VIP' | undefined,
                      sortBy: sortParams.sortBy,
                      sortOrder: sortParams.sortOrder,
                    });
                    return { data: res.items, total: res.total, success: true };
                  }}
                  pagination={{ defaultPageSize: 20 }}
                  options={false}
                  search={{ labelWidth: 'auto' }}
                  scroll={{ x: resizableTable.tableWidth }}
                />
              </Card>
            ),
          },
          {
            key: 'rules',
            label: '行为规则',
            children: (
              <Card>
                <Alert
                  showIcon
                  type="warning"
                  message="行为规则决定用户做什么能拿积分和成长值"
                  description="先看“生效状态”：生效中的行为才能真实触发；未接入的行为不会自动发放，需要先接入 App/后端事件。"
                  style={{ marginBottom: 16 }}
                />
                <Table<AdminGrowthRule>
                  rowKey="code"
                  loading={rulesQuery.isLoading}
                  columns={ruleResizableTable.columns}
                  components={ruleResizableTable.components}
                  dataSource={rulesQuery.data ?? []}
                  pagination={false}
                  scroll={{ x: ruleResizableTable.tableWidth }}
                />
              </Card>
            ),
          },
          {
            key: 'levels',
            label: '成长等级',
            children: (
              <PermissionGate permission={PERMISSIONS.GROWTH_MANAGE_RULES}>
                <Card
                  title="成长等级"
                  extra={
                    <Space>
                      <Button icon={<PlusOutlined />} onClick={addLevel}>
                        新增等级
                      </Button>
                      <Button type="primary" loading={saveLevelsMutation.isPending} onClick={saveLevels}>
                        保存等级
                      </Button>
                    </Space>
                  }
                >
                  <Alert
                    showIcon
                    type="info"
                    message="成长等级只看成长值，不消耗积分"
                    description="必须保留一个阈值为 0 的起始等级。等级阈值越高，用户需要累计越多成长值；月兑换上限用于控制该等级每月可兑换次数。"
                    style={{ marginBottom: 16 }}
                  />
                  <Table<AdminGrowthLevel>
                    rowKey={(record, index) => `${record.code}-${index}`}
                    loading={levelsQuery.isLoading}
                    columns={levelResizableTable.columns}
                    components={levelResizableTable.components}
                    dataSource={currentLevelDrafts}
                    pagination={false}
                    scroll={{ x: levelResizableTable.tableWidth }}
                  />
                </Card>
              </PermissionGate>
            ),
          },
          {
            key: 'exchange',
            label: '积分兑换',
            children: (
              <Card
                extra={
                  <PermissionGate permission={PERMISSIONS.GROWTH_MANAGE_EXCHANGE}>
                    <Button type="primary" icon={<PlusOutlined />} onClick={() => openExchangeModal()}>
                      新增兑换项
                    </Button>
                  </PermissionGate>
                }
              >
                <Alert
                  showIcon
                  type="info"
                  message="积分兑换负责把积分变成红包或其他权益"
                  description="红包类兑换项必须绑定红包管理里的“积分兑换专用”手动发放红包池；等级要求用于限制低等级用户兑换高价值权益；库存和用户限额用于控制成本。"
                  style={{ marginBottom: 16 }}
                />
                <Table<AdminGrowthExchangeItem>
                  rowKey="id"
                  loading={exchangeItemsQuery.isLoading}
                  columns={exchangeResizableTable.columns}
                  components={exchangeResizableTable.components}
                  dataSource={exchangeItemsQuery.data ?? []}
                  scroll={{ x: exchangeResizableTable.tableWidth }}
                />
              </Card>
            ),
          },
          {
            key: 'ledgers',
            label: '流水',
            children: (
              <Card>
                <Alert
                  showIcon
                  type="info"
                  message="流水是排查积分和成长值变化的审计记录"
                  description="所有自动发放、兑换消耗、过期、冲正和后台调整都会记录在这里。用户投诉积分不对时，先按用户编号或行为筛选流水。"
                  style={{ marginBottom: 16 }}
                />
                <ProTable<AdminGrowthLedger>
                  actionRef={ledgerActionRef}
                  rowKey="id"
                  columns={ledgerResizableTable.columns}
                  components={ledgerResizableTable.components}
                  request={async (params, sort) => {
                    const sortParams = getLedgerSortParams(sort as Record<string, SortOrder | undefined>);
                    const res = await getGrowthLedgers({
                      page: params.current,
                      pageSize: params.pageSize,
                      userId: params.userId as string | undefined,
                      behaviorCode: params.behaviorCode as string | undefined,
                      type: params.type as string | undefined,
                      sortBy: sortParams.sortBy,
                      sortOrder: sortParams.sortOrder,
                    });
                    return { data: res.items, total: res.total, success: true };
                  }}
                  pagination={{ defaultPageSize: 20 }}
                  options={false}
                  search={{ labelWidth: 'auto' }}
                  scroll={{ x: ledgerResizableTable.tableWidth }}
                />
              </Card>
            ),
          },
        ]}
      />

      <Modal
        title={
          editingRule ? `编辑行为规则：${behaviorCodeLabels[editingRule.code] ?? editingRule.name}` : '编辑行为规则'
        }
        open={ruleModalOpen}
        onCancel={() => setRuleModalOpen(false)}
        onOk={() => ruleForm.submit()}
        confirmLoading={saveRuleMutation.isPending}
        width={720}
      >
        <Form<AdminGrowthRule>
          form={ruleForm}
          layout="vertical"
          onFinish={(values) =>
            saveRuleMutation.mutate({
              ...values,
              code: editingRule?.code ?? values.code,
            })
          }
        >
          <Row gutter={16}>
            <Form.Item name="code" hidden rules={[{ required: true }]}>
              <Input />
            </Form.Item>
            <Col span={24}>
              <Form.Item name="name" label="规则名称" rules={[{ required: true }]} extra="用户端规则说明会使用这个名称，请写成用户能理解的动作。">
                <Input />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="categoryCode" label="分类" rules={[{ required: true }]} extra="分类用于后台排序和用户端分组展示。">
                <Select options={categoryOptions} />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="applicableUserType" label="适用用户" extra="普通邀请类规则应选普通用户；VIP 专属任务才选 VIP。">
                <Select
                  options={[
                    { label: '全部', value: 'ALL' },
                    { label: '普通用户', value: 'NORMAL' },
                    { label: 'VIP', value: 'VIP' },
                  ]}
                />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="grantTiming" label="发放时机" extra="立即发放适合注册、签到；确认收货后发放适合订单和邀请首单。">
                <Select
                  options={Object.entries(grantTimingLabels).map(([value, label]) => ({
                    label,
                    value,
                  }))}
                />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="pointsReward" label="积分奖励" extra="积分=可消耗，用户可拿去兑换红包和权益。">
                <InputNumber precision={0} style={{ width: '100%' }} />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="growthReward" label="成长值奖励" extra="成长值=不可消耗，只用于升级和解锁等级权益。">
                <InputNumber precision={0} style={{ width: '100%' }} />
              </Form.Item>
            </Col>
            <Col span={6}>
              <Form.Item name="dailyLimit" label="日上限" extra="0 或留空表示不限。">
                <InputNumber min={0} precision={0} style={{ width: '100%' }} />
              </Form.Item>
            </Col>
            <Col span={6}>
              <Form.Item name="weeklyLimit" label="周上限" extra="0 或留空表示不限。">
                <InputNumber min={0} precision={0} style={{ width: '100%' }} />
              </Form.Item>
            </Col>
            <Col span={6}>
              <Form.Item name="monthlyLimit" label="月上限" extra="0 或留空表示不限。">
                <InputNumber min={0} precision={0} style={{ width: '100%' }} />
              </Form.Item>
            </Col>
            <Col span={6}>
              <Form.Item name="lifetimeLimit" label="总上限" extra="用于首单、注册等一次性奖励。">
                <InputNumber min={0} precision={0} style={{ width: '100%' }} />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="vipPointsMultiplier" label="VIP 积分倍率" extra="仅适用用户包含 VIP 时生效；留空表示不加倍。">
                <InputNumber min={0} precision={2} style={{ width: '100%' }} placeholder="留空不加倍" />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="vipGrowthMultiplier" label="VIP 成长倍率" extra="仅适用用户包含 VIP 时生效；留空表示不加倍。">
                <InputNumber min={0} precision={2} style={{ width: '100%' }} placeholder="留空不加倍" />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item
                name="enabled"
                label="状态"
                valuePropName="checked"
                extra="未接入的行为不能启用；已接入行为启用后才会真实发放。"
              >
                <Switch
                  checkedChildren="启用"
                  unCheckedChildren="停用"
                  disabled={!!editingRule && !wiredBehaviorCodes.has(editingRule.code)}
                />
              </Form.Item>
            </Col>
          </Row>
        </Form>
      </Modal>

      <Modal
        title={editingExchange ? '编辑兑换项' : '新增兑换项'}
        open={exchangeModalOpen}
        onCancel={() => setExchangeModalOpen(false)}
        onOk={() => exchangeForm.submit()}
        confirmLoading={saveExchangeMutation.isPending}
        width={760}
      >
        <Form<AdminGrowthExchangeItemPayload>
          form={exchangeForm}
          layout="vertical"
          onFinish={(values) => saveExchangeMutation.mutate(values)}
        >
          <Row gutter={16}>
            <Col span={12}>
              <Form.Item
                name="type"
                label="类型"
                rules={[{ required: true }]}
                extra="当前只开放红包类兑换。抽奖机会、装饰权益等类型等后端发放通道接入后再开放。"
              >
                <Select
                  options={exchangeTypeOptions}
                />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="name" label="名称" rules={[{ required: true }]} extra="用户端会看到这个名称，建议写清面额或权益。">
                <Input />
              </Form.Item>
            </Col>
            <Col span={24}>
              <Form.Item name="description" label="说明" extra="说明兑换后的使用范围、有效期或限制。">
                <Input.TextArea rows={2} />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="pointsCost" label="所需积分" rules={[{ required: true }]} extra="用户兑换时会扣减这些积分；成长值不会被扣减。">
                <InputNumber min={1} precision={0} style={{ width: '100%' }} />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item shouldUpdate={(prev, next) => prev.type !== next.type} noStyle>
                {({ getFieldValue }) => {
                  const type = getFieldValue('type');
                  return (
                    <Form.Item
                      name="couponCampaignId"
                      label="积分兑换专用红包池"
                      extra="只显示红包管理中已标记“积分兑换专用”的手动发放红包池。用户兑换成功后，系统会从该红包池发放一张红包。"
                      rules={[
                        {
                          required: couponExchangeTypes.has(type),
                          message: '红包类兑换项必须绑定积分兑换专用红包池',
                        },
                      ]}
                    >
                      <Select
                        allowClear
                        loading={couponCampaignsQuery.isLoading}
                        optionLabelProp="title"
                        placeholder="请选择积分兑换专用红包池"
                        notFoundContent={
                          couponCampaignsQuery.isLoading
                            ? '加载中'
                            : '请先到红包管理创建并标记“积分兑换专用”的手动发放红包活动'
                        }
                        options={exchangeAvailableCouponCampaigns.map((campaign) => ({
                          label: renderExchangeCampaignOption(campaign),
                          title: campaign.name,
                          value: campaign.id,
                        }))}
                      />
                    </Form.Item>
                  );
                }}
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="requiredLevelCode" label="要求等级" extra="限制哪些成长等级可以兑换。留空表示所有等级可兑换。">
                <Select allowClear options={levelOptions} />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="status" label="状态" extra="停用后用户端不可兑换；售罄用于库存耗尽后的展示。">
                <Select
                  options={Object.entries(exchangeStatusMap).map(([value, meta]) => ({ label: meta.text, value }))}
                />
              </Form.Item>
            </Col>
            <Col span={6}>
              <Form.Item name="stockTotal" label="总库存" extra="控制活动总成本。">
                <InputNumber min={0} precision={0} style={{ width: '100%' }} placeholder="不限" />
              </Form.Item>
            </Col>
            <Col span={6}>
              <Form.Item name="stockDaily" label="日库存" extra="控制每天最多兑换多少份。">
                <InputNumber min={0} precision={0} style={{ width: '100%' }} placeholder="不限" />
              </Form.Item>
            </Col>
            <Col span={6}>
              <Form.Item name="perUserDailyLimit" label="用户日限" extra="控制单个用户每天最多兑换次数。">
                <InputNumber min={0} precision={0} style={{ width: '100%' }} placeholder="不限" />
              </Form.Item>
            </Col>
            <Col span={6}>
              <Form.Item name="perUserMonthlyLimit" label="用户月限" extra="控制单个用户每月最多兑换次数。">
                <InputNumber min={0} precision={0} style={{ width: '100%' }} placeholder="不限" />
              </Form.Item>
            </Col>
          </Row>
        </Form>
      </Modal>

      <Modal
        title="手动调整积分 / 成长值"
        open={!!adjustingAccount}
        onCancel={() => setAdjustingAccount(null)}
        onOk={() => adjustForm.submit()}
        confirmLoading={adjustMutation.isPending}
      >
        <Form
          form={adjustForm}
          layout="vertical"
          onFinish={(values) => {
            if (!adjustingAccount) return;
            adjustMutation.mutate({
              userId: adjustingAccount.userId,
              data: values,
            });
          }}
        >
          {adjustingAccount ? (
            <Card size="small" style={{ marginBottom: 16 }}>
              {renderUser(adjustingAccount.user)}
            </Card>
          ) : null}
          <Form.Item name="pointsDelta" label="积分变动" rules={[{ required: true }]}>
            <InputNumber precision={0} style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item name="growthDelta" label="成长值变动" rules={[{ required: true }]}>
            <InputNumber precision={0} style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item name="reason" label="调整原因" rules={[{ required: true }]}>
            <Input.TextArea rows={3} />
          </Form.Item>
        </Form>
      </Modal>

      <Drawer title="增长流水" width={860} open={!!selectedUserId} onClose={() => setSelectedUserId(null)}>
        <ProTable<AdminGrowthLedger>
          rowKey="id"
          columns={drawerLedgerResizableTable.columns}
          components={drawerLedgerResizableTable.components}
          request={async (params, sort) => {
            const sortParams = getLedgerSortParams(sort as Record<string, SortOrder | undefined>);
            const res = await getGrowthLedgers({
              page: params.current,
              pageSize: params.pageSize,
              userId: selectedUserId ?? undefined,
              type: params.type as string | undefined,
              sortBy: sortParams.sortBy,
              sortOrder: sortParams.sortOrder,
            });
            return { data: res.items, total: res.total, success: true };
          }}
          pagination={{ defaultPageSize: 20 }}
          options={false}
          search={{ labelWidth: 'auto' }}
          scroll={{ x: drawerLedgerResizableTable.tableWidth }}
        />
      </Drawer>
    </div>
  );
}
