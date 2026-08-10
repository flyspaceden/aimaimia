import { Text, View } from '@tarojs/components';
import Taro from '@tarojs/taro';
import { useQuery } from '@tanstack/react-query';
import { useAuthStore } from '@/store/auth';
import { BenefitsFeedback } from '../BenefitsFeedback';
import { BenefitsRepo } from '../repos';
import { benefitsLoginUrl, formatDate } from '../utils';
import './index.scss';

export default function NormalTreePage() {
  const hydrated = useAuthStore((state) => state.hydrated);
  const loggedIn = useAuthStore((state) => Boolean(state.accessToken));
  const treeQuery = useQuery({ queryKey: ['benefits', 'normal-tree'], queryFn: BenefitsRepo.getNormalTree, enabled: hydrated && loggedIn });
  if (!hydrated) return <View className='aim-page benefits-page'><BenefitsFeedback kind='loading' /></View>;
  if (!loggedIn) return <View className='aim-page benefits-page'><BenefitsFeedback kind='login' description='登录后查看普通用户树节点与消费进度' actionLabel='去登录' onAction={() => Taro.redirectTo({ url: benefitsLoginUrl('/packages/benefits/normal-tree/index') })} /></View>;
  if (treeQuery.isLoading) return <View className='aim-page benefits-page'><BenefitsFeedback kind='loading' /></View>;
  if (!treeQuery.data?.ok) return <View className='aim-page benefits-page'><BenefitsFeedback kind='error' title='普通树加载失败' description={treeQuery.data && !treeQuery.data.ok ? treeQuery.data.error.displayMessage : undefined} onAction={() => treeQuery.refetch()} /></View>;
  const tree = treeQuery.data.data;
  if (!tree.inTree || !tree.node) return <View className='aim-page benefits-page'><BenefitsFeedback kind='empty' title='尚未进入普通用户树' description='满足资格后，系统会按当前业务规则分配节点' /></View>;
  return <View className='aim-page benefits-page'>
    <View className='benefits-hero'><View className='benefits-hero__orbit' /><Text className='benefits-hero__eyebrow'>NORMAL TREE</Text><Text className='benefits-hero__title'>普通用户成长节点</Text><Text className='benefits-hero__description'>展示我的树中位置和消费解锁进度，子节点仅显示占位情况。</Text><View className='benefits-stat-row'><View><Text>当前层级</Text><Text>L{tree.node.level}</Text></View><View><Text>自购次数</Text><Text>{tree.node.selfPurchaseCount}</Text></View><View><Text>子节点</Text><Text>{tree.node.childrenCount}</Text></View></View></View>
    <View className='benefits-card aim-card'><Text className='benefits-card__title'>路径与状态</Text><Text className='benefits-card__description'>{tree.breadcrumb.length ? tree.breadcrumb.map((item) => item.isRoot ? '系统根节点' : `L${item.level}`).join(' › ') : '当前节点直连根结构'} › 我的 L{tree.node.level}</Text><Text className='benefits-card__meta'>{tree.node.frozenAt ? `冻结时间：${formatDate(tree.node.frozenAt)}` : '当前节点未返回冻结时间'}</Text></View>
    <View className='benefits-section-head'><Text>直属位置</Text><Text>不展示其他用户身份</Text></View>
    {tree.children.length ? <View className='tree-branches'>{tree.children.map((child) => <View className='tree-node aim-card' key={`${child.level}-${child.position}`}><Text className='tree-node__mark'>{child.hasUser ? '苗' : '空'}</Text><Text className='tree-node__title'>L{child.level} · 位置 {child.position + 1}</Text><Text className='tree-node__meta'>{child.hasUser ? `已占位 · 下级 ${child.childrenCount}` : '等待分配'}</Text></View>)}</View> : <BenefitsFeedback kind='empty' title='暂无子节点' />}
    <View className='benefits-card aim-card'><Text className='benefits-card__title'>奖励与进度</Text><Text className='benefits-card__description'>本页展示节点关系；奖励入账、解锁层级与过期时间以钱包流水为准。</Text></View>
  </View>;
}
