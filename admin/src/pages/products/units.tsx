import { useState, useCallback } from 'react';
import { App, Card, Button, Space, Tag, Modal, Form, Input, InputNumber, Switch } from 'antd';
import { PlusOutlined, EditOutlined, DeleteOutlined } from '@ant-design/icons';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ProTable } from '@ant-design/pro-components';
import type { ProColumns } from '@ant-design/pro-components';
import PermissionGate from '@/components/PermissionGate';
import { PERMISSIONS } from '@/constants/permissions';
import {
  getProductUnits,
  createProductUnit,
  updateProductUnit,
  deleteProductUnit,
  type AdminProductUnit,
} from '@/api/productUnits';

export default function ProductUnitsPage() {
  const { message, modal } = App.useApp();
  const queryClient = useQueryClient();
  const [modalOpen, setModalOpen] = useState(false);
  const [editingUnit, setEditingUnit] = useState<AdminProductUnit | null>(null);
  const [form] = Form.useForm();

  // ===== 数据查询 =====
  const { data: units = [], isLoading } = useQuery({
    queryKey: ['admin-product-units'],
    queryFn: () => getProductUnits(),
  });

  const invalidate = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ['admin-product-units'] });
    // 公开单位列表（商品编辑下拉）同步刷新
    queryClient.invalidateQueries({ queryKey: ['public-product-units'] });
  }, [queryClient]);

  // ===== Mutations =====
  const createMut = useMutation({
    mutationFn: createProductUnit,
    onSuccess: () => {
      message.success('单位已创建');
      invalidate();
      setModalOpen(false);
      form.resetFields();
    },
    onError: (e: any) => message.error(e?.message || '创建失败'),
  });

  const updateMut = useMutation({
    mutationFn: ({ id, data }: { id: string; data: { name?: string; sortOrder?: number; isActive?: boolean } }) =>
      updateProductUnit(id, data),
    onSuccess: () => {
      message.success('单位已更新');
      invalidate();
      setModalOpen(false);
      setEditingUnit(null);
      form.resetFields();
    },
    onError: (e: any) => message.error(e?.message || '更新失败'),
  });

  const toggleMut = useMutation({
    mutationFn: ({ id, isActive }: { id: string; isActive: boolean }) =>
      updateProductUnit(id, { isActive }),
    onSuccess: (data) => {
      message.success(data.isActive ? '已启用' : '已停用');
      invalidate();
    },
    onError: (e: any) => message.error(e?.message || '操作失败'),
  });

  const deleteMut = useMutation({
    mutationFn: deleteProductUnit,
    onSuccess: () => {
      message.success('单位已删除');
      invalidate();
    },
    onError: (e: any) =>
      modal.error({
        title: '无法删除单位',
        content: (
          <div style={{ fontSize: 16, lineHeight: 1.7, paddingTop: 8 }}>
            {e?.message || '删除失败'}
          </div>
        ),
        width: 520,
        centered: true,
        okText: '知道了',
      }),
  });

  // ===== Handlers =====
  const openModal = useCallback(
    (unit?: AdminProductUnit) => {
      setEditingUnit(unit || null);
      if (unit) {
        form.setFieldsValue({ name: unit.name, sortOrder: unit.sortOrder, isActive: unit.isActive });
      } else {
        form.resetFields();
        form.setFieldsValue({ sortOrder: 0, isActive: true });
      }
      setModalOpen(true);
    },
    [form],
  );

  const handleSubmit = useCallback(async () => {
    const values = await form.validateFields();
    const data = {
      name: String(values.name).trim(),
      sortOrder: values.sortOrder ?? 0,
      isActive: values.isActive ?? true,
    };
    if (editingUnit) {
      updateMut.mutate({ id: editingUnit.id, data });
    } else {
      createMut.mutate(data);
    }
  }, [form, editingUnit, createMut, updateMut]);

  const handleDelete = useCallback(
    (record: AdminProductUnit) => {
      modal.confirm({
        title: '确认删除单位',
        content: `确定要删除单位「${record.name}」吗？此操作不可恢复。`,
        okText: '删除',
        okButtonProps: { danger: true },
        cancelText: '取消',
        centered: true,
        onOk: () => deleteMut.mutateAsync(record.id),
      });
    },
    [modal, deleteMut],
  );

  // ===== Columns =====
  const columns: ProColumns<AdminProductUnit>[] = [
    { title: '单位名称', dataIndex: 'name', width: 200 },
    {
      title: '排序',
      dataIndex: 'sortOrder',
      width: 120,
      sorter: (a, b) => a.sortOrder - b.sortOrder,
      defaultSortOrder: 'ascend',
    },
    {
      title: '状态',
      dataIndex: 'isActive',
      width: 120,
      render: (_, r) => (
        <PermissionGate
          permission={PERMISSIONS.PRODUCTS_UPDATE}
          fallback={<Tag color={r.isActive ? 'green' : 'default'}>{r.isActive ? '启用' : '停用'}</Tag>}
        >
          <Switch
            checked={r.isActive}
            checkedChildren="启用"
            unCheckedChildren="停用"
            loading={toggleMut.isPending && toggleMut.variables?.id === r.id}
            onChange={(checked) => toggleMut.mutate({ id: r.id, isActive: checked })}
          />
        </PermissionGate>
      ),
    },
    {
      title: '操作',
      key: 'action',
      width: 160,
      render: (_, record) => (
        <PermissionGate
          permission={PERMISSIONS.PRODUCTS_UPDATE}
          fallback={<span style={{ color: '#999' }}>—</span>}
        >
          <Space size="small">
            <a onClick={() => openModal(record)}>
              <EditOutlined /> 编辑
            </a>
            <a style={{ color: '#ff4d4f' }} onClick={() => handleDelete(record)}>
              <DeleteOutlined /> 删除
            </a>
          </Space>
        </PermissionGate>
      ),
    },
  ];

  return (
    <>
      <Card
        title="商品单位管理"
        extra={
          <PermissionGate permission={PERMISSIONS.PRODUCTS_UPDATE}>
            <Button type="primary" icon={<PlusOutlined />} onClick={() => openModal()}>
              新增单位
            </Button>
          </PermissionGate>
        }
      >
        <ProTable<AdminProductUnit>
          columns={columns}
          dataSource={units}
          loading={isLoading}
          rowKey="id"
          search={false}
          options={false}
          pagination={false}
        />
      </Card>

      <Modal
        title={editingUnit ? '编辑单位' : '新增单位'}
        open={modalOpen}
        onOk={handleSubmit}
        onCancel={() => {
          setModalOpen(false);
          setEditingUnit(null);
          form.resetFields();
        }}
        confirmLoading={createMut.isPending || updateMut.isPending}
        destroyOnClose
      >
        <Form form={form} layout="vertical">
          <Form.Item
            name="name"
            label="单位名称"
            rules={[
              { required: true, message: '请输入单位名称' },
              { max: 10, message: '最多 10 个字符' },
            ]}
          >
            <Input placeholder="如：斤、千克、件、箱" maxLength={10} showCount />
          </Form.Item>
          <Form.Item
            name="sortOrder"
            label="排序"
            tooltip="数字越小越靠前"
            initialValue={0}
          >
            <InputNumber min={0} precision={0} style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item name="isActive" label="启用" valuePropName="checked" initialValue={true}>
            <Switch checkedChildren="启用" unCheckedChildren="停用" />
          </Form.Item>
        </Form>
      </Modal>
    </>
  );
}
