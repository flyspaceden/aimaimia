import { useRef, useState } from 'react';
import { ProTable } from '@ant-design/pro-components';
import type { ActionType, ProColumns } from '@ant-design/pro-components';
import { App, Button, Modal, Form, Input, Popconfirm, Space, Select, Spin } from 'antd';
import { PlusOutlined, EditOutlined, DeleteOutlined } from '@ant-design/icons';
import { getTraceBatches, createTraceBatch, updateTraceBatch, deleteTraceBatch } from '@/api/trace';
import { getCompanies } from '@/api/companies';
import PermissionGate from '@/components/PermissionGate';
import { PERMISSIONS } from '@/constants/permissions';
import type { TraceBatch } from '@/types';
import dayjs from 'dayjs';

export default function TraceListPage() {
  const { message } = App.useApp();
  const actionRef = useRef<ActionType>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<TraceBatch | null>(null);
  const [form] = Form.useForm();

  // 企业搜索选项状态
  const [companyOptions, setCompanyOptions] = useState<{ label: string; value: string }[]>([]);
  const [companySearching, setCompanySearching] = useState(false);

  // 根据关键词搜索企业（已审核）
  const handleCompanySearch = async (keyword: string) => {
    if (!keyword || keyword.length < 1) {
      setCompanyOptions([]);
      return;
    }
    setCompanySearching(true);
    try {
      const res = await getCompanies({ keyword, pageSize: 20, status: 'APPROVED' });
      const items = res?.items ?? [];
      setCompanyOptions(items.map(c => ({ label: c.name, value: c.id })));
    } catch {
      setCompanyOptions([]);
    } finally {
      setCompanySearching(false);
    }
  };

  const handleSubmit = async (values: { companyId: string; batchCode: string }) => {
    if (editing) {
      await updateTraceBatch(editing.id, { batchCode: values.batchCode });
      message.success('更新成功');
    } else {
      await createTraceBatch(values);
      message.success('创建成功');
    }
    setModalOpen(false);
    form.resetFields();
    setEditing(null);
    actionRef.current?.reload();
  };

  const handleDelete = async (id: string) => {
    await deleteTraceBatch(id);
    message.success('删除成功');
    actionRef.current?.reload();
  };

  const columns: ProColumns<TraceBatch>[] = [
    { title: '批次号', dataIndex: 'batchCode', width: 180 },
    {
      title: '企业',
      dataIndex: 'companyId',
      width: 160,
      render: (_: unknown, r: TraceBatch) => r.company?.name || r.companyId,
      renderFormItem: () => (
        <Select
          showSearch
          allowClear
          placeholder="搜索企业"
          filterOption={false}
          onSearch={handleCompanySearch}
          loading={companySearching}
          options={companyOptions}
        />
      ),
    },
    {
      title: '创建时间',
      dataIndex: 'createdAt',
      width: 160,
      search: false,
      render: (_: unknown, r: TraceBatch) => dayjs(r.createdAt).format('YYYY-MM-DD HH:mm'),
    },
    {
      title: '操作',
      key: 'action',
      width: 160,
      search: false,
      render: (_: unknown, record: TraceBatch) => (
        <Space>
          <PermissionGate permission={PERMISSIONS.TRACE_UPDATE}>
            <Button
              type="link"
              size="small"
              icon={<EditOutlined />}
              onClick={() => {
                setEditing(record);
                // 编辑时预填企业选项，确保下拉框能显示企业名称
                if (record.company) {
                  setCompanyOptions([{ label: record.company.name, value: record.companyId }]);
                }
                form.setFieldsValue({ companyId: record.companyId, batchCode: record.batchCode });
                setModalOpen(true);
              }}
            >
              编辑
            </Button>
          </PermissionGate>
          <PermissionGate permission={PERMISSIONS.TRACE_DELETE}>
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
      <ProTable<TraceBatch>
        headerTitle="溯源管理"
        actionRef={actionRef}
        rowKey="id"
        columns={columns}
        scroll={{ x: 700 }}
        request={async (params) => {
          const { current, pageSize, companyId } = params;
          const res = await getTraceBatches({ page: current, pageSize, companyId });
          return { data: res.items, total: res.total, success: true };
        }}
        toolBarRender={() => [
          <PermissionGate key="create" permission={PERMISSIONS.TRACE_CREATE}>
            <Button
              type="primary"
              icon={<PlusOutlined />}
              onClick={() => {
                setEditing(null);
                form.resetFields();
                setCompanyOptions([]);
                setModalOpen(true);
              }}
            >
              新增批次
            </Button>
          </PermissionGate>,
        ]}
        search={{ labelWidth: 'auto' }}
        pagination={{ defaultPageSize: 20 }}
      />

      <Modal
        title={editing ? '编辑溯源批次' : '新增溯源批次'}
        open={modalOpen}
        onCancel={() => { setModalOpen(false); setEditing(null); }}
        onOk={() => form.submit()}
      >
        <Form form={form} layout="vertical" onFinish={handleSubmit}>
          <Form.Item name="companyId" label="企业" rules={[{ required: true, message: '请选择企业' }]} hidden={!!editing}>
            <Select
              showSearch
              placeholder="搜索企业名称"
              filterOption={false}
              onSearch={handleCompanySearch}
              loading={companySearching}
              options={companyOptions}
              notFoundContent={companySearching ? <Spin size="small" /> : '无匹配企业'}
            />
          </Form.Item>
          <Form.Item name="batchCode" label="批次号" rules={[{ required: true }]}>
            <Input placeholder="请输入批次号" />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
