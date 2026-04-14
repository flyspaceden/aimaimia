import { useState, useEffect, useCallback, useRef } from 'react';
import { Button, message, Modal, Form, Input, Switch, Space, Tag, Popconfirm, Table, Spin, Tooltip, Select } from 'antd';
import { PlusOutlined, DeleteOutlined, ApartmentOutlined, HolderOutlined, CaretRightOutlined, CaretDownOutlined } from '@ant-design/icons';
import { returnPolicyMap } from '@/constants/statusMaps';
import type { ColumnsType } from 'antd/es/table';
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import { restrictToVerticalAxis } from '@dnd-kit/modifiers';
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import PermissionGate from '@/components/PermissionGate';
import { PERMISSIONS } from '@/constants/permissions';
import {
  getCategories,
  createCategory,
  deleteCategory,
  toggleCategoryActive,
  batchSortCategories,
  updateCategory,
  type AdminCategory,
} from '@/api/categories';

/** 显示用的扁平行（保留层级信息） */
type DisplayRow = AdminCategory & { children?: undefined };

/** 将扁平 API 数据按层级递归排成显示顺序（支持任意层级） */
function buildDisplayRows(list: AdminCategory[], expanded: Set<string>): DisplayRow[] {
  const rows: DisplayRow[] = [];
  function addNodes(parentId: string | null) {
    const nodes = list
      .filter((c) => (parentId ? c.parentId === parentId : !c.parentId))
      .sort((a, b) => a.sortOrder - b.sortOrder);
    for (const node of nodes) {
      rows.push(node);
      if (expanded.has(node.id)) {
        addNodes(node.id);
      }
    }
  }
  addNodes(null);
  return rows;
}

/** 沿父级链向上解析出实际生效的退货政策（跳过所有 INHERIT） */
function resolveEffectivePolicy(
  categoryId: string | null,
  list: AdminCategory[],
): 'RETURNABLE' | 'NON_RETURNABLE' {
  const byId = new Map(list.map((c) => [c.id, c]));
  let current = categoryId ? byId.get(categoryId) : undefined;
  while (current) {
    if (current.returnPolicy !== 'INHERIT') {
      return current.returnPolicy as 'RETURNABLE' | 'NON_RETURNABLE';
    }
    current = current.parentId ? byId.get(current.parentId) : undefined;
  }
  return 'RETURNABLE'; // 兜底
}

/** 可拖拽的表格行 */
function DraggableRow(props: React.HTMLAttributes<HTMLTableRowElement> & {
  'data-row-key'?: string;
  'data-dragging-parent-id'?: string | null;
  'data-row-parent-id'?: string | null;
}) {
  const id = props['data-row-key'] || '';
  const { attributes, setNodeRef, transform, transition, isDragging } = useSortable({ id });

  return (
    <tr
      {...props}
      ref={setNodeRef}
      style={{
        ...props.style,
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.5 : 1,
        cursor: 'default',
      }}
      {...attributes}
    >
      {props.children}
    </tr>
  );
}

/** 拖拽手柄 */
function DragHandle({ id }: { id: string }) {
  const { listeners, setActivatorNodeRef } = useSortable({ id });
  return (
    <HolderOutlined
      ref={setActivatorNodeRef}
      {...listeners}
      style={{ cursor: 'grab', color: '#999', fontSize: 16 }}
    />
  );
}

export default function CategoriesPage() {
  const [flatList, setFlatList] = useState<AdminCategory[]>([]);
  const [displayRows, setDisplayRows] = useState<DisplayRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [parentCategory, setParentCategory] = useState<AdminCategory | null>(null);
  const [form] = Form.useForm();
  const [submitting, setSubmitting] = useState(false);
  // 行内编辑
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState('');
  // 展开的一级分类 ID 集合
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  // 当前正在拖拽的分类的 parentId（用于限制同级拖拽）
  const draggingParentId = useRef<string | null | undefined>(undefined);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
  );

  // 加载数据
  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const list = await getCategories();
      setFlatList(list);
      // 首次加载默认展开所有有子分类的一级分类
      const hasChildren = new Set(list.filter((c) => c.parentId).map((c) => c.parentId!));
      setExpandedIds((prev) => prev.size > 0 ? prev : hasChildren);
      setDisplayRows(buildDisplayRows(list, expandedIds.size > 0 ? expandedIds : hasChildren));
    } catch (err) {
      message.error(err instanceof Error ? err.message : '加载分类失败');
    } finally {
      setLoading(false);
    }
  }, [expandedIds]);

  useEffect(() => { loadData(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // 展开/收起
  const toggleExpand = useCallback((id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      setDisplayRows(buildDisplayRows(flatList, next));
      return next;
    });
  }, [flatList]);

  const handleDragStart = (event: DragStartEvent) => {
    const item = flatList.find((c) => c.id === event.active.id);
    draggingParentId.current = item?.parentId ?? null;
  };

  // 拖拽结束
  const handleDragEnd = async (event: DragEndEvent) => {
    draggingParentId.current = undefined;
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const activeItem = flatList.find((c) => c.id === active.id);
    const overItem = flatList.find((c) => c.id === over.id);
    if (!activeItem || !overItem) return;

    // 严格同级限制
    if (activeItem.parentId !== overItem.parentId) return;

    // 获取同级兄弟节点
    const siblings = flatList
      .filter((c) => c.parentId === activeItem.parentId)
      .sort((a, b) => a.sortOrder - b.sortOrder);

    const oldIndex = siblings.findIndex((c) => c.id === active.id);
    const newIndex = siblings.findIndex((c) => c.id === over.id);
    if (oldIndex === -1 || newIndex === -1 || oldIndex === newIndex) return;

    // 重新排列
    const reordered = [...siblings];
    const [moved] = reordered.splice(oldIndex, 1);
    reordered.splice(newIndex, 0, moved);

    const updates = reordered.map((item, idx) => ({ id: item.id, sortOrder: idx }));

    // 乐观更新 UI
    const updatedFlatList = flatList.map((c) => {
      const update = updates.find((u) => u.id === c.id);
      return update ? { ...c, sortOrder: update.sortOrder } : c;
    });
    setFlatList(updatedFlatList);
    setDisplayRows(buildDisplayRows(updatedFlatList, expandedIds));

    try {
      await batchSortCategories(updates);
    } catch (err) {
      message.error(err instanceof Error ? err.message : '排序保存失败');
      loadData();
    }
  };

  // 弹窗操作
  const openCreateModal = useCallback((parent?: AdminCategory) => {
    setParentCategory(parent || null);
    form.resetFields();
    setModalOpen(true);
  }, [form]);

  // 行内编辑：双击进入
  const startEditing = useCallback((category: AdminCategory) => {
    setEditingId(category.id);
    setEditingName(category.name);
  }, []);

  // 行内编辑：保存
  const saveEditing = useCallback(async () => {
    if (!editingId) return;
    const trimmed = editingName.trim();
    const original = flatList.find((c) => c.id === editingId);
    if (!trimmed || trimmed === original?.name) {
      setEditingId(null);
      return;
    }
    if (trimmed.length > 20) {
      message.warning('分类名称最多 20 个字符');
      return;
    }
    try {
      await updateCategory(editingId, { name: trimmed });
      message.success('分类已更新');
      setEditingId(null);
      loadData();
    } catch (err) {
      message.error(err instanceof Error ? err.message : '更新失败');
    }
  }, [editingId, editingName, flatList, loadData]);

  // 行内编辑：取消
  const cancelEditing = useCallback(() => {
    setEditingId(null);
  }, []);

  const handleSubmit = async () => {
    const values = await form.validateFields();
    setSubmitting(true);
    try {
      const data: { name: string; parentId?: string; returnPolicy?: string } = { name: values.name };
      if (parentCategory) data.parentId = parentCategory.id;
      if (values.returnPolicy && values.returnPolicy !== 'INHERIT') data.returnPolicy = values.returnPolicy;
      await createCategory(data as any);
      message.success('分类已创建');
      setModalOpen(false);
      loadData();
    } catch (err) {
      message.error(err instanceof Error ? err.message : '操作失败');
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await deleteCategory(id);
      message.success('分类已删除');
      loadData();
    } catch (err) {
      message.error(err instanceof Error ? err.message : '删除失败');
    }
  };

  const handleToggleActive = async (record: AdminCategory) => {
    try {
      const result = await toggleCategoryActive(record.id);
      message.success(result.isActive ? '已启用' : '已停用');
      loadData();
    } catch (err) {
      message.error(err instanceof Error ? err.message : '操作失败');
    }
  };

  const columns: ColumnsType<DisplayRow> = [
    {
      title: '',
      width: 40,
      align: 'center',
      render: (_, record) => <DragHandle id={record.id} />,
    },
    {
      title: '分类名称',
      dataIndex: 'name',
      width: 300,
      render: (_, record) => {
        const depth = record.level - 1; // level=1 根节点, depth=0
        const hasChildren = record._count.children > 0;
        const isExpanded = expandedIds.has(record.id);
        const isEditing = editingId === record.id;
        return (
          <span style={{
            color: record.isActive ? undefined : '#999',
            fontWeight: depth === 0 ? 600 : 400,
            fontSize: depth === 0 ? 14 : 13,
            paddingLeft: depth * 28,
            display: 'inline-flex',
            alignItems: 'center',
          }}>
            {hasChildren ? (
              <span
                onClick={() => toggleExpand(record.id)}
                style={{ cursor: 'pointer', marginRight: 6, color: '#666', fontSize: 12 }}
              >
                {isExpanded ? <CaretDownOutlined /> : <CaretRightOutlined />}
              </span>
            ) : (
              <span style={{ width: 18 }} />
            )}
            {depth > 0 && <span style={{ color: '#d9d9d9', marginRight: 8 }}>└</span>}
            {isEditing ? (
              <Input
                size="small"
                autoFocus
                value={editingName}
                maxLength={20}
                style={{ width: 160 }}
                onChange={(e) => setEditingName(e.target.value)}
                onBlur={saveEditing}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') saveEditing();
                  if (e.key === 'Escape') cancelEditing();
                }}
              />
            ) : (
              <span
                onDoubleClick={() => startEditing(record)}
                style={{ cursor: 'text' }}
                title="双击编辑"
              >
                {record.name}
              </span>
            )}
            {!record.isActive && <Tag color="default" style={{ marginLeft: 8 }}>已停用</Tag>}
          </span>
        );
      },
    },
    {
      title: '层级',
      width: 80,
      render: (_, record) => (
        <Tag color={record.level === 1 ? 'blue' : 'default'}>
          {record.level}级
        </Tag>
      ),
    },
    {
      title: '商品数',
      width: 80,
      render: (_, record) => record._count.products,
    },
    {
      title: '退货政策',
      width: 140,
      render: (_, record) => {
        const parentEffective = resolveEffectivePolicy(record.parentId, flatList);
        const parentLabel = returnPolicyMap[parentEffective]?.text || parentEffective;
        const isInherit = record.returnPolicy === 'INHERIT';
        const entry = returnPolicyMap[record.returnPolicy];

        return (
          <PermissionGate
            permission={PERMISSIONS.CATEGORIES_MANAGE}
            fallback={
              <Tag color={isInherit ? (returnPolicyMap[parentEffective]?.color || 'default') : (entry?.color || 'default')}>
                {isInherit ? parentLabel : entry?.text}
              </Tag>
            }
          >
            <div>
              <Select
                size="small"
                value={record.returnPolicy}
                style={{ width: 130 }}
                onChange={async (val) => {
                  try {
                    await updateCategory(record.id, { returnPolicy: val });
                    message.success('退货政策已更新');
                    loadData();
                  } catch (err) {
                    message.error(err instanceof Error ? err.message : '更新失败');
                  }
                }}
                options={[
                  { label: '7天无理由退换', value: 'RETURNABLE' },
                  { label: '仅质量问题可退', value: 'NON_RETURNABLE' },
                  { label: '同上级', value: 'INHERIT' },
                ]}
              />
              {isInherit && (
                <div style={{ fontSize: 11, color: '#999', marginTop: 2 }}>
                  即：{parentLabel}
                </div>
              )}
            </div>
          </PermissionGate>
        );
      },
    },
    {
      title: '状态',
      width: 100,
      render: (_, record) => (
        <PermissionGate permission={PERMISSIONS.CATEGORIES_MANAGE} fallback={
          <Tag color={record.isActive ? 'green' : 'default'}>{record.isActive ? '启用' : '停用'}</Tag>
        }>
          <Switch
            checked={record.isActive}
            checkedChildren="启用"
            unCheckedChildren="停用"
            onChange={() => handleToggleActive(record)}
          />
        </PermissionGate>
      ),
    },
    {
      title: '操作',
      key: 'action',
      width: 220,
      render: (_, record) => (
        <Space>
          <PermissionGate permission={PERMISSIONS.CATEGORIES_MANAGE}>
            <Button type="link" size="small" icon={<PlusOutlined />} onClick={() => openCreateModal(record)}>
              添加子分类
            </Button>
            {record._count.children > 0 || record._count.products > 0 ? (
              <Tooltip
                title={
                  record._count.children > 0
                    ? `该分类下有 ${record._count.children} 个子分类，请先删除子分类`
                    : `该分类下有 ${record._count.products} 个商品，无法删除`
                }
              >
                <span>
                  <Button type="link" size="small" danger icon={<DeleteOutlined />} disabled>
                    删除
                  </Button>
                </span>
              </Tooltip>
            ) : (
              <Popconfirm title="确认删除此分类？" onConfirm={() => handleDelete(record.id)}>
                <Button type="link" size="small" danger icon={<DeleteOutlined />}>
                  删除
                </Button>
              </Popconfirm>
            )}
          </PermissionGate>
        </Space>
      ),
    },
  ];

  const flatIds = displayRows.map((r) => r.id);

  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <Space>
          <ApartmentOutlined style={{ fontSize: 18 }} />
          <span style={{ fontSize: 16, fontWeight: 500 }}>商品分类管理</span>
          <Tag color="blue">拖拽同级排序</Tag>
        </Space>
        <PermissionGate permission={PERMISSIONS.CATEGORIES_MANAGE}>
          <Button type="primary" icon={<PlusOutlined />} onClick={() => openCreateModal()}>
            新增顶级分类
          </Button>
        </PermissionGate>
      </div>

      <Spin spinning={loading}>
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          modifiers={[restrictToVerticalAxis]}
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
        >
          <SortableContext items={flatIds} strategy={verticalListSortingStrategy}>
            <Table<DisplayRow>
              columns={columns}
              dataSource={displayRows}
              rowKey="id"
              pagination={false}
              components={{ body: { row: DraggableRow } }}
              size="middle"
              rowClassName={(record) =>
                record.level === 1 ? 'category-row-parent' : 'category-row-child'
              }
            />
          </SortableContext>
        </DndContext>
      </Spin>

      {/* 一级/二级行样式区分 */}
      <style>{`
        .category-row-parent td { background: #fafafa !important; }
        .category-row-child td { background: #fff !important; }
        .category-row-parent:hover td,
        .category-row-child:hover td { background: #f0f5ff !important; }
      `}</style>

      <Modal
        title={parentCategory ? `新增子分类（父级：${parentCategory.name}）` : '新增顶级分类'}
        open={modalOpen}
        onCancel={() => setModalOpen(false)}
        onOk={handleSubmit}
        confirmLoading={submitting}
        destroyOnClose
      >
        <Form form={form} layout="vertical" style={{ marginTop: 16 }}>
          <Form.Item
            name="name"
            label="分类名称"
            rules={[
              { required: true, message: '请输入分类名称' },
              { max: 20, message: '最多 20 个字符' },
            ]}
          >
            <Input placeholder="如：水果、茶叶" maxLength={20} showCount />
          </Form.Item>
          <Form.Item
            name="returnPolicy"
            label="退货政策"
            initialValue="INHERIT"
          >
            <Select
              options={[
                { label: '继承上级', value: 'INHERIT' },
                { label: '7天无理由退换', value: 'RETURNABLE' },
                { label: '仅质量问题可退（如生鲜）', value: 'NON_RETURNABLE' },
              ]}
            />
          </Form.Item>
        </Form>
      </Modal>
    </>
  );
}
