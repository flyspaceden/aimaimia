import { Button, Image, ScrollView, Text, Textarea, View } from '@tarojs/components';
import Taro, { useRouter } from '@tarojs/taro';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useRef, useState } from 'react';
import { CatalogFeedback } from '@/components/catalog-feedback';
import { MiniSubscriptionRepo, requestOptionalMiniProgramSubscriptions } from '@/platform/subscriptions';
import { useAuthStore } from '@/store/auth';
import { AfterSaleAuthGate } from '../_components/auth-gate';
import { MiniAfterSaleRepo } from '../repo';
import type { AfterSaleType, QualityReason } from '../types';
import { AFTER_SALE_TYPE_LABELS, QUALITY_REASONS, formatMoney } from '../utils';
import '../_components/after-sale-shared.scss';
import './index.scss';

const noReasonSuggestions = ['不喜欢', '拍错了', '规格不对', '不想要了', '收到太慢', '其他'];

export default function AfterSaleApplyPage() {
  const router = useRouter();
  const orderId = typeof router.params.orderId === 'string' ? router.params.orderId : '';
  const loggedIn = useAuthStore((state) => Boolean(state.accessToken));
  const queryClient = useQueryClient();
  const [itemId, setItemId] = useState('');
  const [type, setType] = useState<AfterSaleType>();
  const [qualityReason, setQualityReason] = useState<QualityReason>('QUALITY_ISSUE');
  const [tags, setTags] = useState<string[]>([]);
  const [note, setNote] = useState('');
  const [photos, setPhotos] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [agreed, setAgreed] = useState(false);
  const submitLock = useRef(false);
  const eligibilityQuery = useQuery({ queryKey: ['after-sale-eligibility', orderId], queryFn: () => MiniAfterSaleRepo.getEligibility(orderId), enabled: loggedIn && Boolean(orderId) });
  const policyQuery = useQuery({ queryKey: ['after-sale-policy'], queryFn: MiniAfterSaleRepo.getReturnPolicy, enabled: loggedIn });
  const subscriptionTemplatesQuery = useQuery({
    queryKey: ['mini-program', 'subscription-templates'],
    queryFn: MiniSubscriptionRepo.templates,
    enabled: loggedIn,
    staleTime: 5 * 60_000,
  });
  const eligibility = eligibilityQuery.data?.ok ? eligibilityQuery.data.data : undefined;
  const selectedItem = eligibility?.items.find((item) => item.orderItemId === itemId);
  const selectedOption = selectedItem?.options.find((option) => option.afterSaleType === type);
  const isQuality = type === 'QUALITY_RETURN' || type === 'QUALITY_EXCHANGE';
  const enabledOptions = useMemo(() => selectedItem?.options || [], [selectedItem]);

  const choosePhotos = async () => {
    if (photos.length >= 10 || uploading) return;
    let selection;
    try {
      selection = await Taro.chooseMedia({ count: 10 - photos.length, mediaType: ['image'], sourceType: ['album', 'camera'], sizeType: ['compressed'] });
    } catch {
      return;
    }
    if (!selection.tempFiles.length) return;
    setUploading(true);
    const outcomes = await Promise.all(selection.tempFiles.map((file) => MiniAfterSaleRepo.uploadEvidence(file.tempFilePath)));
    const urls = outcomes.flatMap((result) => result.ok && result.data.url ? [result.data.url] : []);
    setPhotos((current) => [...current, ...urls].slice(0, 10));
    setUploading(false);
    if (urls.length !== outcomes.length) Taro.showToast({ title: `${urls.length} 张已上传，${outcomes.length - urls.length} 张失败`, icon: 'none' });
  };

  const showPolicy = () => {
    const policy = policyQuery.data?.ok ? policyQuery.data.data : undefined;
    void Taro.showModal({ title: policy?.title || '退换货规则', content: policy?.content.join('\n') || '请以页面展示的售后资格与费用为准', showCancel: false, confirmText: '知道了' });
  };

  const submit = async () => {
    if (submitLock.current || !itemId || !type) { Taro.showToast({ title: '请选择商品和售后方式', icon: 'none' }); return; }
    if (!selectedOption?.enabled) { Taro.showToast({ title: selectedOption?.disabledReason || '当前方式不可申请', icon: 'none' }); return; }
    if (photos.length < 1) { Taro.showToast({ title: '请至少上传 1 张凭证', icon: 'none' }); return; }
    if (!agreed) { Taro.showToast({ title: '请先阅读并同意退换货规则', icon: 'none' }); return; }
    submitLock.current = true; setSubmitting(true);
    try {
      const agreeResult = await MiniAfterSaleRepo.agreePolicy();
      if (!agreeResult.ok) { Taro.showToast({ title: agreeResult.error.displayMessage || '规则确认失败', icon: 'none' }); return; }
      const reason = isQuality ? note.trim() : [tags.join('、'), note.trim()].filter(Boolean).join('；');
      const result = await MiniAfterSaleRepo.apply(orderId, { orderItemId: itemId, afterSaleType: type, photos, ...(isQuality ? { reasonType: qualityReason } : {}), ...(reason ? { reason } : {}) });
      if (!result.ok) { Taro.showToast({ title: result.error.displayMessage || '售后申请失败', icon: 'none' }); return; }
      await Promise.all([queryClient.invalidateQueries({ queryKey: ['orders'] }), queryClient.invalidateQueries({ queryKey: ['after-sales'] }), queryClient.invalidateQueries({ queryKey: ['after-sale-eligibility', orderId] })]);
      try {
        const reminder = await Taro.showModal({
          title: '售后申请已提交',
          content: '是否授权一次售后进度提醒？如果有多个服务单，将用于最先发生的售后更新。',
          confirmText: '接收提醒',
          cancelText: '暂不订阅',
          confirmColor: '#2E7D32',
        });
        const subscriptionTemplates = subscriptionTemplatesQuery.data?.ok
          ? subscriptionTemplatesQuery.data.data
          : undefined;
        if (reminder.confirm) {
          if (!subscriptionTemplates) {
            await Taro.showToast({
              title: subscriptionTemplatesQuery.isLoading ? '提醒配置仍在加载，请稍后到设置中授权' : '提醒配置暂不可用，可稍后到设置中授权',
              icon: 'none',
              duration: 2600,
            });
          } else {
            await requestOptionalMiniProgramSubscriptions(['AFTER_SALE_RESULT'], subscriptionTemplates);
          }
        }
      } catch {
        // 售后申请已成功，订阅面板失败不改变业务结果。
      } finally {
        void Taro.redirectTo({ url: `/packages/after-sales/after-sale-detail/index?id=${encodeURIComponent(result.data.id)}` });
      }
    } finally { submitLock.current = false; setSubmitting(false); }
  };

  const returnUrl = `/packages/after-sales/after-sale-apply/index?orderId=${encodeURIComponent(orderId)}`;
  return <AfterSaleAuthGate returnUrl={returnUrl}><View className='after-sale-apply-page'>
    {!orderId ? <CatalogFeedback kind='error' title='订单参数缺失' description='请从订单详情重新进入' /> : eligibilityQuery.isLoading ? <CatalogFeedback kind='loading' /> : !eligibility ? <CatalogFeedback kind='error' title='售后资格加载失败' description={eligibilityQuery.data && !eligibilityQuery.data.ok ? eligibilityQuery.data.error.displayMessage : '请稍后重试'} onRetry={() => eligibilityQuery.refetch()} /> : !eligibility.eligible ? <CatalogFeedback kind='empty' title='暂不可申请售后' description={eligibility.disabledReason || '订单内暂无可售后商品'} /> : <ScrollView className='after-sale-apply-scroll' scrollY enhanced><View className='after-sale-apply-content'>
      <View className='after-sale-apply-hero'><Text className='after-sale-apply-hero__eyebrow'>建立售后服务单</Text><Text className='after-sale-apply-hero__title'>说清问题，处理更快</Text><Text className='after-sale-apply-hero__copy'>以后端实时返回的可申请项和预估金额为准。</Text></View>
      <View className='after-sale-step aim-card'><Text className='after-sale-step__number'>01</Text><Text className='after-sale-step__title'>选择商品</Text>{eligibility.items.map((item) => <View key={item.orderItemId} className={itemId === item.orderItemId ? 'after-sale-product after-sale-product--active' : 'after-sale-product'} onClick={() => { setItemId(item.orderItemId); setType(undefined); }}><Image className='after-sale-product__image' src={item.productSnapshot?.image || item.productSnapshot?.images?.[0] || ''} mode='aspectFill' /><View><Text className='after-sale-product__title'>{item.productTitle}</Text><Text className='after-sale-product__meta'>¥{formatMoney(item.unitPrice)} × {item.quantity}</Text></View><Text className='after-sale-product__check'>{itemId === item.orderItemId ? '✓' : ''}</Text></View>)}</View>
      {selectedItem ? <View className='after-sale-step aim-card'><Text className='after-sale-step__number'>02</Text><Text className='after-sale-step__title'>选择处理方式</Text>{enabledOptions.map((option) => <View key={option.afterSaleType} className={`${type === option.afterSaleType ? 'after-sale-option after-sale-option--active' : 'after-sale-option'}${option.enabled ? '' : ' after-sale-option--disabled'}`} onClick={() => { if (option.enabled) setType(option.afterSaleType); }}><View><Text className='after-sale-option__title'>{AFTER_SALE_TYPE_LABELS[option.afterSaleType]}</Text><Text className='after-sale-option__copy'>{option.enabled ? `${option.requiresReturn ? '需寄回' : '无需寄回'}${option.estimatedRefundAmount != null ? ` · 预计退款 ¥${formatMoney(option.estimatedRefundAmount)}` : ''}` : option.disabledReason || '当前不可申请'}</Text></View><Text className='after-sale-option__radio'>{type === option.afterSaleType ? '●' : '○'}</Text></View>)}</View> : null}
      {type ? <><View className='after-sale-step aim-card'><Text className='after-sale-step__number'>03</Text><Text className='after-sale-step__title'>上传商品凭证</Text><Text className='after-sale-step__hint'>至少 1 张，最多 10 张</Text><View className='after-sale-photos'>{photos.map((url, index) => <View className='after-sale-photo' key={url}><Image src={url} mode='aspectFill' onClick={() => Taro.previewImage({ current: url, urls: photos })} /><Text onClick={() => setPhotos((current) => current.filter((_, i) => i !== index))}>×</Text></View>)}{photos.length < 10 ? <View className='after-sale-photo-add' onClick={choosePhotos}><Text>{uploading ? '上传中' : '+'}</Text><Text>{uploading ? '请稍候' : '拍照/相册'}</Text></View> : null}</View></View>
      <View className='after-sale-step aim-card'><Text className='after-sale-step__number'>04</Text><Text className='after-sale-step__title'>{isQuality ? '选择问题类型' : '补充原因'}</Text>{isQuality ? <View className='after-sale-reasons'>{QUALITY_REASONS.map(([value, label]) => <Text key={value} className={qualityReason === value ? 'after-sale-reason after-sale-reason--active' : 'after-sale-reason'} onClick={() => setQualityReason(value)}>{label}</Text>)}</View> : <View className='after-sale-reasons'>{noReasonSuggestions.map((tag) => <Text key={tag} className={tags.includes(tag) ? 'after-sale-reason after-sale-reason--active' : 'after-sale-reason'} onClick={() => setTags((current) => current.includes(tag) ? current.filter((item) => item !== tag) : [...current, tag])}>{tag}</Text>)}</View>}<Textarea className='after-sale-note' value={note} maxlength={500} placeholder='可补充说明具体问题' onInput={(event) => setNote(event.detail.value)} /><Text className='after-sale-note-count'>{note.length}/500</Text></View>
      <View className='after-sale-policy' onClick={() => setAgreed((value) => !value)}><Text className={agreed ? 'after-sale-policy__check after-sale-policy__check--active' : 'after-sale-policy__check'}>{agreed ? '✓' : ''}</Text><Text>我已阅读并同意</Text><Text className='after-sale-policy__link' onClick={(event) => { event.stopPropagation(); showPolicy(); }}>《退换货规则》</Text></View>
      <Button className='after-sale-submit' loading={submitting} disabled={submitting || uploading} onClick={submit}>{submitting ? '提交中...' : `提交${AFTER_SALE_TYPE_LABELS[type]}申请`}</Button></> : null}
    </View></ScrollView>}
  </View></AfterSaleAuthGate>;
}
