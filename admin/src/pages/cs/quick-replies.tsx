import { useState } from 'react';
import {
  Table, Button, Modal, Form, Input, message, Tag, Space, Popconfirm,
  Switch, InputNumber, Select,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { PlusOutlined, DeleteOutlined, EditOutlined } from '@ant-design/icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  getCsQuickReplies, createCsQuickReply, updateCsQuickReply, deleteCsQuickReply,
  type CsQuickReply,
} from '@/api/cs';

const { TextArea } = Input;

// 分类颜色映射
const categoryColorMap: Record<string, string> = {
  greeting: 'green',
  order: 'blue',
  refund: 'red',
  delivery: 'orange',
  product: 'cyan',
  closing: 'purple',
};

export default function CsQuickRepliesPage() {
  const queryClient = useQueryClient();
  const [modalOpen, setModalOpen] = useState(false);
  const [editingRecord, setEditingRecord] = useState<CsQuickReply | null>(null);
  const [form] = Form.useForm();
  const [submitting, setSubmitting] = useState(false);

  const { data: replies = [], isLoading } = useQuery({
    queryKey: ['admin', 'cs', 'quick-replies'],
    queryFn: getCsQuickReplies,
  });

  // 提取已有分类用于下拉
  const existingCategories = [...new Set(replies.map((r) => r.category))].filter(Boolean);

  // 打开新建弹窗
  const openCreateModal = () => {
    setEditingRecord(null);
    form.resetFields();
    setModalOpen(true);
  };

  // 打开编辑弹窗
  const openEditModal = (record: CsQuickReply) => {
    setEditingRecord(record);
    form.setFieldsValue({
      category: record.category,
      title: record.title,
      content: record.content,
      sortOrder: record.sortOrder,
    });
    setModalOpen(true);
  };

  // 提交表单
  const handleSubmit = async () => {
    const values = await form.validateFields();
    setSubmitting(true);
    try {
      if (editingRecord) {
        await updateCsQuickReply(editingRecord.id, values);
        message.success('快捷回复已更新');
      } else {
        await createCsQuickReply(values);
        message.success('快捷回复已创建');
      }
      setModalOpen(false);
      queryClient.invalidateQueries({ queryKey: ['admin', 'cs', 'quick-replies'] });
    } catch (err) {
      message.error(err instanceof Error ? err.message : '操作失败');
    } finally {
      setSubmitting(false);
    }
  };

  // 删除
  const handleDelete = async (id: string) => {
    try {
      await deleteCsQuickReply(id);
      message.success('快捷回复已删除');
      queryClient.invalidateQueries({ queryKey: ['admin', 'cs', 'quick-replies'] });
    } catch (err) {
      message.error(err instanceof Error ? err.message : '删除失败');
    }
  };

  // 切换启用
  const handleToggleEnabled = async (record: CsQuickReply) => {
    try {
      await updateCsQuickReply(record.id, { enabled: !record.enabled });
      message.success(record.enabled ? '已停用' : '已启用');
      queryClient.invalidateQueries({ queryKey: ['admin', 'cs', 'quick-replies'] });
    } catch (err) {
      message.error(err instanceof Error ? err.message : '操作失败');
    }
  };

  const columns: ColumnsType<CsQuickReply> = [
    {
      title: '分类',
      dataIndex: 'category',
      width: 100,
      filters: existingCategories.map((c) => ({ text: c, value: c })),
      onFilter: (value, record) => record.category === value,
      render: (category: string) => (
        <Tag color={categoryColorMap[category] || 'default'}>{category}</Tag>
      ),
    },
    {
      title: '标题',
      dataIndex: 'title',
      width: 180,
    },
    {
      title: '内容',
      dataIndex: 'content',
      width: 300,
      ellipsis: true,
    },
    {
      title: '排序',
      dataIndex: 'sortOrder',
      width: 70,
      sorter: (a, b) => a.sortOrder - b.sortOrder,
      defaultSortOrder: 'ascend',
    },
    {
      title: '启用',
      dataIndex: 'enabled',
      width: 80,
      render: (_: unknown, record: CsQuickReply) => (
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
      render: (_: unknown, record: CsQuickReply) => (
        <Space>
          <Button
            type="link"
            size="small"
            icon={<EditOutlined />}
            onClick={() => openEditModal(record)}
          >
            编辑
          </Button>
          <Popconfirm title="确认删除此快捷回复？" onConfirm={() => handleDelete(record.id)}>
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
        <span style={{ fontSize: 16, fontWeight: 500 }}>客服快捷回复</span>
        <Button type="primary" icon={<PlusOutlined />} onClick={openCreateModal}>
          新增快捷回复
        </Button>
      </div>

      <Table<CsQuickReply>
        columns={columns}
        dataSource={replies}
        rowKey="id"
        loading={isLoading}
        pagination={{ defaultPageSize: 20, showSizeChanger: true }}
        size="middle"
      />

      {/* 新建/编辑弹窗 */}
      <Modal
        title={editingRecord ? '编辑快捷回复' : '新增快捷回复'}
        open={modalOpen}
        onCancel={() => setModalOpen(false)}
        onOk={handleSubmit}
        confirmLoading={submitting}
        destroyOnClose
        width={560}
      >
        <Form form={form} layout="vertical" style={{ marginTop: 16 }}>
          <Form.Item
            name="category"
            label="分类"
            rules={[{ required: true, message: '请输入或选择分类' }]}
          >
            <Select
              placeholder="选择已有分类或输入新分类"
              allowClear
              showSearch
              options={existingCategories.map((c) => ({ label: c, value: c }))}
              // 允许输入自定义分类
              mode={undefined}
              dropdownRender={(menu) => menu}
              // 如果搜索值不在选项中，也允许选择
              filterOption={(input, option) =>
                (option?.label as string)?.toLowerCase().includes(input.toLowerCase())
              }
            />
          </Form.Item>
          <Form.Item
            name="title"
            label="标题"
            rules={[{ required: true, message: '请输入标题' }]}
          >
            <Input placeholder="快捷回复标题" maxLength={50} showCount />
          </Form.Item>
          <Form.Item
            name="content"
            label="回复内容"
            rules={[{ required: true, message: '请输入回复内容' }]}
          >
            <TextArea rows={4} placeholder="快捷回复内容" />
          </Form.Item>
          <Form.Item
            name="sortOrder"
            label="排序"
            initialValue={0}
          >
            <InputNumber min={0} max={999} style={{ width: 120 }} />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
