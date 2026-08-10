import { Button, Text, View } from '@tarojs/components';

type Props = {
  kind: 'loading' | 'empty' | 'error' | 'login';
  title?: string;
  description?: string;
  actionLabel?: string;
  onAction?: () => void;
};

export function BenefitsFeedback({ kind, title, description, actionLabel, onAction }: Props) {
  if (kind === 'loading') return <View className='benefits-feedback benefits-feedback--loading'><View className='benefits-feedback__seed' /><Text>正在加载...</Text></View>;
  const defaults = kind === 'login'
    ? { mark: '爱', title: '请先登录', description: '登录后查看会员身份与权益' }
    : kind === 'error'
      ? { mark: '!', title: '加载失败', description: '请稍后重试' }
      : { mark: '·', title: '暂无数据', description: '暂时没有相关记录' };
  return <View className='benefits-feedback aim-card'>
    <Text className={`benefits-feedback__mark benefits-feedback__mark--${kind}`}>{defaults.mark}</Text>
    <Text className='benefits-feedback__title'>{title || defaults.title}</Text>
    <Text className='benefits-feedback__description'>{description || defaults.description}</Text>
    {onAction ? <Button className='benefits-feedback__action' onClick={onAction}>{actionLabel || '重试'}</Button> : null}
  </View>;
}
