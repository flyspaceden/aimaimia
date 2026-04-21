import { useRef, useState } from 'react';
import { ProTable } from '@ant-design/pro-components';
import type { ActionType, ProColumns } from '@ant-design/pro-components';
import { Button, Tag, App, Popconfirm, Space, Tooltip, Typography, Modal, Input } from 'antd';
import {
  CheckOutlined,
  CloseOutlined,
  AlipayCircleOutlined,
  WechatOutlined,
  BankOutlined,
} from '@ant-design/icons';
import { getWithdrawals, approveWithdrawal, rejectWithdrawal } from '@/api/bonus';
import PermissionGate from '@/components/PermissionGate';
import type { WithdrawRequest } from '@/types';
import {
  withdrawalStatusMap as statusMap,
  withdrawChannelMap,
  rewardAccountTypeMap,
} from '@/constants/statusMaps';
import { PERMISSIONS } from '@/constants/permissions';
import dayjs from 'dayjs';

const { Text } = Typography;
const { TextArea } = Input;

/** 渠道图标映射 */
const channelIconMap: Record<string, React.ReactNode> = {
  ALIPAY: <AlipayCircleOutlined style={{ color: '#1677ff', marginRight: 4 }} />,
  WECHAT: <WechatOutlined style={{ color: '#52c41a', marginRight: 4 }} />,
  BANKCARD: <BankOutlined style={{ color: '#fa8c16', marginRight: 4 }} />,
};

/** 渠道中文标签 */
const channelLabelMap: Record<string, string> = {
  ALIPAY: '支付宝',
  WECHAT: '微信',
  BANKCARD: '银行卡',
};

/** 遮罩账号：保留前3后4，中间用 **** 代替 */
function maskAccount(account: string): string {
  if (account.length <= 7) return account;
  return `${account.slice(0, 3)}****${account.slice(-4)}`;
}

/** 从 accountSnapshot 提取展示信息 */
function renderAccountInfo(record: WithdrawRequest) {
  const snapshot = record.accountSnapshot || record.accountInfo;
  if (!snapshot) return <Text type="secondary">-</Text>;

  const data = snapshot as Record<string, unknown>;
  const name = (data.name as string) || undefined;
  const account = (data.account as string) || undefined;
  const channel = record.channel as string;

  const icon = channelIconMap[channel] || null;
  const channelLabel = channelLabelMap[channel] || channel;

  if (name || account) {
    const maskedAccount = account ? maskAccount(account) : '';
    return (
      <Tooltip title={`${channelLabel} | ${name || '-'} | ${account || '-'}`}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2, lineHeight: 1.4 }}>
          <span>
            {icon}
            <Text strong style={{ fontSize: 13 }}>{name || '-'}</Text>
          </span>
          <Text type="secondary" style={{ fontSize: 12 }}>{maskedAccount || '-'}</Text>
        </div>
      </Tooltip>
    );
  }

  // 回退：尝试提取其他有意义的字段，避免显示原始 JSON
  const keys = Object.keys(data).filter((k) => typeof data[k] === 'string' || typeof data[k] === 'number');
  if (keys.length > 0) {
    const summary = keys
      .slice(0, 3)
      .map((k) => `${k}: ${data[k]}`)
      .join(' / ');
    return (
      <Tooltip title={summary}>
        <Text ellipsis style={{ maxWidth: 140, fontSize: 12 }}>{summary}</Text>
      </Tooltip>
    );
  }

  return <Text type="secondary">-</Text>;
}

export default function WithdrawalListPage() {
  const { message } = App.useApp();
  const actionRef = useRef<ActionType>(null);

  // 拒绝弹窗状态
  const [rejectModal, setRejectModal] = useState<{ visible: boolean; id: string | null }>({
    visible: false,
    id: null,
  });
  const [rejectReason, setRejectReason] = useState('');
  const [rejectLoading, setRejectLoading] = useState(false);

  const handleApprove = async (id: string) => {
    await approveWithdrawal(id);
    message.success('已批准');
    actionRef.current?.reload();
  };

  /** 打开拒绝弹窗 */
  const openRejectModal = (id: string) => {
    setRejectModal({ visible: true, id });
    setRejectReason('');
  };

  /** 确认拒绝 */
  const handleRejectConfirm = async () => {
    if (!rejectModal.id) return;
    if (!rejectReason.trim()) {
      message.warning('请输入拒绝原因');
      return;
    }
    setRejectLoading(true);
    try {
      await rejectWithdrawal(rejectModal.id, rejectReason.trim());
      message.success('已拒绝');
      setRejectModal({ visible: false, id: null });
      setRejectReason('');
      actionRef.current?.reload();
    } finally {
      setRejectLoading(false);
    }
  };

  /** 关闭拒绝弹窗 */
  const handleRejectCancel = () => {
    setRejectModal({ visible: false, id: null });
    setRejectReason('');
  };

  const columns: ProColumns<WithdrawRequest>[] = [
    {
      title: '用户',
      dataIndex: ['user', 'profile', 'nickname'],
      width: 140,
      search: false,
      render: (_: unknown, r: WithdrawRequest) =>
        r.user?.profile?.nickname || `用户${r.userId.slice(-4)}`,
    },
    {
      title: '金额',
      dataIndex: 'amount',
      width: 110,
      search: false,
      render: (_: unknown, r: WithdrawRequest) => (
        <Text strong>¥{r.amount.toFixed(2)}</Text>
      ),
    },
    {
      title: '提现渠道',
      dataIndex: 'channel',
      width: 100,
      valueType: 'select',
      valueEnum: Object.fromEntries(
        Object.entries(withdrawChannelMap).map(([k, v]) => [k, { text: v.text }]),
      ),
      render: (_: unknown, r: WithdrawRequest) => {
        const ch = withdrawChannelMap[r.channel];
        return <Tag color={ch?.color}>{ch?.text || r.channel}</Tag>;
      },
    },
    {
      title: '账户信息',
      dataIndex: 'accountSnapshot',
      width: 180,
      search: false,
      render: (_: unknown, r: WithdrawRequest) => renderAccountInfo(r),
    },
    {
      title: '账户类型',
      dataIndex: 'accountType',
      width: 110,
      valueType: 'select',
      valueEnum: Object.fromEntries(
        Object.entries(rewardAccountTypeMap).map(([k, v]) => [k, { text: v.text }]),
      ),
      render: (_: unknown, r: WithdrawRequest) => {
        const t = rewardAccountTypeMap[r.accountType];
        return <Tag color={t?.color}>{t?.text || r.accountType}</Tag>;
      },
    },
    {
      title: '状态',
      dataIndex: 'status',
      width: 120,
      valueType: 'select',
      valueEnum: Object.fromEntries(Object.entries(statusMap).map(([k, v]) => [k, { text: v.text }])),
      render: (_: unknown, r: WithdrawRequest) => {
        const s = statusMap[r.status];
        // 拒绝状态时显示拒绝原因 Tooltip
        if (r.status === 'REJECTED' && r.rejectReason) {
          return (
            <Tooltip title={`拒绝原因：${r.rejectReason}`}>
              <Tag color={s?.color}>{s?.text}</Tag>
            </Tooltip>
          );
        }
        return <Tag color={s?.color}>{s?.text}</Tag>;
      },
    },
    {
      title: '申请时间',
      dataIndex: 'createdAt',
      width: 160,
      search: false,
      render: (_: unknown, r: WithdrawRequest) => dayjs(r.createdAt).format('YYYY-MM-DD HH:mm'),
    },
    {
      title: '操作',
      key: 'action',
      width: 160,
      fixed: 'right',
      search: false,
      render: (_: unknown, record: WithdrawRequest) =>
        record.status === 'REQUESTED' ? (
          <PermissionGate permission={PERMISSIONS.BONUS_APPROVE_WITHDRAW}>
            <Space>
              <Popconfirm title="确认批准？" onConfirm={() => handleApprove(record.id)}>
                <Button type="link" size="small" icon={<CheckOutlined />}>批准</Button>
              </Popconfirm>
              <Button
                type="link"
                size="small"
                danger
                icon={<CloseOutlined />}
                onClick={() => openRejectModal(record.id)}
              >
                拒绝
              </Button>
            </Space>
          </PermissionGate>
        ) : (
          '-'
        ),
    },
  ];

  return (
    <div style={{ padding: 24 }}>
      <ProTable<WithdrawRequest>
        headerTitle="提现审核"
        actionRef={actionRef}
        rowKey="id"
        columns={columns}
        request={async (params) => {
          const { current, pageSize, status, channel, accountType } = params;
          const res = await getWithdrawals({ page: current, pageSize, status, channel, accountType });
          return { data: res.items, total: res.total, success: true };
        }}
        search={{ labelWidth: 'auto' }}
        pagination={{ defaultPageSize: 20 }}
        scroll={{ x: 1180 }}
      />

      {/* 拒绝原因弹窗 */}
      <Modal
        title="拒绝提现申请"
        open={rejectModal.visible}
        onOk={handleRejectConfirm}
        onCancel={handleRejectCancel}
        confirmLoading={rejectLoading}
        okText="确认拒绝"
        cancelText="取消"
        okButtonProps={{ danger: true }}
        destroyOnClose
      >
        <div style={{ marginBottom: 8 }}>
          <Text type="secondary">请输入拒绝原因，用户将可以查看该信息：</Text>
        </div>
        <TextArea
          value={rejectReason}
          onChange={(e) => setRejectReason(e.target.value)}
          placeholder="请输入拒绝原因，例如：账户信息不匹配、金额异常等"
          rows={4}
          maxLength={500}
          showCount
          autoFocus
        />
      </Modal>
    </div>
  );
}
