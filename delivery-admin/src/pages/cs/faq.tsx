import { useState, useRef } from 'react';
import {
  Table, Button, Modal, Form, Input, App, Tag, Space, Popconfirm,
  Switch, InputNumber, Select, Card, Typography, Alert,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import {
  PlusOutlined, DeleteOutlined, EditOutlined, SearchOutlined,
} from '@ant-design/icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  getCsFaqs, createCsFaq, updateCsFaq, deleteCsFaq, testCsFaq,
  type CsFaq,
} from '@/api/cs';

const { TextArea } = Input;
const { Text } = Typography;

export default function CsFaqPage() {
  const { message } = App.useApp();
  const queryClient = useQueryClient();
  const [modalOpen, setModalOpen] = useState(false);
  const [editingRecord, setEditingRecord] = useState<CsFaq | null>(null);
  const [form] = Form.useForm();
  const [submitting, setSubmitting] = useState(false);

  // 测试匹配相关
  const [testInput, setTestInput] = useState('');
  const [testResult, setTestResult] = useState<string | null>(null);
  const [testLoading, setTestLoading] = useState(false);

  // 关键词输入
  const [keywordInput, setKeywordInput] = useState('');
  const keywordRef = useRef<any>(null);

  const { data: faqs = [], isLoading } = useQuery({
    queryKey: ['admin', 'cs', 'faqs'],
    queryFn: getCsFaqs,
  });

  // 测试匹配
  const handleTest = async () => {
    if (!testInput.trim()) {
      message.warning('请输入测试消息');
      return;
    }
    setTestLoading(true);
    setTestResult(null);
    try {
      const result = await testCsFaq(testInput.trim());
      setTestResult(result?.answer || null);
    } catch (err) {
      message.error(err instanceof Error ? err.message : '测试失败');
    } finally {
      setTestLoading(false);
    }
  };

  // 打开新建弹窗
  const openCreateModal = () => {
    setEditingRecord(null);
    form.resetFields();
    setModalOpen(true);
  };

  // 打开编辑弹窗
  const openEditModal = (record: CsFaq) => {
    setEditingRecord(record);
    form.setFieldsValue({
      keywords: record.keywords,
      pattern: record.pattern,
      answer: record.answer,
      answerType: record.answerType,
      priority: record.priority,
    });
    setModalOpen(true);
  };

  // 提交表单
  const handleSubmit = async () => {
    const values = await form.validateFields();
    setSubmitting(true);
    try {
      if (editingRecord) {
        await updateCsFaq(editingRecord.id, values);
        message.success('FAQ已更新');
      } else {
        await createCsFaq(values);
        message.success('FAQ已创建');
      }
      setModalOpen(false);
      queryClient.invalidateQueries({ queryKey: ['admin', 'cs', 'faqs'] });
    } catch (err) {
      message.error(err instanceof Error ? err.message : '操作失败');
    } finally {
      setSubmitting(false);
    }
  };

  // 删除
  const handleDelete = async (id: string) => {
    try {
      await deleteCsFaq(id);
      message.success('FAQ已删除');
      queryClient.invalidateQueries({ queryKey: ['admin', 'cs', 'faqs'] });
    } catch (err) {
      message.error(err instanceof Error ? err.message : '删除失败');
    }
  };

  // 切换启用状态
  const handleToggleEnabled = async (record: CsFaq) => {
    try {
      await updateCsFaq(record.id, { enabled: !record.enabled });
      message.success(record.enabled ? '已停用' : '已启用');
      queryClient.invalidateQueries({ queryKey: ['admin', 'cs', 'faqs'] });
    } catch (err) {
      message.error(err instanceof Error ? err.message : '操作失败');
    }
  };

  // 关键词 Tag 输入处理
  const handleKeywordAdd = () => {
    const val = keywordInput.trim();
    if (!val) return;
    const current: string[] = form.getFieldValue('keywords') || [];
    if (current.includes(val)) {
      message.warning('关键词已存在');
      return;
    }
    form.setFieldsValue({ keywords: [...current, val] });
    setKeywordInput('');
    keywordRef.current?.focus();
  };

  const handleKeywordRemove = (keyword: string) => {
    const current: string[] = form.getFieldValue('keywords') || [];
    form.setFieldsValue({ keywords: current.filter((k) => k !== keyword) });
  };

  const columns: ColumnsType<CsFaq> = [
    {
      title: '关键词',
      dataIndex: 'keywords',
      width: 200,
      render: (keywords: string[]) => (
        <Space size={[4, 4]} wrap>
          {keywords.map((kw) => (
            <Tag key={kw} color="blue">{kw}</Tag>
          ))}
        </Space>
      ),
    },
    {
      title: '正则',
      dataIndex: 'pattern',
      width: 160,
      render: (pattern: string | null) =>
        pattern ? (
          <Text code style={{ fontSize: 12 }}>{pattern}</Text>
        ) : (
          <Text type="secondary">-</Text>
        ),
    },
    {
      title: '回复内容',
      dataIndex: 'answer',
      width: 250,
      ellipsis: true,
    },
    {
      title: '类型',
      dataIndex: 'answerType',
      width: 80,
      render: (type: string) => (
        <Tag color={type === 'RICH_CARD' ? 'purple' : 'default'}>{type}</Tag>
      ),
    },
    {
      title: '优先级',
      dataIndex: 'priority',
      width: 80,
      sorter: (a, b) => a.priority - b.priority,
    },
    {
      title: '启用',
      dataIndex: 'enabled',
      width: 80,
      render: (_: unknown, record: CsFaq) => (
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
      render: (_: unknown, record: CsFaq) => (
        <Space>
          <Button
            type="link"
            size="small"
            icon={<EditOutlined />}
            onClick={() => openEditModal(record)}
          >
            编辑
          </Button>
          <Popconfirm title="确认删除此FAQ？" onConfirm={() => handleDelete(record.id)}>
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
        <span style={{ fontSize: 16, fontWeight: 500 }}>FAQ管理</span>
        <Button type="primary" icon={<PlusOutlined />} onClick={openCreateModal}>
          新增FAQ
        </Button>
      </div>

      {/* 测试匹配区域 */}
      <Card size="small" style={{ marginBottom: 16 }} title="测试匹配">
        <Space.Compact style={{ width: '100%' }}>
          <Input
            placeholder="输入用户消息测试FAQ匹配..."
            value={testInput}
            onChange={(e) => setTestInput(e.target.value)}
            onPressEnter={handleTest}
            style={{ flex: 1 }}
          />
          <Button
            type="primary"
            icon={<SearchOutlined />}
            loading={testLoading}
            onClick={handleTest}
          >
            测试
          </Button>
        </Space.Compact>
        {testResult !== null && (
          <Alert
            style={{ marginTop: 8 }}
            type={testResult ? 'success' : 'warning'}
            message={testResult || '未匹配到任何FAQ'}
            showIcon
          />
        )}
      </Card>

      <Table<CsFaq>
        columns={columns}
        dataSource={faqs}
        rowKey="id"
        loading={isLoading}
        pagination={{ defaultPageSize: 20, showSizeChanger: true }}
        size="middle"
      />

      {/* 新建/编辑弹窗 */}
      <Modal
        title={editingRecord ? '编辑FAQ' : '新增FAQ'}
        open={modalOpen}
        onCancel={() => setModalOpen(false)}
        onOk={handleSubmit}
        confirmLoading={submitting}
        destroyOnClose
        width={600}
      >
        <Form form={form} layout="vertical" style={{ marginTop: 16 }}>
          <Form.Item
            name="keywords"
            label="关键词"
            rules={[
              {
                validator: (_, value) =>
                  value && value.length > 0
                    ? Promise.resolve()
                    : Promise.reject(new Error('请至少添加一个关键词')),
              },
            ]}
          >
            <div>
              <Form.Item noStyle shouldUpdate={(prev, cur) => prev.keywords !== cur.keywords}>
                {({ getFieldValue }) => {
                  const keywords: string[] = getFieldValue('keywords') || [];
                  return (
                    <Space size={[4, 8]} wrap style={{ marginBottom: keywords.length > 0 ? 8 : 0 }}>
                      {keywords.map((kw) => (
                        <Tag
                          key={kw}
                          closable
                          color="blue"
                          onClose={() => handleKeywordRemove(kw)}
                        >
                          {kw}
                        </Tag>
                      ))}
                    </Space>
                  );
                }}
              </Form.Item>
              <Space.Compact style={{ width: '100%' }}>
                <Input
                  ref={keywordRef}
                  placeholder="输入关键词后按回车添加"
                  value={keywordInput}
                  onChange={(e) => setKeywordInput(e.target.value)}
                  onPressEnter={(e) => {
                    e.preventDefault();
                    handleKeywordAdd();
                  }}
                />
                <Button onClick={handleKeywordAdd}>添加</Button>
              </Space.Compact>
            </div>
          </Form.Item>
          <Form.Item name="pattern" label="正则匹配（可选）">
            <Input placeholder="如：退[货款换]|退换货" />
          </Form.Item>
          <Form.Item
            name="answer"
            label="回复内容"
            rules={[{ required: true, message: '请输入回复内容' }]}
          >
            <TextArea rows={4} placeholder="FAQ回复内容" />
          </Form.Item>
          <Space size={16}>
            <Form.Item
              name="answerType"
              label="回复类型"
              initialValue="TEXT"
              rules={[{ required: true }]}
            >
              <Select
                style={{ width: 140 }}
                options={[
                  { label: '纯文本', value: 'TEXT' },
                  { label: '富文本卡片', value: 'RICH_CARD' },
                ]}
              />
            </Form.Item>
            <Form.Item
              name="priority"
              label="优先级"
              initialValue={0}
              rules={[{ required: true }]}
            >
              <InputNumber min={0} max={999} style={{ width: 100 }} />
            </Form.Item>
          </Space>
        </Form>
      </Modal>
    </div>
  );
}
