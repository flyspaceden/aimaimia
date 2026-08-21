import { useRef, useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { ProTable } from '@ant-design/pro-components';
import type { ActionType, ProColumns } from '@ant-design/pro-components';
import { App, Button, Tag, Modal, Input, Space, Badge, Tabs, Form, Alert, List, Popconfirm, Spin } from 'antd';
import { CheckCircleOutlined, CloseCircleOutlined, DeleteOutlined, EyeOutlined, PlusOutlined, UndoOutlined } from '@ant-design/icons';
import {
  getCompanies,
  auditCompany,
  createCompany,
  getCompanyDeletionCheck,
  deleteCompany,
  restoreCompany,
  type CompanyDeletionCheck,
} from '@/api/companies';
import { getMerchantApplicationPendingCount } from '@/api/merchant-applications';
import PermissionGate from '@/components/PermissionGate';
import { PERMISSIONS } from '@/constants/permissions';
import type { Company } from '@/types';
import { companyStatusMap as statusMap } from '@/constants/statusMaps';
import ApplicationsTab from './applications-tab';
import dayjs from 'dayjs';

type TabKey = 'all' | 'pending' | 'applications' | 'recycle';

const VALID_TABS: TabKey[] = ['all', 'pending', 'applications', 'recycle'];

export default function CompanyListPage() {
  const { message } = App.useApp();
  const navigate = useNavigate();
  const actionRef = useRef<ActionType>(null);
  const [searchParams, setSearchParams] = useSearchParams();
  const [auditModalOpen, setAuditModalOpen] = useState(false);
  const [currentCompany, setCurrentCompany] = useState<Company | null>(null);
  const [auditNote, setAuditNote] = useState('');
  // 从 URL query 初始化 activeTab（支持侧边栏菜单"入驻审核"快捷入口跳转）
  const initialTab = (searchParams.get('tab') as TabKey) ?? 'all';
  const [activeTab, setActiveTab] = useState<TabKey>(
    VALID_TABS.includes(initialTab) ? initialTab : 'all',
  );
  const [pendingCount, setPendingCount] = useState(0);
  const [applicationCount, setApplicationCount] = useState(0);
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [createLoading, setCreateLoading] = useState(false);
  const [createForm] = Form.useForm();
  const [deleteTarget, setDeleteTarget] = useState<Company | null>(null);
  const [deletionCheck, setDeletionCheck] = useState<CompanyDeletionCheck | null>(null);
  const [deleteCheckLoading, setDeleteCheckLoading] = useState(false);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [deleteConfirmation, setDeleteConfirmation] = useState('');

  // URL query 变更时同步 activeTab（处理从其他页面再次点击菜单的情况，组件不卸载仅参数变）
  // 依赖稳定字符串 tabParam 而不是 searchParams 对象，避免 URL 任意变更都触发 effect
  const tabParam = searchParams.get('tab');
  useEffect(() => {
    const tab = (tabParam as TabKey) ?? 'all';
    const next = VALID_TABS.includes(tab) ? tab : 'all';
    setActiveTab((prev) => (prev === next ? prev : next));
  }, [tabParam]);

  // 获取入驻申请待审核计数
  useEffect(() => {
    getMerchantApplicationPendingCount().then((count) => setApplicationCount(count));
  }, []);

  const handleCreateCompany = async () => {
    try {
      const values = await createForm.validateFields();
      setCreateLoading(true);
      await createCompany(values);
      message.success('企业创建成功');
      setCreateModalOpen(false);
      createForm.resetFields();
      actionRef.current?.reload();
    } catch (err: any) {
      if (err?.errorFields) return; // form validation error
      message.error(err?.message || '创建失败');
    } finally {
      setCreateLoading(false);
    }
  };

  const handleAudit = async (status: 'APPROVED' | 'REJECTED') => {
    if (!currentCompany) return;
    await auditCompany(currentCompany.id, { status, note: auditNote || undefined });
    message.success(status === 'APPROVED' ? '审核通过' : '审核拒绝');
    setAuditModalOpen(false);
    setAuditNote('');
    actionRef.current?.reload();
    // 刷新待审核计数
    getCompanies({ page: 1, pageSize: 1, status: 'PENDING' }).then((r) => setPendingCount(r.total));
  };

  const openDeleteModal = async (company: Company) => {
    setDeleteTarget(company);
    setDeletionCheck(null);
    setDeleteConfirmation('');
    setDeleteCheckLoading(true);
    try {
      setDeletionCheck(await getCompanyDeletionCheck(company.id));
    } catch (err) {
      message.error(err instanceof Error ? err.message : '删除检查失败');
      setDeleteTarget(null);
    } finally {
      setDeleteCheckLoading(false);
    }
  };

  const handleDeleteCompany = async () => {
    if (!deleteTarget || !deletionCheck?.canDelete) return;
    setDeleteLoading(true);
    try {
      await deleteCompany(deleteTarget.id, deleteConfirmation);
      message.success('企业已移入回收站');
      setDeleteTarget(null);
      setDeletionCheck(null);
      setDeleteConfirmation('');
      actionRef.current?.reload();
    } catch (err) {
      message.error(err instanceof Error ? err.message : '删除失败');
      if (deleteTarget) {
        setDeletionCheck(await getCompanyDeletionCheck(deleteTarget.id).catch(() => deletionCheck));
      }
    } finally {
      setDeleteLoading(false);
    }
  };

  const handleRestoreCompany = async (company: Company) => {
    try {
      await restoreCompany(company.id);
      message.success('企业已恢复');
      actionRef.current?.reload();
    } catch (err) {
      message.error(err instanceof Error ? err.message : '恢复失败');
    }
  };

  const columns: ProColumns<Company>[] = [
    { title: '企业名称', dataIndex: 'name', width: 200, ellipsis: true },
    { title: '联系人', dataIndex: 'contactName', width: 100, search: false },
    { title: '联系电话', dataIndex: 'contactPhone', width: 120, search: false },
    {
      title: '商品数',
      dataIndex: ['_count', 'products'],
      width: 80,
      search: false,
      render: (_: unknown, r: Company) => r._count?.products ?? '-',
    },
    {
      title: '状态',
      dataIndex: 'status',
      width: 100,
      valueType: 'select',
      valueEnum: Object.fromEntries(Object.entries(statusMap).map(([k, v]) => [k, { text: v.text }])),
      // 待审核 Tab 下隐藏此筛选
      hideInSearch: activeTab === 'pending' || activeTab === 'recycle',
      render: (_: unknown, r: Company) => {
        const s = statusMap[r.status];
        return <Tag color={s?.color}>{s?.text}</Tag>;
      },
    },
    {
      title: '注册时间',
      dataIndex: 'createdAt',
      width: 160,
      search: false,
      render: (_: unknown, r: Company) => dayjs(r.createdAt).format('YYYY-MM-DD HH:mm'),
    },
    {
      title: '操作',
      key: 'action',
      width: 220,
      search: false,
      render: (_: unknown, record: Company) => (
        <Space>
          <Button
            type="link"
            size="small"
            icon={<EyeOutlined />}
            onClick={() => navigate(`/companies/${record.id}`)}
          >
            详情
          </Button>
          <PermissionGate permission={PERMISSIONS.COMPANIES_AUDIT}>
            {record.status === 'PENDING' && (
              <Button
                type="link"
                size="small"
                onClick={() => {
                  setCurrentCompany(record);
                  setAuditModalOpen(true);
                }}
              >
                审核
              </Button>
            )}
          </PermissionGate>
          <PermissionGate permission={PERMISSIONS.COMPANIES_DELETE}>
            {record.status === 'DELETED' ? (
              <Popconfirm
                title={`确认恢复「${record.name}」？`}
                description="恢复后企业回到删除前状态。"
                onConfirm={() => handleRestoreCompany(record)}
                okText="恢复"
                cancelText="取消"
              >
                <Button type="link" size="small" icon={<UndoOutlined />}>恢复</Button>
              </Popconfirm>
            ) : !record.isPlatform && (
              <Button
                type="link"
                size="small"
                danger
                icon={<DeleteOutlined />}
                onClick={() => openDeleteModal(record)}
              >
                删除
              </Button>
            )}
          </PermissionGate>
        </Space>
      ),
    },
  ];

  const tabItems = [
    {
      key: 'all',
      label: '全部企业',
    },
    {
      key: 'pending',
      label: (
        <Badge count={pendingCount} offset={[12, 0]} size="small">
          待审核
        </Badge>
      ),
    },
    {
      key: 'applications',
      label: (
        <Badge count={applicationCount} offset={[12, 0]} size="small">
          入驻申请
        </Badge>
      ),
    },
    {
      key: 'recycle',
      label: '回收站',
    },
  ];

  return (
    <div style={{ padding: 24 }}>
      <Tabs
        activeKey={activeTab}
        items={tabItems}
        onChange={(key) => {
          const nextTab = key as TabKey;
          setActiveTab(nextTab);
          // 同步 URL query，便于分享链接与浏览器前进后退
          // 用对象字面量而非 mutate searchParams，避免 react-router 内部比较失败
          setSearchParams(nextTab === 'all' ? {} : { tab: nextTab }, { replace: true });
          if (nextTab !== 'applications') {
            actionRef.current?.reload();
          }
        }}
        style={{ marginBottom: 16 }}
      />

      {activeTab !== 'applications' && (
        <>
          <ProTable<Company>
            headerTitle="企业管理"
            actionRef={actionRef}
            rowKey="id"
            columns={columns}
            request={async (params) => {
              const { current, pageSize, status, name: keyword } = params;
              const res = await getCompanies({
                page: current,
                pageSize,
                status: activeTab === 'pending' ? 'PENDING' : activeTab === 'recycle' ? 'DELETED' : status,
                keyword,
              });
              if (activeTab === 'all') {
                getCompanies({ page: 1, pageSize: 1, status: 'PENDING' }).then((r) => setPendingCount(r.total));
              } else if (activeTab === 'pending') {
                setPendingCount(res.total);
              }
              return { data: res.items, total: res.total, success: true };
            }}
            toolBarRender={() => [
              activeTab === 'all' && (
                <Button
                  key="create"
                  type="primary"
                  icon={<PlusOutlined />}
                  onClick={() => setCreateModalOpen(true)}
                >
                  添加企业
                </Button>
              ),
            ]}
            search={{ labelWidth: 'auto' }}
            pagination={{ defaultPageSize: 20 }}
            scroll={{ x: 800 }}
          />

          <Modal
            title={`审核企业: ${currentCompany?.name}`}
            open={auditModalOpen}
            onCancel={() => { setAuditModalOpen(false); setAuditNote(''); }}
            footer={[
              <Button key="reject" danger icon={<CloseCircleOutlined />} onClick={() => handleAudit('REJECTED')}>
                拒绝
              </Button>,
              <Button key="approve" type="primary" icon={<CheckCircleOutlined />} onClick={() => handleAudit('APPROVED')}>
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

          <Modal
            title="添加企业"
            open={createModalOpen}
            onCancel={() => { setCreateModalOpen(false); createForm.resetFields(); }}
            onOk={handleCreateCompany}
            confirmLoading={createLoading}
            okText="创建"
            cancelText="取消"
            destroyOnClose
          >
            <Form form={createForm} layout="vertical" style={{ marginTop: 16 }}>
              <Form.Item name="companyName" label="公司名称" rules={[{ required: true, message: '请输入公司名称' }]}>
                <Input placeholder="请输入公司全称" />
              </Form.Item>
              <Form.Item name="contactName" label="联系人姓名" rules={[{ required: true, message: '请输入联系人姓名' }]}>
                <Input placeholder="请输入联系人姓名" />
              </Form.Item>
              <Form.Item name="phone" label="手机号" rules={[{ required: true, message: '请输入手机号' }, { pattern: /^1\d{10}$/, message: '请输入正确的手机号' }]}>
                <Input placeholder="用于创建卖家账号" />
              </Form.Item>
              <Form.Item name="category" label="经营品类" rules={[{ required: true, message: '请输入经营品类' }]}>
                <Input placeholder="如：水果、茶叶、粮油" />
              </Form.Item>
              <Form.Item name="description" label="公司简介">
                <Input.TextArea rows={3} placeholder="选填" />
              </Form.Item>
            </Form>
          </Modal>

          <Modal
            title="删除企业"
            open={!!deleteTarget}
            onCancel={() => {
              if (deleteLoading) return;
              setDeleteTarget(null);
              setDeletionCheck(null);
              setDeleteConfirmation('');
            }}
            onOk={handleDeleteCompany}
            okText="移入回收站"
            cancelText="取消"
            okButtonProps={{
              danger: true,
              disabled: !deletionCheck?.canDelete || deleteConfirmation !== deleteTarget?.name,
            }}
            confirmLoading={deleteLoading}
            destroyOnClose
          >
            {deleteCheckLoading ? (
              <div style={{ padding: 32, textAlign: 'center' }}><Spin tip="正在检查未完成业务" /></div>
            ) : deletionCheck && !deletionCheck.canDelete ? (
              <Alert
                type="warning"
                showIcon
                message="该企业暂不能删除"
                description={(
                  <List
                    size="small"
                    dataSource={deletionCheck.blockers}
                    renderItem={(item) => <List.Item>{item.label}：{item.count}</List.Item>}
                  />
                )}
              />
            ) : deletionCheck?.canDelete ? (
              <Space direction="vertical" size={16} style={{ width: '100%' }}>
                <Alert
                  type="error"
                  showIcon
                  message="删除后将立即停止企业对外展示和卖家访问"
                  description="历史订单、资金和审计记录会保留，之后可从回收站恢复。"
                />
                <div>
                  <div style={{ marginBottom: 8 }}>
                    请输入完整企业名称 <strong>{deleteTarget?.name}</strong> 以确认：
                  </div>
                  <Input
                    value={deleteConfirmation}
                    onChange={(event) => setDeleteConfirmation(event.target.value)}
                    placeholder="输入完整企业名称"
                    status={deleteConfirmation && deleteConfirmation !== deleteTarget?.name ? 'error' : undefined}
                  />
                </div>
              </Space>
            ) : null}
          </Modal>
        </>
      )}

      {activeTab === 'applications' && (
        <ApplicationsTab onPendingCountChange={setApplicationCount} />
      )}
    </div>
  );
}
