import { Text, View } from '@tarojs/components';
import Taro from '@tarojs/taro';
import { useQuery } from '@tanstack/react-query';
import { useAuthStore } from '@/store/auth';
import { BenefitsFeedback } from '../BenefitsFeedback';
import { BenefitsRepo } from '../repos';
import { benefitsLoginUrl } from '../utils';
import './index.scss';

export default function VipTreePage() {
  const hydrated = useAuthStore((state) => state.hydrated);
  const loggedIn = useAuthStore((state) => Boolean(state.accessToken));
  const treeQuery = useQuery({ queryKey: ['benefits', 'vip-tree'], queryFn: BenefitsRepo.getVipTree, enabled: hydrated && loggedIn });
  const memberQuery = useQuery({ queryKey: ['benefits', 'member'], queryFn: BenefitsRepo.getMember, enabled: hydrated && loggedIn });
  if (!hydrated) return <View className='aim-page benefits-page'><BenefitsFeedback kind='loading' /></View>;
  if (!loggedIn) return <View className='aim-page benefits-page'><BenefitsFeedback kind='login' description='登录后查看你在 VIP 树中的节点' actionLabel='去登录' onAction={() => Taro.redirectTo({ url: benefitsLoginUrl('/packages/benefits/vip-tree/index') })} /></View>;
  if (treeQuery.isLoading || memberQuery.isLoading) return <View className='aim-page benefits-page'><BenefitsFeedback kind='loading' /></View>;
  if (!treeQuery.data?.ok || !memberQuery.data?.ok) return <View className='aim-page benefits-page'><BenefitsFeedback kind='error' title='VIP 树加载失败' onAction={() => { void treeQuery.refetch(); void memberQuery.refetch(); }} /></View>;
  const tree = treeQuery.data.data;
  const member = memberQuery.data.data;
  if (member.tier !== 'VIP' || !tree.node) return <View className='aim-page benefits-page'><BenefitsFeedback kind='empty' title='尚未进入 VIP 树' description='购买 VIP 礼包并支付成功后，节点会在这里展示' actionLabel='查看 VIP 礼包' onAction={() => Taro.redirectTo({ url: '/packages/benefits/vip-gifts/index' })} /></View>;

  return <View className='aim-page benefits-page'>
    <View className='benefits-hero'><View className='benefits-hero__orbit' /><Text className='benefits-hero__eyebrow'>VIP TREE</Text><Text className='benefits-hero__title'>我的 VIP 节点</Text><Text className='benefits-hero__description'>仅展示层级、位置和子节点数，不暴露其他用户的姓名、手机号等身份信息。</Text><View className='benefits-stat-row'><View><Text>当前层级</Text><Text>L{tree.node.level}</Text></View><View><Text>位置</Text><Text>{tree.node.position + 1}</Text></View><View><Text>直属节点</Text><Text>{tree.node.childrenCount}</Text></View></View></View>
    <View className='benefits-section-head'><Text>节点结构</Text><Text>当前两层</Text></View>
    <View className='tree-root aim-card'><Text className='tree-root__mark'>我</Text><Text className='tree-root__title'>L{tree.node.level} · 第 {tree.node.position + 1} 位</Text><Text className='tree-root__meta'>直属 {tree.node.childrenCount} 个节点</Text></View>
    {tree.children.length ? <View className='tree-branches'>{tree.children.map((child) => <View className='tree-node aim-card' key={child.id}><Text className='tree-node__mark'>L{child.level}</Text><Text className='tree-node__title'>位置 {child.position + 1}</Text><Text className='tree-node__meta'>下级 {child.childrenCount}</Text>{child.children?.length ? <Text className='tree-node__meta'>次级 {child.children.length}</Text> : null}</View>)}</View> : <BenefitsFeedback kind='empty' title='暂无直属节点' description='新节点进入后会自动更新' />}
    <View className='benefits-card aim-card'><Text className='benefits-card__title'>奖励口径</Text><Text className='benefits-card__description'>树结构只用于展示当前节点关系；实际奖励、冻结和可用状态以钱包流水为准。</Text></View>
  </View>;
}
