import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { App as AntdApp, Button, Form, Input, Modal, Popconfirm, Space, Spin, Switch, Table, Tag, Tooltip } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { ApartmentOutlined, CaretDownOutlined, CaretRightOutlined, DeleteOutlined, HolderOutlined, PlusOutlined } from '@ant-design/icons';
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
import {
  batchSortDeliveryCategories,
  createDeliveryCategory,
  deleteDeliveryCategory,
  getDeliveryCategories,
  toggleDeliveryCategoryStatus,
  updateDeliveryCategory,
} from '@/api/delivery-management';
import type { DeliveryCategory } from '@/types/delivery-management';
import { PageHeader } from './components';
import { getErrorMessage } from './utils';

type DisplayRow = DeliveryCategory & { children?: undefined };

function buildDisplayRows(list: DeliveryCategory[], expanded: Set<string>): DisplayRow[] {
  const rows: DisplayRow[] = [];
  function addNodes(parentId: string | null) {
    const nodes = list
      .filter((category) => (parentId ? category.parentId === parentId : !category.parentId))
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

function DraggableRow(props: React.HTMLAttributes<HTMLTableRowElement> & { 'data-row-key'?: string }) {
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
      }}
      {...attributes}
    >
      {props.children}
    </tr>
  );
}

function DragHandle({ id }: { id: string }) {
  const { listeners, setActivatorNodeRef } = useSortable({ id });
  return (
    <HolderOutlined
      ref={setActivatorNodeRef}
      {...listeners}
      style={{ cursor: 'grab', color: '#8c8c8c', fontSize: 16 }}
    />
  );
}

export default function DeliveryCategoriesPage() {
  const { message, modal } = AntdApp.useApp();
  const [flatList, setFlatList] = useState<DeliveryCategory[]>([]);
  const [displayRows, setDisplayRows] = useState<DisplayRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [parentCategory, setParentCategory] = useState<DeliveryCategory | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState('');
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const draggingParentId = useRef<string | null | undefined>(undefined);
  const [form] = Form.useForm<{ name: string }>();

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
  );

  const refreshRows = useCallback((list: DeliveryCategory[], expanded: Set<string>) => {
    setFlatList(list);
    setDisplayRows(buildDisplayRows(list, expanded));
  }, []);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const list = await getDeliveryCategories();
      const hasChildren = new Set(list.filter((category) => category.parentId).map((category) => category.parentId!));
      setExpandedIds((prev) => {
        const next = prev.size > 0 ? prev : hasChildren;
        refreshRows(list, next);
        return next;
      });
    } catch (error) {
      message.error(getErrorMessage(error));
    } finally {
      setLoading(false);
    }
  }, [message, refreshRows]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const toggleExpand = useCallback((id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      setDisplayRows(buildDisplayRows(flatList, next));
      return next;
    });
  }, [flatList]);

  const openCreateModal = useCallback((parent?: DeliveryCategory) => {
    setParentCategory(parent || null);
    form.resetFields();
    setModalOpen(true);
  }, [form]);

  const startEditing = useCallback((category: DeliveryCategory) => {
    setEditingId(category.id);
    setEditingName(category.name);
  }, []);

  const cancelEditing = useCallback(() => {
    setEditingId(null);
  }, []);

  const saveEditing = useCallback(async () => {
    if (!editingId) return;
    const trimmed = editingName.trim();
    const original = flatList.find((category) => category.id === editingId);
    if (!trimmed || trimmed === original?.name) {
      setEditingId(null);
      return;
    }
    if (trimmed.length > 20) {
      message.warning('分类名称最多 20 个字符');
      return;
    }
    try {
      await updateDeliveryCategory(editingId, { name: trimmed });
      message.success('分类已更新');
      setEditingId(null);
      loadData();
    } catch (error) {
      message.error(getErrorMessage(error));
    }
  }, [editingId, editingName, flatList, loadData, message]);

  const handleSubmit = async () => {
    const values = await form.validateFields();
    setSubmitting(true);
    try {
      await createDeliveryCategory({
        name: values.name.trim(),
        ...(parentCategory ? { parentId: parentCategory.id } : {}),
      });
      message.success('分类已创建');
      setModalOpen(false);
      loadData();
    } catch (error) {
      message.error(getErrorMessage(error));
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await deleteDeliveryCategory(id);
      message.success('分类已删除');
      loadData();
    } catch (error) {
      modal.error({
        title: '无法删除分类',
        content: getErrorMessage(error),
        centered: true,
        okText: '知道了',
      });
    }
  };

  const handleToggleStatus = async (record: DeliveryCategory) => {
    try {
      const result = await toggleDeliveryCategoryStatus(record.id);
      message.success(result.status === 'ACTIVE' ? '已启用' : '已停用');
      loadData();
    } catch (error) {
      message.error(getErrorMessage(error));
    }
  };

  const handleDragStart = (event: DragStartEvent) => {
    const item = flatList.find((category) => category.id === event.active.id);
    draggingParentId.current = item?.parentId ?? null;
  };

  const handleDragEnd = async (event: DragEndEvent) => {
    draggingParentId.current = undefined;
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const activeItem = flatList.find((category) => category.id === active.id);
    const overItem = flatList.find((category) => category.id === over.id);
    if (!activeItem || !overItem || activeItem.parentId !== overItem.parentId) {
      return;
    }

    const siblings = flatList
      .filter((category) => category.parentId === activeItem.parentId)
      .sort((a, b) => a.sortOrder - b.sortOrder);
    const oldIndex = siblings.findIndex((category) => category.id === active.id);
    const newIndex = siblings.findIndex((category) => category.id === over.id);
    if (oldIndex === -1 || newIndex === -1 || oldIndex === newIndex) {
      return;
    }

    const reordered = [...siblings];
    const [moved] = reordered.splice(oldIndex, 1);
    reordered.splice(newIndex, 0, moved);
    const updates = reordered.map((item, index) => ({ id: item.id, sortOrder: index }));
    const nextFlatList = flatList.map((category) => {
      const update = updates.find((item) => item.id === category.id);
      return update ? { ...category, sortOrder: update.sortOrder } : category;
    });
    refreshRows(nextFlatList, expandedIds);

    try {
      await batchSortDeliveryCategories(updates);
    } catch (error) {
      message.error(getErrorMessage(error));
      loadData();
    }
  };

  const columns: ColumnsType<DisplayRow> = [
    {
      title: '',
      width: 44,
      align: 'center',
      render: (_, record) => <DragHandle id={record.id} />,
    },
    {
      title: '分类名称',
      dataIndex: 'name',
      width: 320,
      render: (_, record) => {
        const depth = Math.max(0, record.level - 1);
        const hasChildren = record._count.children > 0;
        const isExpanded = expandedIds.has(record.id);
        const isEditing = editingId === record.id;
        return (
          <span style={{
            color: record.status === 'ACTIVE' ? undefined : '#8c8c8c',
            fontWeight: depth === 0 ? 600 : 400,
            paddingLeft: depth * 28,
            display: 'inline-flex',
            alignItems: 'center',
          }}>
            {hasChildren ? (
              <span
                onClick={() => toggleExpand(record.id)}
                style={{ cursor: 'pointer', marginRight: 6, color: '#595959', fontSize: 12 }}
              >
                {isExpanded ? <CaretDownOutlined /> : <CaretRightOutlined />}
              </span>
            ) : (
              <span style={{ width: 18 }} />
            )}
            {depth > 0 ? <span style={{ color: '#d9d9d9', marginRight: 8 }}>└</span> : null}
            {isEditing ? (
              <Input
                size="small"
                autoFocus
                value={editingName}
                maxLength={20}
                style={{ width: 180 }}
                onChange={(event) => setEditingName(event.target.value)}
                onBlur={saveEditing}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') saveEditing();
                  if (event.key === 'Escape') cancelEditing();
                }}
              />
            ) : (
              <span onDoubleClick={() => startEditing(record)} style={{ cursor: 'text' }} title="双击编辑">
                {record.name}
              </span>
            )}
            {record.status !== 'ACTIVE' ? <Tag color="default" style={{ marginLeft: 8 }}>已停用</Tag> : null}
          </span>
        );
      },
    },
    {
      title: '分类路径',
      dataIndex: 'path',
      ellipsis: true,
      render: (value: string) => <span style={{ color: '#6b7280' }}>{value}</span>,
    },
    {
      title: '层级',
      width: 90,
      render: (_, record) => <Tag color={record.level === 1 ? 'blue' : 'default'}>{record.level}级</Tag>,
    },
    {
      title: '商品数',
      width: 90,
      render: (_, record) => record._count.products,
    },
    {
      title: '状态',
      width: 120,
      render: (_, record) => (
        <Switch
          checked={record.status === 'ACTIVE'}
          checkedChildren="启用"
          unCheckedChildren="停用"
          onChange={() => handleToggleStatus(record)}
        />
      ),
    },
    {
      title: '操作',
      key: 'action',
      width: 220,
      render: (_, record) => (
        <Space>
          <Button type="link" size="small" icon={<PlusOutlined />} onClick={() => openCreateModal(record)}>
            新增子分类
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
        </Space>
      ),
    },
  ];

  const flatIds = useMemo(() => displayRows.map((row) => row.id), [displayRows]);

  return (
    <div style={{ padding: 24 }}>
      <PageHeader
        title="商品分类管理"
        subtitle="维护配送中心商品发布和买家商品列表共用的配送分类。"
        extra={(
          <Button type="primary" icon={<PlusOutlined />} onClick={() => openCreateModal()}>
            新增顶级分类
          </Button>
        )}
      />

      <Space style={{ marginBottom: 12 }}>
        <ApartmentOutlined style={{ fontSize: 18, color: '#1677ff' }} />
        <Tag color="blue">拖拽同级排序</Tag>
        <Tag color="default">双击名称编辑</Tag>
      </Space>

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
              rowClassName={(record) => (
                record.level === 1 ? 'delivery-category-parent-row' : 'delivery-category-child-row'
              )}
            />
          </SortableContext>
        </DndContext>
      </Spin>

      <style>{`
        .delivery-category-parent-row td { background: #f7fbff !important; }
        .delivery-category-child-row td { background: #fff !important; }
        .delivery-category-parent-row:hover td,
        .delivery-category-child-row:hover td { background: #edf6ff !important; }
      `}</style>

      <Modal
        title={parentCategory ? `新增子分类（父级：${parentCategory.name}）` : '新增顶级分类'}
        open={modalOpen}
        onCancel={() => setModalOpen(false)}
        onOk={handleSubmit}
        confirmLoading={submitting}
        destroyOnHidden
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
            <Input placeholder="如：蔬菜、冻品、调味品" maxLength={20} showCount />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
