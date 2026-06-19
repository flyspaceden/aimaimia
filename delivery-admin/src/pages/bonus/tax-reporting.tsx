import { useEffect, useMemo, useRef, useState } from 'react';
import { Button, Card, DatePicker, Descriptions, App } from 'antd';
import { DownloadOutlined, FileDoneOutlined } from '@ant-design/icons';
import { ProTable } from '@ant-design/pro-components';
import type { ActionType, ProColumns } from '@ant-design/pro-components';
import dayjs, { type Dayjs } from 'dayjs';
import {
  getTaxReportDetail,
  getTaxReportSummary,
  generateTaxVoucher,
  type TaxReportDetailRow,
  type TaxReportSummary,
} from '@/api/bonus';
import PermissionGate from '@/components/PermissionGate';
import { PERMISSIONS } from '@/constants/permissions';

function formatMoney(value: number | null | undefined): string {
  return `¥${(value ?? 0).toFixed(2)}`;
}

function csvCell(value: unknown): string {
  return `"${String(value ?? '').replace(/"/g, '""')}"`;
}

export default function TaxReportingPage() {
  const { message } = App.useApp();
  const actionRef = useRef<ActionType>(null);
  const [monthValue, setMonthValue] = useState<Dayjs>(dayjs().startOf('month'));
  const [summary, setSummary] = useState<TaxReportSummary | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(false);

  const year = monthValue.year();
  const month = monthValue.month() + 1;

  const columns = useMemo<ProColumns<TaxReportDetailRow>[]>(() => [
    {
      title: '提现单号',
      dataIndex: 'id',
      width: 180,
      ellipsis: true,
      search: false,
    },
    {
      title: '用户 ID',
      dataIndex: 'userId',
      width: 180,
      ellipsis: true,
      search: false,
    },
    {
      title: '提现总额',
      dataIndex: 'amount',
      width: 110,
      search: false,
      render: (_, record) => formatMoney(record.amount),
    },
    {
      title: '代扣个税',
      dataIndex: 'taxAmount',
      width: 110,
      search: false,
      render: (_, record) => formatMoney(record.taxAmount),
    },
    {
      title: '实际到账',
      dataIndex: 'netAmount',
      width: 110,
      search: false,
      render: (_, record) => formatMoney(record.netAmount),
    },
    {
      title: '税率',
      dataIndex: 'taxRate',
      width: 90,
      search: false,
      render: (_, record) => `${((record.taxRate ?? 0) * 100).toFixed(0)}%`,
    },
    {
      title: '到账时间',
      dataIndex: 'paidAt',
      width: 160,
      search: false,
      render: (_, record) => record.paidAt ? dayjs(record.paidAt).format('YYYY-MM-DD HH:mm') : '-',
    },
    {
      title: '支付宝单号',
      dataIndex: 'providerPayoutId',
      width: 180,
      ellipsis: true,
      search: false,
    },
    {
      title: '资金流水号',
      dataIndex: 'providerFundOrderId',
      width: 180,
      ellipsis: true,
      search: false,
    },
  ], []);

  useEffect(() => {
    setSummaryLoading(true);
    getTaxReportSummary(year, month)
      .then(setSummary)
      .finally(() => setSummaryLoading(false));
    actionRef.current?.reload();
  }, [year, month]);

  const exportCsv = async () => {
    const rows = await getTaxReportDetail(year, month);
    const headers: Array<keyof TaxReportDetailRow> = [
      'id',
      'userId',
      'amount',
      'taxAmount',
      'netAmount',
      'taxRate',
      'paidAt',
      'providerPayoutId',
      'providerFundOrderId',
    ];
    const csv = [
      headers.join(','),
      ...rows.map((row) => headers.map((field) => csvCell(row[field])).join(',')),
    ].join('\n');
    const blob = new Blob([`\ufeff${csv}`], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `tax-report-${year}-${String(month).padStart(2, '0')}.csv`;
    link.click();
    URL.revokeObjectURL(url);
    message.success('已导出');
  };

  const downloadText = (content: string, fileName: string, mimeType: string) => {
    const blob = new Blob([`\ufeff${content}`], { type: mimeType || 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = fileName;
    link.click();
    URL.revokeObjectURL(url);
  };

  const createVoucher = async () => {
    const voucher = await generateTaxVoucher(year, month);
    downloadText(voucher.content, voucher.fileName, voucher.mimeType);
    message.success('代扣凭证已生成');
  };

  return (
    <PermissionGate permission={PERMISSIONS.BONUS_APPROVE_WITHDRAW}>
      <div style={{ padding: 24 }}>
        <Card
          title="个税代扣月度汇总"
          loading={summaryLoading && !summary}
          extra={
            <DatePicker
              picker="month"
              value={monthValue}
              onChange={(value) => {
                if (value) setMonthValue(value.startOf('month'));
              }}
            />
          }
        >
          {summary && (
            <Descriptions bordered size="small" column={{ xs: 1, sm: 2, lg: 4 }}>
              <Descriptions.Item label="本月提现笔数">{summary.count}</Descriptions.Item>
              <Descriptions.Item label="提现总额">{formatMoney(summary.grossTotal)}</Descriptions.Item>
              <Descriptions.Item label="代扣总额">{formatMoney(summary.taxTotal)}</Descriptions.Item>
              <Descriptions.Item label="实际到账">{formatMoney(summary.netTotal)}</Descriptions.Item>
            </Descriptions>
          )}
        </Card>

        <ProTable<TaxReportDetailRow>
          style={{ marginTop: 16 }}
          headerTitle="报送明细"
          actionRef={actionRef}
          rowKey="id"
          columns={columns}
          search={false}
          pagination={{ defaultPageSize: 20 }}
          scroll={{ x: 1300 }}
          toolBarRender={() => [
            <Button key="voucher" icon={<FileDoneOutlined />} onClick={createVoucher}>
              生成代扣凭证
            </Button>,
            <Button key="export" type="primary" icon={<DownloadOutlined />} onClick={exportCsv}>
              导出 CSV
            </Button>,
          ]}
          request={async () => {
            const rows = await getTaxReportDetail(year, month);
            return { data: rows, total: rows.length, success: true };
          }}
        />
      </div>
    </PermissionGate>
  );
}
