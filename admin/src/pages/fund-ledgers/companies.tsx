import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Alert, Button, Card, Drawer, Form, Input, Select, Space, Table, Tabs, Tag, Tooltip, Typography } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { ReloadOutlined } from '@ant-design/icons';
import { getIndustryFundCompanies, getIndustryFundUnassigned, type IndustryFundCompany, type IndustryFundUnassignedEntry, type FundLedgerQuery } from '@/api/fund-ledgers';
import { PERMISSIONS } from '@/constants/permissions';
import { usePermission } from '@/hooks/usePermission';
import { getAdminErrorMessage } from '@/utils/adminErrorMessage';
import CompanyDetail from './company-detail';
import { dateTime, money } from './common';
import { FundEmpty, FundHeading, FundSummary } from './workspace';
import { fundLink, useFundSearch, useFundScroll } from './workspace-state';

const VIEWS = [{key:'all',label:'全部'},{key:'available',label:'有可支付金额'},{key:'review',label:'有待核实付款'},{key:'recovery',label:'有待追偿'}] as const;
export default function IndustryFundCompaniesPage() {
  const nav = useNavigate();
  const {params,update,current,page,pageSize,reset} = useFundSearch();
  const scrollParams = new URLSearchParams(params); scrollParams.delete('detail');
  useFundScroll('/fund-ledgers/companies?' + scrollParams.toString());
  const [form] = Form.useForm();
  const [advanced,setAdvanced] = useState(false);
  const {hasPermission} = usePermission();
  const canPay = hasPermission(PERMISSIONS.INDUSTRY_FUNDS_PAY);
  const tab = params.get('tab') === 'unassigned' ? 'unassigned' : 'accounts';
  const q = params.get('q') || '';
  const view = VIEWS.some(v=>v.key===params.get('view')) ? params.get('view')! as FundLedgerQuery['view'] : 'all';
  const status = params.get('status') || undefined;
  const args = {page,pageSize,search:q||undefined,view,status};
  const companies = useQuery({queryKey:['admin','industry-funds','companies',args],queryFn:()=>getIndustryFundCompanies(args),enabled:tab==='accounts'});
  const unassignedArgs = {page,pageSize,orderId:q||undefined,status:params.get('history') === 'all' ? undefined : 'PENDING'};
  const unassigned = useQuery({queryKey:['admin','industry-funds','unassigned',unassignedArgs],queryFn:()=>getIndustryFundUnassigned(unassignedArgs),enabled:tab==='unassigned'});
  useEffect(()=>{form.setFieldsValue({q,status});},[form,q,status]);
  const filtered = !!q || view !== 'all' || !!status;
  const blocked = (c:IndustryFundCompany) => c.status !== 'ACTIVE' ? '公司当前状态不允许付款' : (c.recoverable??0)>0 ? '存在待追偿，请先处理回款' : (c.available??0)<=0 ? '暂无可支付余额' : '';
  const columns:ColumnsType<IndustryFundCompany> = [
    {title:'公司',dataIndex:'name',width:205,render:(_,c)=><div className="fund-list-title"><Button type="link" style={{padding:0}} onClick={()=>update({detail:c.id},false)}>{c.name}</Button>{(c.recoverable??0)>0&&<Typography.Text type="warning" style={{fontSize:12}}>有待追偿事项</Typography.Text>}</div>},
    {title:'可支付',dataIndex:'available',align:'right',render:value=><Typography.Text strong className="fund-number">{money(value)}</Typography.Text>},
    {title:'售后冻结',dataIndex:'frozen',align:'right',responsive:['lg'],render:value=>money(value)},
    {title:'付款预留',dataIndex:'reserved',align:'right',responsive:['lg'],render:value=>money(value)},
    {title:'待追偿',dataIndex:'recoverable',align:'right',responsive:['lg'],render:value=><Typography.Text type={value>0?'warning':undefined}>{money(value)}</Typography.Text>},
    {title:'最近变动',dataIndex:'lastEntryAt',responsive:['xl'],render:value=>dateTime(value)},
    {title:'操作',key:'action',width:canPay?176:75,fixed:'right',render:(_,c)=><Space size={4}><Button type="link" onClick={()=>update({detail:c.id},false)}>查看</Button>{canPay&&<Tooltip title={blocked(c)}><Button disabled={!!blocked(c)} onClick={()=>nav(fundLink(`/fund-ledgers/payments?companyId=${encodeURIComponent(c.id)}&create=1`,current))}>登记付款</Button></Tooltip>}</Space>},
  ];
  const unassignedColumns:ColumnsType<IndustryFundUnassignedEntry> = [
    {title:'来源订单',dataIndex:'orderId',render:value=><Typography.Text copyable={!!value}>{value||'未记录'}</Typography.Text>},
    {title:'原计提',dataIndex:'originalAmount',align:'right',render:money},
    {title:'已冲回',dataIndex:'reversedAmount',align:'right',responsive:['lg'],render:money},
    {title:'待归属净额',dataIndex:'amount',align:'right',render:money},
    {title:'原因',dataIndex:'reason',responsive:['lg']},
    {title:'时间',dataIndex:'createdAt',responsive:['lg'],render:dateTime},
  ];
  const source = tab === 'accounts' ? companies : unassigned;
  useEffect(()=>{
    if (!source.data || source.isFetching || source.isError) return;
    const lastPage = Math.max(1, Math.ceil(source.data.total / pageSize));
    if (page > lastPage) update({page:lastPage},false);
  },[source.data,source.isFetching,source.isError,page,pageSize,update]);
  const summary = companies.data?.summary;
  return <div className="fund-workspace">
    <FundHeading title="公司产业基金" description="查看公司应付与来源，处理需要核实或追偿的事项。" actions={<Button icon={<ReloadOutlined/>} loading={source.isFetching} onClick={()=>source.refetch()}>刷新</Button>} />
    {tab==='accounts' && !companies.isError && <><p className="fund-filter-note">当前筛选公司合计 · 当前账面余额</p><FundSummary loading={companies.isFetching} caption="当前筛选公司合计" items={[{label:'可支付',value:summary?.available},{label:'付款预留',value:summary?.reserved},{label:'待追偿',value:summary?.recoverable,warning:(summary?.recoverable??0)>0}]} /></>}
    <Card>
      <Tabs activeKey={tab} items={[{key:'accounts',label:'公司账本'},{key:'unassigned',label:'待归属'}]} onChange={value=>update({tab:value,q:undefined,status:undefined,view:undefined,history:undefined,detail:undefined})}/>
      {tab==='accounts' ? <div className="fund-quick">{VIEWS.map(v=><Button key={v.key} type={view===v.key?'primary':'default'} onClick={()=>update({view:v.key})}>{v.label}</Button>)}</div> : <div className="fund-quick"><Button type={!params.get('history')?'primary':'default'} onClick={()=>update({history:undefined})}>未处理</Button><Button type={params.get('history')==='all'?'primary':'default'} onClick={()=>update({history:'all'})}>全部记录</Button></div>}
      <Form form={form} onFinish={values=>update({q:values.q?.trim(),status:tab==='accounts'?values.status:undefined})}>
        <div className="fund-toolbar"><Form.Item name="q" noStyle><Input className="fund-search-input" aria-label={tab==='accounts'?'公司名称搜索':'来源订单搜索'} placeholder={tab==='accounts'?'搜索公司名称':'输入完整来源订单编号'} allowClear/></Form.Item><Button type="primary" htmlType="submit">查询</Button><Button onClick={()=>{form.resetFields();update({q:undefined,status:undefined,view:undefined});}}>重置</Button>{tab==='accounts'&&<Button aria-expanded={advanced} onClick={()=>setAdvanced(v=>!v)}>更多筛选</Button>}</div>
        <div className="fund-advanced" hidden={!advanced||tab!=='accounts'}><Form.Item name="status" label="公司状态" style={{marginBottom:0}}><Select allowClear style={{width:190}} options={[{value:'ACTIVE',label:'正常'},{value:'PENDING',label:'待审核'},{value:'SUSPENDED',label:'暂停'},{value:'BANNED',label:'已禁用'},{value:'DELETED',label:'已删除'}]}/></Form.Item></div>
      </Form>
      <div className="fund-condition-tags">{q&&<Tag closable onClose={()=>update({q:undefined})}>搜索：{q}</Tag>}{status&&<Tag closable onClose={()=>update({status:undefined})}>公司状态筛选已启用</Tag>}</div>
      {source.isError ? <Alert type="error" showIcon message="记录加载失败" description={getAdminErrorMessage(source.error,'请重试')} action={<Button onClick={()=>source.refetch()}>重试</Button>}/> : tab==='accounts' ? <Table rowKey="id" columns={columns} dataSource={companies.data?.items||[]} loading={companies.isFetching} scroll={{x:'max-content'}} pagination={{current:page,pageSize,total:companies.data?.total||0,showSizeChanger:true,pageSizeOptions:[20,50,100],onChange:(p,size)=>update({page:size!==pageSize?1:p,pageSize:size},false)}} locale={{emptyText:<FundEmpty filtered={filtered} onReset={reset}/>}}/> : <><p className="fund-filter-note">缺少可靠的公司归属时仅查看来源，不直接划给某家公司。</p><Table rowKey="id" columns={unassignedColumns} dataSource={unassigned.data?.items||[]} loading={unassigned.isFetching} scroll={{x:'max-content'}} expandable={{expandedRowRender:r=><Space direction="vertical">{r.events?.map(e=><Typography.Text key={e.id}>{dateTime(e.createdAt)} · 累计冲回 {money(e.reversedBefore)} → {money(e.reversedAfter)}</Typography.Text>)}</Space>}} pagination={{current:page,pageSize,total:unassigned.data?.total||0,onChange:(p,size)=>update({page:p,pageSize:size},false)}} locale={{emptyText:<Typography.Text type="secondary">暂无匹配的待归属记录</Typography.Text>}}/></>}
    </Card>
    <Drawer title="公司产业基金" width="min(920px, 100vw)" open={!!params.get('detail')} onClose={()=>update({detail:undefined},false)} destroyOnHidden>{params.get('detail')&&<CompanyDetail companyId={params.get('detail')!} embedded returnTo={current}/>}</Drawer>
  </div>;
}
