import { useState } from 'react';
import { App, Card, Table, Tag, Button, Modal, Form, Input, Select, Popconfirm, Space, Alert } from 'antd';
import { PlusOutlined, EditOutlined, KeyOutlined, PhoneOutlined } from '@ant-design/icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  getStaff,
  inviteStaff,
  updateStaff,
  removeStaff,
  updateStaffNickname,
  updateStaffPhone,
  resetStaffPassword,
} from '@/api/company';
import { staffRoleMap } from '@/constants/statusMaps';
import useAuthStore from '@/store/useAuthStore';
import type { CompanyStaff } from '@/types';
import dayjs from 'dayjs';

export default function StaffManagementPage() {
  const { message } = App.useApp();
  const queryClient = useQueryClient();
  const isOwner = useAuthStore((s) => s.isOwner);
  const [inviteModal, setInviteModal] = useState(false);
  const [inviteForm] = Form.useForm();
  // C40c9 改角色
  const [editRoleModal, setEditRoleModal] = useState(false);
  const [editRoleTarget, setEditRoleTarget] = useState<CompanyStaff | null>(null);
  const [editRoleForm] = Form.useForm();
  // 修改昵称 / 手机号 / 重置密码
  const [editNicknameTarget, setEditNicknameTarget] = useState<CompanyStaff | null>(null);
  const [editNicknameForm] = Form.useForm<{ nickname: string }>();
  const [editNicknameLoading, setEditNicknameLoading] = useState(false);
  const [editPhoneTarget, setEditPhoneTarget] = useState<CompanyStaff | null>(null);
  const [editPhoneForm] = Form.useForm<{ newPhone: string }>();
  const [editPhoneLoading, setEditPhoneLoading] = useState(false);
  const [resetPwdTarget, setResetPwdTarget] = useState<CompanyStaff | null>(null);
  const [resetPwdForm] = Form.useForm<{ newPassword: string; confirmPassword: string }>();
  const [resetPwdLoading, setResetPwdLoading] = useState(false);

  const { data: staffList, isLoading } = useQuery({
    queryKey: ['seller-staff'],
    queryFn: getStaff,
  });

  const handleInvite = async (values: { phone: string; role: string; password?: string }) => {
    try {
      const trimmed = values.password?.trim();
      await inviteStaff(
        values.phone,
        values.role as 'MANAGER' | 'OPERATOR',
        trimmed ? trimmed : undefined,
      );
      message.success('邀请成功');
      setInviteModal(false);
      inviteForm.resetFields();
      queryClient.invalidateQueries({ queryKey: ['seller-staff'] });
    } catch (err) {
      message.error(err instanceof Error ? err.message : '邀请失败');
    }
  };

  const handleToggleStatus = async (staff: CompanyStaff) => {
    const newStatus = staff.status === 'ACTIVE' ? 'DISABLED' : 'ACTIVE';
    try {
      await updateStaff(staff.id, { status: newStatus });
      message.success(newStatus === 'DISABLED' ? '已禁用' : '已启用');
      queryClient.invalidateQueries({ queryKey: ['seller-staff'] });
    } catch (err) {
      message.error(err instanceof Error ? err.message : '操作失败');
    }
  };

  // C40c9 改角色
  const handleEditRole = async (values: { role: 'MANAGER' | 'OPERATOR' }) => {
    if (!editRoleTarget) return;
    try {
      await updateStaff(editRoleTarget.id, { role: values.role });
      message.success('角色已更新');
      setEditRoleModal(false);
      setEditRoleTarget(null);
      editRoleForm.resetFields();
      queryClient.invalidateQueries({ queryKey: ['seller-staff'] });
    } catch (err) {
      message.error(err instanceof Error ? err.message : '更新失败');
    }
  };

  const handleRemove = async (staffId: string) => {
    try {
      await removeStaff(staffId);
      message.success('已移除');
      queryClient.invalidateQueries({ queryKey: ['seller-staff'] });
    } catch (err) {
      message.error(err instanceof Error ? err.message : '操作失败');
    }
  };

  const handleEditNickname = async (values: { nickname: string }) => {
    if (!editNicknameTarget) return;
    setEditNicknameLoading(true);
    try {
      await updateStaffNickname(editNicknameTarget.id, values.nickname.trim());
      message.success('昵称已更新');
      setEditNicknameTarget(null);
      editNicknameForm.resetFields();
      queryClient.invalidateQueries({ queryKey: ['seller-staff'] });
    } catch (err) {
      message.error(err instanceof Error ? err.message : '更新失败');
    } finally {
      setEditNicknameLoading(false);
    }
  };

  const handleEditPhone = async (values: { newPhone: string }) => {
    if (!editPhoneTarget) return;
    setEditPhoneLoading(true);
    try {
      const res = await updateStaffPhone(editPhoneTarget.id, values.newPhone.trim());
      if (res.unchanged) {
        message.info('新手机号与当前一致，未做更改');
      } else {
        message.success('手机号已更新，该员工下次登录请使用新号');
      }
      setEditPhoneTarget(null);
      editPhoneForm.resetFields();
      queryClient.invalidateQueries({ queryKey: ['seller-staff'] });
    } catch (err) {
      message.error(err instanceof Error ? err.message : '更新失败');
    } finally {
      setEditPhoneLoading(false);
    }
  };

  const handleResetPwd = async (values: { newPassword: string; confirmPassword: string }) => {
    if (!resetPwdTarget) return;
    if (values.newPassword !== values.confirmPassword) {
      message.warning('两次新密码输入不一致');
      return;
    }
    setResetPwdLoading(true);
    try {
      await resetStaffPassword(resetPwdTarget.id, values.newPassword);
      message.success('密码已重置，该员工需用新密码重新登录');
      setResetPwdTarget(null);
      resetPwdForm.resetFields();
      queryClient.invalidateQueries({ queryKey: ['seller-staff'] });
    } catch (err) {
      message.error(err instanceof Error ? err.message : '重置失败');
    } finally {
      setResetPwdLoading(false);
    }
  };

  const columns = [
    {
      title: '员工',
      render: (_: unknown, r: CompanyStaff) => {
        const nickname = r.user.profile?.nickname || '-';
        const phone = r.user?.authIdentities?.[0]?.identifier || '';
        // OWNER 自己的昵称在「账号安全」页面改，这里只对非 OWNER 显示铅笔
        return (
          <Space size={4}>
            <span>{nickname}</span>
            {isOwner() && r.role !== 'OWNER' && (
              <Button
                type="text"
                size="small"
                icon={<EditOutlined />}
                title="修改昵称"
                onClick={() => {
                  setEditNicknameTarget(r);
                  editNicknameForm.setFieldsValue({ nickname: nickname === '-' ? '' : nickname });
                }}
                style={{ color: '#8c8c8c' }}
              />
            )}
            {phone && <span style={{ color: '#8c8c8c' }}>({phone})</span>}
          </Space>
        );
      },
    },
    {
      title: '角色',
      dataIndex: 'role',
      render: (role: string) => {
        const s = staffRoleMap[role];
        return <Tag color={s?.color}>{s?.text || role}</Tag>;
      },
    },
    {
      title: '状态',
      dataIndex: 'status',
      render: (status: string) => (
        <Tag color={status === 'ACTIVE' ? 'green' : 'default'}>
          {status === 'ACTIVE' ? '正常' : '已禁用'}
        </Tag>
      ),
    },
    {
      title: '加入时间',
      dataIndex: 'joinedAt',
      render: (v: string) => dayjs(v).format('YYYY-MM-DD'),
    },
    ...(isOwner()
      ? [
          {
            title: '操作',
            render: (_: unknown, r: CompanyStaff) =>
              r.role !== 'OWNER' ? (
                <Space size="small" wrap>
                  <Button
                    type="link"
                    size="small"
                    icon={<EditOutlined />}
                    onClick={() => {
                      // 仅设置 target + 打开 Modal，角色初值通过 Modal 内 Form 的 initialValues 传入
                      // （destroyOnClose 下 setFieldsValue 在挂载前调用会失效）
                      setEditRoleTarget(r);
                      setEditRoleModal(true);
                    }}
                  >
                    改角色
                  </Button>
                  <Button
                    type="link"
                    size="small"
                    icon={<PhoneOutlined />}
                    onClick={() => {
                      setEditPhoneTarget(r);
                      editPhoneForm.setFieldsValue({
                        newPhone: r.user?.authIdentities?.[0]?.identifier || '',
                      });
                    }}
                  >
                    修改手机号
                  </Button>
                  <Button
                    type="link"
                    size="small"
                    icon={<KeyOutlined />}
                    onClick={() => {
                      setResetPwdTarget(r);
                      resetPwdForm.resetFields();
                    }}
                  >
                    重置密码
                  </Button>
                  <Button type="link" size="small" onClick={() => handleToggleStatus(r)}>
                    {r.status === 'ACTIVE' ? '禁用' : '启用'}
                  </Button>
                  <Popconfirm title="确认移除该员工？" onConfirm={() => handleRemove(r.id)}>
                    <Button type="link" size="small" danger>移除</Button>
                  </Popconfirm>
                </Space>
              ) : (
                <Tag>创始人</Tag>
              ),
          },
        ]
      : []),
  ];

  return (
    <Card
      title="员工管理"
      extra={
        <Button type="primary" icon={<PlusOutlined />} onClick={() => setInviteModal(true)}>
          邀请员工
        </Button>
      }
    >
      <Table
        dataSource={staffList || []}
        columns={columns}
        rowKey="id"
        loading={isLoading}
        pagination={false}
      />

      <Modal
        title="邀请员工"
        open={inviteModal}
        onCancel={() => { setInviteModal(false); inviteForm.resetFields(); }}
        onOk={() => inviteForm.submit()}
        destroyOnClose
      >
        <Form form={inviteForm} onFinish={handleInvite} layout="vertical">
          <Form.Item name="phone" label="手机号" rules={[{ required: true }, { pattern: /^1\d{10}$/, message: '请输入正确的手机号' }]}>
            <Input placeholder="被邀请人手机号" />
          </Form.Item>
          <Form.Item name="role" label="角色" rules={[{ required: true }]} initialValue="OPERATOR">
            <Select
              options={[
                { value: 'MANAGER', label: '经理（可管理商品+订单+员工）' },
                { value: 'OPERATOR', label: '运营（只能管理商品+订单）' },
              ]}
            />
          </Form.Item>
          <Form.Item
            name="password"
            label="初始登录密码（可选）"
            extra="设置后员工可用手机+密码登录；留空则只能用手机+验证码登录"
            rules={[
              { min: 6, message: '密码至少 6 位' },
              { max: 128, message: '密码不能超过 128 位' },
            ]}
          >
            <Input.Password placeholder="留空则员工仅支持验证码登录" autoComplete="new-password" />
          </Form.Item>
          {/* TODO: 后端补充「重置员工密码」接口后，在员工行操作列新增重置密码入口 */}
        </Form>
      </Modal>

      {/* C40c9 改角色 Modal */}
      <Modal
        title={`改角色: ${editRoleTarget?.user?.profile?.nickname || '员工'}`}
        open={editRoleModal}
        onCancel={() => { setEditRoleModal(false); setEditRoleTarget(null); editRoleForm.resetFields(); }}
        onOk={() => editRoleForm.submit()}
        destroyOnClose
      >
        {/* key={editRoleTarget?.id} 保证每次打开不同员工时 Form 重新挂载并应用新 initialValues */}
        <Form
          key={editRoleTarget?.id}
          form={editRoleForm}
          onFinish={handleEditRole}
          layout="vertical"
          initialValues={{ role: editRoleTarget?.role }}
        >
          <Form.Item
            name="role"
            label="新角色"
            rules={[{ required: true, message: '请选择角色' }]}
          >
            <Select
              options={[
                { value: 'MANAGER', label: '经理（可管理商品+订单+员工）' },
                { value: 'OPERATOR', label: '运营（只能管理商品+订单）' },
              ]}
            />
          </Form.Item>
        </Form>
      </Modal>

      {/* 修改员工昵称 */}
      <Modal
        title={`修改昵称: ${editNicknameTarget?.user?.profile?.nickname || '员工'}`}
        open={!!editNicknameTarget}
        onCancel={() => { setEditNicknameTarget(null); editNicknameForm.resetFields(); }}
        onOk={() => editNicknameForm.submit()}
        confirmLoading={editNicknameLoading}
        okText="保存"
        destroyOnClose
      >
        <Form form={editNicknameForm} onFinish={handleEditNickname} layout="vertical">
          <Form.Item
            name="nickname"
            label="昵称"
            extra="此昵称会同步影响该员工在买家 App 和其他企业的显示"
            rules={[
              { required: true, message: '请输入昵称' },
              {
                validator: (_, value) =>
                  value && value.trim()
                    ? Promise.resolve()
                    : Promise.reject(new Error('昵称不能只包含空格')),
              },
              { max: 30, message: '昵称最长 30 个字符' },
            ]}
          >
            <Input placeholder="如：张三 / 仓库小王" maxLength={30} />
          </Form.Item>
        </Form>
      </Modal>

      {/* 修改员工手机号 */}
      <Modal
        title={`修改手机号: ${editPhoneTarget?.user?.profile?.nickname || '员工'}`}
        open={!!editPhoneTarget}
        onCancel={() => { setEditPhoneTarget(null); editPhoneForm.resetFields(); }}
        onOk={() => editPhoneForm.submit()}
        confirmLoading={editPhoneLoading}
        okText="保存"
        destroyOnClose
      >
        <Alert
          type="warning"
          showIcon
          message="修改后该员工需使用新手机号登录（当前活跃会话不受影响）"
          style={{ marginBottom: 16 }}
        />
        <Form form={editPhoneForm} onFinish={handleEditPhone} layout="vertical">
          <Form.Item
            name="newPhone"
            label="新手机号"
            rules={[
              { required: true, message: '请输入新手机号' },
              { pattern: /^1\d{10}$/, message: '请输入正确的 11 位手机号' },
            ]}
          >
            <Input placeholder="新手机号" maxLength={11} />
          </Form.Item>
        </Form>
      </Modal>

      {/* 重置员工密码 */}
      <Modal
        title={`重置密码: ${resetPwdTarget?.user?.profile?.nickname || '员工'}`}
        open={!!resetPwdTarget}
        onCancel={() => { setResetPwdTarget(null); resetPwdForm.resetFields(); }}
        onOk={() => resetPwdForm.submit()}
        confirmLoading={resetPwdLoading}
        okText="重置"
        destroyOnClose
      >
        <Alert
          type="warning"
          showIcon
          message="重置后该员工所有活跃设备会被强制登出，必须用新密码重新登录"
          style={{ marginBottom: 16 }}
        />
        <Form form={resetPwdForm} onFinish={handleResetPwd} layout="vertical">
          <Form.Item
            name="newPassword"
            label="新密码"
            rules={[
              { required: true, message: '请输入新密码' },
              { min: 6, max: 128, message: '密码长度 6-128 位' },
            ]}
          >
            <Input.Password placeholder="至少 6 位" autoComplete="new-password" />
          </Form.Item>
          <Form.Item
            name="confirmPassword"
            label="确认新密码"
            dependencies={['newPassword']}
            rules={[
              { required: true, message: '请再次输入新密码' },
              ({ getFieldValue }) => ({
                validator(_, value) {
                  if (!value || getFieldValue('newPassword') === value) {
                    return Promise.resolve();
                  }
                  return Promise.reject(new Error('两次输入的密码不一致'));
                },
              }),
            ]}
          >
            <Input.Password placeholder="再次输入新密码" autoComplete="new-password" />
          </Form.Item>
        </Form>
      </Modal>
    </Card>
  );
}
