import { useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  App,
  Avatar,
  Button,
  Card,
  Drawer,
  Form,
  Input,
  InputNumber,
  Modal,
  Radio,
  Row,
  Col,
  Space,
  Statistic,
  Table,
  Tag,
  Typography,
} from 'antd';
import { ProTable } from '@ant-design/pro-components';
import type { ActionType, ProColumns } from '@ant-design/pro-components';
import {
  ExportOutlined,
  UserOutlined,
  WalletOutlined,
} from '@ant-design/icons';
import dayjs from 'dayjs';
import {
  adjustDigitalAssetAccount,
  exportDigitalAssetAccounts,
  getDigitalAssetAccount,
  getDigitalAssetAccounts,
  getDigitalAssetLedgers,
  getDigitalAssetOverview,
} from '@/api/digital-assets';
import PermissionGate from '@/components/PermissionGate';
import { PERMISSIONS } from '@/constants/permissions';
import { usePermission } from '@/hooks/usePermission';
import type {
  DigitalAssetAccountRow,
  DigitalAssetAdjustPayload,
  DigitalAssetLedger,
} from '@/types';

const ledgerTypeMap: Record<string, { text: string; color: string }> = {
  ORDER_RECEIVED: { text: '确认收货', color: 'green' },
  BACKFILL: { text: '历史补数', color: 'blue' },
  REFUND_REVERSAL: { text: '退款扣回', color: 'red' },
  ADMIN_ADJUSTMENT: { text: '后台调整', color: 'orange' },
};

export default function DigitalAssetsPage() {
  const { message } = App.useApp();
  const queryClient = useQueryClient();
  const actionRef = useRef<ActionType>(null);
  const { isSuperAdmin } = usePermission();
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [adjusting, setAdjusting] = useState<DigitalAssetAccountRow | null>(null);
  const [form] = Form.useForm<DigitalAssetAdjustPayload>();

  const { data: overview, isLoading: overviewLoading } = useQuery({
    queryKey: ['admin', 'digital-assets', 'overview'],
    queryFn: getDigitalAssetOverview,
  });

  const { data: detail, isLoading: detailLoading } = useQuery({
    queryKey: ['admin', 'digital-assets', 'account', selectedUserId],
    queryFn: () => getDigitalAssetAccount(selectedUserId!),
    enabled: !!selectedUserId,
  });

  const { data: ledgers, isLoading: ledgerLoading } = useQuery({
    queryKey: ['admin', 'digital-assets', 'ledgers', selectedUserId],
    queryFn: () => getDigitalAssetLedgers(selectedUserId!, { page: 1, pageSize: 20 }),
    enabled: !!selectedUserId,
  });

  const adjustMutation = useMutation({
    mutationFn: ({ userId, data }: { userId: string; data: DigitalAssetAdjustPayload }) =>
      adjustDigitalAssetAccount(userId, data),
    onSuccess: () => {
      message.success('调整成功');
      setAdjusting(null);
      form.resetFields();
      actionRef.current?.reload();
      queryClient.invalidateQueries({ queryKey: ['admin', 'digital-assets'] });
    },
    onError: (err: Error) => message.error(err.message || '调整失败'),
  });

  const handleExport = async () => {
    try {
      const blob = await exportDigitalAssetAccounts();
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `digital-assets-${dayjs().format('YYYYMMDD-HHmm')}.csv`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      message.success('导出已开始');
    } catch (err: any) {
      message.error(err?.message || '导出失败');
    }
  };

  const columns: ProColumns<DigitalAssetAccountRow>[] = [
    {
      title: '用户',
      dataIndex: 'keyword',
      width: 260,
      render: (_: unknown, record) => (
        <Space>
          <Avatar src={record.user.avatarUrl} icon={<UserOutlined />} />
          <div>
            <Button type="link" style={{ padding: 0 }} onClick={() => setSelectedUserId(record.userId)}>
              {record.user.nickname || record.user.phone || record.userId}
            </Button>
            <div style={{ color: 'rgba(0,0,0,0.45)', fontSize: 12 }}>{record.userId}</div>
          </div>
        </Space>
      ),
    },
    {
      title: '累计消费',
      dataIndex: 'cumulativeSpendAmount',
      search: false,
      sorter: false,
      width: 140,
      render: (_: unknown, record) => (
        <Typography.Text strong>¥{record.cumulativeSpendAmount.toFixed(2)}</Typography.Text>
      ),
    },
    {
      title: '最低金额',
      dataIndex: 'minAmount',
      hideInTable: true,
      valueType: 'digit',
    },
    {
      title: '最高金额',
      dataIndex: 'maxAmount',
      hideInTable: true,
      valueType: 'digit',
    },
    {
      title: '账户更新时间',
      dataIndex: 'updatedAt',
      search: false,
      width: 170,
      render: (_: unknown, record) => dayjs(record.updatedAt).format('YYYY-MM-DD HH:mm'),
    },
    {
      title: '操作',
      valueType: 'option',
      width: 180,
      render: (_: unknown, record) => [
        <Button key="detail" type="link" onClick={() => setSelectedUserId(record.userId)}>
          明细
        </Button>,
        <PermissionGate key="adjust" permission={PERMISSIONS.DIGITAL_ASSETS_ADJUST}>
          <Button
            type="link"
            disabled={!isSuperAdmin()}
            onClick={() => {
              setAdjusting(record);
              form.setFieldsValue({ direction: 'CREDIT', amount: 0, reason: '' });
            }}
          >
            调整
          </Button>
        </PermissionGate>,
      ],
    },
  ];

  return (
    <div style={{ padding: 24 }}>
      <Row gutter={16} style={{ marginBottom: 16 }}>
        <Col span={6}>
          <Card>
            <Statistic loading={overviewLoading} title="资产账户数" value={overview?.accountCount ?? 0} prefix={<UserOutlined />} />
          </Card>
        </Col>
        <Col span={6}>
          <Card>
            <Statistic loading={overviewLoading} title="累计消费总额" value={overview?.totalCumulativeSpendAmount ?? 0} precision={2} prefix="¥" />
          </Card>
        </Col>
        <Col span={6}>
          <Card>
            <Statistic loading={overviewLoading} title="今日入账" value={overview?.todayCreditAmount ?? 0} precision={2} prefix="¥" valueStyle={{ color: '#16a34a' }} />
          </Card>
        </Col>
        <Col span={6}>
          <Card>
            <Statistic loading={overviewLoading} title="今日扣回" value={overview?.todayDebitAmount ?? 0} precision={2} prefix="¥" valueStyle={{ color: '#dc2626' }} />
          </Card>
        </Col>
      </Row>

      <Card>
        <ProTable<DigitalAssetAccountRow>
          actionRef={actionRef}
          columns={columns}
          rowKey="id"
          request={async (params) => {
            const res = await getDigitalAssetAccounts({
              page: params.current,
              pageSize: params.pageSize,
              keyword: params.keyword as string | undefined,
              minAmount: params.minAmount as number | undefined,
              maxAmount: params.maxAmount as number | undefined,
            });
            return { data: res.items, total: res.total, success: true };
          }}
          pagination={{ defaultPageSize: 20 }}
          options={false}
          toolBarRender={() => [
            <PermissionGate key="export" permission={PERMISSIONS.DIGITAL_ASSETS_EXPORT}>
              <Button icon={<ExportOutlined />} onClick={handleExport}>导出 CSV</Button>
            </PermissionGate>,
          ]}
        />
      </Card>

      <Drawer
        title="数字资产明细"
        width={720}
        open={!!selectedUserId}
        onClose={() => setSelectedUserId(null)}
      >
        {detailLoading ? null : detail ? (
          <Space direction="vertical" size={16} style={{ width: '100%' }}>
            <Card size="small">
              <Space align="center">
                <Avatar src={detail.user.avatarUrl} icon={<UserOutlined />} size={48} />
                <div>
                  <Typography.Title level={5} style={{ margin: 0 }}>
                    {detail.user.nickname || detail.user.phone || detail.user.id}
                  </Typography.Title>
                  <Typography.Text type="secondary">{detail.user.id}</Typography.Text>
                </div>
              </Space>
              <Statistic
                style={{ marginTop: 16 }}
                title="累计消费金额"
                value={detail.account.cumulativeSpendAmount}
                precision={2}
                prefix={<><WalletOutlined /> ¥</>}
              />
            </Card>

            <Table<DigitalAssetLedger>
              rowKey="id"
              loading={ledgerLoading}
              dataSource={ledgers?.items ?? []}
              pagination={false}
              size="small"
              columns={[
                {
                  title: '类型',
                  dataIndex: 'type',
                  width: 100,
                  render: (value: string) => {
                    const meta = ledgerTypeMap[value] || { text: value, color: 'default' };
                    return <Tag color={meta.color}>{meta.text}</Tag>;
                  },
                },
                {
                  title: '金额',
                  dataIndex: 'amount',
                  width: 110,
                  render: (_: unknown, record) => (
                    <Typography.Text type={record.direction === 'DEBIT' ? 'danger' : 'success'}>
                      {record.direction === 'DEBIT' ? '-' : '+'}¥{record.amount.toFixed(2)}
                    </Typography.Text>
                  ),
                },
                {
                  title: '余额',
                  dataIndex: 'balanceAfter',
                  width: 110,
                  render: (value: number) => `¥${value.toFixed(2)}`,
                },
                { title: '说明', dataIndex: 'title', ellipsis: true },
                {
                  title: '时间',
                  dataIndex: 'createdAt',
                  width: 150,
                  render: (value: string) => dayjs(value).format('YYYY-MM-DD HH:mm'),
                },
              ]}
            />
          </Space>
        ) : null}
      </Drawer>

      <Modal
        title="手动调整数字资产"
        open={!!adjusting}
        onCancel={() => setAdjusting(null)}
        onOk={() => form.submit()}
        okButtonProps={{ loading: adjustMutation.isPending, disabled: !isSuperAdmin() }}
      >
        <Form
          form={form}
          layout="vertical"
          onFinish={(values) => {
            if (!adjusting) return;
            adjustMutation.mutate({ userId: adjusting.userId, data: values });
          }}
        >
          <Form.Item label="调整方向" name="direction" rules={[{ required: true }]}>
            <Radio.Group
              options={[
                { label: '增加', value: 'CREDIT' },
                { label: '扣减', value: 'DEBIT' },
              ]}
            />
          </Form.Item>
          <Form.Item label="金额" name="amount" rules={[{ required: true, message: '请输入金额' }]}>
            <InputNumber min={0.01} precision={2} style={{ width: '100%' }} prefix="¥" />
          </Form.Item>
          <Form.Item label="原因" name="reason" rules={[{ required: true, min: 5, message: '请输入至少 5 个字的原因' }]}>
            <Input.TextArea rows={3} placeholder="例如：历史数据人工校正" />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
