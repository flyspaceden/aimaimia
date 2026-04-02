import { useState } from 'react';
import { Card, Table, Tag, Button, Modal, Form, Input, Select, message, Popconfirm, Space } from 'antd';
import { PlusOutlined } from '@ant-design/icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { getStaff, inviteStaff, updateStaff, removeStaff } from '@/api/company';
import { staffRoleMap } from '@/constants/statusMaps';
import useAuthStore from '@/store/useAuthStore';
import type { CompanyStaff } from '@/types';
import dayjs from 'dayjs';

export default function StaffManagementPage() {
  const queryClient = useQueryClient();
  const isOwner = useAuthStore((s) => s.isOwner);
  const [inviteModal, setInviteModal] = useState(false);
  const [inviteForm] = Form.useForm();

  const { data: staffList, isLoading } = useQuery({
    queryKey: ['seller-staff'],
    queryFn: getStaff,
  });

  const handleInvite = async (values: { phone: string; role: string }) => {
    try {
      await inviteStaff(values.phone, values.role);
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

  const handleRemove = async (staffId: string) => {
    try {
      await removeStaff(staffId);
      message.success('已移除');
      queryClient.invalidateQueries({ queryKey: ['seller-staff'] });
    } catch (err) {
      message.error(err instanceof Error ? err.message : '操作失败');
    }
  };

  const columns = [
    {
      title: '员工',
      render: (_: unknown, r: CompanyStaff) => r.user.profile?.nickname || '-',
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
                <Space>
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
        onCancel={() => setInviteModal(false)}
        onOk={() => inviteForm.submit()}
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
        </Form>
      </Modal>
    </Card>
  );
}
