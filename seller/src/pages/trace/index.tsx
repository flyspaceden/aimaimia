import { useState } from 'react';
import { App, Card, Table, Button, Modal, Form, Input, Space, Popconfirm, Tag } from 'antd';
import { PlusOutlined, MinusCircleOutlined } from '@ant-design/icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  getTraceBatches,
  createTraceBatch,
  updateTraceBatch,
  deleteTraceBatch,
  type TraceBatch,
} from '@/api/trace';
import dayjs from 'dayjs';

// 常用溯源属性模板
const META_KEYS = [
  { key: 'origin', label: '产地' },
  { key: 'farmingMethod', label: '种植/养殖方式' },
  { key: 'feed', label: '饲料/肥料' },
  { key: 'inspection', label: '检验报告摘要' },
  { key: 'harvestDate', label: '采收日期' },
  { key: 'certification', label: '认证信息' },
];

export default function TracePage() {
  const { message } = App.useApp();
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const [editModal, setEditModal] = useState(false);
  const [editingBatch, setEditingBatch] = useState<TraceBatch | null>(null);
  const [form] = Form.useForm();

  const { data, isLoading } = useQuery({
    queryKey: ['seller-trace', page],
    queryFn: () => getTraceBatches({ page, pageSize: 20 }),
  });

  const handleOpen = (batch?: TraceBatch) => {
    if (batch) {
      setEditingBatch(batch);
      // 将 meta 对象转为键值对数组
      const metaPairs = batch.meta
        ? Object.entries(batch.meta).map(([key, value]) => ({ key, value }))
        : [];
      form.setFieldsValue({
        batchCode: batch.batchCode,
        metaPairs: metaPairs.length > 0 ? metaPairs : [{ key: '', value: '' }],
      });
    } else {
      setEditingBatch(null);
      form.setFieldsValue({
        batchCode: '',
        metaPairs: META_KEYS.slice(0, 4).map((m) => ({ key: m.key, value: '' })),
      });
    }
    setEditModal(true);
  };

  const handleSubmit = async (values: { batchCode: string; metaPairs: Array<{ key: string; value: string }> }) => {
    const meta = Object.fromEntries(
      (values.metaPairs || []).filter((p) => p.key && p.value).map((p) => [p.key, p.value]),
    );

    try {
      if (editingBatch) {
        await updateTraceBatch(editingBatch.id, { batchCode: values.batchCode, meta });
        message.success('批次已更新');
      } else {
        await createTraceBatch({ batchCode: values.batchCode, meta });
        message.success('批次已创建');
      }
      setEditModal(false);
      form.resetFields();
      queryClient.invalidateQueries({ queryKey: ['seller-trace'] });
    } catch (err) {
      message.error(err instanceof Error ? err.message : '操作失败');
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await deleteTraceBatch(id);
      message.success('已删除');
      queryClient.invalidateQueries({ queryKey: ['seller-trace'] });
    } catch (err) {
      message.error(err instanceof Error ? err.message : '删除失败');
    }
  };

  const columns = [
    {
      title: '批次编码',
      dataIndex: 'batchCode',
      render: (code: string) => <Tag>{code}</Tag>,
    },
    {
      title: '溯源属性',
      dataIndex: 'meta',
      render: (meta: Record<string, string> | null) => {
        if (!meta) return '-';
        const entries = Object.entries(meta).slice(0, 3);
        return entries.map(([k, v]) => `${k}: ${v}`).join(' | ') + (Object.keys(meta).length > 3 ? ' ...' : '');
      },
    },
    {
      title: '关联商品',
      render: (_: unknown, r: TraceBatch) => r._count?.productTraceLinks || 0,
      width: 100,
    },
    {
      title: '事件数',
      render: (_: unknown, r: TraceBatch) => r._count?.events || 0,
      width: 80,
    },
    {
      title: '创建时间',
      dataIndex: 'createdAt',
      width: 140,
      render: (v: string) => dayjs(v).format('YYYY-MM-DD HH:mm'),
    },
    {
      title: '操作',
      width: 140,
      render: (_: unknown, r: TraceBatch) => (
        <Space>
          <Button type="link" size="small" onClick={() => handleOpen(r)}>编辑</Button>
          <Popconfirm title="确认删除该批次？" onConfirm={() => handleDelete(r.id)}>
            <Button type="link" size="small" danger>删除</Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <Card
      title="溯源管理"
      extra={
        <Button type="primary" icon={<PlusOutlined />} onClick={() => handleOpen()}>
          新建批次
        </Button>
      }
    >
      <Table
        columns={columns}
        dataSource={data?.items || []}
        rowKey="id"
        loading={isLoading}
        pagination={{
          current: page,
          total: data?.total || 0,
          pageSize: 20,
          onChange: setPage,
        }}
      />

      <Modal
        title={editingBatch ? '编辑溯源批次' : '新建溯源批次'}
        open={editModal}
        onCancel={() => { setEditModal(false); form.resetFields(); }}
        onOk={() => form.submit()}
        width={640}
      >
        <Form form={form} onFinish={handleSubmit} layout="vertical">
          <Form.Item
            name="batchCode"
            label="批次编码"
            rules={[{ required: true, message: '请输入批次编码' }]}
          >
            <Input placeholder="如：NM-2026-001" />
          </Form.Item>

          <div style={{ marginBottom: 8, color: '#666' }}>
            溯源属性（AI 和买家可查看，请尽量填写详细）
          </div>

          <Form.List name="metaPairs">
            {(fields, { add, remove }) => (
              <>
                {fields.map((field) => (
                  <Space key={field.key} align="start" style={{ display: 'flex', marginBottom: 8 }}>
                    <Form.Item {...field} name={[field.name, 'key']} rules={[{ required: true, message: '属性名' }]}>
                      <Input placeholder="属性名" style={{ width: 160 }} />
                    </Form.Item>
                    <Form.Item {...field} name={[field.name, 'value']} rules={[{ required: true, message: '属性值' }]}>
                      <Input placeholder="属性值" style={{ width: 300 }} />
                    </Form.Item>
                    {fields.length > 1 && (
                      <MinusCircleOutlined style={{ marginTop: 8, color: '#999' }} onClick={() => remove(field.name)} />
                    )}
                  </Space>
                ))}
                <Button type="dashed" onClick={() => add()} icon={<PlusOutlined />}>
                  添加属性
                </Button>
              </>
            )}
          </Form.List>
        </Form>
      </Modal>
    </Card>
  );
}
