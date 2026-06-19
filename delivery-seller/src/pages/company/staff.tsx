import { useState } from 'react';
import {
  Alert,
  App,
  Button,
  Card,
  Form,
  Input,
  Modal,
  Select,
  Space,
  Table,
  Tag,
  Typography,
} from 'antd';
import { EditOutlined, PlusOutlined } from '@ant-design/icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { createStaff, getStaff, updateStaff } from '@/api/company';
import { staffRoleMap } from '@/constants/statusMaps';
import useAuthStore from '@/store/useAuthStore';
import type { CompanyStaff, CreateCompanyStaffPayload, UpdateCompanyStaffPayload } from '@/types';
import dayjs from 'dayjs';

const staffStatusMap: Record<CompanyStaff['status'], { text: string; color: string }> = {
  ACTIVE: { text: '正常', color: 'green' },
  DISABLED: { text: '已禁用', color: 'default' },
};

interface EditStaffForm {
  realName?: string;
  role: CompanyStaff['role'];
  status: CompanyStaff['status'];
  permissionCodes: string[];
}

export default function StaffManagementPage() {
  const { message } = App.useApp();
  const queryClient = useQueryClient();
  const isOwner = useAuthStore((s) => s.isOwner);
  const currentStaffId = useAuthStore((s) => s.seller?.staffId);
  const canManageStaff = isOwner();

  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [editingStaff, setEditingStaff] = useState<CompanyStaff | null>(null);
  const [createForm] = Form.useForm<CreateCompanyStaffPayload>();
  const [editForm] = Form.useForm<EditStaffForm>();

  const { data: staffList, isLoading } = useQuery({
    queryKey: ['seller-staff'],
    queryFn: getStaff,
  });

  const refreshStaff = () => {
    queryClient.invalidateQueries({ queryKey: ['seller-staff'] });
  };

  const handleCreateStaff = async (values: CreateCompanyStaffPayload) => {
    try {
      await createStaff({
        username: values.username.trim(),
        phone: values.phone?.trim() || undefined,
        realName: values.realName?.trim() || undefined,
        role: values.role,
        permissionCodes: values.permissionCodes?.filter(Boolean) || [],
      });
      message.success('员工已创建');
      setCreateModalOpen(false);
      createForm.resetFields();
      refreshStaff();
    } catch (err) {
      message.error(err instanceof Error ? err.message : '创建失败');
    }
  };

  const openEditModal = (staff: CompanyStaff) => {
    setEditingStaff(staff);
    editForm.setFieldsValue({
      realName: staff.realName || '',
      role: staff.role,
      status: staff.status,
      permissionCodes: staff.permissionCodes || [],
    });
  };

  const handleUpdateStaff = async (values: EditStaffForm) => {
    if (!editingStaff) return;

    const payload: UpdateCompanyStaffPayload = {
      realName: values.realName?.trim() || undefined,
      permissionCodes: values.permissionCodes?.filter(Boolean) || [],
    };

    if (editingStaff.id !== currentStaffId) {
      payload.role = values.role;
      payload.status = values.status;
    }

    try {
      await updateStaff(editingStaff.id, payload);
      message.success('员工资料已更新');
      setEditingStaff(null);
      editForm.resetFields();
      refreshStaff();
    } catch (err) {
      message.error(err instanceof Error ? err.message : '更新失败');
    }
  };

  const columns = [
    {
      title: '账号',
      key: 'account',
      render: (_: unknown, staff: CompanyStaff) => (
        <Space direction="vertical" size={0}>
          <Typography.Text strong>{staff.username}</Typography.Text>
          <Typography.Text type="secondary">
            {staff.realName || '未填写姓名'}
          </Typography.Text>
        </Space>
      ),
    },
    {
      title: '手机号',
      dataIndex: 'phone',
      render: (phone: CompanyStaff['phone']) => phone || '-',
    },
    {
      title: '角色',
      dataIndex: 'role',
      render: (role: CompanyStaff['role']) => {
        const item = staffRoleMap[role];
        return <Tag color={item?.color}>{item?.text || role}</Tag>;
      },
    },
    {
      title: '权限码',
      dataIndex: 'permissionCodes',
      render: (permissionCodes: string[]) =>
        permissionCodes.length > 0 ? (
          <Space size={[4, 4]} wrap>
            {permissionCodes.map((code) => (
              <Tag key={code}>{code}</Tag>
            ))}
          </Space>
        ) : (
          '-'
        ),
    },
    {
      title: '状态',
      dataIndex: 'status',
      render: (status: CompanyStaff['status']) => {
        const item = staffStatusMap[status];
        return <Tag color={item?.color}>{item?.text || status}</Tag>;
      },
    },
    {
      title: '创建时间',
      dataIndex: 'createdAt',
      render: (value: string) => dayjs(value).format('YYYY-MM-DD HH:mm'),
    },
    {
      title: '更新时间',
      dataIndex: 'updatedAt',
      render: (value: string) => dayjs(value).format('YYYY-MM-DD HH:mm'),
    },
    ...(canManageStaff
      ? [
          {
            title: '操作',
            key: 'actions',
            render: (_: unknown, staff: CompanyStaff) => (
              <Button type="link" size="small" icon={<EditOutlined />} onClick={() => openEditModal(staff)}>
                编辑
              </Button>
            ),
          },
        ]
      : []),
  ];

  return (
    <Space direction="vertical" size={16} style={{ display: 'flex' }}>
      <Alert
        type="info"
        showIcon
        message="当前 delivery 员工合同只支持账号创建，以及 realName、role、status、permissionCodes 的维护。删除、重置密码、改手机号和改昵称都不在此合同里。"
      />

      <Card
        title="员工管理"
        extra={
          canManageStaff ? (
            <Button type="primary" icon={<PlusOutlined />} onClick={() => setCreateModalOpen(true)}>
              新增员工
            </Button>
          ) : null
        }
      >
        <Table
          rowKey="id"
          loading={isLoading}
          dataSource={staffList || []}
          columns={columns}
          pagination={false}
        />
      </Card>

      <Modal
        title="新增员工"
        open={createModalOpen}
        onCancel={() => {
          setCreateModalOpen(false);
          createForm.resetFields();
        }}
        onOk={() => createForm.submit()}
        destroyOnClose
      >
        <Form<CreateCompanyStaffPayload>
          form={createForm}
          layout="vertical"
          onFinish={handleCreateStaff}
          initialValues={{ role: 'OPERATOR', permissionCodes: [] }}
        >
          <Form.Item
            name="username"
            label="登录账号"
            rules={[{ required: true, message: '请输入登录账号' }]}
          >
            <Input placeholder="例如：warehouse-01" maxLength={60} />
          </Form.Item>
          <Form.Item name="realName" label="姓名">
            <Input placeholder="例如：张三" maxLength={120} />
          </Form.Item>
          <Form.Item name="phone" label="手机号">
            <Input placeholder="可选，用于当前员工账号" maxLength={20} />
          </Form.Item>
          <Form.Item
            name="role"
            label="角色"
            rules={[{ required: true, message: '请选择角色' }]}
          >
            <Select
              options={[
                { value: 'OWNER', label: '企业主' },
                { value: 'MANAGER', label: '经理' },
                { value: 'OPERATOR', label: '运营' },
              ]}
            />
          </Form.Item>
          <Form.Item name="permissionCodes" label="权限码">
            <Select
              mode="tags"
              tokenSeparators={[',', ' ']}
              placeholder="可选，回车后新增权限码"
              open={false}
            />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title={editingStaff ? `编辑员工: ${editingStaff.username}` : '编辑员工'}
        open={!!editingStaff}
        onCancel={() => {
          setEditingStaff(null);
          editForm.resetFields();
        }}
        onOk={() => editForm.submit()}
        destroyOnClose
      >
        {editingStaff ? (
          <>
            {editingStaff.id === currentStaffId ? (
              <Alert
                type="warning"
                showIcon
                style={{ marginBottom: 16 }}
                message="当前登录账号只能在这里修改姓名和权限码，角色与状态保持不变，避免把自己踢下线。"
              />
            ) : null}
            <Form<EditStaffForm> form={editForm} layout="vertical" onFinish={handleUpdateStaff}>
              <Form.Item label="登录账号">
                <Input value={editingStaff.username} disabled />
              </Form.Item>
              <Form.Item label="手机号">
                <Input value={editingStaff.phone || ''} disabled placeholder="未绑定" />
              </Form.Item>
              <Form.Item name="realName" label="姓名">
                <Input placeholder="员工姓名" maxLength={120} />
              </Form.Item>
              <Form.Item
                name="role"
                label="角色"
                rules={[{ required: true, message: '请选择角色' }]}
              >
                <Select
                  disabled={editingStaff.id === currentStaffId}
                  options={[
                    { value: 'OWNER', label: '企业主' },
                    { value: 'MANAGER', label: '经理' },
                    { value: 'OPERATOR', label: '运营' },
                  ]}
                />
              </Form.Item>
              <Form.Item
                name="status"
                label="状态"
                rules={[{ required: true, message: '请选择状态' }]}
              >
                <Select
                  disabled={editingStaff.id === currentStaffId}
                  options={[
                    { value: 'ACTIVE', label: '正常' },
                    { value: 'DISABLED', label: '已禁用' },
                  ]}
                />
              </Form.Item>
              <Form.Item name="permissionCodes" label="权限码">
                <Select
                  mode="tags"
                  tokenSeparators={[',', ' ']}
                  placeholder="可选，回车后新增权限码"
                  open={false}
                />
              </Form.Item>
            </Form>
          </>
        ) : null}
      </Modal>
    </Space>
  );
}
