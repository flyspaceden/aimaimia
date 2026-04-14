import { useRef, useState } from 'react';
import { ProTable } from '@ant-design/pro-components';
import type { ActionType, ProColumns } from '@ant-design/pro-components';
import { Button, Tag, message, Modal, Form, Input, Select, Popconfirm, Space } from 'antd';
import { PlusOutlined, EditOutlined, DeleteOutlined, KeyOutlined } from '@ant-design/icons';
import { useQuery } from '@tanstack/react-query';
import { getAdminUsers, createAdminUser, updateAdminUser, deleteAdminUser, resetPassword } from '@/api/users';
import { getRoles } from '@/api/roles';
import PermissionGate from '@/components/PermissionGate';
import { PERMISSIONS } from '@/constants/permissions';
import type { AdminUser } from '@/types';
import dayjs from 'dayjs';

export default function AdminUsersPage() {
  const actionRef = useRef<ActionType>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [passwordModalOpen, setPasswordModalOpen] = useState(false);
  const [editing, setEditing] = useState<AdminUser | null>(null);
  const [form] = Form.useForm();
  const [passwordForm] = Form.useForm();

  const { data: roles } = useQuery({
    queryKey: ['admin', 'roles'],
    queryFn: getRoles,
  });

  const handleCreate = async (values: {
    username: string;
    password: string;
    realName?: string;
    phone?: string;
    roleIds?: string[];
  }) => {
    await createAdminUser(values);
    message.success('创建成功');
    setModalOpen(false);
    form.resetFields();
    actionRef.current?.reload();
  };

  const handleUpdate = async (values: {
    realName?: string;
    phone?: string;
    status?: 'ACTIVE' | 'DISABLED';
    roleIds?: string[];
  }) => {
    if (!editing) return;
    await updateAdminUser(editing.id, values);
    message.success('更新成功');
    setModalOpen(false);
    setEditing(null);
    form.resetFields();
    actionRef.current?.reload();
  };

  const handleDelete = async (id: string) => {
    await deleteAdminUser(id);
    message.success('删除成功');
    actionRef.current?.reload();
  };

  const handleResetPassword = async (values: { newPassword: string }) => {
    if (!editing) return;
    await resetPassword(editing.id, values.newPassword);
    message.success('密码已重置');
    setPasswordModalOpen(false);
    passwordForm.resetFields();
    setEditing(null);
  };

  const columns: ProColumns<AdminUser>[] = [
    { title: '用户名', dataIndex: 'username', width: 120 },
    { title: '姓名', dataIndex: 'realName', width: 100, render: (_: unknown, r: AdminUser) => r.realName || '-' },
    {
      // 手机号列：用于短信登录
      title: '手机号',
      dataIndex: 'phone',
      width: 130,
      search: false,
      render: (_: unknown, r: AdminUser) => r.phone || '-',
    },
    {
      // 角色列：超级管理员突出显示，其余角色蓝色标签
      title: '角色',
      dataIndex: 'roles',
      width: 200,
      search: false,
      render: (_: unknown, r: AdminUser) => {
        const isSuperAdmin = r.roles?.some(role => role.isSystem || role.name === '超级管理员');
        return (
          <Space wrap>
            {isSuperAdmin && <Tag color="red" style={{ fontWeight: 600 }}>超管</Tag>}
            {r.roles?.filter(role => !(role.isSystem || role.name === '超级管理员')).map((role) => (
              <Tag key={role.id} color="blue">{role.name}</Tag>
            ))}
          </Space>
        );
      },
    },
    {
      // 状态列：含登录失败次数和锁定状态安全指示
      title: '状态',
      dataIndex: 'status',
      width: 120,
      render: (_: unknown, r: AdminUser) => (
        <Space direction="vertical" size={2}>
          <Tag color={r.status === 'ACTIVE' ? 'green' : 'default'}>
            {r.status === 'ACTIVE' ? '正常' : '禁用'}
          </Tag>
          {r.loginFailCount > 0 && (
            <Tag color="orange" style={{ fontSize: 11 }}>
              失败{r.loginFailCount}次
            </Tag>
          )}
          {r.lockedUntil && dayjs(r.lockedUntil).isAfter(dayjs()) && (
            <Tag color="red" style={{ fontSize: 11 }}>
              锁定至 {dayjs(r.lockedUntil).format('HH:mm')}
            </Tag>
          )}
        </Space>
      ),
    },
    {
      title: '最近登录',
      dataIndex: 'lastLoginAt',
      width: 160,
      search: false,
      render: (_: unknown, r: AdminUser) => r.lastLoginAt ? dayjs(r.lastLoginAt).format('YYYY-MM-DD HH:mm') : '-',
    },
    {
      // 登录IP列
      title: '登录IP',
      dataIndex: 'lastLoginIp',
      width: 130,
      search: false,
      render: (_: unknown, r: AdminUser) => r.lastLoginIp || '-',
    },
    {
      // 创建时间列
      title: '创建时间',
      dataIndex: 'createdAt',
      width: 140,
      search: false,
      render: (_: unknown, r: AdminUser) => dayjs(r.createdAt).format('YYYY-MM-DD HH:mm'),
    },
    {
      title: '操作',
      key: 'action',
      width: 200,
      search: false,
      render: (_: unknown, record: AdminUser) => (
        <Space>
          <PermissionGate permission={PERMISSIONS.ADMIN_USERS_UPDATE}>
            <Button
              type="link"
              size="small"
              icon={<EditOutlined />}
              onClick={() => {
                setEditing(record);
                form.setFieldsValue({
                  realName: record.realName,
                  phone: record.phone,
                  status: record.status,
                  roleIds: record.roles?.map((r) => r.id),
                });
                setModalOpen(true);
              }}
            >
              编辑
            </Button>
          </PermissionGate>
          <PermissionGate permission={PERMISSIONS.ADMIN_USERS_UPDATE}>
            <Button
              type="link"
              size="small"
              icon={<KeyOutlined />}
              onClick={() => {
                setEditing(record);
                setPasswordModalOpen(true);
              }}
            >
              重置密码
            </Button>
          </PermissionGate>
          <PermissionGate permission={PERMISSIONS.ADMIN_USERS_DELETE}>
            <Popconfirm title="确认删除？" onConfirm={() => handleDelete(record.id)}>
              <Button type="link" size="small" danger icon={<DeleteOutlined />}>删除</Button>
            </Popconfirm>
          </PermissionGate>
        </Space>
      ),
    },
  ];

  return (
    <div style={{ padding: 24 }}>
      <ProTable<AdminUser>
        headerTitle="管理员账号"
        actionRef={actionRef}
        rowKey="id"
        columns={columns}
        scroll={{ x: 1000 }}
        request={async (params) => {
          const { current, pageSize } = params;
          const res = await getAdminUsers({ page: current, pageSize });
          return { data: res.items, total: res.total, success: true };
        }}
        toolBarRender={() => [
          <PermissionGate key="create" permission={PERMISSIONS.ADMIN_USERS_CREATE}>
            <Button
              type="primary"
              icon={<PlusOutlined />}
              onClick={() => {
                setEditing(null);
                form.resetFields();
                setModalOpen(true);
              }}
            >
              新增管理员
            </Button>
          </PermissionGate>,
        ]}
        search={false}
        pagination={{ defaultPageSize: 20 }}
      />

      {/* 创建/编辑弹窗 */}
      <Modal
        title={editing ? '编辑管理员' : '新增管理员'}
        open={modalOpen}
        onCancel={() => { setModalOpen(false); setEditing(null); }}
        onOk={() => form.submit()}
      >
        <Form form={form} layout="vertical" onFinish={editing ? handleUpdate : handleCreate}>
          {!editing && (
            <>
              <Form.Item name="username" label="用户名" rules={[{ required: true }]}>
                <Input placeholder="请输入用户名" />
              </Form.Item>
              <Form.Item name="password" label="密码" rules={[{ required: true }, { min: 6, message: '至少 6 位' }]}>
                <Input.Password placeholder="请输入密码" />
              </Form.Item>
            </>
          )}
          <Form.Item name="realName" label="姓名">
            <Input placeholder="请输入姓名" />
          </Form.Item>
          <Form.Item
            name="phone"
            label="手机号（用于短信登录）"
            rules={[
              {
                pattern: /^1\d{10}$/,
                message: '手机号格式不正确，必须为 1 开头的 11 位数字',
              },
            ]}
          >
            <Input placeholder="1开头的11位数字" maxLength={11} />
          </Form.Item>
          {editing && (
            <Form.Item name="status" label="状态">
              <Select
                options={[
                  { label: '正常', value: 'ACTIVE' },
                  { label: '禁用', value: 'DISABLED' },
                ]}
              />
            </Form.Item>
          )}
          <Form.Item name="roleIds" label="角色">
            <Select
              mode="multiple"
              placeholder="选择角色"
              options={roles?.map((r) => ({ label: r.name, value: r.id })) || []}
            />
          </Form.Item>
        </Form>
      </Modal>

      {/* 重置密码弹窗 */}
      <Modal
        title={`重置密码: ${editing?.username}`}
        open={passwordModalOpen}
        onCancel={() => { setPasswordModalOpen(false); setEditing(null); }}
        onOk={() => passwordForm.submit()}
      >
        <Form form={passwordForm} layout="vertical" onFinish={handleResetPassword}>
          <Form.Item
            name="newPassword"
            label="新密码"
            rules={[{ required: true }, { min: 6, message: '至少 6 位' }]}
          >
            <Input.Password placeholder="请输入新密码" />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
