import { Button, Image, Input, Text, View } from '@tarojs/components';
import Taro from '@tarojs/taro';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { CatalogFeedback } from '@/components/catalog-feedback';
import { useAuthStore } from '@/store/auth';
import { CommunityRepo } from '../repo';
import type { Author } from '../types';
import { authorSearchText, formatDate } from '../utils';
import './index.scss';

type PrimaryTab = 'following' | 'followers';
type AuthorTab = 'user' | 'company';

export default function FollowingPage() {
  const hydrated = useAuthStore((state) => state.hydrated);
  const loggedIn = useAuthStore((state) => Boolean(state.accessToken));
  const authRevision = useAuthStore((state) => state.revision);
  const [primaryTab, setPrimaryTab] = useState<PrimaryTab>('following');
  const [authorTab, setAuthorTab] = useState<AuthorTab>('user');
  const [sort, setSort] = useState<'recent' | 'active'>('recent');
  const [keyword, setKeyword] = useState('');
  const query = useQuery({ queryKey: ['community', 'following', authRevision, sort], queryFn: () => CommunityRepo.following(sort), enabled: hydrated && loggedIn && primaryTab === 'following', staleTime: 0 });
  const mutation = useMutation({
    mutationFn: CommunityRepo.toggleFollow,
    onSuccess: async (result) => {
      if (!result.ok) { await Taro.showToast({ title: result.error.displayMessage || '操作失败', icon: 'none' }); return; }
      await Taro.showToast({ title: result.data.isFollowed ? '已关注' : '已取消关注', icon: 'success' });
      await query.refetch();
    },
  });
  useEffect(() => { setKeyword(''); setPrimaryTab('following'); setAuthorTab('user'); }, [authRevision]);
  const items = useMemo(() => {
    const all = query.data?.ok ? query.data.data : [];
    const term = keyword.trim().toLowerCase();
    return all.filter((item) => item.author.type === authorTab && (!term || authorSearchText(item.author).includes(term)));
  }, [authorTab, keyword, query.data]);
  const openAuthor = (author: Author) => {
    if (author.type === 'company') { void Taro.navigateTo({ url: `/packages/commerce/catalog-company/index?id=${encodeURIComponent(author.companyId || author.id)}` }); return; }
    void Taro.navigateTo({ url: `/packages/community/author-detail/index?id=${encodeURIComponent(author.id)}` });
  };

  if (!hydrated) return <View className='aim-page'><CatalogFeedback kind='loading' /></View>;
  if (!loggedIn) return <View className='aim-page'><CatalogFeedback kind='empty' title='请先登录' description='登录后可查看你关注的用户与企业' actionLabel='去登录' onRetry={() => Taro.redirectTo({ url: `/packages/account/account-login/index?returnUrl=${encodeURIComponent('/packages/community/following/index')}` })} /></View>;

  return <View className='following-page'>
    <View className='following-tabs'><View className={primaryTab === 'following' ? 'following-tab following-tab--active' : 'following-tab'} onClick={() => setPrimaryTab('following')}><Text>我的关注</Text><Text>已建立的关系</Text></View><View className={primaryTab === 'followers' ? 'following-tab following-tab--active' : 'following-tab'} onClick={() => setPrimaryTab('followers')}><Text>粉丝</Text><Text>谁关注了我</Text></View></View>
    {primaryTab === 'followers' ? <View className='following-limitation aim-card'><View className='following-limitation__mark'>···</View><Text>粉丝明细暂未开放</Text><Text>当前服务只返回作者的粉丝数量，没有提供“谁关注了我”的名单。因此这里不会用虚拟数据填充。</Text></View> : <>
      <View className='following-controls aim-card'><View className='following-segments'><Text className={authorTab === 'user' ? 'following-segment following-segment--active' : 'following-segment'} onClick={() => setAuthorTab('user')}>用户</Text><Text className={authorTab === 'company' ? 'following-segment following-segment--active' : 'following-segment'} onClick={() => setAuthorTab('company')}>企业</Text></View><Input className='following-search' value={keyword} maxlength={40} placeholder='搜索名称、标签或城市' onInput={(event) => setKeyword(event.detail.value)} /><View className='following-sort'><Text className={sort === 'recent' ? 'following-sort__active' : ''} onClick={() => setSort('recent')}>最近关注</Text><Text className={sort === 'active' ? 'following-sort__active' : ''} onClick={() => setSort('active')}>粉丝较多</Text></View></View>
      {query.isLoading ? <CatalogFeedback kind='loading' /> : !query.data?.ok ? <CatalogFeedback kind='error' title='关注列表加载失败' description={query.data?.error.displayMessage || '请稍后重试'} onRetry={() => query.refetch()} /> : !items.length ? <CatalogFeedback kind='empty' title={keyword.trim() ? '未找到匹配结果' : `暂无关注的${authorTab === 'user' ? '用户' : '企业'}`} description={keyword.trim() ? '试试更换关键词' : '从首页和发现内容中关注感兴趣的作者'} /> : <View className='following-list'>{items.map((item) => <View className='following-card aim-card' key={item.author.id} onClick={() => openAuthor(item.author)}>{item.author.avatar ? <Image className='following-card__avatar' src={item.author.avatar} mode='aspectFill' /> : <View className='following-card__avatar following-card__avatar--empty'>{item.author.type === 'company' ? '企' : '人'}</View>}<View className='following-card__copy'><View><Text>{item.author.name}</Text>{item.author.verified ? <Text>实</Text> : null}</View><Text>{item.author.title || item.author.tags?.[0] || (item.author.type === 'company' ? '平台入驻企业' : '爱买买用户')}</Text><Text>{item.author.city || '地区未填写'} · {formatDate(item.followedAt)}</Text></View><View className='following-card__end'><Text>{item.author.followerCount || 0}</Text><Text>粉丝</Text><Button loading={mutation.isPending && mutation.variables === item.author.id} disabled={mutation.isPending} onClick={(event) => { event.stopPropagation(); mutation.mutate(item.author.id); }}>已关注</Button></View></View>)}</View>}
    </>}
  </View>;
}
