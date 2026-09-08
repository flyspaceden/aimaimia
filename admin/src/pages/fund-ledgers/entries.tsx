import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ProTable } from '@ant-design/pro-components';
import type { ProColumns } from '@ant-design/pro-components';
import {
  Alert,
  App,
  Button,
  Card,
  DatePicker,
  Form,
  Input,
  Select,
  Space,
  Tag,
  Typography,
} from 'antd';
import type { Dayjs } from 'dayjs';
import {
  getFundLedgerEntries,
  type FundLedgerEntry,
  type FundLedgerQuery,
  type FundType,
} from '@/api/fund-ledgers';
import { getAdminErrorMessage } from '@/utils/adminErrorMessage';
import {
  EVENT_LABELS,
  FUND_TYPE_COLORS,
  FUND_TYPE_LABELS,
  dateTime,
  getRows,
  money,
  signedMoney,
  sourceTag,
} from './common';

const { RangePicker } = DatePicker;
const validFundTypes = Object.keys(FUND_TYPE_LABELS) as FundType[];

interface EntryFilterValues {
  dates?: [Dayjs, Dayjs];
  sourceType?: string;
  eventType?: string;
  orderId?: string;
  companyId?: string;
}

export default function FundLedgerEntriesPage() {
  const { message } = App.useApp();
  const navigate = useNavigate();
  const { fundType: rawFundType } = useParams<{ fundType: string }>();
  const fundType = rawFundType as FundType;
  const [form] = Form.useForm<EntryFilterValues>();
  const [filters, setFilters] = useState<EntryFilterValues>({});
  const valid = validFundTypes.includes(fundType);

  if (!valid) {
    return <Card style={{ margin: 24 }}><Typography.Text type="danger">账本类型无效</Typography.Text></Card>;
  }

  const columns: ProColumns<FundLedgerEntry>[] = [
    { title: '流水号', dataIndex: 'entryNo', width: 190, render: (_, row) => <Link to={`/fund-ledgers/entries/${fundType}/${row.id}`}>{row.entryNo || row.id}</Link> },
    { title: '事件', dataIndex: 'eventType', width: 110, render: (value) => <Tag>{EVENT_LABELS[String(value)] || String(value || '-')}</Tag> },
    { title: '来源', dataIndex: 'sourceType', width: 100, render: (_, row) => sourceTag(row.sourceType) },
    { title: '变动金额', dataIndex: 'amount', width: 130, align: 'right', render: (_, row) => signedMoney(row.amount, row.direction) },
    { title: '变动后余额', dataIndex: 'balanceAfter', width: 130, align: 'right', render: (_, row) => money(row.balanceAfter) },
    { title: '售后冻结', dataIndex: 'frozenAfter', width: 120, align: 'right', render: (_, row) => money(row.frozenAfter) },
    { title: '付款预留', dataIndex: 'reservedAfter', width: 120, align: 'right', render: (_, row) => money(row.reservedAfter) },
    { title: '公司', dataIndex: 'companyName', width: 160, render: (_, row) => row.companyId ? <Link to={`/fund-ledgers/companies/${row.companyId}`}>{row.companyName || row.companyId}</Link> : '-' },
    { title: '订单', dataIndex: 'orderId', width: 160, render: (_, row) => row.orderId || '-' },
    { title: '记账时间', dataIndex: 'createdAt', width: 175, render: (_, row) => dateTime(row.createdAt) },
    { title: '操作', key: 'action', valueType: 'option', width: 90, render: (_, row) => <Button type="link" onClick={() => navigate(`/fund-ledgers/entries/${fundType}/${row.id}`)}>详情</Button> },
  ];

  const applyFilters = (values: EntryFilterValues) => setFilters(values);

  return (
    <div style={{ padding: 24 }}>
      <Space direction="vertical" size={16} style={{ width: '100%' }}>
        <Space>
          <Button onClick={() => navigate('/fund-ledgers')}>返回基金总览</Button>
          <Typography.Title level={3} style={{ margin: 0 }}>
            <Tag color={FUND_TYPE_COLORS[fundType]}>{FUND_TYPE_LABELS[fundType]}</Tag>逐笔流水
          </Typography.Title>
        </Space>
        <Alert type="info" showIcon message="每笔账本事件均保留来源、余额变化与关联业务。历史路径只读展示，不会被改名或并入新基金。" />
        <Card size="small" title="流水筛选">
          <Form form={form} layout="inline" onFinish={applyFilters}>
            <Form.Item name="dates" label="发生时间"><RangePicker showTime format="YYYY-MM-DD HH:mm" /></Form.Item>
            <Form.Item name="sourceType" label="来源"><Select allowClear style={{ width: 120 }} options={[{ value: 'NORMAL', label: '普通' }, { value: 'VIP', label: 'VIP' }, { value: 'LEGACY', label: '历史路径' }]} /></Form.Item>
            <Form.Item name="eventType" label="事件"><Select allowClear style={{ width: 150 }} options={(fundType === 'INDUSTRY_FUND' ? ['ACCRUAL','RELEASE','REVERSAL','REVERSAL_PENDING','PAYMENT_RESERVED','PAYMENT_UNRESERVED','PAYMENT_CONFIRMED','PAYMENT_REVERSED','RECOVERY'] : ['FREEZE','RELEASE','REVERSAL','TRANSFER_IN','TRANSFER_OUT','PAYMENT','STATE_CHANGE']).map(value => ({ value, label: EVENT_LABELS[value] }))} /></Form.Item>
            <Form.Item name="orderId" label="订单号"><Input allowClear style={{ width: 180 }} /></Form.Item>
            <Form.Item name="companyId" label="来源公司编号"><Input allowClear style={{ width: 180 }} /></Form.Item>
            <Form.Item><Space><Button type="primary" htmlType="submit">查询</Button><Button onClick={() => { form.resetFields(); setFilters({}); }}>重置</Button></Space></Form.Item>
          </Form>
        </Card>
        <ProTable<FundLedgerEntry>
          key={`${fundType}:${JSON.stringify(filters)}`}
          rowKey="id"
          columns={columns}
          options={false}
          search={false}
          scroll={{ x: 1500 }}
          request={async (params) => {
            try {
              const dates = filters.dates;
              const query: FundLedgerQuery = {
                page: Number(params.current ?? 1),
                pageSize: Number(params.pageSize ?? 20),
                from: dates?.[0]?.startOf('day').toISOString(),
                to: dates?.[1]?.endOf('day').toISOString(),
                sourceType: filters.sourceType,
                eventType: filters.eventType?.trim() || undefined,
                orderId: filters.orderId?.trim() || undefined,
                companyId: filters.companyId?.trim() || undefined,
              };
              const result = getRows<FundLedgerEntry>(await getFundLedgerEntries(fundType, query));
              return { data: result.items, success: true, total: result.total };
            } catch (error) {
              message.error(getAdminErrorMessage(error, '基金流水加载失败'));
              return { data: [], success: false, total: 0 };
            }
          }}
          pagination={{ defaultPageSize: 20, showSizeChanger: true }}
          locale={{ emptyText: '暂无流水' }}
        />
      </Space>
    </div>
  );
}
