import { useState } from 'react';
import {
  Table, Button, Modal, Form, Input, App, Tag, Space, Popconfirm,
  Switch, Tabs, Typography,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import {
  PlusOutlined, DeleteOutlined, EditOutlined, HolderOutlined,
} from '@ant-design/icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import { restrictToVerticalAxis } from '@dnd-kit/modifiers';
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
  arrayMove,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
  getCsQuickEntries, createCsQuickEntry, updateCsQuickEntry,
  deleteCsQuickEntry, sortCsQuickEntries,
  type CsQuickEntry,
} from '@/api/cs';

const { Text } = Typography;

type EntryType = 'QUICK_ACTION' | 'HOT_QUESTION';

// 可拖拽行
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
        cursor: 'default',
      }}
      {...attributes}
    >
      {props.children}
    </tr>
  );
}

// 拖拽手柄
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

export default function CsQuickEntriesPage() {
  const { message, modal } = App.useApp();
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState<EntryType>('QUICK_ACTION');
  const [modalOpen, setModalOpen] = useState(false);
  const [editingRecord, setEditingRecord] = useState<CsQuickEntry | null>(null);
  const [form] = Form.useForm();
  const [submitting, setSubmitting] = useState(false);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
  );

  const { data: allEntries = [], isLoading } = useQuery({
    queryKey: ['admin', 'cs', 'quick-entries'],
    queryFn: getCsQuickEntries,
  });

  // 按类型过滤并排序
  const filteredEntries = allEntries
    .filter((e) => e.type === activeTab)
    .sort((a, b) => a.sortOrder - b.sortOrder);

  // 拖拽结束
  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const oldIndex = filteredEntries.findIndex((e) => e.id === active.id);
    const newIndex = filteredEntries.findIndex((e) => e.id === over.id);
    if (oldIndex === -1 || newIndex === -1) return;

    const reordered = arrayMove(filteredEntries, oldIndex, newIndex);
    const sortItems = reordered.map((item, idx) => ({ id: item.id, sortOrder: idx }));

    // 乐观更新
    queryClient.setQueryData<CsQuickEntry[]>(['admin', 'cs', 'quick-entries'], (prev) => {
      if (!prev) return prev;
      return prev.map((entry) => {
        const update = sortItems.find((s) => s.id === entry.id);
        return update ? { ...entry, sortOrder: update.sortOrder } : entry;
      });
    });

    try {
      await sortCsQuickEntries(sortItems);
    } catch (err) {
      message.error(err instanceof Error ? err.message : '排序保存失败');
      queryClient.invalidateQueries({ queryKey: ['admin', 'cs', 'quick-entries'] });
    }
  };

  // 打开新建弹窗
  const openCreateModal = () => {
    setEditingRecord(null);
    form.resetFields();
    form.setFieldsValue({ type: activeTab });
    setModalOpen(true);
  };

  // 打开编辑弹窗
  const openEditModal = (record: CsQuickEntry) => {
    setEditingRecord(record);
    form.setFieldsValue({
      type: record.type,
      label: record.label,
      action: record.action,
      message: record.message,
      icon: record.icon,
    });
    setModalOpen(true);
  };

  // 提交表单
  const handleSubmit = async () => {
    const values = await form.validateFields();
    setSubmitting(true);
    try {
      if (editingRecord) {
        await updateCsQuickEntry(editingRecord.id, values);
        message.success('快捷入口已更新');
      } else {
        await createCsQuickEntry({ ...values, sortOrder: filteredEntries.length });
        message.success('快捷入口已创建');
      }
      setModalOpen(false);
      queryClient.invalidateQueries({ queryKey: ['admin', 'cs', 'quick-entries'] });
    } catch (err) {
      message.error(err instanceof Error ? err.message : '操作失败');
    } finally {
      setSubmitting(false);
    }
  };

  // 删除
  const handleDelete = async (id: string) => {
    try {
      await deleteCsQuickEntry(id);
      message.success('已删除');
      queryClient.invalidateQueries({ queryKey: ['admin', 'cs', 'quick-entries'] });
    } catch (err) {
      modal.error({
        title: '无法删除',
        content: (
          <div style={{ fontSize: 16, lineHeight: 1.7, paddingTop: 8 }}>
            {err instanceof Error ? err.message : '删除失败'}
          </div>
        ),
        width: 520,
        centered: true,
        okText: '知道了',
      });
    }
  };

  // 切换启用
  const handleToggleEnabled = async (record: CsQuickEntry) => {
    try {
      await updateCsQuickEntry(record.id, { enabled: !record.enabled });
      message.success(record.enabled ? '已停用' : '已启用');
      queryClient.invalidateQueries({ queryKey: ['admin', 'cs', 'quick-entries'] });
    } catch (err) {
      message.error(err instanceof Error ? err.message : '操作失败');
    }
  };

  const columns: ColumnsType<CsQuickEntry> = [
    {
      title: '',
      width: 40,
      align: 'center',
      render: (_: unknown, record: CsQuickEntry) => <DragHandle id={record.id} />,
    },
    {
      title: '标签',
      dataIndex: 'label',
      width: 160,
      render: (label: string) => <Text strong>{label}</Text>,
    },
    {
      title: activeTab === 'QUICK_ACTION' ? '动作' : '消息',
      width: 250,
      ellipsis: true,
      render: (_: unknown, record: CsQuickEntry) =>
        activeTab === 'QUICK_ACTION'
          ? record.action || <Text type="secondary">-</Text>
          : record.message || <Text type="secondary">-</Text>,
    },
    {
      title: '图标',
      dataIndex: 'icon',
      width: 80,
      align: 'center',
      render: (icon: string | null) =>
        icon ? <span style={{ fontSize: 20 }}>{icon}</span> : <Text type="secondary">-</Text>,
    },
    {
      title: '启用',
      dataIndex: 'enabled',
      width: 80,
      render: (_: unknown, record: CsQuickEntry) => (
        <Switch
          checked={record.enabled}
          checkedChildren="开"
          unCheckedChildren="关"
          onChange={() => handleToggleEnabled(record)}
        />
      ),
    },
    {
      title: '操作',
      key: 'action',
      width: 120,
      render: (_: unknown, record: CsQuickEntry) => (
        <Space>
          <Button
            type="link"
            size="small"
            icon={<EditOutlined />}
            onClick={() => openEditModal(record)}
          >
            编辑
          </Button>
          <Popconfirm title="确认删除？" onConfirm={() => handleDelete(record.id)}>
            <Button type="link" size="small" danger icon={<DeleteOutlined />}>
              删除
            </Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <div style={{ padding: 24 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <Space>
          <span style={{ fontSize: 16, fontWeight: 500 }}>快捷入口配置</span>
          <Tag color="blue">拖拽排序</Tag>
        </Space>
        <Button type="primary" icon={<PlusOutlined />} onClick={openCreateModal}>
          新增入口
        </Button>
      </div>

      <Tabs
        activeKey={activeTab}
        onChange={(key) => setActiveTab(key as EntryType)}
        items={[
          { key: 'QUICK_ACTION', label: '快捷操作' },
          { key: 'HOT_QUESTION', label: '热门问题' },
        ]}
        style={{ marginBottom: 16 }}
      />

      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        modifiers={[restrictToVerticalAxis]}
        onDragEnd={handleDragEnd}
      >
        <SortableContext
          items={filteredEntries.map((e) => e.id)}
          strategy={verticalListSortingStrategy}
        >
          <Table<CsQuickEntry>
            columns={columns}
            dataSource={filteredEntries}
            rowKey="id"
            loading={isLoading}
            pagination={false}
            components={{ body: { row: DraggableRow } }}
            size="middle"
          />
        </SortableContext>
      </DndContext>

      {/* 新建/编辑弹窗 */}
      <Modal
        title={editingRecord ? '编辑快捷入口' : '新增快捷入口'}
        open={modalOpen}
        onCancel={() => setModalOpen(false)}
        onOk={handleSubmit}
        confirmLoading={submitting}
        destroyOnClose
      >
        <Form form={form} layout="vertical" style={{ marginTop: 16 }}>
          <Form.Item name="type" hidden>
            <Input />
          </Form.Item>
          <Form.Item
            name="label"
            label="标签名称"
            rules={[{ required: true, message: '请输入标签名称' }]}
          >
            <Input placeholder="如：查快递、退换货" maxLength={20} showCount />
          </Form.Item>
          {activeTab === 'QUICK_ACTION' ? (
            <Form.Item name="action" label="动作标识">
              <Input placeholder="如：CHECK_ORDER, TRACK_DELIVERY" />
            </Form.Item>
          ) : (
            <Form.Item name="message" label="消息内容">
              <Input.TextArea rows={3} placeholder="用户点击后发送的消息" />
            </Form.Item>
          )}
          <Form.Item name="icon" label="图标（Emoji）">
            <Input placeholder="如：📦" maxLength={2} style={{ width: 80, fontSize: 18, textAlign: 'center' }} />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
