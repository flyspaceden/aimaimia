import { Button, Text, View } from '@tarojs/components';
import { SeafoodImage } from '@/components/SeafoodImage';

type Props = {
  kind: 'loading' | 'empty' | 'error' | 'login';
  title?: string;
  description?: string;
  actionLabel?: string;
  onAction?: () => void;
};

export function MemberFeedback({ kind, title, description, actionLabel, onAction }: Props) {
  if (kind === 'loading') {
    return <View className='member-feedback member-feedback--loading'><View className='member-feedback__pulse' /><Text>正在加载...</Text></View>;
  }
  const defaults = kind === 'login'
    ? { title: '请先登录', description: '登录后查看账户资产' }
    : kind === 'error'
      ? { title: '加载失败', description: '请稍后重试' }
      : { title: '暂无记录', description: '暂时没有相关数据' };
  return <View className='member-feedback aim-card'>
    {kind === 'error'
      ? <Text className='member-feedback__mark member-feedback__mark--error'>!</Text>
      : <View className={`member-feedback__illustration member-feedback__illustration--${kind}`}><SeafoodImage name={kind === 'login' ? 'icon-order-puffer' : 'icon-tool-abalone'} /></View>}
    <Text className='member-feedback__title'>{title || defaults.title}</Text>
    <Text className='member-feedback__description'>{description || defaults.description}</Text>
    {onAction ? <Button className='member-feedback__action' onClick={onAction}>{actionLabel || '重试'}</Button> : null}
  </View>;
}
