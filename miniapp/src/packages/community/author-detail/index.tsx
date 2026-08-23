import { Button, Image, Text, View } from '@tarojs/components';
import Taro, { useRouter } from '@tarojs/taro';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CatalogFeedback } from '@/components/catalog-feedback';
import { useAuthStore } from '@/store/auth';
import { CommunityRepo } from '../repo';
import './index.scss';

export default function AuthorDetailPage() {
  const router = useRouter();
  const id = typeof router.params.id === 'string' ? router.params.id : '';
  const hydrated = useAuthStore((state) => state.hydrated);
  const loggedIn = useAuthStore((state) => Boolean(state.accessToken));
  const authRevision = useAuthStore((state) => state.revision);
  const queryClient = useQueryClient();
  const query = useQuery({ queryKey: ['community', 'author', authRevision, id], queryFn: () => CommunityRepo.author(id), enabled: hydrated && loggedIn && Boolean(id), staleTime: 0 });
  const author = query.data?.ok ? query.data.data : undefined;
  const mutation = useMutation({ mutationFn: () => CommunityRepo.toggleFollow(id), onSuccess: async (result) => {
    if (!result.ok) { await Taro.showToast({ title: result.error.displayMessage || '操作失败', icon: 'none' }); return; }
    await Promise.all([query.refetch(), queryClient.invalidateQueries({ queryKey: ['community', 'following', authRevision] })]);
  } });

  if (!hydrated) return <View className='aim-page'><CatalogFeedback kind='loading' /></View>;
  if (!loggedIn) return <View className='aim-page'><CatalogFeedback kind='empty' title='请先登录' description='登录后才能查看作者资料和关注状态' actionLabel='去登录' onRetry={() => Taro.redirectTo({ url: `/packages/account/account-login/index?returnUrl=${encodeURIComponent(`/packages/community/author-detail/index?id=${encodeURIComponent(id)}`)}` })} /></View>;
  if (!id || query.isLoading) return <View className='aim-page'><CatalogFeedback kind={id ? 'loading' : 'error'} title={id ? undefined : '缺少用户信息'} /></View>;
  if (!query.data?.ok || !author) return <View className='aim-page'><CatalogFeedback kind='error' title='作者资料加载失败' description={query.data && !query.data.ok ? query.data.error.displayMessage : '请稍后重试'} onRetry={() => query.refetch()} /></View>;
  return <View className='author-page'>
    <View className='author-hero'><View className='author-hero__rings' />{author.avatar ? <Image className='author-avatar' src={author.avatar} mode='aspectFill' /> : <View className='author-avatar author-avatar--empty'>{author.type === 'company' ? '企' : '人'}</View>}<Text className='author-name'>{author.name}</Text><Text className='author-title'>{author.title || (author.type === 'company' ? '平台入驻企业' : 'AI爱买买用户')}</Text><View className='author-metrics'><View><Text>{author.followerCount || 0}</Text><Text>粉丝</Text></View><View><Text>{author.city || '未填写'}</Text><Text>所在地</Text></View></View></View>
    {(author.interestTags?.length || author.tags?.length) ? <View className='author-panel aim-card'><Text>兴趣与标签</Text><View>{[...(author.interestTags || []), ...(author.tags || [])].filter((value, index, list) => list.indexOf(value) === index).map((tag) => <Text key={tag}>{tag}</Text>)}</View></View> : null}
    <View className='author-actions'><Button loading={mutation.isPending} disabled={mutation.isPending} onClick={() => mutation.mutate()}>{author.isFollowed ? '取消关注' : '+ 关注'}</Button>{author.type === 'company' ? <Button className='author-actions__secondary' onClick={() => Taro.navigateTo({ url: `/packages/commerce/catalog-company/index?id=${encodeURIComponent(author.companyId || author.id)}` })}>查看企业商品</Button> : null}</View>
  </View>;
}
