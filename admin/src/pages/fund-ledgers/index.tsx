import { useEffect, useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Alert, Button, Card, DatePicker, Form, Input, Space, Table, Tabs, Tag, Typography } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import dayjs from 'dayjs';
import { ReloadOutlined } from '@ant-design/icons';
import { getFundSummary, type FundSummaryRow, type FundType } from '@/api/fund-ledgers';
import { PERMISSIONS } from '@/constants/permissions';
import { usePermission } from '@/hooks/usePermission';
import { getAdminErrorMessage } from '@/utils/adminErrorMessage';
import { FUND_TYPE_LABELS, money, dateTime } from './common';
import { FundHeading } from './workspace';
import { fundLink, useFundSearch, useFundScroll } from './workspace-state';

const CURRENT: FundType[] = ['INDUSTRY_FUND','CHARITY_FUND','TECH_FUND','RESERVE_FUND','PLATFORM_PROFIT'];
const LEGACY: FundType[] = ['FUND_POOL','POINTS','LEGACY_INDUSTRY_FUND'];
export default function FundLedgersPage() {
  const { params, update, current, reset } = useFundSearch();
  useFundScroll(current);
  const { hasPermission } = usePermission();
  const navigate = useNavigate();
  const canRead = hasPermission(PERMISSIONS.FUND_LEDGERS_READ);
  const canReadCompany = hasPermission(PERMISSIONS.INDUSTRY_FUNDS_READ);
  const [advanced, setAdvanced] = useState(false);
  const [form] = Form.useForm();
  const q = params.get('q') || '';
  const scope = params.get('scope') === 'history' ? 'history' : 'current';
  const from = params.get('from') || undefined, to = params.get('to') || undefined;
  const query = useQuery({ queryKey: ['admin','fund-ledgers','summary',{from,to}], queryFn: () => getFundSummary({from,to}), enabled: canRead });
  useEffect(() => { form.setFieldsValue({ q, dates: from && to && dayjs(from).isValid() && dayjs(to).isValid() ? [dayjs(from),dayjs(to)] : undefined }); }, [form,q,from,to]);
  if (params.get('companyId') && canReadCompany) return <Navigate replace to={`/fund-ledgers/payments?companyId=${encodeURIComponent(params.get('companyId')!)}`} />;
  if (!canRead && canReadCompany) return <Navigate replace to="/fund-ledgers/companies" />;
  const types = scope === 'current' ? CURRENT : LEGACY;
  const rows = types.map(type => query.data?.funds.find(row => row.fundType === type)).filter((row): row is FundSummaryRow => !!row && FUND_TYPE_LABELS[row.fundType].includes(q));
  const columns: ColumnsType<FundSummaryRow> = [
    { title: '基金名称', dataIndex: 'fundType', width: 190, render: (type: FundType) => <div className="fund-list-title"><Button type="link" style={{padding:0}} onClick={() => navigate(fundLink(`/fund-ledgers/${type}`,current))}>{FUND_TYPE_LABELS[type]}</Button><Typography.Text type="secondary" style={{fontSize:12}}>{type === 'INDUSTRY_FUND' ? '平台暂存 · 公司应付' : scope === 'history' ? '历史记录独立保留' : '独立核算'}</Typography.Text></div> },
    { title: '期初余额', dataIndex: 'initialBalance', align: 'right', responsive: ['md'], render: value => money(value) },
    { title: '期间收入', dataIndex: 'periodIncome', align: 'right', responsive: ['md'], render: value => money(value) },
    { title: '期间支出 / 冲回', dataIndex: 'periodExpense', align: 'right', responsive: ['md'], render: value => money(value) },
    { title: '当前余额', dataIndex: 'currentBalance', align: 'right', render: value => <Typography.Text strong className="fund-number">{money(value)}</Typography.Text> },
    { title: '最近变动', dataIndex: 'lastEntryAt', responsive: ['xl'], render: value => dateTime(value) },
    { title: '操作', key: 'action', width: 104, fixed: 'right', render: (_,row) => <Button type="link" onClick={() => navigate(fundLink(`/fund-ledgers/${row.fundType}`,current))}>查看流水</Button> },
  ];
  return <div className="fund-workspace">
    <FundHeading title="基金账本" description="按基金查看收支与来源，产业基金按公司独立记账。" actions={<Button icon={<ReloadOutlined />} loading={query.isFetching} onClick={() => query.refetch()}>刷新</Button>} />
    <Card>
      <Tabs activeKey={scope} onChange={value => update({scope:value,q:undefined})} items={[{key:'current',label:'当前基金'},{key:'history',label:'历史账本'}]} />
      <Form form={form} onFinish={values => update({q:values.q?.trim(),from:values.dates?.[0]?.startOf('day').toISOString(),to:values.dates?.[1]?.endOf('day').toISOString()})}>
        <div className="fund-toolbar"><Form.Item name="q" noStyle><Input className="fund-search-input" aria-label="基金名称" placeholder="搜索基金名称，如：慈善基金" allowClear /></Form.Item><Button type="primary" htmlType="submit">查询</Button><Button onClick={() => {form.resetFields();reset();}}>重置</Button><Button onClick={() => setAdvanced(v=>!v)} aria-expanded={advanced}>更多筛选</Button></div>
        <div hidden={!advanced} className="fund-advanced"><Form.Item name="dates" label="记账期间" style={{marginBottom:0}}><DatePicker.RangePicker /></Form.Item></div>
      </Form>
      <div className="fund-condition-tags">{q && <Tag closable onClose={() => update({q:undefined})}>基金名称：{q}</Tag>}{(from||to) && <Tag closable onClose={() => update({from:undefined,to:undefined})}>期间：{from ? dayjs(from).format('YYYY-MM-DD') : '不限'} 至 {to ? dayjs(to).format('YYYY-MM-DD') : '不限'}</Tag>}</div>
      <p className="fund-filter-note">日期筛选影响期初和期间发生额，当前余额始终是当前值。历史缺失数据不补造。</p>
      {query.isError ? <Alert type="error" showIcon message="基金账本加载失败" description={getAdminErrorMessage(query.error,'请重试')} action={<Button onClick={() => query.refetch()}>重试</Button>} /> : <Table rowKey="fundType" columns={columns} dataSource={rows} loading={query.isFetching} pagination={false} scroll={{x:'max-content'}} locale={{emptyText:<Space direction="vertical"><Typography.Text>{q ? '没有找到匹配的基金' : '暂无该类基金记录'}</Typography.Text>{q && <Button onClick={() => update({q:undefined})}>清除搜索</Button>}</Space>}} />}
    </Card>
  </div>;
}
