import { Button, Text, View } from '@tarojs/components';
import './account-feedback.scss';

type Props = {
  kind: 'loading' | 'empty' | 'error';
  title?: string;
  description?: string;
  actionLabel?: string;
  onAction?: () => void;
};

export function AccountFeedback({ kind, title, description, actionLabel, onAction }: Props) {
  if (kind === 'loading') return <View className='account-feedback account-feedback--loading'><View className='account-feedback__pulse' /><Text>正在加载账户信息...</Text></View>;
  return <View className='account-feedback aim-card'>
    <Text className='account-feedback__mark'>{kind === 'error' ? '!' : '人'}</Text>
    <Text className='account-feedback__title'>{title ?? (kind === 'error' ? '加载失败' : '暂无内容')}</Text>
    {description ? <Text className='account-feedback__description'>{description}</Text> : null}
    {onAction ? <Button className='account-feedback__action' onClick={onAction}>{actionLabel ?? '重试'}</Button> : null}
  </View>;
}
