import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { App, Card, Table, Button, Modal, Form, Input, Checkbox, Tag, Popconfirm, Space, Divider, Row, Col } from 'antd';
import { PlusOutlined, EditOutlined, DeleteOutlined, CopyOutlined } from '@ant-design/icons';
import { getRoles, getPermissions, createRole, updateRole, deleteRole } from '@/api/roles';
import PermissionGate from '@/components/PermissionGate';
import { PERMISSIONS } from '@/constants/permissions';
import type { AdminRole, AdminPermission } from '@/types';

// 按模块分组权限
function groupPermissionsByModule(permissions: AdminPermission[]) {
  const groups: Record<string, AdminPermission[]> = {};
  for (const p of permissions) {
    if (!groups[p.module]) groups[p.module] = [];
    groups[p.module].push(p);
  }
  return groups;
}

// 模块中文名
const moduleNames: Record<string, string> = {
  dashboard: '工作台',
  users: '用户管理',
  products: '商品管理',
  orders: '订单管理',
  companies: '企业管理',
  bonus: '会员奖励',
  trace: '溯源管理',
  config: '系统配置',
  admin_users: '管理员账号',
  admin_roles: '角色权限',
  audit: '审计日志',
};

// 模块全选复选框组件
function ModuleSelectAll({
  module,
  perms,
  selectedPermIds,
  form,
}: {
  module: string;
  perms: AdminPermission[];
  selectedPermIds: string[];
  form: ReturnType<typeof Form.useForm>[0];
}) {
  const moduleIds = perms.map((p) => p.id);
  const allChecked = moduleIds.every((id) => selectedPermIds.includes(id));
  const someChecked = moduleIds.some((id) => selectedPermIds.includes(id));

  return (
    <div style={{ fontWeight: 600, marginBottom: 8, color: '#1E40AF', display: 'flex', alignItems: 'center', gap: 8 }}>
      <Checkbox
        checked={allChecked}
        indeterminate={someChecked && !allChecked}
        onChange={(e) => {
          const current: string[] = form.getFieldValue('permissionIds') || [];
          if (e.target.checked) {
            // 添加该模块所有权限
            const newIds = [...new Set([...current, ...moduleIds])];
            form.setFieldsValue({ permissionIds: newIds });
          } else {
            // 移除该模块所有权限
            const newIds = current.filter((id) => !moduleIds.includes(id));
            form.setFieldsValue({ permissionIds: newIds });
          }
        }}
      />
      {moduleNames[module] || module}
    </div>
  );
}

export default function RolesPage() {
  const { message } = App.useApp();
  const queryClient = useQueryClient();
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<AdminRole | null>(null);
  const [form] = Form.useForm();

  // 监听表单中 permissionIds 的实时值，用于模块全选状态计算
  const selectedPermIds: string[] = Form.useWatch('permissionIds', form) || [];

  const { data: roles, isLoading } = useQuery({
    queryKey: ['admin', 'roles'],
    queryFn: getRoles,
  });

  const { data: permissions } = useQuery({
    queryKey: ['admin', 'permissions'],
    queryFn: getPermissions,
  });

  const createMutation = useMutation({
    mutationFn: createRole,
    onSuccess: () => {
      message.success('创建成功');
      queryClient.invalidateQueries({ queryKey: ['admin', 'roles'] });
      setModalOpen(false);
      form.resetFields();
    },
    onError: (err: Error) => message.error(err.message),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Parameters<typeof updateRole>[1] }) =>
      updateRole(id, data),
    onSuccess: () => {
      message.success('更新成功');
      queryClient.invalidateQueries({ queryKey: ['admin', 'roles'] });
      setModalOpen(false);
      setEditing(null);
      form.resetFields();
    },
    onError: (err: Error) => message.error(err.message),
  });

  const deleteMutation = useMutation({
    mutationFn: deleteRole,
    onSuccess: () => {
      message.success('删除成功');
      queryClient.invalidateQueries({ queryKey: ['admin', 'roles'] });
    },
    onError: (err: Error) => message.error(err.message),
  });

  const handleSubmit = (values: { name: string; description?: string; permissionIds?: string[] }) => {
    if (editing) {
      updateMutation.mutate({ id: editing.id, data: values });
    } else {
      createMutation.mutate(values);
    }
  };

  const permissionGroups = permissions ? groupPermissionsByModule(permissions) : {};

  const columns = [
    { title: '角色名称', dataIndex: 'name', width: 150 },
    { title: '描述', dataIndex: 'description', width: 200 },
    {
      title: '类型',
      dataIndex: 'isSystem',
      width: 100,
      render: (v: boolean) => v ? <Tag color="red">系统角色</Tag> : <Tag>自定义</Tag>,
    },
    {
      title: '权限数',
      key: 'permCount',
      width: 80,
      render: (_: unknown, r: AdminRole) => r.permissions?.length || 0,
    },
    {
      // 成员数：依赖后端返回 _count.adminUsers
      title: '成员数',
      key: 'memberCount',
      width: 80,
      render: (_: unknown, r: AdminRole) => (r as any)._count?.adminUsers ?? '-',
    },
    {
      title: '操作',
      key: 'action',
      width: 220,
      render: (_: unknown, record: AdminRole) => (
        <Space>
          <PermissionGate permission={PERMISSIONS.ADMIN_ROLES_UPDATE}>
            <Button
              type="link"
              size="small"
              icon={<EditOutlined />}
              onClick={() => {
                setEditing(record);
                form.setFieldsValue({
                  name: record.name,
                  description: record.description,
                  permissionIds: record.permissions?.map((p) => p.id),
                });
                setModalOpen(true);
              }}
            >
              编辑
            </Button>
          </PermissionGate>
          {/* 复制角色：以当前角色的权限和描述为基础创建新角色 */}
          <PermissionGate permission={PERMISSIONS.ADMIN_ROLES_CREATE}>
            <Button
              type="link"
              size="small"
              icon={<CopyOutlined />}
              onClick={() => {
                setEditing(null); // null = 创建模式
                form.setFieldsValue({
                  name: '',
                  description: `复制自「${record.name}」`,
                  permissionIds: record.permissions?.map((p) => p.id),
                });
                setModalOpen(true);
              }}
            >
              复制
            </Button>
          </PermissionGate>
          {!record.isSystem && (
            <PermissionGate permission={PERMISSIONS.ADMIN_ROLES_DELETE}>
              <Popconfirm title="确认删除？" onConfirm={() => deleteMutation.mutate(record.id)}>
                <Button type="link" size="small" danger icon={<DeleteOutlined />}>删除</Button>
              </Popconfirm>
            </PermissionGate>
          )}
        </Space>
      ),
    },
  ];

  return (
    <div style={{ padding: 24 }}>
      <Card
        title="角色权限管理"
        extra={
          <PermissionGate permission={PERMISSIONS.ADMIN_ROLES_CREATE}>
            <Button
              type="primary"
              icon={<PlusOutlined />}
              onClick={() => {
                setEditing(null);
                form.resetFields();
                setModalOpen(true);
              }}
            >
              新增角色
            </Button>
          </PermissionGate>
        }
      >
        <Table
          columns={columns}
          dataSource={roles || []}
          rowKey="id"
          loading={isLoading}
          pagination={false}
          size="small"
        />
      </Card>

      {/* 角色编辑弹窗（含权限矩阵） */}
      <Modal
        title={editing ? `编辑角色: ${editing.name}` : '新增角色'}
        open={modalOpen}
        onCancel={() => { setModalOpen(false); setEditing(null); }}
        onOk={() => form.submit()}
        width={700}
        confirmLoading={createMutation.isPending || updateMutation.isPending}
      >
        <Form form={form} layout="vertical" onFinish={handleSubmit}>
          <Form.Item name="name" label="角色名称" rules={[{ required: true }]}>
            <Input placeholder="如：运营经理" disabled={editing?.isSystem} />
          </Form.Item>
          <Form.Item name="description" label="描述">
            <Input.TextArea rows={2} placeholder="角色描述" />
          </Form.Item>
          <Divider>
            权限矩阵
            <span style={{ float: 'right', fontWeight: 'normal' }}>
              <Button
                type="link"
                size="small"
                onClick={() => {
                  const allIds = permissions?.map((p) => p.id) || [];
                  form.setFieldsValue({ permissionIds: allIds });
                }}
              >
                全选
              </Button>
              <Button
                type="link"
                size="small"
                onClick={() => {
                  form.setFieldsValue({ permissionIds: [] });
                }}
              >
                清空
              </Button>
            </span>
          </Divider>
          <Form.Item name="permissionIds">
            <Checkbox.Group style={{ width: '100%' }}>
              {Object.entries(permissionGroups).map(([module, perms]) => (
                <div key={module} style={{ marginBottom: 16 }}>
                  <ModuleSelectAll
                    module={module}
                    perms={perms}
                    selectedPermIds={selectedPermIds}
                    form={form}
                  />
                  <Row>
                    {perms.map((p) => (
                      <Col span={8} key={p.id}>
                        <Checkbox value={p.id}>
                          {p.description || p.code}
                        </Checkbox>
                      </Col>
                    ))}
                  </Row>
                </div>
              ))}
            </Checkbox.Group>
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
