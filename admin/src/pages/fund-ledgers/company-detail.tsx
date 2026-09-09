import { useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Alert, Button, Card, Descriptions, Empty, Input, Result, Skeleton, Space, Table, Tabs, Tooltip, Typography } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { getIndustryFundCompany, getIndustryFundCompanyLedgers, getIndustryFundPayments, type FundLedgerEntry, type IndustryFundPayment } from '@/api/fund-ledgers';
import { usePermission } from '@/hooks/usePermission';
import { PERMISSIONS } from '@/constants/permissions';
import { getAdminErrorMessage } from '@/utils/adminErrorMessage';
import { dateTime, eventTag, money, paymentStatusTag, signedMoney } from './common';
import { FundHeading, FundSummary } from './workspace';
import { fundLink, safeFundReturn } from './workspace-state';

type Props = { companyId?: string; embedded?: boolean; returnTo?: string };
export default function IndustryFundCompanyDetailPage({companyId,embedded=false,returnTo}:Props={}) {
  const route = useParams<{id:string}>(); const id = companyId || route.id;
  const nav=useNavigate(); const [params,setParams]=useSearchParams();
  const {hasPermission}=usePermission(); const canPay=hasPermission(PERMISSIONS.INDUSTRY_FUNDS_PAY);
  const [localTab,setLocalTab]=useState('ledger');
  const tab=embedded?localTab:(params.get('tab')||'ledger');
  const [search,setSearch]=useState(''); const [keyword,setKeyword]=useState(''); const [page,setPage]=useState(1); const [paymentPage,setPaymentPage]=useState(1);
  const back=safeFundReturn(returnTo||params.get('returnTo'),'/fund-ledgers/companies');
  const context=embedded?back:`/fund-ledgers/companies/${id}?${params}`;
  const companyQuery=useQuery({queryKey:['admin','industry-funds','company',id],queryFn:()=>getIndustryFundCompany(id!),enabled:!!id});
  const ledgerQuery=useQuery({queryKey:['admin','industry-funds','company-ledgers',id,keyword,page],queryFn:()=>getIndustryFundCompanyLedgers(id!,{search:keyword||undefined,page,pageSize:20}),enabled:!!id&&tab==='ledger'});
  const paymentQuery=useQuery({queryKey:['admin','industry-funds','company-payments',id,paymentPage],queryFn:()=>getIndustryFundPayments({companyId:id,page:paymentPage,pageSize:10}),enabled:!!id&&tab==='payments'});
  const reviewQuery=useQuery({queryKey:['admin','industry-funds','company-review',id],queryFn:()=>getIndustryFundPayments({companyId:id,view:'review',page:1,pageSize:10}),enabled:!!id&&tab==='issues'});
  if(companyQuery.isLoading)return <div className={embedded?'fund-detail-embedded':'fund-workspace'}><Skeleton active/></div>;
  if(companyQuery.isError||!companyQuery.data)return <Result status="error" title="公司账本加载失败" subTitle={getAdminErrorMessage(companyQuery.error,'请重试')} extra={<Space><Button onClick={()=>companyQuery.refetch()}>重试</Button>{!embedded&&<Button onClick={()=>nav(back)}>返回公司列表</Button>}</Space>}/>;
  const company=companyQuery.data;
  const blocked=company.status!=='ACTIVE'?'公司当前状态不允许付款':(company.recoverable??0)>0?'存在待追偿，请先处理回款':(company.available??0)<=0?'暂无可支付余额':'';
  const paymentUrl=`/fund-ledgers/payments?companyId=${encodeURIComponent(company.id)}`;
  const ledgerColumns:ColumnsType<FundLedgerEntry>=[
    {title:'记账时间',dataIndex:'createdAt',width:155,render:dateTime},
    {title:'事件',dataIndex:'eventType',render:eventTag},
    {title:'来源订单',dataIndex:'orderId',ellipsis:true,responsive:['md'],render:value=><Typography.Text copyable={!!value}>{value||'未关联订单'}</Typography.Text>},
    {title:'变动金额',dataIndex:'amount',align:'right',render:(_,r)=>signedMoney(r.amount,r.direction)},
    {title:'变动后余额',dataIndex:'balanceAfter',align:'right',responsive:['md'],render:money},
    {title:'操作',key:'action',width:70,render:(_,r)=><Button type="link" onClick={()=>nav(fundLink(`/fund-ledgers/entries/INDUSTRY_FUND/${r.id}`,context))}>详情</Button>},
  ];
  const paymentColumns:ColumnsType<IndustryFundPayment>=[
    {title:'付款单',dataIndex:'id',ellipsis:true,render:(_,p)=><Button type="link" onClick={()=>nav(fundLink(`/fund-ledgers/payments/${p.id}`,context))}>{p.paymentNo||p.id}</Button>},
    {title:'金额',dataIndex:'amount',align:'right',render:money},
    {title:'状态',dataIndex:'status',render:(_,p)=>p.needsReview&&p.status==='RESERVED'?<Typography.Text type="warning">需核实</Typography.Text>:paymentStatusTag(p.status)},
    {title:'时间',dataIndex:'createdAt',responsive:['md'],render:dateTime},
  ];
  const error=(err:unknown,retry:()=>void)=><Alert type="error" message="记录加载失败" description={getAdminErrorMessage(err,'请重试')} action={<Button onClick={retry}>重试</Button>}/>;
  return <div className={embedded?'fund-detail-embedded':'fund-workspace'}>
    {!embedded&&<Button style={{marginBottom:16}} onClick={()=>nav(back)}>返回公司列表</Button>}
    <FundHeading title={company.name} description="公司产业基金子账 · 当前余额" actions={canPay&&<Tooltip title={blocked}><Button type="primary" disabled={!!blocked} onClick={()=>nav(fundLink(paymentUrl+'&create=1',context))}>登记付款</Button></Tooltip>}/>
    <FundSummary caption="公司当前余额" items={[{label:'可支付',value:company.available},{label:'售后冻结',value:company.frozen},{label:'付款预留',value:company.reserved},{label:'待追偿',value:company.recoverable,warning:(company.recoverable??0)>0}]}/>
    <Descriptions size="small" column={{xs:1,sm:2,md:3}} items={[{key:'accrued',label:'累计计提',children:money(company.accrued)},{key:'paid',label:'累计已支付',children:money(company.paid)},{key:'status',label:'公司状态',children:({ACTIVE:'正常',PENDING:'待审核',SUSPENDED:'暂停',BANNED:'已禁用',DELETED:'已删除'} as Record<string,string>)[company.status||'']||'未记录'}]}/>
    <Card size="small" style={{marginTop:18}}>
      <Tabs activeKey={tab} onChange={value=>embedded?setLocalTab(value):setParams(p=>{const n=new URLSearchParams(p);n.set('tab',value);return n;})} items={[{key:'ledger',label:'资金明细'},{key:'payments',label:'付款记录'},{key:'issues',label:'待处理事项'}]}/>
      {tab==='ledger'&&<><Input.Search aria-label="公司流水搜索" placeholder="搜索流水号或订单编号" value={search} onChange={e=>setSearch(e.target.value)} onSearch={value=>{setKeyword(value.trim());setPage(1);}} allowClear enterButton="查询" style={{maxWidth:420,marginBottom:16}}/>{ledgerQuery.isError?error(ledgerQuery.error,()=>ledgerQuery.refetch()):<Table rowKey="id" size="small" columns={ledgerColumns} dataSource={ledgerQuery.data?.items||[]} loading={ledgerQuery.isFetching} scroll={{x:'max-content'}} pagination={{current:page,pageSize:20,total:ledgerQuery.data?.total||0,onChange:setPage}} expandable={{expandedRowRender:r=><Descriptions size="small" items={[{key:'frozen',label:'冻结后',children:money(r.frozenAfter)},{key:'reserved',label:'预留后',children:money(r.reservedAfter)},{key:'due',label:'待追偿后',children:money(r.recoveryDueAfter)}]}/>}} locale={{emptyText:<Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={keyword?'没有匹配的流水':'尚未产生新产业基金，历史个人余额不回填'}/>}}/>}</>}
      {tab==='payments'&&<><Button style={{marginBottom:12}} onClick={()=>nav(fundLink(paymentUrl,context))}>在付款页面查看</Button>{paymentQuery.isError?error(paymentQuery.error,()=>paymentQuery.refetch()):<Table rowKey="id" size="small" columns={paymentColumns} dataSource={paymentQuery.data?.items||[]} loading={paymentQuery.isFetching} pagination={{current:paymentPage,pageSize:10,total:paymentQuery.data?.total||0,onChange:setPaymentPage}}/>}</>}
      {tab==='issues'&&<Space direction="vertical" style={{width:'100%'}}>{(company.recoverable??0)>0&&<Alert type="warning" showIcon message={`待追偿 ${money(company.recoverable)}`} description="新付款暂停，先在对应付款单处理实际回款。" action={<Button onClick={()=>nav(fundLink(paymentUrl+'&view=recovery',context))}>查看待追偿付款</Button>}/>} {reviewQuery.isError?error(reviewQuery.error,()=>reviewQuery.refetch()):reviewQuery.isFetching?<Skeleton active paragraph={{rows:2}}/>:(reviewQuery.data?.total??0)>0?<><Typography.Text>有 {reviewQuery.data?.total} 笔付款需要核实银行实际状态。</Typography.Text><Table rowKey="id" size="small" columns={paymentColumns} dataSource={reviewQuery.data?.items||[]} pagination={false}/><Button onClick={()=>nav(fundLink(paymentUrl+'&view=review',context))}>查看全部待核实付款</Button></>:!(company.recoverable??0)&&<Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="当前没有待处理事项"/>}</Space>}
    </Card>
  </div>;
}
