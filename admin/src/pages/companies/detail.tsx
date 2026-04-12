import { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Card,
  Button,
  Spin,
  Tag,
  Descriptions,
  Table,
  Modal,
  Input,
  Form,
  message,
  Space,
  Statistic,
  Row,
  Col,
  Image,
  Breadcrumb,
  Divider,
  Alert,
  Select,
} from 'antd';
import {
  ArrowLeftOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
  UserAddOutlined,
  EditOutlined,
} from '@ant-design/icons';
import { ProForm, ProFormText, ProFormTextArea } from '@ant-design/pro-components';
import {
  getCompany,
  updateCompany,
  auditCompany,
  getCompanyStaff,
  bindCompanyOwner,
  verifyDocument,
  getCompanyAiSearchProfile,
  updateCompanyAiSearchProfile,
} from '@/api/companies';
import PermissionGate from '@/components/PermissionGate';
import { PERMISSIONS } from '@/constants/permissions';
import type { CompanyStaff, CompanyDocument, AiSearchProfile } from '@/types';
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

export default function CompanyDetailPage() {
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

  const handleBindOwner = async (values: { phone: string }) => {
    setBindLoading(true);
    try {
      await bindCompanyOwner(id!, values.phone);
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
      width: 100,
      render: (url: string) => {
        const isImage = /\.(jpg|jpeg|png|gif|webp|bmp|svg)(\?.*)?$/i.test(url);
        return isImage ? (
          <Image src={url} width={48} height={48} style={{ objectFit: 'cover', borderRadius: 4 }} />
        ) : (
          <a href={url} target="_blank" rel="noopener noreferrer">查看文件</a>
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
            {!hasOwner && (
              <Button
                type="primary"
                icon={<UserAddOutlined />}
                onClick={() => setBindModalOpen(true)}
              >
                绑定创始人
              </Button>
            )}
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
              <a href={verifyingDoc.fileUrl} target="_blank" rel="noopener noreferrer">查看文件</a>
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
    </div>
  );
}
