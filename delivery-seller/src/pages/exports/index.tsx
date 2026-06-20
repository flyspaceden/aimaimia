import { useState } from 'react';
import { App, Button, Card, Form, Input, Space, Table, Tag, Typography } from 'antd';
import { DownloadOutlined, FileDoneOutlined, FileExcelOutlined, FilePdfOutlined } from '@ant-design/icons';
import { useQuery } from '@tanstack/react-query';
import { exportFinanceManifest, exportFulfillmentManifest, type DeliveryManifest } from '@/api/manifests';
import { getSettlements, type DeliverySettlement } from '@/api/settlements';
import { downloadDeliveryUploadWithAuth } from '@/utils/uploadDownload';
import dayjs from 'dayjs';

interface FulfillmentExportForm {
  subOrderId: string;
}

const API_BASE = import.meta.env.VITE_API_BASE_URL || '/api/v1';
const money = (value?: number) => (typeof value === 'number' ? `¥${(value / 100).toFixed(2)}` : '-');

async function openManifest(manifest: DeliveryManifest) {
  await downloadDeliveryUploadWithAuth(manifest.fileUrl, manifest.title || '配送清单', API_BASE);
}

export default function ExportCenterPage() {
  const { message } = App.useApp();
  const [financeExporting, setFinanceExporting] = useState(false);
  const [fulfillmentExporting, setFulfillmentExporting] = useState(false);
  const [lastManifest, setLastManifest] = useState<DeliveryManifest | null>(null);
  const [form] = Form.useForm<FulfillmentExportForm>();

  const { data: settlements, isLoading } = useQuery({
    queryKey: ['delivery-settlements'],
    queryFn: () => getSettlements({ page: 1, pageSize: 50 }),
  });

  const handleFinanceExport = async () => {
    setFinanceExporting(true);
    try {
      const manifest = await exportFinanceManifest();
      setLastManifest(manifest);
      await openManifest(manifest);
      message.success('财务导出已生成');
    } catch (err) {
      message.error(err instanceof Error ? err.message : '财务导出失败');
    } finally {
      setFinanceExporting(false);
    }
  };

  const handleFulfillmentExport = async (values: FulfillmentExportForm) => {
    setFulfillmentExporting(true);
    try {
      const manifest = await exportFulfillmentManifest(values.subOrderId.trim());
      setLastManifest(manifest);
      await openManifest(manifest);
      message.success('履约清单已生成');
    } catch (err) {
      message.error(err instanceof Error ? err.message : '履约清单生成失败');
    } finally {
      setFulfillmentExporting(false);
    }
  };

  return (
    <Space direction="vertical" size={16} style={{ display: 'flex' }}>
      <Card
        title={<Space><FileDoneOutlined />导出操作</Space>}
        styles={{ header: { borderTop: '3px solid #EA580C' } }}
      >
        <Space align="start" size={24} wrap>
          <Button
            type="primary"
            icon={<FileExcelOutlined />}
            loading={financeExporting}
            onClick={handleFinanceExport}
          >
            导出财务结算
          </Button>
          <Form<FulfillmentExportForm>
            form={form}
            layout="inline"
            onFinish={handleFulfillmentExport}
            style={{ rowGap: 8 }}
          >
            <Form.Item
              name="subOrderId"
              rules={[{ required: true, message: '请输入子订单号' }]}
            >
              <Input placeholder="子订单号" style={{ width: 260 }} />
            </Form.Item>
            <Button htmlType="submit" icon={<FilePdfOutlined />} loading={fulfillmentExporting}>
              导出履约清单
            </Button>
          </Form>
        </Space>
        {lastManifest ? (
          <div style={{ marginTop: 16 }}>
            <Typography.Text type="secondary">最近生成：</Typography.Text>
            <Button
              type="link"
              icon={<DownloadOutlined />}
              onClick={() => void openManifest(lastManifest)}
            >
              {lastManifest.title}
            </Button>
          </div>
        ) : null}
      </Card>

      <Card title="结算记录" styles={{ header: { borderTop: '3px solid #FFA940' } }}>
        <Table<DeliverySettlement>
          rowKey="id"
          loading={isLoading}
          dataSource={settlements?.items || []}
          pagination={{ pageSize: 20, showSizeChanger: true }}
          size="middle"
          columns={[
            { title: '结算月份', dataIndex: 'settlementMonth', width: 120 },
            {
              title: '订单',
              render: (_, row) => row.subOrder?.orderId || row.subOrderId || '-',
            },
            {
              title: '状态',
              dataIndex: 'status',
              width: 110,
              render: (value: DeliverySettlement['status']) => (
                <Tag color={value === 'SETTLED' ? 'green' : 'orange'}>
                  {value === 'SETTLED' ? '已结算' : '待结算'}
                </Tag>
              ),
            },
            {
              title: '供货金额',
              dataIndex: 'supplyAmountCents',
              width: 120,
              render: money,
            },
            {
              title: '应结金额',
              width: 120,
              render: (_, row) => money(row.expectedAmountCents ?? row.settledAmountCents),
            },
            {
              title: '结算时间',
              dataIndex: 'settledAt',
              width: 170,
              render: (value?: string | null) => value ? dayjs(value).format('YYYY-MM-DD HH:mm') : '-',
            },
          ]}
        />
      </Card>
    </Space>
  );
}
