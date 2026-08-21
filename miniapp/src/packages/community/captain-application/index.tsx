import { Button, Input, Text, Textarea, View } from '@tarojs/components';
import Taro from '@tarojs/taro';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { CatalogFeedback } from '@/components/catalog-feedback';
import { useAuthStore } from '@/store/auth';
import { CommunityRepo } from '../repo';
import type { SubmitCaptainApplication } from '../types';
import { captainApplicationStatus, formatDate } from '../utils';
import './index.scss';

const COMMUNITY = [['NONE', '暂无社群'], ['UNDER_50', '50人以下'], ['BETWEEN_50_200', '50-200人'], ['BETWEEN_200_500', '200-500人'], ['OVER_500', '500人以上']] as const;
const GMV = [['UNDER_3000', '3000以下'], ['BETWEEN_3000_10000', '3000-1万'], ['BETWEEN_10000_30000', '1万-3万'], ['OVER_30000', '3万以上']] as const;
const RESOURCES = [['MOMENTS', '朋友圈'], ['WECHAT_GROUP', '微信群'], ['VIDEO_ACCOUNT', '视频号'], ['COMMUNITY', '线下社区'], ['RESTAURANT', '餐饮店'], ['COMPANY_GROUP_BUY', '企业团购'], ['FRIENDS_FAMILY', '亲友圈'], ['OTHER', '其他']] as const;
const EXPERIENCE = [['NONE', '无经验'], ['BUYER', '有购买经验'], ['SOLD_BEFORE', '有销售经验'], ['SUPPLY_CHAIN_OR_GROUP_BUY', '供应链 / 团购经验']] as const;

const EMPTY: SubmitCaptainApplication = { realName: '', contact: '', city: '', communityScale: '', expectedMonthlyGmv: '', resourceTypes: [], promotionPlan: '', seafoodExperience: '', complianceAccepted: false };

function validate(input: SubmitCaptainApplication): string | null {
  if (input.realName.trim().length < 2) return '请填写至少 2 个字的真实姓名';
  if (input.contact.trim().length < 3) return '请填写联系微信或手机号';
  if (input.city.trim().length < 2) return '请填写所在城市或经营区域';
  if (!input.communityScale) return '请选择社群规模';
  if (!input.expectedMonthlyGmv) return '请选择预计月销售能力';
  if (!input.resourceTypes.length) return '请至少选择一种推广资源';
  if (input.promotionPlan.trim().length < 10) return '请用至少 10 个字说明推广计划';
  if (!input.seafoodExperience) return '请选择相关销售经验';
  if (!input.complianceAccepted) return '请确认团长合规承诺';
  return null;
}

function Choices({ options, selected, multi, onChange }: { options: ReadonlyArray<readonly [string, string]>; selected: string | string[]; multi?: boolean; onChange: (value: string | string[]) => void }) {
  const values = Array.isArray(selected) ? selected : [selected];
  return <View className='captain-form__choices'>{options.map(([value, label]) => <View className={values.includes(value) ? 'captain-form__choice captain-form__choice--active' : 'captain-form__choice'} key={value} onClick={() => {
    if (!multi) { onChange(value); return; }
    onChange(values.includes(value) ? values.filter((item) => item !== value) : [...values, value]);
  }}
  >{label}</View>)}</View>;
}

export default function CaptainApplicationPage() {
  const hydrated = useAuthStore((state) => state.hydrated);
  const loggedIn = useAuthStore((state) => Boolean(state.accessToken));
  const authRevision = useAuthStore((state) => state.revision);
  const queryClient = useQueryClient();
  const [form, setForm] = useState<SubmitCaptainApplication>(EMPTY);
  const [formRevision, setFormRevision] = useState(authRevision);
  const query = useQuery({ queryKey: ['community', 'captain', 'application', authRevision], queryFn: CommunityRepo.captainApplication, enabled: hydrated && loggedIn, staleTime: 0 });
  const data = query.data?.ok ? query.data.data : undefined;
  const application = data?.application;

  useEffect(() => { setForm({ ...EMPTY, resourceTypes: [] }); setFormRevision(authRevision); }, [authRevision]);
  useEffect(() => {
    if (formRevision !== authRevision || application?.status !== 'REJECTED') return;
    setForm({ realName: application.realName, contact: application.contact, city: application.city, communityScale: application.communityScale, expectedMonthlyGmv: application.expectedMonthlyGmv, resourceTypes: application.resourceTypes || [], promotionPlan: application.promotionPlan, seafoodExperience: application.seafoodExperience, complianceAccepted: application.complianceAccepted });
  }, [application, authRevision, formRevision]);

  const mutation = useMutation({
    mutationFn: CommunityRepo.submitCaptainApplication,
    onSuccess: async (result) => {
      if (!result.ok) { await Taro.showToast({ title: result.error.displayMessage || '提交失败', icon: 'none' }); return; }
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['community', 'captain', 'application', authRevision] }),
        queryClient.invalidateQueries({ queryKey: ['community', 'captain', 'profile', authRevision] }),
      ]);
      await Taro.showToast({ title: '申请已提交', icon: 'success' });
    },
  });
  const submit = () => {
    const safeForm = { ...form, realName: form.realName.trim(), contact: form.contact.trim(), city: form.city.trim(), promotionPlan: form.promotionPlan.trim() };
    const error = validate(safeForm);
    if (error) { void Taro.showToast({ title: error, icon: 'none', duration: 2400 }); return; }
    if (!mutation.isPending) mutation.mutate(safeForm);
  };

  if (!hydrated) return <View className='aim-page'><CatalogFeedback kind='loading' /></View>;
  if (!loggedIn) return <View className='aim-page'><CatalogFeedback kind='empty' title='请先登录' description='登录后可以提交团长申请' actionLabel='去登录' onRetry={() => Taro.redirectTo({ url: `/packages/account/account-login/index?returnUrl=${encodeURIComponent('/packages/community/captain-application/index')}` })} /></View>;
  if (query.isLoading) return <View className='aim-page'><CatalogFeedback kind='loading' /></View>;
  if (!query.data?.ok || !data) return <View className='aim-page'><CatalogFeedback kind='error' title='申请状态加载失败' description={query.data && !query.data.ok ? query.data.error.displayMessage : '请稍后重试'} onRetry={() => query.refetch()} /></View>;
  if (data.isCaptain || application?.status === 'APPROVED') return <View className='aim-page captain-application-status'><View className='captain-application-status__mark'>✓</View><Text>团长已开通</Text><Text>当前账号可以进入经营中心查看团长码、奖励与订单进度。</Text><Button className='captain-form__submit' onClick={() => Taro.redirectTo({ url: '/packages/community/captain-center/index' })}>进入团长经营</Button></View>;
  if (application?.status === 'PENDING') {
    const status = captainApplicationStatus(application.status);
    return <View className='aim-page captain-application-status'><View className={`captain-application-status__mark captain-application-status__mark--${status.tone}`}>时</View><Text>{status.label}</Text><Text>提交时间：{formatDate(application.createdAt)}。平台会结合申请资料和历史成交情况审核。</Text><Button className='captain-form__submit' onClick={() => query.refetch()}>刷新状态</Button></View>;
  }

  return <View className='captain-form-page'>
    <View className='captain-form-intro'><Text>团长资料册</Text><Text>请提供真实经营信息。资料仅用于平台审核，审核进度会在本页更新。</Text></View>
    {application?.status === 'REJECTED' ? <View className='captain-form-rejected'><Text>上次申请未通过</Text><Text>{application.rejectReason || '请补充资料后重新提交'}</Text></View> : null}
    <View className='captain-form-section aim-card'><Text className='captain-form-section__title'>01 基础信息</Text><Text className='captain-form__label'>真实姓名</Text><Input className='captain-form__input' value={form.realName} maxlength={40} placeholder='用于平台审核' onInput={(event) => setForm((value) => ({ ...value, realName: event.detail.value }))} /><Text className='captain-form__label'>联系微信或手机号</Text><Input className='captain-form__input' value={form.contact} maxlength={80} placeholder='方便平台联系你' onInput={(event) => setForm((value) => ({ ...value, contact: event.detail.value }))} /><Text className='captain-form__label'>所在城市 / 经营区域</Text><Input className='captain-form__input' value={form.city} maxlength={80} placeholder='例如：杭州滨江' onInput={(event) => setForm((value) => ({ ...value, city: event.detail.value }))} /></View>
    <View className='captain-form-section aim-card'><Text className='captain-form-section__title'>02 经营能力</Text><Text className='captain-form__label'>社群规模</Text><Choices options={COMMUNITY} selected={form.communityScale} onChange={(value) => setForm((state) => ({ ...state, communityScale: value as string }))} /><Text className='captain-form__label'>预计月销售能力</Text><Choices options={GMV} selected={form.expectedMonthlyGmv} onChange={(value) => setForm((state) => ({ ...state, expectedMonthlyGmv: value as string }))} /><Text className='captain-form__label'>可用推广资源（可多选）</Text><Choices options={RESOURCES} selected={form.resourceTypes} multi onChange={(value) => setForm((state) => ({ ...state, resourceTypes: value as string[] }))} /><Text className='captain-form__label'>相关销售经验</Text><Choices options={EXPERIENCE} selected={form.seafoodExperience} onChange={(value) => setForm((state) => ({ ...state, seafoodExperience: value as string }))} /></View>
    <View className='captain-form-section aim-card'><Text className='captain-form-section__title'>03 推广计划</Text><Textarea className='captain-form__textarea' value={form.promotionPlan} maxlength={500} placeholder='说明你计划如何邀请买家、运营社群与服务用户（至少 10 字）' onInput={(event) => setForm((value) => ({ ...value, promotionPlan: event.detail.value }))} /><Text className='captain-form__count'>{form.promotionPlan.length}/500</Text></View>
    <View className='captain-form__agreement' onClick={() => setForm((value) => ({ ...value, complianceAccepted: !value.complianceAccepted }))}><View className={form.complianceAccepted ? 'captain-form__check captain-form__check--active' : 'captain-form__check'}>{form.complianceAccepted ? '✓' : ''}</View><Text>我承诺不夸大宣传、不刷单、不代付套现，并遵守平台团长经营与消费者保护规则。</Text></View>
    <Button className='captain-form__submit' loading={mutation.isPending} disabled={mutation.isPending} onClick={submit}>{mutation.isPending ? '提交中...' : '提交申请'}</Button>
  </View>;
}
