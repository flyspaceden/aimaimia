import { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ProTable } from '@ant-design/pro-components';
import type { ActionType, ProColumns } from '@ant-design/pro-components';
import { App, Button, Form, Input, Modal, Space, Typography } from 'antd';
import dayjs from 'dayjs';
import {
  createCaptainProfile,
  getCaptainProfiles,
  updateCaptainProfileStatus,
} from '@/api/captain';
import PermissionGate from '@/components/PermissionGate';
import { PERMISSIONS } from '@/constants/permissions';
import type { CaptainProfile, CaptainProfileStatus } from '@/types';
import {
  CaptainUser,
  StatusTag,
  captainProfileStatusMap,
  money,
} from './common';

export default function CaptainProfilesPage() {
  const actionRef = useRef<ActionType | undefined>(undefined);
  const { message } = App.useApp();
  const [open, setOpen] = useState(false);
  const [form] = Form.useForm();

  const changeStatus = async (record: CaptainProfile, status: CaptainProfileStatus) => {
    await updateCaptainProfileStatus(record.userId, { status });
    message.success('状态已更新');
    actionRef.current?.reload();
  };

  const columns: ProColumns<CaptainProfile>[] = [
    {
      title: '关键词',
      dataIndex: 'keyword',
      hideInTable: true,
    },
    {
      title: '月份',
      dataIndex: 'month',
      valueType: 'dateMonth',
      hideInTable: true,
    },
    {
      title: '团长',
      width: 260,
      search: false,
      render: (_, record) => <CaptainUser user={record.user} />,
    },
    {
      title: '团长码',
      dataIndex: 'captainCode',
      width: 150,
      search: false,
      render: (_, record) => (
        <Typography.Text copyable={{ text: record.captainCode }} style={{ fontFamily: 'monospace' }}>
          {record.captainCode}
        </Typography.Text>
      ),
    },
    {
      title: '状态',
      dataIndex: 'status',
      valueType: 'select',
      width: 110,
      valueEnum: {
        ACTIVE: { text: '启用' },
        PAUSED: { text: '暂停' },
        DISABLED: { text: '禁用' },
      },
      render: (_, record) => <StatusTag value={record.status} map={captainProfileStatusMap} />,
    },
    {
      title: '余额',
      search: false,
      width: 160,
      render: (_, record) => {
        const account = record.user?.captainAccounts?.[0] || record.account;
        return (
          <Space direction="vertical" size={0}>
            <Typography.Text strong>{money(account?.balance)}</Typography.Text>
            <Typography.Text type="secondary">冻结 {money(account?.frozen)}</Typography.Text>
          </Space>
        );
      },
    },
    {
      title: '本月业绩',
      search: false,
      width: 180,
      render: (_, record) => {
        const metric = record.user?.captainMonthlyMetrics?.[0];
        return (
          <Space direction="vertical" size={0}>
            <Typography.Text>团队 {money(metric?.teamGmv)}</Typography.Text>
            <Typography.Text type="secondary">个人 {money(metric?.personalGmv)}</Typography.Text>
          </Space>
        );
      },
    },
    {
      title: '开通时间',
      dataIndex: 'createdAt',
      search: false,
      width: 170,
      render: (_, record) => dayjs(record.createdAt).format('YYYY-MM-DD HH:mm'),
    },
    {
      title: '操作',
      valueType: 'option',
      width: 210,
      render: (_, record) => (
        <Space>
          <Link to={`/captain/profiles/${record.userId}`}>详情</Link>
          <PermissionGate permission={PERMISSIONS.CAPTAIN_MANAGE}>
            {record.status !== 'ACTIVE' ? (
              <a onClick={() => changeStatus(record, 'ACTIVE')}>启用</a>
            ) : (
              <a onClick={() => changeStatus(record, 'PAUSED')}>暂停</a>
            )}
            {record.status !== 'DISABLED' ? (
              <a onClick={() => changeStatus(record, 'DISABLED')}>禁用</a>
            ) : null}
          </PermissionGate>
        </Space>
      ),
    },
  ];

  return (
    <div style={{ padding: 24 }}>
      <ProTable<CaptainProfile>
        actionRef={actionRef}
        columns={columns}
        rowKey="id"
        request={async (params) => {
          const res = await getCaptainProfiles({
            page: params.current,
            pageSize: params.pageSize,
            keyword: params.keyword as string | undefined,
            status: params.status as string | undefined,
            month: params.month as string | undefined,
          });
          return { data: res.items, total: res.total, success: true };
        }}
        pagination={{ defaultPageSize: 20 }}
        options={false}
        toolbar={{
          title: '团长列表',
          actions: [
            <PermissionGate key="create" permission={PERMISSIONS.CAPTAIN_MANAGE}>
              <Button type="primary" onClick={() => setOpen(true)}>
                开通团长
              </Button>
            </PermissionGate>,
          ],
        }}
      />

      <Modal
        title="开通团长"
        open={open}
        onCancel={() => setOpen(false)}
        onOk={() => form.submit()}
        destroyOnClose
      >
        <Form
          form={form}
          layout="vertical"
          onFinish={async (values) => {
            await createCaptainProfile(values);
            message.success('团长已开通');
            setOpen(false);
            form.resetFields();
            actionRef.current?.reload();
          }}
        >
          <Form.Item name="userId" label="用户 ID" rules={[{ required: true, message: '请输入用户 ID' }]}>
            <Input placeholder="买家内部用户 ID" />
          </Form.Item>
          <Form.Item name="captainCode" label="团长码">
            <Input placeholder="留空自动生成" />
          </Form.Item>
          <Form.Item name="displayName" label="展示名称">
            <Input />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
