import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
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
  GiftOutlined,
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
  disableNormalShareProfile,
  enableNormalShareProfile,
  getGrowthAccounts,
  getGrowthDashboard,
  getGrowthExchangeItems,
  getGrowthLedgers,
  getGrowthLevels,
  getGrowthRules,
  getGrowthSettings,
  getNormalShareBindings,
  replaceGrowthLevels,
  updateGrowthExchangeItem,
  updateGrowthSettings,
  upsertGrowthRule,
} from '@/api/growth';
import { getCampaigns } from '@/api/coupon';
import { PERMISSIONS } from '@/constants/permissions';
import type {
  AdminGrowthAccountRow,
  AdminGrowthAccountQueryParams,
  AdminGrowthExchangeItem,
  AdminGrowthExchangeItemPayload,
  AdminGrowthLedger,
  AdminGrowthLevel,
  AdminGrowthRule,
  AdminGrowthSettings,
  AdminNormalShareBinding,
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

const rewardStatusMap: Record<string, { text: string; color: string }> = {
  PENDING: { text: '已绑定', color: 'default' },
  REGISTER_REWARDED: { text: '注册已奖', color: 'blue' },
  FIRST_ORDER_PENDING: { text: '待首单', color: 'orange' },
  ISSUED: { text: '首单已奖', color: 'green' },
  REVERSED: { text: '已冲正', color: 'red' },
  VOIDED: { text: '已作废', color: 'default' },
};

const couponExchangeTypes = new Set(['COUPON', 'SHIPPING_COUPON', 'VIP_DISCOUNT_COUPON']);

function formatInt(value?: number | null) {
  return Number(value ?? 0).toLocaleString();
}

function renderUser(user: AdminGrowthAccountRow['user'] | AdminNormalShareBinding['inviter'] | undefined) {
  if (!user) return <Typography.Text type="secondary">-</Typography.Text>;
  return (
    <Space>
      <Avatar src={user.avatarUrl ?? undefined} icon={<UserOutlined />} />
      <BuyerIdentityText
        buyerNo={user.buyerNo}
        userId={user.id}
        nickname={user.nickname || user.phone || '-'}
        compact
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
  if (!['pointsBalance', 'pointsTotalEarned', 'growthValue', 'updatedAt'].includes(field)) return {};
  return {
    sortBy: field as AdminGrowthAccountQueryParams['sortBy'],
    sortOrder: order as AdminGrowthAccountQueryParams['sortOrder'],
  };
}

export default function GrowthPage() {
  const { message, modal } = App.useApp();
  const queryClient = useQueryClient();
  const actionRef = useRef<ActionType>(null);
  const ledgerActionRef = useRef<ActionType>(null);
  const shareActionRef = useRef<ActionType>(null);
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
  const [settingsForm] = Form.useForm<AdminGrowthSettings>();

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
      settingsForm.setFieldsValue(settingsQuery.data);
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

  const saveSettingsMutation = useMutation({
    mutationFn: updateGrowthSettings,
    onSuccess: (settings) => {
      message.success('成长设置已保存');
      settingsForm.setFieldsValue(settings);
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

  const shareProfileMutation = useMutation({
    mutationFn: ({ userId, status }: { userId: string; status: 'ACTIVE' | 'DISABLED' }) =>
      status === 'ACTIVE' ? disableNormalShareProfile(userId, '管理员停用') : enableNormalShareProfile(userId),
    onSuccess: () => {
      message.success('普通分享码状态已更新');
      actionRef.current?.reload();
      shareActionRef.current?.reload();
      queryClient.invalidateQueries({ queryKey: ['admin', 'growth'] });
    },
    onError: (error: Error) => message.error(error.message || '操作失败'),
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
          {renderUser(record.user)}
        </Button>
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
      title: '普通积分',
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
      title: '分享码',
      dataIndex: ['user', 'normalShareCode'],
      search: false,
      width: 120,
      render: (_: unknown, record) =>
        record.user?.normalShareCode ? (
          <Typography.Text code>{record.user.normalShareCode}</Typography.Text>
        ) : (
          <Typography.Text type="secondary">-</Typography.Text>
        ),
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
      width: 170,
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
        record.user?.normalShareCode ? (
          <PermissionGate key="share-status" permission={PERMISSIONS.NORMAL_SHARE_MANAGE}>
            <Button
              type="link"
              danger={record.user.normalShareStatus === 'ACTIVE'}
              loading={shareProfileMutation.isPending}
              onClick={() => {
                const status = record.user?.normalShareStatus === 'DISABLED' ? 'DISABLED' : 'ACTIVE';
                modal.confirm({
                  title: status === 'ACTIVE' ? '停用普通分享码' : '启用普通分享码',
                  content:
                    status === 'ACTIVE'
                      ? '停用后该分享码不能再绑定新用户，已产生的绑定和流水不会删除。'
                      : '启用后该分享码可以继续绑定新用户。',
                  okText: '确认',
                  cancelText: '取消',
                  onOk: () =>
                    shareProfileMutation.mutate({
                      userId: record.userId,
                      status,
                    }),
                });
              }}
            >
              {record.user.normalShareStatus === 'DISABLED' ? '启用分享码' : '停用分享码'}
            </Button>
          </PermissionGate>
        ) : null,
      ],
    },
  ];

  const ruleColumns: ColumnsType<AdminGrowthRule> = [
    {
      title: '行为',
      dataIndex: 'code',
      width: 190,
      render: (code: string, record) => (
        <Space direction="vertical" size={0}>
          <Typography.Text strong>{behaviorCodeLabels[code] ?? record.name}</Typography.Text>
          <Typography.Text type="secondary" code>
            {code}
          </Typography.Text>
        </Space>
      ),
    },
    {
      title: '分类',
      dataIndex: 'categoryCode',
      width: 100,
      render: (value: string) => categoryOptions.find((item) => item.value === value)?.label ?? value,
    },
    {
      title: '奖励',
      width: 180,
      render: (_, record) => (
        <Space>
          <Tag color="green">积分 {record.pointsReward}</Tag>
          <Tag color="blue">成长 {record.growthReward}</Tag>
        </Space>
      ),
    },
    {
      title: '限制',
      width: 220,
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
      width: 100,
      render: (value: string) => <Tag>{value === 'ALL' ? '全部' : value}</Tag>,
    },
    {
      title: '状态',
      dataIndex: 'enabled',
      width: 90,
      render: (enabled: boolean) => <Tag color={enabled ? 'green' : 'default'}>{enabled ? '启用' : '停用'}</Tag>,
    },
    {
      title: '操作',
      width: 110,
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
      title: '等级编码',
      dataIndex: 'code',
      width: 150,
      render: (value: string, _record, index) => (
        <Input value={value} onChange={(event) => patchLevel(index, { code: event.target.value })} />
      ),
    },
    {
      title: '等级名称',
      dataIndex: 'name',
      width: 160,
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
      width: 160,
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
      width: 170,
      render: (_: unknown, record) => dayjs(record.createdAt).format('YYYY-MM-DD HH:mm'),
    },
  ];

  const shareColumns: ProColumns<AdminNormalShareBinding>[] = [
    {
      title: '推荐人',
      dataIndex: 'keyword',
      width: 260,
      render: (_: unknown, record) => renderUser(record.inviter),
    },
    {
      title: '被推荐人',
      dataIndex: 'inviteeUserId',
      search: false,
      width: 260,
      render: (_: unknown, record) => renderUser(record.invitee),
    },
    {
      title: '分享码',
      dataIndex: 'code',
      width: 120,
      render: (_: unknown, record) => <Typography.Text code>{record.code}</Typography.Text>,
    },
    {
      title: '来源',
      dataIndex: 'source',
      search: false,
      width: 100,
      render: (_: unknown, record) => <Tag>{record.source}</Tag>,
    },
    {
      title: '奖励状态',
      dataIndex: 'rewardStatus',
      valueType: 'select',
      fieldProps: {
        options: Object.entries(rewardStatusMap).map(([value, meta]) => ({
          label: meta.text,
          value,
        })),
      },
      width: 130,
      render: (_: unknown, record) => {
        const meta = rewardStatusMap[record.rewardStatus] ?? {
          text: record.rewardStatus,
          color: 'default',
        };
        return <Tag color={meta.color}>{meta.text}</Tag>;
      },
    },
    {
      title: '首单',
      dataIndex: 'firstOrderId',
      search: false,
      width: 170,
      render: (_: unknown, record) => record.firstOrderId ?? <Typography.Text type="secondary">-</Typography.Text>,
    },
    {
      title: '绑定时间',
      dataIndex: 'boundAt',
      search: false,
      width: 170,
      render: (_: unknown, record) => dayjs(record.boundAt).format('YYYY-MM-DD HH:mm'),
    },
  ];

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
      <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
        <Col xs={24} sm={12} xl={6}>
          <Card>
            <Statistic
              loading={dashboardQuery.isLoading}
              title="普通买家账户"
              value={overview?.accountCount ?? 0}
              prefix={<UserOutlined />}
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
        <Col xs={24} sm={12} xl={6}>
          <Card>
            <Statistic
              loading={dashboardQuery.isLoading}
              title="待首单推荐奖励"
              value={overview?.pendingShareRewardCount ?? 0}
              valueStyle={{ color: '#d97706' }}
              prefix={<GiftOutlined />}
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
                <Form<AdminGrowthSettings>
                  form={settingsForm}
                  layout="vertical"
                  onFinish={(values) => saveSettingsMutation.mutate(values)}
                >
                  <Row gutter={16}>
                    <Col xs={24} md={8}>
                      <Form.Item name="growthEnabled" label="普通成长系统" valuePropName="checked">
                        <Switch checkedChildren="启用" unCheckedChildren="关闭" />
                      </Form.Item>
                    </Col>
                    <Col xs={24} md={8}>
                      <Form.Item name="refundReversalEnabled" label="退款冲正" valuePropName="checked">
                        <Switch checkedChildren="启用" unCheckedChildren="关闭" />
                      </Form.Item>
                    </Col>
                    <Col xs={24} md={8}>
                      <Form.Item name="autoSuspendExchangeRisk" label="异常兑换自动暂停" valuePropName="checked">
                        <Switch checkedChildren="启用" unCheckedChildren="关闭" />
                      </Form.Item>
                    </Col>
                  </Row>
                  <Divider />
                  <Row gutter={16}>
                    <Col xs={24} md={8}>
                      <Form.Item name="pointsExpireDays" label="积分有效期（天）" rules={[{ required: true }]}>
                        <InputNumber min={1} precision={0} style={{ width: '100%' }} />
                      </Form.Item>
                    </Col>
                    <Col xs={24} md={8}>
                      <Form.Item name="pointsExpireRemindDays" label="过期提醒提前（天）" rules={[{ required: true }]}>
                        <InputNumber min={0} precision={0} style={{ width: '100%' }} />
                      </Form.Item>
                    </Col>
                    <Col xs={24} md={8}>
                      <Form.Item name="dailyPointsCap" label="每日积分获取上限" rules={[{ required: true }]}>
                        <InputNumber min={0} precision={0} style={{ width: '100%' }} />
                      </Form.Item>
                    </Col>
                    <Col xs={24} md={8}>
                      <Form.Item name="monthlyPointsCap" label="每月积分获取上限" rules={[{ required: true }]}>
                        <InputNumber min={0} precision={0} style={{ width: '100%' }} />
                      </Form.Item>
                    </Col>
                    <Col xs={24} md={8}>
                      <Form.Item
                        name="dailyShareRewardUserCap"
                        label="每日邀请注册奖励上限"
                        rules={[{ required: true }]}
                      >
                        <InputNumber min={0} precision={0} style={{ width: '100%' }} />
                      </Form.Item>
                    </Col>
                    <Col xs={24} md={8}>
                      <Form.Item
                        name="monthlyInviteFirstOrderCap"
                        label="每月邀请首单奖励上限"
                        rules={[{ required: true }]}
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
            label: '账户',
            children: (
              <Card>
                <Typography.Paragraph type="secondary">
                  这里按所有有效普通买家展示，尚未获得积分或成长值的用户也会以 0 账户显示。
                </Typography.Paragraph>
                <ProTable<AdminGrowthAccountRow>
                  actionRef={actionRef}
                  rowKey="id"
                  columns={accountColumns}
                  request={async (params, sort) => {
                    const sortParams = getSortParams(sort as Record<string, SortOrder | undefined>);
                    const res = await getGrowthAccounts({
                      page: params.current,
                      pageSize: params.pageSize,
                      keyword: params.keyword as string | undefined,
                      levelCode: params.levelCode as string | undefined,
                      sortBy: sortParams.sortBy,
                      sortOrder: sortParams.sortOrder,
                    });
                    return { data: res.items, total: res.total, success: true };
                  }}
                  pagination={{ defaultPageSize: 20 }}
                  options={false}
                  search={{ labelWidth: 'auto' }}
                />
              </Card>
            ),
          },
          {
            key: 'rules',
            label: '行为规则',
            children: (
              <Card>
                <Table<AdminGrowthRule>
                  rowKey="code"
                  loading={rulesQuery.isLoading}
                  columns={ruleColumns}
                  dataSource={rulesQuery.data ?? []}
                  pagination={false}
                  scroll={{ x: 980 }}
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
                  <Table<AdminGrowthLevel>
                    rowKey={(record, index) => `${record.code}-${index}`}
                    loading={levelsQuery.isLoading}
                    columns={levelColumns}
                    dataSource={currentLevelDrafts}
                    pagination={false}
                    scroll={{ x: 940 }}
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
                <Table<AdminGrowthExchangeItem>
                  rowKey="id"
                  loading={exchangeItemsQuery.isLoading}
                  columns={exchangeColumns}
                  dataSource={exchangeItemsQuery.data ?? []}
                  scroll={{ x: 1120 }}
                />
              </Card>
            ),
          },
          {
            key: 'ledgers',
            label: '流水',
            children: (
              <Card>
                <ProTable<AdminGrowthLedger>
                  actionRef={ledgerActionRef}
                  rowKey="id"
                  columns={ledgerColumns}
                  request={async (params) => {
                    const res = await getGrowthLedgers({
                      page: params.current,
                      pageSize: params.pageSize,
                      userId: params.userId as string | undefined,
                      behaviorCode: params.behaviorCode as string | undefined,
                      type: params.type as string | undefined,
                    });
                    return { data: res.items, total: res.total, success: true };
                  }}
                  pagination={{ defaultPageSize: 20 }}
                  options={false}
                  search={{ labelWidth: 'auto' }}
                />
              </Card>
            ),
          },
          {
            key: 'share',
            label: '普通分享',
            children: (
              <Card>
                <ProTable<AdminNormalShareBinding>
                  actionRef={shareActionRef}
                  rowKey="id"
                  columns={shareColumns}
                  request={async (params) => {
                    const res = await getNormalShareBindings({
                      page: params.current,
                      pageSize: params.pageSize,
                      keyword: params.keyword as string | undefined,
                      rewardStatus: params.rewardStatus as string | undefined,
                    });
                    return { data: res.items, total: res.total, success: true };
                  }}
                  pagination={{ defaultPageSize: 20 }}
                  options={false}
                  search={{ labelWidth: 'auto' }}
                />
              </Card>
            ),
          },
        ]}
      />

      <Modal
        title={
          editingRule ? `编辑行为规则：${behaviorCodeLabels[editingRule.code] ?? editingRule.code}` : '编辑行为规则'
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
            <Col span={12}>
              <Form.Item name="code" label="行为码" rules={[{ required: true }]}>
                <Input disabled />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="name" label="规则名称" rules={[{ required: true }]}>
                <Input />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="categoryCode" label="分类" rules={[{ required: true }]}>
                <Select options={categoryOptions} />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="applicableUserType" label="适用用户">
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
              <Form.Item name="pointsReward" label="积分奖励">
                <InputNumber precision={0} style={{ width: '100%' }} />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="growthReward" label="成长值奖励">
                <InputNumber precision={0} style={{ width: '100%' }} />
              </Form.Item>
            </Col>
            <Col span={6}>
              <Form.Item name="dailyLimit" label="日上限">
                <InputNumber min={0} precision={0} style={{ width: '100%' }} />
              </Form.Item>
            </Col>
            <Col span={6}>
              <Form.Item name="weeklyLimit" label="周上限">
                <InputNumber min={0} precision={0} style={{ width: '100%' }} />
              </Form.Item>
            </Col>
            <Col span={6}>
              <Form.Item name="monthlyLimit" label="月上限">
                <InputNumber min={0} precision={0} style={{ width: '100%' }} />
              </Form.Item>
            </Col>
            <Col span={6}>
              <Form.Item name="lifetimeLimit" label="总上限">
                <InputNumber min={0} precision={0} style={{ width: '100%' }} />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="vipPointsMultiplier" label="VIP 积分倍率">
                <InputNumber min={0} precision={2} style={{ width: '100%' }} placeholder="留空不加倍" />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="vipGrowthMultiplier" label="VIP 成长倍率">
                <InputNumber min={0} precision={2} style={{ width: '100%' }} placeholder="留空不加倍" />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="enabled" label="状态" valuePropName="checked">
                <Switch checkedChildren="启用" unCheckedChildren="停用" />
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
              <Form.Item name="type" label="类型" rules={[{ required: true }]}>
                <Select
                  options={Object.entries(exchangeTypeMap).map(([value, meta]) => ({ label: meta.text, value }))}
                />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="name" label="名称" rules={[{ required: true }]}>
                <Input />
              </Form.Item>
            </Col>
            <Col span={24}>
              <Form.Item name="description" label="说明">
                <Input.TextArea rows={2} />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="pointsCost" label="所需积分" rules={[{ required: true }]}>
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
                      label="红包活动"
                      rules={[
                        {
                          required: couponExchangeTypes.has(type),
                          message: '红包类兑换项必须绑定红包活动',
                        },
                      ]}
                    >
                      <Select
                        allowClear
                        loading={couponCampaignsQuery.isLoading}
                        options={(couponCampaignsQuery.data?.items ?? []).map((campaign) => ({
                          label: campaign.name,
                          value: campaign.id,
                        }))}
                      />
                    </Form.Item>
                  );
                }}
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="requiredLevelCode" label="要求等级">
                <Select allowClear options={levelOptions} />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="status" label="状态">
                <Select
                  options={Object.entries(exchangeStatusMap).map(([value, meta]) => ({ label: meta.text, value }))}
                />
              </Form.Item>
            </Col>
            <Col span={6}>
              <Form.Item name="stockTotal" label="总库存">
                <InputNumber min={0} precision={0} style={{ width: '100%' }} placeholder="不限" />
              </Form.Item>
            </Col>
            <Col span={6}>
              <Form.Item name="stockDaily" label="日库存">
                <InputNumber min={0} precision={0} style={{ width: '100%' }} placeholder="不限" />
              </Form.Item>
            </Col>
            <Col span={6}>
              <Form.Item name="perUserDailyLimit" label="用户日限">
                <InputNumber min={0} precision={0} style={{ width: '100%' }} placeholder="不限" />
              </Form.Item>
            </Col>
            <Col span={6}>
              <Form.Item name="perUserMonthlyLimit" label="用户月限">
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
          columns={ledgerColumns.filter((column) => column.dataIndex !== 'userId')}
          request={async (params) => {
            const res = await getGrowthLedgers({
              page: params.current,
              pageSize: params.pageSize,
              userId: selectedUserId ?? undefined,
              type: params.type as string | undefined,
            });
            return { data: res.items, total: res.total, success: true };
          }}
          pagination={{ defaultPageSize: 20 }}
          options={false}
          search={{ labelWidth: 'auto' }}
        />
      </Drawer>
    </div>
  );
}
