import { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  App,
  Card,
  Button,
  Spin,
  Tag,
  Descriptions,
  Table,
  Modal,
  Input,
  Form,
  Space,
  Statistic,
  Row,
  Col,
  Image,
  Breadcrumb,
  Divider,
  Alert,
  Select,
  Popconfirm,
  Radio,
} from 'antd';
import {
  ArrowLeftOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
  UserAddOutlined,
  EditOutlined,
  KeyOutlined,
  SwapOutlined,
  PlusOutlined,
  DownloadOutlined,
  EyeOutlined,
  FileOutlined,
} from '@ant-design/icons';
import { ProForm, ProFormText, ProFormTextArea } from '@ant-design/pro-components';
import {
  getCompany,
  updateCompany,
  auditCompany,
  getCompanyStaff,
  bindCompanyOwner,
  resetStaffPassword,
  addStaff,
  updateStaff,
  removeStaff,
  transferOwner,
  verifyDocument,
  getCompanyAiSearchProfile,
  updateCompanyAiSearchProfile,
} from '@/api/companies';
import PermissionGate from '@/components/PermissionGate';
import { PERMISSIONS } from '@/constants/permissions';
import type { CompanyStaff, CompanyDocument } from '@/types';
import { COMPANY_TYPE_OPTIONS } from '@/types';
import { getPublicTagCategories, getCompanyTags, updateCompanyTags } from '@/api/tags';
import dayjs from 'dayjs';

const statusMap: Record<string, { text: string; color: string }> = {
  PENDING: { text: '待审核', color: 'orange' },
  APPROVED: { text: '已通过', color: 'green' },
  REJECTED: { text: '已拒绝', color: 'red' },
  SUSPENDED: { text: '已暂停', color: 'default' },
};

const verifyStatusMap: Record<string, { text: string; color: string }> = {
  PENDING: { text: '待验证', color: 'orange' },
  VERIFIED: { text: '已验证', color: 'green' },
  REJECTED: { text: '已拒绝', color: 'red' },
};

const staffRoleMap: Record<string, { text: string; color: string }> = {
  OWNER: { text: '创始人', color: 'gold' },
  MANAGER: { text: '经理', color: 'blue' },
  OPERATOR: { text: '运营', color: 'default' },
};

// 文件类型判断（基于 URL 扩展名，忽略 query string）
function getFileExt(url: string): string {
  const cleanUrl = url.split('?')[0].toLowerCase();
  const match = cleanUrl.match(/\.([a-z0-9]+)$/);
  return match ? match[1] : '';
}
const IMAGE_EXTS = ['jpg', 'jpeg', 'png', 'webp', 'gif', 'bmp', 'svg'];
const isImageFile = (url: string) => IMAGE_EXTS.includes(getFileExt(url));
const isPdfFile = (url: string) => getFileExt(url) === 'pdf';

export default function CompanyDetailPage() {
  const { message } = App.useApp();
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [auditModalOpen, setAuditModalOpen] = useState(false);
  const [auditNote, setAuditNote] = useState('');
  const [bindModalOpen, setBindModalOpen] = useState(false);
  const [bindLoading, setBindLoading] = useState(false);
  const [bindForm] = Form.useForm();
  const [editing, setEditing] = useState(false);
  const [verifyModalOpen, setVerifyModalOpen] = useState(false);
  const [verifyingDoc, setVerifyingDoc] = useState<CompanyDocument | null>(null);
  const [verifyNote, setVerifyNote] = useState('');
  const [docFilter, setDocFilter] = useState<string>('all');
  const aiFormRef = useRef<any>(null);
  // C40c8 重置员工密码
  const [resetPwdModalOpen, setResetPwdModalOpen] = useState(false);
  const [resetPwdTarget, setResetPwdTarget] = useState<CompanyStaff | null>(null);
  const [resetPwdForm] = Form.useForm();
  const [resetPwdLoading, setResetPwdLoading] = useState(false);
  // C40c9 员工 CRUD + 换 OWNER
  const [addStaffModalOpen, setAddStaffModalOpen] = useState(false);
  const [addStaffForm] = Form.useForm();
  const [addStaffLoading, setAddStaffLoading] = useState(false);
  const [editStaffModalOpen, setEditStaffModalOpen] = useState(false);
  const [editStaffTarget, setEditStaffTarget] = useState<CompanyStaff | null>(null);
  const [editStaffForm] = Form.useForm();
  const [editStaffLoading, setEditStaffLoading] = useState(false);
  const [transferOwnerModalOpen, setTransferOwnerModalOpen] = useState(false);
  const [transferOwnerForm] = Form.useForm();
  const [transferOwnerLoading, setTransferOwnerLoading] = useState(false);
  const [previewFile, setPreviewFile] = useState<{ url: string; title: string } | null>(null);

  const {
    data: company,
    isLoading,
    refetch,
  } = useQuery({
    queryKey: ['admin', 'company', id],
    queryFn: () => getCompany(id!),
    enabled: !!id,
  });

  const { data: staffList, isLoading: staffLoading } = useQuery({
    queryKey: ['admin', 'company-staff', id],
    queryFn: () => getCompanyStaff(id!),
    enabled: !!id,
  });

  const { data: aiProfile, refetch: refetchAiProfile } = useQuery({
    queryKey: ['admin', 'company-ai-search-profile', id],
    queryFn: () => getCompanyAiSearchProfile(id!),
    enabled: !!id,
  });

  const { data: tagCategories = [] } = useQuery({
    queryKey: ['tag-categories-company'],
    queryFn: () => getPublicTagCategories('COMPANY'),
  });

  const { data: companyTagGroups = [] } = useQuery({
    queryKey: ['company-tags', id],
    queryFn: () => getCompanyTags(id!),
    enabled: !!id,
  });

  // 初始化标签选中状态
  useEffect(() => {
    if (companyTagGroups.length > 0 && aiFormRef.current) {
      for (const group of companyTagGroups) {
        aiFormRef.current.setFieldValue(`tag_${group.categoryCode}`, group.tags.map(t => t.id));
      }
    }
  }, [companyTagGroups]);

  const handleAudit = async (status: 'APPROVED' | 'REJECTED') => {
    if (!company) return;
    await auditCompany(company.id, {
      status,
      note: auditNote || undefined,
    });
    message.success(status === 'APPROVED' ? '审核通过' : '审核拒绝');
    setAuditModalOpen(false);
    setAuditNote('');
    refetch();
  };

  const handleBindOwner = async (values: { phone: string; nickname?: string }) => {
    setBindLoading(true);
    try {
      await bindCompanyOwner(id!, {
        phone: values.phone.trim(),
        nickname: values.nickname?.trim() || undefined,
      });
      message.success('创始人绑定成功');
      setBindModalOpen(false);
      bindForm.resetFields();
      queryClient.invalidateQueries({ queryKey: ['admin', 'company-staff', id] });
    } catch (err) {
      message.error(err instanceof Error ? err.message : '绑定失败');
    } finally {
      setBindLoading(false);
    }
  };

  const handleUpdateCompany = async (values: Record<string, unknown>) => {
    try {
      const { addressProvince, addressCity, addressDistrict, addressDetail, ...rest } = values;
      const hasAddress = addressProvince || addressCity || addressDistrict || addressDetail;
      const data = {
        ...rest,
        address: hasAddress
          ? {
              province: addressProvince || '',
              city: addressCity || '',
              district: addressDistrict || '',
              detail: addressDetail || '',
            }
          : undefined,
      } as Parameters<typeof updateCompany>[1];
      await updateCompany(id!, data);
      message.success('企业信息已更新');
      setEditing(false);
      refetch();
    } catch (err) {
      message.error(err instanceof Error ? err.message : '更新失败');
    }
  };

  const handleUpdateAiSearchProfile = async (values: Record<string, any>) => {
    try {
      await updateCompanyAiSearchProfile(id!, {
        companyType: values.companyType,
      });
      // 收集所有标签 ID
      const allTagIds: string[] = [];
      for (const cat of tagCategories) {
        const fieldValue = values[`tag_${cat.code}`] || [];
        allTagIds.push(...fieldValue);
      }
      await updateCompanyTags(id!, allTagIds);
      message.success('AI 搜索资料已更新');
      refetchAiProfile();
      queryClient.invalidateQueries({ queryKey: ['company-tags', id] });
    } catch (err) {
      message.error(err instanceof Error ? err.message : '更新失败');
    }
  };

  // C40c9 添加员工
  const handleAddStaff = async (values: { phone: string; role: 'MANAGER' | 'OPERATOR'; nickname?: string; password?: string }) => {
    setAddStaffLoading(true);
    try {
      await addStaff(id!, {
        phone: values.phone.trim(),
        role: values.role,
        nickname: values.nickname?.trim() || undefined,
        password: values.password?.trim() || undefined,
      });
      message.success('员工已添加');
      setAddStaffModalOpen(false);
      addStaffForm.resetFields();
      queryClient.invalidateQueries({ queryKey: ['admin', 'company-staff', id] });
    } catch (err) {
      message.error(err instanceof Error ? err.message : '添加失败');
    } finally {
      setAddStaffLoading(false);
    }
  };

  // C40c9 编辑员工（改角色/状态）
  const handleEditStaff = async (values: { role: 'MANAGER' | 'OPERATOR'; status: 'ACTIVE' | 'DISABLED' }) => {
    if (!editStaffTarget) return;
    setEditStaffLoading(true);
    try {
      await updateStaff(id!, editStaffTarget.id, {
        role: values.role,
        status: values.status,
      });
      message.success('员工信息已更新');
      setEditStaffModalOpen(false);
      setEditStaffTarget(null);
      editStaffForm.resetFields();
      queryClient.invalidateQueries({ queryKey: ['admin', 'company-staff', id] });
    } catch (err) {
      message.error(err instanceof Error ? err.message : '更新失败');
    } finally {
      setEditStaffLoading(false);
    }
  };

  // C40c9 移除员工
  const handleRemoveStaff = async (staffId: string) => {
    try {
      await removeStaff(id!, staffId);
      message.success('员工已移除');
      queryClient.invalidateQueries({ queryKey: ['admin', 'company-staff', id] });
    } catch (err) {
      message.error(err instanceof Error ? err.message : '移除失败');
    }
  };

  // C40c9 换 OWNER
  const handleTransferOwner = async (values: {
    newOwnerPhone: string;
    oldOwnerAction: 'DEMOTE_TO_MANAGER' | 'REMOVE';
    nickname?: string;
  }) => {
    setTransferOwnerLoading(true);
    try {
      await transferOwner(id!, {
        newOwnerPhone: values.newOwnerPhone.trim(),
        oldOwnerAction: values.oldOwnerAction,
        nickname: values.nickname?.trim() || undefined,
      });
      message.success('创始人转让成功');
      setTransferOwnerModalOpen(false);
      transferOwnerForm.resetFields();
      queryClient.invalidateQueries({ queryKey: ['admin', 'company-staff', id] });
    } catch (err) {
      message.error(err instanceof Error ? err.message : '转让失败');
    } finally {
      setTransferOwnerLoading(false);
    }
  };

  // C40c8 管理员兜底重置员工密码
  const handleResetPassword = async (values: { newPassword: string; confirmPassword: string }) => {
    if (!resetPwdTarget) return;
    if (values.newPassword !== values.confirmPassword) {
      message.warning('两次新密码输入不一致');
      return;
    }
    setResetPwdLoading(true);
    try {
      await resetStaffPassword(id!, resetPwdTarget.id, values.newPassword);
      message.success('密码已重置，该员工需用新密码重新登录');
      setResetPwdModalOpen(false);
      setResetPwdTarget(null);
      resetPwdForm.resetFields();
    } catch (err) {
      message.error(err instanceof Error ? err.message : '重置失败');
    } finally {
      setResetPwdLoading(false);
    }
  };

  const handleVerifyDocument = async (status: 'VERIFIED' | 'REJECTED') => {
    if (!verifyingDoc) return;
    try {
      await verifyDocument(id!, verifyingDoc.id, {
        verifyStatus: status,
        verifyNote: verifyNote || undefined,
      });
      message.success(status === 'VERIFIED' ? '已通过验证' : '已驳回');
      setVerifyModalOpen(false);
      setVerifyingDoc(null);
      setVerifyNote('');
      refetch();
    } catch (err) {
      message.error(err instanceof Error ? err.message : '操作失败');
    }
  };

  if (isLoading) {
    return (
      <div style={{ textAlign: 'center', padding: 60 }}>
        <Spin size="large" />
      </div>
    );
  }

  if (!company) return null;

  const status = statusMap[company.status];
  const documents: CompanyDocument[] = company.documents || [];
  const counts = company._count as { products: number; bookings: number } || {
    products: 0,
    bookings: 0,
  };
  const contact = company.contact as Record<string, string> | null;
  const addressObj = company.address as Record<string, any> | null;
  // 优先显示结构化地址，回退到旧格式 text
  const addressText = addressObj
    ? (addressObj.province || addressObj.city || addressObj.district || addressObj.detail)
      ? [addressObj.province, addressObj.city, addressObj.district, addressObj.detail].filter(Boolean).join(' ')
      : (addressObj.text || '')
    : '';

  const hasOwner = staffList?.some((s: CompanyStaff) => s.role === 'OWNER');

  // 按状态过滤资质文档
  const filteredDocs = docFilter === 'all'
    ? documents
    : documents.filter((d) => d.verifyStatus === docFilter);

  // 资质文档表格列
  const docColumns = [
    { title: '文档名称', dataIndex: 'title', key: 'title' },
    { title: '类型', dataIndex: 'type', key: 'type', width: 120 },
    {
      title: '签发机构',
      dataIndex: 'issuer',
      key: 'issuer',
      width: 120,
      render: (v: string | null) => v || '-',
    },
    {
      title: '验证状态',
      dataIndex: 'verifyStatus',
      key: 'verifyStatus',
      width: 100,
      render: (v: string) => {
        const s = verifyStatusMap[v];
        return <Tag color={s?.color}>{s?.text}</Tag>;
      },
    },
    {
      title: '上传时间',
      dataIndex: 'createdAt',
      key: 'createdAt',
      width: 120,
      render: (v: string) => dayjs(v).format('YYYY-MM-DD'),
    },
    {
      title: '文件',
      dataIndex: 'fileUrl',
      key: 'fileUrl',
      width: 80,
      render: (url: string, record: CompanyDocument) => {
        if (!url) return '-';
        return (
          <a
            onClick={() => setPreviewFile({ url, title: record.title })}
            title="点击预览 / 下载"
            style={{ cursor: 'pointer', display: 'inline-block' }}
          >
            {isImageFile(url) ? (
              <img src={url} alt="" style={{ width: 40, height: 40, objectFit: 'cover', borderRadius: 4 }} />
            ) : (
              <FileOutlined style={{ fontSize: 32, color: '#1677ff' }} />
            )}
          </a>
        );
      },
    },
    {
      title: '操作',
      key: 'action',
      width: 100,
      render: (_: unknown, record: CompanyDocument) => (
        <PermissionGate permission={PERMISSIONS.COMPANIES_AUDIT}>
          {record.verifyStatus === 'PENDING' && (
            <Button
              type="link"
              size="small"
              onClick={() => {
                setVerifyingDoc(record);
                setVerifyModalOpen(true);
              }}
            >
              审核
            </Button>
          )}
        </PermissionGate>
      ),
    },
  ];

  // 员工表格列
  const staffColumns = [
    {
      title: '用户',
      render: (_: unknown, r: CompanyStaff) => {
        const nickname = r.user?.profile?.nickname || '-';
        const phone = r.user?.authIdentities?.[0]?.identifier || '';
        return `${nickname}${phone ? ` (${phone})` : ''}`;
      },
    },
    {
      title: '角色',
      dataIndex: 'role',
      width: 100,
      render: (role: string) => {
        const s = staffRoleMap[role];
        return <Tag color={s?.color}>{s?.text || role}</Tag>;
      },
    },
    {
      title: '状态',
      dataIndex: 'status',
      width: 80,
      render: (v: string) => (
        <Tag color={v === 'ACTIVE' ? 'green' : 'default'}>
          {v === 'ACTIVE' ? '正常' : '已禁用'}
        </Tag>
      ),
    },
    {
      title: '加入时间',
      dataIndex: 'joinedAt',
      width: 140,
      render: (v: string) => dayjs(v).format('YYYY-MM-DD HH:mm'),
    },
    {
      title: '操作',
      key: 'action',
      width: 280,
      render: (_: unknown, record: CompanyStaff) => (
        <PermissionGate permission={PERMISSIONS.COMPANIES_UPDATE}>
          <Space size="small" wrap>
            <Button
              type="link"
              size="small"
              icon={<KeyOutlined />}
              onClick={() => {
                setResetPwdTarget(record);
                setResetPwdModalOpen(true);
                resetPwdForm.resetFields();
              }}
            >
              重置密码
            </Button>
            {record.role !== 'OWNER' && (
              <>
                <Button
                  type="link"
                  size="small"
                  icon={<EditOutlined />}
                  onClick={() => {
                    setEditStaffTarget(record);
                    setEditStaffModalOpen(true);
                    editStaffForm.setFieldsValue({
                      role: record.role,
                      status: record.status,
                    });
                  }}
                >
                  编辑
                </Button>
                <Popconfirm
                  title={`确认移除员工 ${record.user?.profile?.nickname || '此员工'}？`}
                  onConfirm={() => handleRemoveStaff(record.id)}
                  okText="确认移除"
                  okButtonProps={{ danger: true }}
                >
                  <Button type="link" size="small" danger>
                    移除
                  </Button>
                </Popconfirm>
              </>
            )}
          </Space>
        </PermissionGate>
      ),
    },
  ];

  return (
    <div style={{ padding: 24 }}>
      <Breadcrumb
        style={{ marginBottom: 12 }}
        items={[
          { title: <a onClick={() => navigate('/')}>首页</a> },
          { title: <a onClick={() => navigate('/companies')}>企业管理</a> },
          { title: '企业详情' },
        ]}
      />
      <Space style={{ marginBottom: 16 }}>
        <Button
          icon={<ArrowLeftOutlined />}
          onClick={() => navigate('/companies')}
        >
          返回列表
        </Button>
        <PermissionGate permission={PERMISSIONS.COMPANIES_AUDIT}>
          {company.status === 'PENDING' && (
            <Button type="primary" onClick={() => setAuditModalOpen(true)}>
              审核
            </Button>
          )}
        </PermissionGate>
      </Space>

      {/* 统计卡片 */}
      <Row gutter={16} style={{ marginBottom: 16 }}>
        <Col span={8}>
          <Card>
            <Statistic title="商品数" value={counts.products} />
          </Card>
        </Col>
        <Col span={8}>
          <Card>
            <Statistic title="预约数" value={counts.bookings} />
          </Card>
        </Col>
        <Col span={8}>
          <Card>
            <Statistic
              title="审核状态"
              value={status?.text}
              valueStyle={{
                color:
                  company.status === 'APPROVED'
                    ? '#2E7D32'
                    : company.status === 'REJECTED'
                      ? '#f5222d'
                      : '#faad14',
              }}
            />
          </Card>
        </Col>
      </Row>

      {/* 基本信息 */}
      <Divider orientation="left">基础信息</Divider>
      <Card
        title="企业信息"
        style={{ marginBottom: 16 }}
        extra={
          <PermissionGate permission={PERMISSIONS.COMPANIES_UPDATE}>
            {!editing && (
              <Button icon={<EditOutlined />} onClick={() => setEditing(true)}>
                编辑
              </Button>
            )}
          </PermissionGate>
        }
      >
        {editing ? (
          <ProForm
            onFinish={handleUpdateCompany}
            initialValues={{
              name: company.name,
              shortName: company.shortName,
              description: company.description,
              servicePhone: company.servicePhone,
              serviceWeChat: company.serviceWeChat,
              addressProvince: addressObj?.province || '',
              addressCity: addressObj?.city || '',
              addressDistrict: addressObj?.district || '',
              addressDetail: addressObj?.detail || '',
            }}
            layout="vertical"
            style={{ maxWidth: 600 }}
            submitter={{
              render: (_, dom) => (
                <Space>
                  {dom}
                  <Button onClick={() => setEditing(false)}>取消</Button>
                </Space>
              ),
            }}
          >
            <ProFormText name="name" label="企业名称" rules={[{ required: true }]} />
            <ProFormText name="shortName" label="企业简称" />
            <ProFormTextArea
              name="description"
              label="企业简介"
              rules={[
                { required: true, message: '请填写企业简介' },
                { min: 20, message: '简介至少 20 字' },
              ]}
              fieldProps={{ rows: 4 }}
            />
            {/* 结构化地址字段 */}
            <ProForm.Group title="经营地址">
              <ProFormText name="addressProvince" label="省份" width="sm" placeholder="如：云南省" />
              <ProFormText name="addressCity" label="城市" width="sm" placeholder="如：玉溪市" />
              <ProFormText name="addressDistrict" label="区/县" width="sm" placeholder="如：红塔区" />
            </ProForm.Group>
            <ProFormText name="addressDetail" label="详细地址" placeholder="如：xxx路xxx号" />
            <ProFormText name="servicePhone" label="客服电话" />
            <ProFormText name="serviceWeChat" label="客服微信" />
          </ProForm>
        ) : (<>
          <Descriptions column={{ xs: 1, sm: 2 }}>
            <Descriptions.Item label="企业名称">
              {company.name}
            </Descriptions.Item>
            <Descriptions.Item label="企业简称">
              {company.shortName || '-'}
            </Descriptions.Item>
            <Descriptions.Item label="状态">
              <Tag color={status?.color}>{status?.text}</Tag>
            </Descriptions.Item>
            <Descriptions.Item label="联系人">
              {contact?.name || company.contactName || '-'}
            </Descriptions.Item>
            <Descriptions.Item label="联系电话">
              {contact?.phone || company.contactPhone || '-'}
            </Descriptions.Item>
            <Descriptions.Item label="客服电话">
              {company.servicePhone || '-'}
            </Descriptions.Item>
            <Descriptions.Item label="客服微信">
              {company.serviceWeChat || '-'}
            </Descriptions.Item>
            <Descriptions.Item label="经营地址">
              {addressText || '-'}
            </Descriptions.Item>
            <Descriptions.Item label="创建时间">
              {dayjs(company.createdAt).format('YYYY-MM-DD HH:mm')}
            </Descriptions.Item>
            <Descriptions.Item label="更新时间">
              {dayjs(company.updatedAt).format('YYYY-MM-DD HH:mm')}
            </Descriptions.Item>
          </Descriptions>
          <div style={{ marginTop: 16, padding: '12px 0', borderTop: '1px solid #f0f0f0' }}>
            <div style={{ color: 'rgba(0,0,0,0.45)', marginBottom: 8 }}>企业简介</div>
            <div style={{ whiteSpace: 'pre-wrap', lineHeight: 1.8 }}>
              {company.description || '-'}
            </div>
          </div>
        </>)}
      </Card>

      {/* AI 搜索资料 */}
      <Divider orientation="left">AI 搜索资料</Divider>
      <PermissionGate permission={PERMISSIONS.COMPANIES_UPDATE}>
        <Card title="企业 AI 搜索资料" style={{ marginBottom: 16 }}>
          <div style={{ marginBottom: 12, color: '#666' }}>
            结构化搜索字段，用于 AI 语音搜索和企业精准匹配
          </div>
          <ProForm
            formRef={aiFormRef}
            onFinish={handleUpdateAiSearchProfile}
            initialValues={{
              companyType: aiProfile?.companyType || undefined,
            }}
            layout="vertical"
            style={{ maxWidth: 600 }}
            key={JSON.stringify(aiProfile)}
          >
            <ProForm.Item name="companyType" label="企业类型" rules={[{ required: true, message: '请选择企业类型' }]}>
              <Select placeholder="请选择企业类型" options={COMPANY_TYPE_OPTIONS} />
            </ProForm.Item>
            {tagCategories
              .filter(cat => cat.code !== 'product_tag')
              .map(cat => (
                <ProForm.Item
                  key={cat.code}
                  name={`tag_${cat.code}`}
                  label={cat.name}
                >
                  <Select
                    mode="multiple"
                    placeholder={`请选择${cat.name}`}
                    options={cat.tags.map(t => ({ value: t.id, label: t.name }))}
                    showSearch
                    optionFilterProp="label"
                  />
                </ProForm.Item>
              ))}
          </ProForm>
        </Card>
      </PermissionGate>

      {/* 员工管理 */}
      <Divider orientation="left">员工管理</Divider>
      <Card
        title="员工列表"
        style={{ marginBottom: 16 }}
        extra={
          <PermissionGate permission={PERMISSIONS.COMPANIES_UPDATE}>
            <Space>
              {!hasOwner && (
                <Button
                  type="primary"
                  icon={<UserAddOutlined />}
                  onClick={() => setBindModalOpen(true)}
                >
                  绑定创始人
                </Button>
              )}
              {hasOwner && (
                <Button
                  icon={<SwapOutlined />}
                  onClick={() => {
                    setTransferOwnerModalOpen(true);
                    transferOwnerForm.resetFields();
                  }}
                >
                  转让创始人
                </Button>
              )}
              <Button
                type="primary"
                icon={<PlusOutlined />}
                onClick={() => {
                  setAddStaffModalOpen(true);
                  addStaffForm.resetFields();
                }}
              >
                添加员工
              </Button>
            </Space>
          </PermissionGate>
        }
      >
        {/* 未绑定创始人时显示警告提示 */}
        {!hasOwner && (
          <Alert
            message="该企业尚未绑定创始人"
            description="请绑定创始人以完成企业入驻流程"
            type="warning"
            showIcon
            style={{ marginBottom: 16 }}
            action={
              <PermissionGate permission={PERMISSIONS.COMPANIES_UPDATE}>
                <Button
                  type="primary"
                  size="small"
                  icon={<UserAddOutlined />}
                  onClick={() => setBindModalOpen(true)}
                >
                  绑定创始人
                </Button>
              </PermissionGate>
            }
          />
        )}
        <Table
          columns={staffColumns}
          dataSource={staffList || []}
          rowKey="id"
          pagination={false}
          size="small"
          loading={staffLoading}
          locale={{ emptyText: '暂无员工' }}
          scroll={{ x: 700 }}
        />
      </Card>

      {/* 资质文档 */}
      <Divider orientation="left">资质文档</Divider>
      <Card
        title="资质文档"
        extra={
          <Space>
            <Button type={docFilter === 'all' ? 'primary' : 'default'} size="small" onClick={() => setDocFilter('all')}>全部</Button>
            <Button type={docFilter === 'PENDING' ? 'primary' : 'default'} size="small" onClick={() => setDocFilter('PENDING')}>待验证</Button>
            <Button type={docFilter === 'VERIFIED' ? 'primary' : 'default'} size="small" onClick={() => setDocFilter('VERIFIED')}>已验证</Button>
            <Button type={docFilter === 'REJECTED' ? 'primary' : 'default'} size="small" onClick={() => setDocFilter('REJECTED')}>已拒绝</Button>
          </Space>
        }
      >
        <Table
          columns={docColumns}
          dataSource={filteredDocs}
          rowKey="id"
          pagination={false}
          size="small"
          locale={{ emptyText: '暂无文档' }}
          scroll={{ x: 700 }}
        />
      </Card>

      {/* 审核弹窗 */}
      <Modal
        title={`审核企业: ${company.name}`}
        open={auditModalOpen}
        onCancel={() => {
          setAuditModalOpen(false);
          setAuditNote('');
        }}
        footer={[
          <Button
            key="reject"
            danger
            icon={<CloseCircleOutlined />}
            onClick={() => handleAudit('REJECTED')}
          >
            拒绝
          </Button>,
          <Button
            key="approve"
            type="primary"
            icon={<CheckCircleOutlined />}
            onClick={() => handleAudit('APPROVED')}
          >
            通过
          </Button>,
        ]}
      >
        <Input.TextArea
          rows={3}
          placeholder="审核备注（可选）"
          value={auditNote}
          onChange={(e) => setAuditNote(e.target.value)}
        />
      </Modal>

      {/* 绑定创始人弹窗 */}
      <Modal
        title="绑定企业创始人"
        open={bindModalOpen}
        onCancel={() => { setBindModalOpen(false); bindForm.resetFields(); }}
        onOk={() => bindForm.submit()}
        confirmLoading={bindLoading}
      >
        <Form form={bindForm} onFinish={handleBindOwner} layout="vertical">
          <Form.Item
            name="phone"
            label="创始人手机号"
            rules={[
              { required: true, message: '请输入手机号' },
              { pattern: /^1\d{10}$/, message: '请输入正确的手机号' },
            ]}
          >
            <Input placeholder="输入已注册用户的手机号" />
          </Form.Item>
          <Form.Item
            name="nickname"
            label="昵称（可选）"
            extra="用于员工列表显示。若该用户已设自定义昵称，将保留其原昵称"
            rules={[{ max: 30, message: '昵称最长 30 个字符' }]}
          >
            <Input placeholder="如：张三 / 王总" maxLength={30} />
          </Form.Item>
        </Form>
      </Modal>

      {/* C40c9 添加员工弹窗 */}
      <Modal
        title="添加员工"
        open={addStaffModalOpen}
        onCancel={() => { setAddStaffModalOpen(false); addStaffForm.resetFields(); }}
        onOk={() => addStaffForm.submit()}
        confirmLoading={addStaffLoading}
        okText="添加"
        destroyOnClose
      >
        <Form form={addStaffForm} onFinish={handleAddStaff} layout="vertical">
          <Form.Item
            name="phone"
            label="手机号"
            rules={[
              { required: true, message: '请输入手机号' },
              { pattern: /^1\d{10}$/, message: '请输入正确的 11 位手机号' },
            ]}
          >
            <Input placeholder="该手机号不存在则自动创建账号" />
          </Form.Item>
          <Form.Item
            name="role"
            label="角色"
            initialValue="OPERATOR"
            rules={[{ required: true, message: '请选择角色' }]}
          >
            <Select
              options={[
                { value: 'MANAGER', label: '经理（可管理商品+订单+员工）' },
                { value: 'OPERATOR', label: '运营（只能管理商品+订单）' },
              ]}
            />
          </Form.Item>
          <Form.Item
            name="nickname"
            label="昵称（可选）"
            extra="用于员工列表显示；留空则显示手机号。若该手机号已是老用户且已设自定义昵称，将保留其原昵称"
            rules={[{ max: 30, message: '昵称最长 30 个字符' }]}
          >
            <Input placeholder="如：张三 / 仓库小王" maxLength={30} />
          </Form.Item>
          <Form.Item
            name="password"
            label="初始登录密码（可选）"
            extra="设置后员工可用手机号+密码登录；留空则员工仅支持短信验证码登录"
            rules={[
              { min: 6, max: 128, message: '密码长度 6-128 位' },
            ]}
          >
            <Input.Password placeholder="留空则不设密码" autoComplete="new-password" />
          </Form.Item>
        </Form>
      </Modal>

      {/* C40c9 编辑员工弹窗（改角色/状态） */}
      <Modal
        title={`编辑员工: ${editStaffTarget?.user?.profile?.nickname || '员工'}`}
        open={editStaffModalOpen}
        onCancel={() => { setEditStaffModalOpen(false); setEditStaffTarget(null); editStaffForm.resetFields(); }}
        onOk={() => editStaffForm.submit()}
        confirmLoading={editStaffLoading}
        destroyOnClose
      >
        <Form form={editStaffForm} onFinish={handleEditStaff} layout="vertical">
          <Form.Item
            name="role"
            label="角色"
            rules={[{ required: true, message: '请选择角色' }]}
          >
            <Select
              options={[
                { value: 'MANAGER', label: '经理' },
                { value: 'OPERATOR', label: '运营' },
              ]}
            />
          </Form.Item>
          <Form.Item
            name="status"
            label="状态"
            rules={[{ required: true, message: '请选择状态' }]}
            extra="禁用后该员工会被强制登出，无法登录"
          >
            <Radio.Group
              options={[
                { value: 'ACTIVE', label: '正常' },
                { value: 'DISABLED', label: '禁用' },
              ]}
            />
          </Form.Item>
        </Form>
      </Modal>

      {/* C40c9 转让创始人弹窗 */}
      <Modal
        title="转让企业创始人"
        open={transferOwnerModalOpen}
        onCancel={() => { setTransferOwnerModalOpen(false); transferOwnerForm.resetFields(); }}
        onOk={() => transferOwnerForm.submit()}
        confirmLoading={transferOwnerLoading}
        okText="确认转让"
        okButtonProps={{ danger: true }}
        destroyOnClose
      >
        <Alert
          type="warning"
          showIcon
          message="转让创始人是不可逆操作。事务原子执行：原创始人降级或移除 + 新创始人就位。原创始人所有登录会话立即失效"
          style={{ marginBottom: 16 }}
        />
        <Form form={transferOwnerForm} onFinish={handleTransferOwner} layout="vertical">
          <Form.Item
            name="newOwnerPhone"
            label="新创始人手机号"
            rules={[
              { required: true, message: '请输入手机号' },
              { pattern: /^1\d{10}$/, message: '请输入正确的 11 位手机号' },
            ]}
            extra="若该手机号已是本企业员工将被升级；若手机号无注册用户会自动创建"
          >
            <Input placeholder="新创始人手机号" />
          </Form.Item>
          <Form.Item
            name="oldOwnerAction"
            label="原创始人处理方式"
            initialValue="DEMOTE_TO_MANAGER"
            rules={[{ required: true, message: '请选择处理方式' }]}
          >
            <Radio.Group
              options={[
                { value: 'DEMOTE_TO_MANAGER', label: '降级为经理（保留账号）' },
                { value: 'REMOVE', label: '移除出企业（删除员工记录）' },
              ]}
            />
          </Form.Item>
          <Form.Item
            name="nickname"
            label="新创始人昵称（可选）"
            extra="用于员工列表显示；留空则显示手机号。若该手机号已是老用户且已设自定义昵称，将保留其原昵称"
            rules={[{ max: 30, message: '昵称最长 30 个字符' }]}
          >
            <Input placeholder="如：张三 / 王总" maxLength={30} />
          </Form.Item>
        </Form>
      </Modal>

      {/* C40c8 重置员工密码弹窗 */}
      <Modal
        title={`重置密码: ${resetPwdTarget?.user?.profile?.nickname || resetPwdTarget?.user?.authIdentities?.[0]?.identifier || '员工'}`}
        open={resetPwdModalOpen}
        onCancel={() => { setResetPwdModalOpen(false); setResetPwdTarget(null); resetPwdForm.resetFields(); }}
        onOk={() => resetPwdForm.submit()}
        confirmLoading={resetPwdLoading}
        okText="确认重置"
        okButtonProps={{ danger: true }}
        destroyOnClose
      >
        <Alert
          type="warning"
          showIcon
          message="重置后该员工所有设备会被强制登出，需用新密码重新登录"
          style={{ marginBottom: 16 }}
        />
        <Form form={resetPwdForm} onFinish={handleResetPassword} layout="vertical">
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

      {/* 资质审核弹窗 */}
      <Modal
        title={`审核资质文件: ${verifyingDoc?.title || ''}`}
        open={verifyModalOpen}
        onCancel={() => {
          setVerifyModalOpen(false);
          setVerifyingDoc(null);
          setVerifyNote('');
        }}
        footer={[
          <Button
            key="reject"
            danger
            icon={<CloseCircleOutlined />}
            onClick={() => handleVerifyDocument('REJECTED')}
          >
            驳回
          </Button>,
          <Button
            key="approve"
            type="primary"
            icon={<CheckCircleOutlined />}
            onClick={() => handleVerifyDocument('VERIFIED')}
          >
            通过
          </Button>,
        ]}
      >
        {verifyingDoc && (
          <Descriptions column={1} style={{ marginBottom: 16 }}>
            <Descriptions.Item label="文件名称">{verifyingDoc.title}</Descriptions.Item>
            <Descriptions.Item label="类型">{verifyingDoc.type}</Descriptions.Item>
            <Descriptions.Item label="签发机构">{verifyingDoc.issuer || '-'}</Descriptions.Item>
            <Descriptions.Item label="文件">
              <Button
                type="link"
                icon={<EyeOutlined />}
                style={{ padding: 0 }}
                onClick={() => setPreviewFile({ url: verifyingDoc.fileUrl, title: verifyingDoc.title })}
              >
                预览 / 下载
              </Button>
            </Descriptions.Item>
          </Descriptions>
        )}
        <Input.TextArea
          rows={3}
          placeholder="审核备注（可选）"
          value={verifyNote}
          onChange={(e) => setVerifyNote(e.target.value)}
        />
      </Modal>

      {/* 文件预览 / 下载弹窗 */}
      <Modal
        title={previewFile ? `预览：${previewFile.title}` : '预览'}
        open={!!previewFile}
        onCancel={() => setPreviewFile(null)}
        footer={null}
        width={900}
        destroyOnClose
      >
        {previewFile && (
          <>
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 12 }}>
              <Button
                type="primary"
                icon={<DownloadOutlined />}
                onClick={() => window.open(previewFile.url, '_blank', 'noopener')}
              >
                下载到本地
              </Button>
            </div>
            <div style={{ textAlign: 'center', background: '#fafafa', borderRadius: 4, minHeight: 400, padding: 16 }}>
              {isImageFile(previewFile.url) ? (
                <Image
                  src={previewFile.url}
                  alt={previewFile.title}
                  style={{ maxWidth: '100%', maxHeight: '70vh', objectFit: 'contain' }}
                />
              ) : isPdfFile(previewFile.url) ? (
                <>
                  <iframe
                    src={previewFile.url}
                    title={previewFile.title}
                    style={{ width: '100%', height: '70vh', border: 0, background: '#fff' }}
                  />
                  <div style={{ marginTop: 8, color: '#8c8c8c', fontSize: 12 }}>
                    若 PDF 无法显示，请点击上方「下载到本地」查看
                  </div>
                </>
              ) : (
                <div style={{ padding: '80px 0', color: '#8c8c8c' }}>
                  <FileOutlined style={{ fontSize: 48, marginBottom: 16 }} />
                  <div>该格式不支持在线预览，请点击上方「下载到本地」查看</div>
                </div>
              )}
            </div>
          </>
        )}
      </Modal>
    </div>
  );
}
