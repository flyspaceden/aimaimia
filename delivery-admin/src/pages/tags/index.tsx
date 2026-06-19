import { useState, useCallback } from 'react';
import { App, Card, Row, Col, Button, Space, Tag, Modal, Form, Input, Select, Switch, Popconfirm } from 'antd';
import { PlusOutlined, EditOutlined, DeleteOutlined } from '@ant-design/icons';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ProTable } from '@ant-design/pro-components';
import type { ProColumns } from '@ant-design/pro-components';
import {
  getTagCategories, createTagCategory, updateTagCategory, deleteTagCategory,
  getTags, createTag, updateTag, deleteTag,
  type TagCategory, type TagItem,
} from '@/api/tags';

export default function TagManagementPage() {
  const { message, modal } = App.useApp();
  const queryClient = useQueryClient();

  const showDeleteError = (title: string, err: any) => {
    modal.error({
      title,
      content: (
        <div style={{ fontSize: 16, lineHeight: 1.7, paddingTop: 8 }}>
          {err?.message || '删除失败'}
        </div>
      ),
      width: 520,
      centered: true,
      okText: '知道了',
    });
  };
  const [selectedCategory, setSelectedCategory] = useState<TagCategory | null>(null);
  const [categoryModalOpen, setCategoryModalOpen] = useState(false);
  const [editingCategory, setEditingCategory] = useState<TagCategory | null>(null);
  const [tagModalOpen, setTagModalOpen] = useState(false);
  const [editingTag, setEditingTag] = useState<TagItem | null>(null);
  const [categoryForm] = Form.useForm();
  const [tagForm] = Form.useForm();

  // ===== 数据查询 =====

  const { data: categories = [], isLoading: categoriesLoading } = useQuery({
    queryKey: ['admin-tag-categories'],
    queryFn: () => getTagCategories(),
  });

  const { data: tags = [], isLoading: tagsLoading } = useQuery({
    queryKey: ['admin-tags', selectedCategory?.id],
    queryFn: () => getTags({ categoryId: selectedCategory?.id }),
    enabled: !!selectedCategory,
  });

  // ===== Category mutations =====

  const createCategoryMut = useMutation({
    mutationFn: createTagCategory,
    onSuccess: () => {
      message.success('类别已创建');
      queryClient.invalidateQueries({ queryKey: ['admin-tag-categories'] });
      setCategoryModalOpen(false);
      categoryForm.resetFields();
    },
    onError: (e: any) => message.error(e?.message || '创建失败'),
  });

  const updateCategoryMut = useMutation({
    mutationFn: ({ id, data }: { id: string; data: any }) => updateTagCategory(id, data),
    onSuccess: () => {
      message.success('类别已更新');
      queryClient.invalidateQueries({ queryKey: ['admin-tag-categories'] });
      setCategoryModalOpen(false);
      setEditingCategory(null);
      categoryForm.resetFields();
    },
    onError: (e: any) => message.error(e?.message || '更新失败'),
  });

  const deleteCategoryMut = useMutation({
    mutationFn: deleteTagCategory,
    onSuccess: (_data, deletedId) => {
      message.success('类别已删除');
      queryClient.invalidateQueries({ queryKey: ['admin-tag-categories'] });
      if (selectedCategory?.id === deletedId) setSelectedCategory(null);
    },
    onError: (e: any) => showDeleteError('无法删除类别', e),
  });

  // ===== Tag mutations =====

  const createTagMut = useMutation({
    mutationFn: createTag,
    onSuccess: () => {
      message.success('标签已创建');
      queryClient.invalidateQueries({ queryKey: ['admin-tags', selectedCategory?.id] });
      queryClient.invalidateQueries({ queryKey: ['admin-tag-categories'] });
      setTagModalOpen(false);
      tagForm.resetFields();
    },
    onError: (e: any) => message.error(e?.message || '创建失败'),
  });

  const updateTagMut = useMutation({
    mutationFn: ({ id, data }: { id: string; data: any }) => updateTag(id, data),
    onSuccess: () => {
      message.success('标签已更新');
      queryClient.invalidateQueries({ queryKey: ['admin-tags', selectedCategory?.id] });
      queryClient.invalidateQueries({ queryKey: ['admin-tag-categories'] });
      setTagModalOpen(false);
      setEditingTag(null);
      tagForm.resetFields();
    },
    onError: (e: any) => message.error(e?.message || '更新失败'),
  });

  const deleteTagMut = useMutation({
    mutationFn: deleteTag,
    onSuccess: () => {
      message.success('标签已删除');
      queryClient.invalidateQueries({ queryKey: ['admin-tags', selectedCategory?.id] });
      queryClient.invalidateQueries({ queryKey: ['admin-tag-categories'] });
    },
    onError: (e: any) => showDeleteError('无法删除标签', e),
  });

  // ===== Handlers =====

  const openCategoryModal = useCallback((category?: TagCategory) => {
    setEditingCategory(category || null);
    if (category) {
      categoryForm.setFieldsValue(category);
    } else {
      categoryForm.resetFields();
    }
    setCategoryModalOpen(true);
  }, [categoryForm]);

  const handleCategorySubmit = useCallback(async () => {
    const values = await categoryForm.validateFields();
    if (editingCategory) {
      updateCategoryMut.mutate({ id: editingCategory.id, data: { name: values.name, description: values.description, sortOrder: values.sortOrder } });
    } else {
      createCategoryMut.mutate(values);
    }
  }, [categoryForm, editingCategory, createCategoryMut, updateCategoryMut]);

  const openTagModal = useCallback((tag?: TagItem) => {
    setEditingTag(tag || null);
    if (tag) {
      tagForm.setFieldsValue({ ...tag, synonyms: tag.synonyms?.join(', ') || '' });
    } else {
      tagForm.resetFields();
    }
    setTagModalOpen(true);
  }, [tagForm]);

  const handleTagSubmit = useCallback(async () => {
    const values = await tagForm.validateFields();
    const synonyms = values.synonyms
      ? values.synonyms.split(/[,，]/).map((s: string) => s.trim()).filter(Boolean)
      : [];
    if (editingTag) {
      updateTagMut.mutate({ id: editingTag.id, data: { name: values.name, synonyms, sortOrder: values.sortOrder, isActive: values.isActive } });
    } else {
      createTagMut.mutate({ name: values.name, categoryId: selectedCategory!.id, synonyms, sortOrder: values.sortOrder || 0 });
    }
  }, [tagForm, editingTag, selectedCategory, createTagMut, updateTagMut]);

  // ===== Category Columns =====

  const categoryColumns: ProColumns<TagCategory>[] = [
    { title: '名称', dataIndex: 'name', width: 120 },
    {
      title: '范围', dataIndex: 'scope', width: 80,
      render: (_, r) => <Tag color={r.scope === 'COMPANY' ? 'blue' : 'green'}>{r.scope === 'COMPANY' ? '企业' : '商品'}</Tag>,
    },
    { title: '标签数', width: 60, render: (_, r) => r.tags?.length || 0 },
    {
      title: '操作', width: 100,
      render: (_, record) => (
        <Space size="small">
          <a onClick={() => openCategoryModal(record)}><EditOutlined /></a>
          <Popconfirm title="确定删除此类别？" onConfirm={() => deleteCategoryMut.mutate(record.id)}>
            <a style={{ color: '#ff4d4f' }}><DeleteOutlined /></a>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  // ===== Tag Columns =====

  const tagColumns: ProColumns<TagItem>[] = [
    { title: '标签名', dataIndex: 'name', width: 120 },
    { title: '同义词', dataIndex: 'synonyms', width: 160, render: (_, r) => r.synonyms?.join(', ') || '-' },
    {
      title: '状态', dataIndex: 'isActive', width: 80,
      render: (_, r) => (
        <Switch
          checked={r.isActive}
          size="small"
          onChange={(checked) => updateTagMut.mutate({ id: r.id, data: { isActive: checked } })}
        />
      ),
    },
    {
      title: '使用量', width: 80,
      render: (_, r) => (r._count?.productTags || 0) + (r._count?.companyTags || 0),
    },
    {
      title: '操作', width: 100,
      render: (_, record) => (
        <Space size="small">
          <a onClick={() => openTagModal(record)}><EditOutlined /></a>
          <Popconfirm title="确定删除此标签？" onConfirm={() => deleteTagMut.mutate(record.id)}>
            <a style={{ color: '#ff4d4f' }}><DeleteOutlined /></a>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <>
      <Row gutter={16}>
        {/* 左侧：标签类别 */}
        <Col span={10}>
          <Card
            title="标签类别"
            extra={<Button type="primary" icon={<PlusOutlined />} onClick={() => openCategoryModal()}>新增类别</Button>}
          >
            <ProTable<TagCategory>
              columns={categoryColumns}
              dataSource={categories}
              loading={categoriesLoading}
              rowKey="id"
              search={false}
              options={false}
              pagination={false}
              onRow={(record) => ({
                onClick: () => setSelectedCategory(record),
                style: { cursor: 'pointer', background: selectedCategory?.id === record.id ? '#e6f4ff' : undefined },
              })}
            />
          </Card>
        </Col>

        {/* 右侧：标签列表 */}
        <Col span={14}>
          <Card
            title={selectedCategory ? `${selectedCategory.name} — 标签列表` : '请选择一个类别'}
            extra={
              selectedCategory && (
                <Button type="primary" icon={<PlusOutlined />} onClick={() => openTagModal()}>
                  新增标签
                </Button>
              )
            }
          >
            {selectedCategory ? (
              <ProTable<TagItem>
                columns={tagColumns}
                dataSource={tags}
                loading={tagsLoading}
                rowKey="id"
                search={false}
                options={false}
                pagination={false}
              />
            ) : (
              <div style={{ textAlign: 'center', padding: 40, color: '#999' }}>点击左侧类别查看标签</div>
            )}
          </Card>
        </Col>
      </Row>

      {/* 类别弹窗 */}
      <Modal
        title={editingCategory ? '编辑类别' : '新增类别'}
        open={categoryModalOpen}
        onOk={handleCategorySubmit}
        onCancel={() => { setCategoryModalOpen(false); setEditingCategory(null); }}
        confirmLoading={createCategoryMut.isPending || updateCategoryMut.isPending}
      >
        <Form form={categoryForm} layout="vertical">
          <Form.Item name="name" label="类别名称" rules={[{ required: true, message: '请输入类别名称' }]}>
            <Input placeholder="如：企业徽章" />
          </Form.Item>
          {!editingCategory && (
            <Form.Item name="scope" label="适用范围" rules={[{ required: true, message: '请选择范围' }]}>
              <Select options={[{ value: 'COMPANY', label: '企业' }, { value: 'PRODUCT', label: '商品' }]} />
            </Form.Item>
          )}
          <Form.Item name="description" label="说明">
            <Input.TextArea rows={2} placeholder="可选" />
          </Form.Item>
        </Form>
      </Modal>

      {/* 标签弹窗 */}
      <Modal
        title={editingTag ? '编辑标签' : '新增标签'}
        open={tagModalOpen}
        onOk={handleTagSubmit}
        onCancel={() => { setTagModalOpen(false); setEditingTag(null); }}
        confirmLoading={createTagMut.isPending || updateTagMut.isPending}
      >
        <Form form={tagForm} layout="vertical">
          <Form.Item name="name" label="标签名称" rules={[{ required: true, message: '请输入标签名称' }]}>
            <Input placeholder="如：有机认证" />
          </Form.Item>
          <Form.Item name="synonyms" label="同义词（逗号分隔）">
            <Input placeholder="如：有机, 绿色有机" />
          </Form.Item>
          {editingTag && (
            <Form.Item name="isActive" label="启用" valuePropName="checked" initialValue={true}>
              <Switch />
            </Form.Item>
          )}
        </Form>
      </Modal>
    </>
  );
}
