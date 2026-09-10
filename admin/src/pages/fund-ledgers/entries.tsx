import { useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import {
  Alert,
  Button,
  Card,
  DatePicker,
  Form,
  Input,
  Select,
  Space,
  Spin,
  Table,
  Tag,
  Typography,
} from 'antd';
import type { TableProps } from 'antd';
import type { Dayjs } from 'dayjs';
import dayjs from 'dayjs';
import {
  getFundLedgerEntries,
  getIndustryFundCompanies,
  type FundLedgerEntry,
  type FundLedgerQuery,
  type FundType,
  type IndustryFundCompany,
} from '@/api/fund-ledgers';
import { PERMISSIONS } from '@/constants/permissions';
import { usePermission } from '@/hooks/usePermission';
import { getAdminErrorMessage } from '@/utils/adminErrorMessage';
import {
  EVENT_LABELS,
  FUND_TYPE_LABELS,
  dateTime,
  eventTag,
  getRows,
  money,
  signedMoney,
  sourceTag,
} from './common';
import { LedgerDetailPanel } from './ledger-detail-panel';
import { FundEmpty, FundHeading } from './workspace';
import { fundLink, safeFundReturn, useFundScroll, useFundSearch } from './workspace-state';

const { RangePicker } = DatePicker;
const validFundTypes = Object.keys(FUND_TYPE_LABELS) as FundType[];

interface EntryFilterValues {
  q?: string;
  dates?: [Dayjs, Dayjs];
  sourceType?: string;
  eventType?: string;
  companyId?: string;
}

const PLATFORM_EVENT_TYPES = ['TRANSFER_IN', 'TRANSFER_OUT', 'FREEZE', 'RELEASE', 'REVERSAL', 'PAYMENT', 'STATE_CHANGE'];
const INDUSTRY_EVENT_TYPES = [
  'ACCRUAL',
  'RELEASE',
  'REVERSAL',
  'REVERSAL_PENDING',
  'PAYMENT_RESERVED',
  'PAYMENT_UNRESERVED',
  'PAYMENT_CONFIRMED',
  'PAYMENT_REVERSED',
  'RECOVERY',
];

function clean(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}

function parseDate(value: string | null): Dayjs | undefined {
  if (!value) return undefined;
  const parsed = dayjs(value);
  return parsed.isValid() ? parsed : undefined;
}

function dateFilterValues(from: string | null, to: string | null): [Dayjs, Dayjs] | undefined {
  const start = parseDate(from);
  const end = parseDate(to);
  return start && end ? [start, end] : undefined;
}

function sourceLabel(value: string | null): string | undefined {
  return value === 'NORMAL' ? '普通' : value === 'VIP' ? 'VIP' : value === 'LEGACY' ? '历史路径' : undefined;
}

function eventOptions(fundType: FundType) {
  return (fundType === 'INDUSTRY_FUND' ? INDUSTRY_EVENT_TYPES : PLATFORM_EVENT_TYPES).map((value) => ({
    value,
    label: EVENT_LABELS[value] || value,
  }));
}

function stopRowClick(event: React.MouseEvent) {
  event.stopPropagation();
}

function companyOptionLabel(company: IndustryFundCompany): string {
  return company.name || company.companyNo || company.id;
}

export default function FundLedgerEntriesPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { fundType: rawFundType } = useParams<{ fundType: string }>();
  const { hasPermission } = usePermission();
  const { params, update, page, pageSize } = useFundSearch();
  const [form] = Form.useForm<EntryFilterValues>();
  const [companySearch, setCompanySearch] = useState('');
  const fundType = rawFundType as FundType;
  const valid = validFundTypes.includes(fundType);
  const canReadIndustry = hasPermission(PERMISSIONS.INDUSTRY_FUNDS_READ);
  // q is the canonical URL field; accept the older search alias when opening a bookmarked list.
  const search = clean(params.get('q') || params.get('search'));
  const sourceType = clean(params.get('sourceType'));
  const eventType = clean(params.get('eventType'));
  const companyId = clean(params.get('companyId'));
  const from = clean(params.get('from'));
  const to = clean(params.get('to'));
  const selectedEntryId = params.get('entryId') || undefined;
  const hasFilters = Boolean(search || sourceType || eventType || companyId || from || to);

  useFundScroll(`entries:${fundType}`);

  useEffect(() => {
    form.setFieldsValue({
      q: search,
      sourceType,
      eventType,
      companyId,
      dates: dateFilterValues(from ?? null, to ?? null),
    });
  }, [companyId, eventType, form, from, search, sourceType, to]);

  const listReturnTo = useMemo(() => {
    const listParams = new URLSearchParams(params);
    listParams.delete('entryId');
    const queryString = listParams.toString();
    return `${location.pathname}${queryString ? `?${queryString}` : ''}`;
  }, [location.pathname, params]);

  const entryQuery = useMemo<FundLedgerQuery>(() => ({
    page,
    pageSize,
    from,
    to,
    sourceType,
    eventType,
    companyId,
    // The backend treats this as the single keyword across entry and order references.
    search,
  }), [companyId, eventType, from, page, pageSize, search, sourceType, to]);

  const entriesQuery = useQuery({
    queryKey: ['admin', 'fund-ledgers', 'entries', fundType, entryQuery],
    queryFn: async () => getRows<FundLedgerEntry>(await getFundLedgerEntries(fundType, entryQuery)),
    enabled: valid,
    placeholderData: keepPreviousData,
  });

  const companyOptionsQuery = useQuery({
    queryKey: ['admin', 'industry-funds', 'companies', 'entry-filter', companySearch],
    queryFn: async () => getRows<IndustryFundCompany>(await getIndustryFundCompanies({
      page: 1,
      pageSize: 50,
      search: clean(companySearch),
    })).items,
    enabled: canReadIndustry,
    staleTime: 30_000,
  });

  const companyOptions = useMemo(() => {
    const options = companyOptionsQuery.data ?? [];
    if (companyId && !options.some((company) => company.id === companyId)) {
      return [{ id: companyId, name: companyId }, ...options];
    }
    return options;
  }, [companyId, companyOptionsQuery.data]);

  const result = entriesQuery.data ?? { items: [], total: 0, page, pageSize };

  useEffect(() => {
    const data = entriesQuery.data;
    if (!data || entriesQuery.isFetching || data.items.length > 0 || page === 1) return;
    const lastPage = Math.max(1, Math.ceil(data.total / pageSize));
    if (page > lastPage) update({ page: lastPage }, false);
  }, [entriesQuery.data, entriesQuery.isFetching, page, pageSize, update]);

  const applyFilters = (values: EntryFilterValues) => {
    const dates = values.dates;
    update({
      q: clean(values.q),
      sourceType: clean(values.sourceType),
      eventType: clean(values.eventType),
      companyId: clean(values.companyId),
      from: dates?.[0]?.startOf('day').toISOString(),
      to: dates?.[1]?.endOf('day').toISOString(),
      entryId: undefined,
    });
  };

  const clearFilter = (key: string) => update({ [key]: undefined, entryId: undefined });

  const openDrawer = (entry: FundLedgerEntry) => {
    const next = new URLSearchParams(params);
    next.set('entryId', entry.id);
    navigate({ pathname: location.pathname, search: `?${next.toString()}` }, { replace: true });
  };

  const closeDrawer = () => {
    const next = new URLSearchParams(params);
    next.delete('entryId');
    navigate({ pathname: location.pathname, search: next.toString() ? `?${next.toString()}` : '' }, { replace: true });
  };

  const columns: TableProps<FundLedgerEntry>['columns'] = [
    {
      title: '记账时间',
      dataIndex: 'occurredAt',
      width: 170,
      render: (_value, row) => <Typography.Text className="fund-number">{dateTime(row.occurredAt || row.createdAt)}</Typography.Text>,
    },
    {
      title: '事件 / 来源',
      key: 'event',
      width: 150,
      render: (_value, row) => (
        <Space direction="vertical" size={2}>
          {eventTag(row.eventType)}
          {sourceTag(row.sourceType)}
          <Link to={fundLink(`/fund-ledgers/entries/${fundType}/${encodeURIComponent(row.id)}`, listReturnTo)} onClick={stopRowClick}>
            {row.entryNo || row.id}
          </Link>
        </Space>
      ),
    },
    {
      title: '来源订单',
      dataIndex: 'orderId',
      width: 220,
      render: (_value, row) => row.orderId ? (
        <Space direction="vertical" size={2}>
          <Link to={`/orders/${encodeURIComponent(row.orderId)}`} onClick={stopRowClick}>
            {row.orderId}
          </Link>
          {row.companyId && <Typography.Text type="secondary" ellipsis={{ tooltip: row.companyName || row.companyId }}>{row.companyName || row.companyId}</Typography.Text>}
        </Space>
      ) : <Typography.Text type="secondary">-</Typography.Text>,
    },
    {
      title: '变动金额',
      dataIndex: 'amount',
      align: 'right',
      width: 140,
      render: (_value, row) => signedMoney(row.amount, row.direction),
    },
    {
      title: '变动后余额',
      dataIndex: 'balanceAfter',
      align: 'right',
      width: 150,
      render: (_value, row) => <Typography.Text className="fund-number">{money(row.balanceAfter)}</Typography.Text>,
    },
    {
      title: '操作',
      key: 'action',
      fixed: 'right',
      width: 120,
      render: (_value, row) => (
        <Button type="link" onClick={(event) => { stopRowClick(event); openDrawer(row); }}>
          查看
        </Button>
      ),
    },
  ];

  if (!valid) {
    return <Card style={{ margin: 24 }}><Typography.Text type="danger">账本类型无效</Typography.Text></Card>;
  }

  return (
    <div className="fund-workspace">
      <FundHeading
        title={`${FUND_TYPE_LABELS[fundType]}流水`}
        description="按时间、事件、来源订单和余额核对每一笔账本记录。金额与历史记录只读展示。"
        actions={(
          <Space wrap>
            <Button onClick={() => navigate(safeFundReturn(params.get('returnTo')))}>返回基金总览</Button>
            <Button onClick={() => { void entriesQuery.refetch(); }} loading={entriesQuery.isFetching}>刷新</Button>
          </Space>
        )}
      />

      <Card size="small" style={{ marginBottom: 16 }}>
        <Form form={form} layout="inline" onFinish={applyFilters}>
          <Form.Item name="q" label="关键词">
            <Input
              allowClear
              className="fund-search-input"
              placeholder="搜索流水号或订单编号"
              onPressEnter={() => form.submit()}
            />
          </Form.Item>
          <Form.Item name="sourceType" label="来源">
            <Select allowClear style={{ width: 120 }} options={[
              { value: 'NORMAL', label: '普通' },
              { value: 'VIP', label: 'VIP' },
              { value: 'LEGACY', label: '历史路径' },
            ]} />
          </Form.Item>
          <Form.Item name="eventType" label="事件">
            <Select allowClear style={{ width: 160 }} options={eventOptions(fundType)} />
          </Form.Item>
          {canReadIndustry && (
            <Form.Item name="companyId" label="公司">
              <Select
                allowClear
                showSearch
                filterOption={false}
                loading={companyOptionsQuery.isFetching}
                placeholder="搜索公司名称"
                style={{ width: 210 }}
                onSearch={setCompanySearch}
                options={companyOptions.map((company) => ({ value: company.id, label: companyOptionLabel(company) }))}
              />
            </Form.Item>
          )}
          <Form.Item label="记账时间" name="dates">
            <RangePicker showTime format="YYYY-MM-DD HH:mm" allowClear />
          </Form.Item>
          <Form.Item>
            <Space>
              <Button type="primary" htmlType="submit">查询</Button>
              <Button onClick={() => { form.resetFields(); update({ q: undefined, sourceType: undefined, eventType: undefined, companyId: undefined, from: undefined, to: undefined, entryId: undefined }); }}>重置</Button>
            </Space>
          </Form.Item>
        </Form>
        {hasFilters && (
          <Space wrap size={[6, 6]} style={{ marginTop: 12 }}>
            <Typography.Text type="secondary">已选条件：</Typography.Text>
            {search && <Tag closable onClose={() => clearFilter('q')}>关键词：{search}</Tag>}
            {sourceType && <Tag closable onClose={() => clearFilter('sourceType')}>来源：{sourceLabel(sourceType)}</Tag>}
            {eventType && <Tag closable onClose={() => clearFilter('eventType')}>事件：{EVENT_LABELS[eventType] || eventType}</Tag>}
            {companyId && <Tag closable onClose={() => clearFilter('companyId')}>公司：{companyOptions.find((company) => company.id === companyId)?.name || companyId}</Tag>}
            {(from || to) && <Tag closable onClose={() => update({ from: undefined, to: undefined, entryId: undefined })}>时间：{from ? dateTime(from) : '不限'} 至 {to ? dateTime(to) : '不限'}</Tag>}
          </Space>
        )}
      </Card>

      {entriesQuery.isError && (
        <Alert
          type="error"
          showIcon
          style={{ marginBottom: 16 }}
          message="流水加载失败"
          description={getAdminErrorMessage(entriesQuery.error, '暂时无法读取该基金流水')}
          action={<Button size="small" onClick={() => { void entriesQuery.refetch(); }}>重试</Button>}
        />
      )}

      <Card bodyStyle={{ padding: 0 }}>
        <Table<FundLedgerEntry>
          rowKey="id"
          columns={columns}
          dataSource={result.items}
          loading={{ spinning: entriesQuery.isFetching, indicator: <Spin /> }}
          scroll={{ x: 850 }}
          onRow={(entry) => ({
            onClick: () => openDrawer(entry),
            style: { cursor: 'pointer' },
          })}
          locale={{ emptyText: <FundEmpty filtered={hasFilters} onReset={() => { form.resetFields(); update({ q: undefined, sourceType: undefined, eventType: undefined, companyId: undefined, from: undefined, to: undefined, entryId: undefined }); }} /> }}
          pagination={{
            current: page,
            pageSize,
            total: result.total,
            showSizeChanger: true,
            pageSizeOptions: ['20', '50', '100'],
            onChange: (nextPage, nextPageSize) => update({ page: nextPage, pageSize: nextPageSize }, false),
            showTotal: (total) => `共 ${total} 条`,
          }}
        />
      </Card>

      <LedgerDetailPanel
        fundType={fundType}
        id={selectedEntryId}
        returnTo={listReturnTo}
        onClose={closeDrawer}
      />
    </div>
  );
}
