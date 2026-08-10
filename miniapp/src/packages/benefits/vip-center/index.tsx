import { Button, Text, View } from '@tarojs/components';
import Taro from '@tarojs/taro';
import { useQuery } from '@tanstack/react-query';
import { MemberWalletRepo } from '@/packages/member/repos';
import { useAuthStore } from '@/store/auth';
import { BenefitsFeedback } from '../BenefitsFeedback';
import { BenefitsRepo } from '../repos';
import { benefitsLoginUrl, formatDate, formatPercent, hasActiveReferral } from '../utils';
import type { MemberProfile } from '../types';
import './index.scss';

const LINKS = [
  { mark: '礼', title: 'VIP 礼包', meta: '选档位与多商品赠品', url: '/packages/benefits/vip-gifts/index', tone: 'gold' },
  { mark: '奖', title: '每日抽奖', meta: '查看今日剩余次数', url: '/packages/benefits/lottery/index', tone: 'red' },
  { mark: '树', title: 'VIP 分润树', meta: '查看我的节点与下级', url: '/packages/benefits/vip-tree/index', tone: 'gold' },
  { mark: '队', title: '订单队列奖励', meta: '查看位置与奖励进度', url: '/packages/benefits/queue-reward/index', tone: '' },
];

const VIP_BENEFITS = [
  { mark: '折', title: '会员结算权益', highlight: '动态计算', description: '普通商品价格、运费门槛与消费积分抵扣比例，以结算页实时计算为准。' },
  { mark: '奖', title: 'VIP 直推奖励', highlight: '售后期释放', description: '好友成为 VIP 后进入团队，其后续普通商品订单按付款时的平台比例计算。' },
  { mark: '树', title: '专属三叉树', highlight: '独立关系', description: 'VIP 树与普通用户奖励树相互隔离，可查看当前节点与下级关系。' },
  { mark: '享', title: '会员身份标识', highlight: '专属展示', description: '可使用 VIP 身份与专属头像框，并进入会员礼包浏览空间。' },
];

const REWARD_STEPS = [
  ['1', '普通商品确认收货', 'VIP 礼包订单不参与奖励计算'],
  ['2', '进入售后冻结期', '退款或退货成功时按当前规则冲回'],
  ['3', '冻结期结束释放', '奖励进入统一钱包，可查看流水或申请提现'],
] as const;

function referralInviterLabel(member: MemberProfile): string {
  return member.directReferralInviter?.nickname
    || member.directReferralInviter?.buyerNo
    || member.inviter?.nickname
    || member.inviter?.maskedPhone
    || '已绑定用户';
}

export default function VipCenterPage() {
  const hydrated = useAuthStore((state) => state.hydrated);
  const loggedIn = useAuthStore((state) => Boolean(state.accessToken));
  const memberQuery = useQuery({ queryKey: ['benefits', 'member'], queryFn: BenefitsRepo.getMember, enabled: hydrated && loggedIn });
  const member = memberQuery.data?.ok ? memberQuery.data.data : undefined;
  const isVip = member?.tier === 'VIP';
  const hasReferral = hasActiveReferral(member);
  const walletQuery = useQuery({ queryKey: ['member', 'wallet'], queryFn: MemberWalletRepo.getWallet, enabled: Boolean(hydrated && loggedIn && isVip) });
  const wallet = walletQuery.data?.ok ? walletQuery.data.data : undefined;

  if (!hydrated) return <View className='aim-page benefits-page benefits-page--gold'><BenefitsFeedback kind='loading' /></View>;
  if (loggedIn && memberQuery.isLoading) return <View className='aim-page benefits-page benefits-page--gold'><BenefitsFeedback kind='loading' /></View>;
  if (loggedIn && !memberQuery.data?.ok) return <View className='aim-page benefits-page benefits-page--gold'><BenefitsFeedback kind='error' description={memberQuery.data && !memberQuery.data.ok ? memberQuery.data.error.displayMessage : '会员数据加载失败'} onAction={() => memberQuery.refetch()} /></View>;

  return <View className='aim-page benefits-page benefits-page--gold'>
    <View className='benefits-hero benefits-hero--gold'>
      <View className='benefits-hero__orbit' />
      <Text className='benefits-hero__eyebrow'>AIMAI MEMBER</Text>
      <Text className='benefits-hero__title'>{isVip ? 'VIP 会员·专属权益中心' : '一份礼包，开启 VIP 权益'}</Text>
      <Text className='benefits-hero__description'>{isVip ? `${formatDate(member?.vipPurchasedAt)} 加入，专属权益已生效` : '选择档位和专属礼包，支付成功后立即开通'}</Text>
      <View className='benefits-stat-row'>
        <View><Text>当前身份</Text><Text>{isVip ? 'VIP' : '普通会员'}</Text></View>
        <View><Text>已邀请 VIP</Text><Text>{member?.inviteeVipCount ?? '--'}</Text></View>
        <View><Text>直推比例</Text><Text>{formatPercent(member?.directReferralPercent)}</Text></View>
      </View>
    </View>

    {!loggedIn ? <View className='benefits-card aim-card'><Text className='benefits-card__title'>登录后查看你的会员身份</Text><Text className='benefits-card__description'>使用手机号或微信登录即可查看全部权益。</Text><Button className='benefits-primary benefits-primary--gold' onClick={() => Taro.redirectTo({ url: benefitsLoginUrl('/packages/benefits/vip-center/index') })}>去登录</Button></View> : null}

    {member ? <View className='vip-relation-card aim-card'>
      <View className='vip-relation-card__mark'>{hasReferral ? '友' : '?'}</View>
      <View className='vip-relation-card__copy'><Text>推荐关系</Text><Text>{hasReferral ? (isVip ? `已加入 ${referralInviterLabel(member)} 的 VIP 团队` : `已绑定 ${referralInviterLabel(member)}，升级时会确认团队关系`) : '尚未绑定推荐人，成为 VIP 时按系统节点分配'}</Text></View>
      {!isVip && !hasReferral ? <Text className='vip-relation-card__action' onClick={() => Taro.navigateTo({ url: '/packages/community/scanner/index' })}>去绑定 ›</Text> : null}
    </View> : null}

    {isVip && wallet ? <View className='vip-earnings aim-card' onClick={() => Taro.navigateTo({ url: '/packages/member/wallet/index' })}>
      <View className='vip-earnings__heading'><Text>收益概览</Text><Text>我的财库详情 ›</Text></View>
      <View className='vip-earnings__grid'>
        <View><Text>¥{wallet.balance.toFixed(2)}</Text><Text>可用余额</Text></View>
        <View><Text>¥{wallet.frozen.toFixed(2)}</Text><Text>冻结中</Text></View>
        <View><Text>¥{wallet.total.toFixed(2)}</Text><Text>累计收益</Text></View>
      </View>
      <View className='vip-earnings__breakdown'>
        <View className='vip-earnings__breakdown-item'><View className='vip-earnings__breakdown-dot vip-earnings__breakdown-dot--vip' /><Text>VIP 奖励 ¥{wallet.vip.balance.toFixed(2)}</Text></View>
        <View className='vip-earnings__breakdown-item'><View className='vip-earnings__breakdown-dot vip-earnings__breakdown-dot--normal' /><Text>普通奖励 ¥{wallet.normal.balance.toFixed(2)}</Text></View>
        <View className='vip-earnings__breakdown-item'><View className='vip-earnings__breakdown-dot vip-earnings__breakdown-dot--queue' /><Text>队列奖励 ¥{wallet.queueReward.balance.toFixed(2)}</Text></View>
        {wallet.industryFund ? <View className='vip-earnings__breakdown-item'><View className='vip-earnings__breakdown-dot vip-earnings__breakdown-dot--industry' /><Text>产业基金 ¥{wallet.industryFund.balance.toFixed(2)}</Text></View> : null}
      </View>
    </View> : null}

    <View className='benefits-section-head'><Text>功能入口</Text><Text>会员专属服务</Text></View>
    <View className='benefits-link-grid'>{LINKS.map((item) => <View className='benefits-link aim-card' key={item.title} onClick={() => Taro.navigateTo({ url: item.url })}><Text className={`benefits-link__mark${item.tone ? ` benefits-link__mark--${item.tone}` : ''}`}>{item.mark}</Text><Text className='benefits-link__title'>{item.title}</Text><Text className='benefits-link__meta'>{item.meta}</Text></View>)}</View>

    <View className='benefits-section-head'><Text>VIP 专属权益</Text><Text>规则以结算页与流水为准</Text></View>
    <View className='vip-benefit-list'>{VIP_BENEFITS.map((benefit) => <View className='vip-benefit aim-card' key={benefit.title}><Text className='vip-benefit__mark'>{benefit.mark}</Text><View className='vip-benefit__copy'><View><Text>{benefit.title}</Text><Text>{benefit.highlight}</Text></View><Text>{benefit.description}</Text></View></View>)}</View>

    <View className='benefits-section-head'><Text>奖励规则</Text><Text>普通商品确认收货后计算</Text></View>
    <View className='vip-reward-steps aim-card'>{REWARD_STEPS.map(([step, title, description], index) => <View className='vip-reward-step' key={step}><View className='vip-reward-step__timeline'><Text>{step}</Text>{index < REWARD_STEPS.length - 1 ? <View /> : null}</View><View className='vip-reward-step__copy'><Text>{title}</Text><Text>{description}</Text></View></View>)}</View>
    <View className='benefits-card aim-card'><Text className='benefits-card__title'>三条关键规则</Text><Text className='benefits-card__description'>VIP 开通后不再参与普通用户奖励树；推荐码仅 VIP 可展示和分享；礼包免运费且禁止消费积分抵扣。</Text></View>
    {!isVip ? <Button className='benefits-primary benefits-primary--gold' onClick={() => Taro.navigateTo({ url: '/packages/benefits/vip-gifts/index' })}>选择 VIP 礼包</Button> : null}
    {isVip && member?.referralCode ? <Button className='benefits-primary benefits-primary--gold' onClick={() => Taro.navigateTo({ url: '/packages/referral/center/index' })}>邀请好友成为 VIP</Button> : null}
  </View>;
}
