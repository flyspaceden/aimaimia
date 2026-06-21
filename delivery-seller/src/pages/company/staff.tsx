import { useMemo, useState } from 'react';
import {
  Alert,
  App,
  Button,
  Checkbox,
  Col,
  Drawer,
  Form,
  Input,
  Row,
  Select,
  Space,
  Switch,
  Table,
  Tag,
  Typography,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import {
  EditOutlined,
  PlusOutlined,
  SafetyCertificateOutlined,
  TeamOutlined,
  UserSwitchOutlined,
} from '@ant-design/icons';
import { ProCard } from '@ant-design/pro-components';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { createStaff, getStaff, updateStaff } from '@/api/company';
import { getStatusDisplay, staffRoleMap } from '@/constants/statusMaps';
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
  statusEnabled: boolean;
  permissionCodes: string[];
}

type PermissionOption = {
  value: string;
  label: string;
};

type CheckboxValueType = string | number | boolean;

type PermissionGroup = {
  title: string;
  description: string;
  options: PermissionOption[];
};

const editableStaffRoleOptions = [
  { value: 'MANAGER', label: '经理' },
  { value: 'OPERATOR', label: '运营' },
];

const permissionGroups: PermissionGroup[] = [
  {
    title: '商品与库存',
    description: '商品查看、商品维护和库存维护。',
    options: [
      { value: 'products:read', label: '查看商品' },
      { value: 'products:write', label: '维护商品' },
      { value: 'inventory:write', label: '维护库存' },
    ],
  },
  {
    title: '订单与履约',
    description: '订单查看、发货和履约处理。',
    options: [
      { value: 'orders:read', label: '查看订单' },
      { value: 'orders:write', label: '发货履约' },
    ],
  },
  {
    title: '客服中心',
    description: '查看和处理配送客服会话。',
    options: [
      { value: 'customer-service:read', label: '查看客服' },
      { value: 'customer-service:write', label: '处理客服' },
    ],
  },
  {
    title: '财务与导出',
    description: '导出配送中心财务清单。',
    options: [
      { value: 'finance:read', label: '查看财务导出' },
    ],
  },
  {
    title: '企业与人员',
    description: '维护配送中心资料和员工权限。',
    options: [
      { value: 'company:read', label: '查看中心资料' },
      { value: 'company:write', label: '维护中心资料' },
      { value: 'staff:manage', label: '管理员工权限' },
    ],
  },
  {
    title: '全部权限',
    description: '拥有配送中心开放的全部操作能力。',
    options: [
      { value: 'delivery:*', label: '全部配送权限' },
    ],
  },
];

const permissionCodeOptions = permissionGroups.flatMap((group) => group.options);
const permissionCodeLabelMap = new Map(permissionCodeOptions.map((item) => [item.value, item.label] as const));

function formatPermissionCode(code: string) {
  return permissionCodeLabelMap.get(code) ?? '自定义权限';
}

function toPermissionCodes(values?: CheckboxValueType[]) {
  return (values ?? []).map(String).filter(Boolean);
}

function PermissionCheckboxGroups() {
  return (
    <Form.Item name="permissionCodes" label="权限分组">
      <Checkbox.Group style={{ width: '100%' }}>
        <Space direction="vertical" size={12} style={{ width: '100%' }}>
          {permissionGroups.map((group) => (
            <div
              key={group.title}
              style={{
                padding: 12,
                border: '1px solid #f0f0f0',
                borderRadius: 8,
                background: '#fff',
              }}
            >
              <Space direction="vertical" size={6} style={{ width: '100%' }}>
                <Space>
                  <Typography.Text strong>{group.title}</Typography.Text>
                  <Typography.Text type="secondary">{group.description}</Typography.Text>
                </Space>
                <Space size={[12, 8]} wrap>
                  {group.options.map((option) => (
                    <Checkbox key={option.value} value={option.value}>
                      {option.label}
                    </Checkbox>
                  ))}
                </Space>
              </Space>
            </div>
          ))}
        </Space>
      </Checkbox.Group>
    </Form.Item>
  );
}

function renderPermissionTags(permissionCodes: string[]) {
  if (permissionCodes.length === 0) {
    return <Typography.Text type="secondary">未分配</Typography.Text>;
  }

  if (permissionCodes.includes('delivery:*')) {
    return <Tag color="gold">全部配送权限</Tag>;
  }

  return (
    <Space size={[4, 4]} wrap>
      {permissionCodes.map((code) => (
        <Tag key={code}>{formatPermissionCode(code)}</Tag>
      ))}
    </Space>
  );
}

export default function StaffManagementPage() {
  const { message } = App.useApp();
  const queryClient = useQueryClient();
  const hasPermission = useAuthStore((s) => s.hasPermission);
  const currentStaffId = useAuthStore((s) => s.seller?.staffId);
  const canManageStaff = hasPermission('staff:manage');

  const [createDrawerOpen, setCreateDrawerOpen] = useState(false);
  const [editingStaff, setEditingStaff] = useState<CompanyStaff | null>(null);
  const [createForm] = Form.useForm<CreateCompanyStaffPayload>();
  const [editForm] = Form.useForm<EditStaffForm>();

  const { data: staffList, isLoading } = useQuery({
    queryKey: ['seller-staff'],
    queryFn: getStaff,
  });

  const staffStats = useMemo(() => {
    const list = staffList ?? [];
    return {
      total: list.length,
      active: list.filter((staff) => staff.status === 'ACTIVE').length,
      disabled: list.filter((staff) => staff.status === 'DISABLED').length,
    };
  }, [staffList]);

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
        permissionCodes: toPermissionCodes(values.permissionCodes),
      });
      message.success('员工已创建');
      setCreateDrawerOpen(false);
      createForm.resetFields();
      refreshStaff();
    } catch (err) {
      message.error(err instanceof Error ? err.message : '创建失败');
    }
  };

  const openEditDrawer = (staff: CompanyStaff) => {
    setEditingStaff(staff);
    editForm.setFieldsValue({
      realName: staff.realName || '',
      role: staff.role,
      statusEnabled: staff.status === 'ACTIVE',
      permissionCodes: staff.permissionCodes || [],
    });
  };

  const handleUpdateStaff = async (values: EditStaffForm) => {
    if (!editingStaff) return;

    const payload: UpdateCompanyStaffPayload = {
      realName: values.realName?.trim() || undefined,
      permissionCodes: toPermissionCodes(values.permissionCodes),
    };

    if (editingStaff.id !== currentStaffId) {
      payload.role = values.role;
      payload.status = values.statusEnabled ? 'ACTIVE' : 'DISABLED';
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

  const closeCreateDrawer = () => {
    setCreateDrawerOpen(false);
    createForm.resetFields();
  };

  const closeEditDrawer = () => {
    setEditingStaff(null);
    editForm.resetFields();
  };

  const columns: ColumnsType<CompanyStaff> = [
    {
      title: '账号',
      key: 'account',
      render: (_, staff) => (
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
        const item = getStatusDisplay(staffRoleMap, role);
        return <Tag color={item.color}>{item.text}</Tag>;
      },
    },
    {
      title: '权限',
      dataIndex: 'permissionCodes',
      render: (permissionCodes: string[]) => renderPermissionTags(permissionCodes),
    },
    {
      title: '状态',
      dataIndex: 'status',
      render: (status: CompanyStaff['status']) => {
        const item = getStatusDisplay(staffStatusMap, status);
        return <Tag color={item.color}>{item.text}</Tag>;
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
              <Button type="link" size="small" icon={<EditOutlined />} onClick={() => openEditDrawer(staff)}>
                编辑
              </Button>
            ),
          },
        ]
      : []),
  ];

  return (
    <Space direction="vertical" size={16} style={{ display: 'flex' }}>
      <Row gutter={[16, 16]}>
        <Col xs={24} md={8}>
          <ProCard title="新增员工" headerBordered style={{ borderTop: '3px solid #EA580C' }}>
            <Space direction="vertical" size={8}>
              <TeamOutlined style={{ color: '#EA580C', fontSize: 22 }} />
              <Typography.Text>创建配送中心登录账号，并选择角色。</Typography.Text>
            </Space>
          </ProCard>
        </Col>
        <Col xs={24} md={8}>
          <ProCard title="分配权限" headerBordered style={{ borderTop: '3px solid #f97316' }}>
            <Space direction="vertical" size={8}>
              <SafetyCertificateOutlined style={{ color: '#f97316', fontSize: 22 }} />
              <Typography.Text>按商品、订单、客服、财务和人员分组勾选权限。</Typography.Text>
            </Space>
          </ProCard>
        </Col>
        <Col xs={24} md={8}>
          <ProCard title="禁用员工" headerBordered style={{ borderTop: '3px solid #fb923c' }}>
            <Space direction="vertical" size={8}>
              <UserSwitchOutlined style={{ color: '#fb923c', fontSize: 22 }} />
              <Typography.Text>员工离岗时关闭账号状态，历史记录继续保留。</Typography.Text>
            </Space>
          </ProCard>
        </Col>
      </Row>

      <ProCard
        title="员工与权限"
        headerBordered
        style={{ borderTop: '3px solid #EA580C' }}
        extra={
          canManageStaff ? (
            <Button type="primary" icon={<PlusOutlined />} onClick={() => setCreateDrawerOpen(true)}>
              新增员工
            </Button>
          ) : null
        }
      >
        <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
          <Col xs={12} md={8}>
            <div style={{ padding: '8px 0' }}>
              <Typography.Text type="secondary">员工总数</Typography.Text>
              <Typography.Title level={3} style={{ margin: 0 }}>{staffStats.total}</Typography.Title>
            </div>
          </Col>
          <Col xs={12} md={8}>
            <div style={{ padding: '8px 0' }}>
              <Typography.Text type="secondary">正常账号</Typography.Text>
              <Typography.Title level={3} style={{ margin: 0 }}>{staffStats.active}</Typography.Title>
            </div>
          </Col>
          <Col xs={12} md={8}>
            <div style={{ padding: '8px 0' }}>
              <Typography.Text type="secondary">已禁用</Typography.Text>
              <Typography.Title level={3} style={{ margin: 0 }}>{staffStats.disabled}</Typography.Title>
            </div>
          </Col>
        </Row>

        <Table<CompanyStaff>
          rowKey="id"
          loading={isLoading}
          dataSource={staffList || []}
          columns={columns}
          pagination={false}
          scroll={{ x: 980 }}
        />
      </ProCard>

      <Drawer
        title="新增员工"
        open={createDrawerOpen}
        width={720}
        onClose={closeCreateDrawer}
        extra={(
          <Space>
            <Button onClick={closeCreateDrawer}>取消</Button>
            <Button type="primary" onClick={() => createForm.submit()}>
              创建
            </Button>
          </Space>
        )}
      >
        <Form<CreateCompanyStaffPayload>
          form={createForm}
          layout="vertical"
          onFinish={handleCreateStaff}
          initialValues={{ role: 'OPERATOR', permissionCodes: [] }}
        >
          <Row gutter={16}>
            <Col xs={24} md={12}>
              <Form.Item
                name="username"
                label="登录账号"
                rules={[{ required: true, message: '请输入登录账号' }]}
              >
                <Input placeholder="例如：配送仓库一号" maxLength={60} />
              </Form.Item>
            </Col>
            <Col xs={24} md={12}>
              <Form.Item
                name="role"
                label="角色"
                rules={[{ required: true, message: '请选择角色' }]}
              >
                <Select options={editableStaffRoleOptions} />
              </Form.Item>
            </Col>
          </Row>
          <Row gutter={16}>
            <Col xs={24} md={12}>
              <Form.Item name="realName" label="姓名">
                <Input placeholder="例如：张三" maxLength={120} />
              </Form.Item>
            </Col>
            <Col xs={24} md={12}>
              <Form.Item name="phone" label="手机号">
                <Input placeholder="可选，用于当前员工账号" maxLength={20} />
              </Form.Item>
            </Col>
          </Row>
          <PermissionCheckboxGroups />
        </Form>
      </Drawer>

      <Drawer
        title={editingStaff ? `编辑员工：${editingStaff.username}` : '编辑员工'}
        open={!!editingStaff}
        width={720}
        onClose={closeEditDrawer}
        extra={(
          <Space>
            <Button onClick={closeEditDrawer}>取消</Button>
            <Button type="primary" onClick={() => editForm.submit()}>
              保存
            </Button>
          </Space>
        )}
      >
        {editingStaff ? (
          <>
            {editingStaff.id === currentStaffId ? (
              <Alert
                type="warning"
                showIcon
                style={{ marginBottom: 16 }}
                message="当前登录账号不能在这里修改自己的角色或禁用自己。"
              />
            ) : null}
            <Form<EditStaffForm> form={editForm} layout="vertical" onFinish={handleUpdateStaff}>
              <Row gutter={16}>
                <Col xs={24} md={12}>
                  <Form.Item label="登录账号">
                    <Input value={editingStaff.username} disabled />
                  </Form.Item>
                </Col>
                <Col xs={24} md={12}>
                  <Form.Item label="手机号">
                    <Input value={editingStaff.phone || ''} disabled placeholder="未绑定" />
                  </Form.Item>
                </Col>
              </Row>
              <Row gutter={16}>
                <Col xs={24} md={12}>
                  <Form.Item name="realName" label="姓名">
                    <Input placeholder="员工姓名" maxLength={120} />
                  </Form.Item>
                </Col>
                <Col xs={24} md={12}>
                  <Form.Item
                    name="role"
                    label="角色"
                    rules={[{ required: true, message: '请选择角色' }]}
                  >
                    <Select
                      disabled={editingStaff.id === currentStaffId}
                      options={editableStaffRoleOptions}
                    />
                  </Form.Item>
                </Col>
              </Row>
              <Form.Item name="statusEnabled" label="账号状态" valuePropName="checked">
                <Switch
                  checkedChildren="正常"
                  unCheckedChildren="禁用"
                  disabled={editingStaff.id === currentStaffId}
                />
              </Form.Item>
              <PermissionCheckboxGroups />
            </Form>
          </>
        ) : null}
      </Drawer>
    </Space>
  );
}
