import { Button, Text, View } from '@tarojs/components';

type Props = {
  kind: 'loading' | 'empty' | 'error' | 'login';
  title?: string;
  description?: string;
  actionLabel?: string;
  onAction?: () => void;
};

export function MemberFeedback({ kind, title, description, actionLabel, onAction }: Props) {
  if (kind === 'loading') {
    return <View className='member-feedback member-feedback--loading'><View className='member-feedback__pulse' /><Text>正在读取服务端数据...</Text></View>;
  }
  const defaults = kind === 'login'
    ? { mark: '爱', title: '请先登录', description: '登录后查看与 App 同步的账户资产' }
    : kind === 'error'
      ? { mark: '!', title: '加载失败', description: '请稍后重试' }
      : { mark: '·', title: '暂无记录', description: '服务端暂时没有相关数据' };
  return <View className='member-feedback aim-card'>
    <Text className={`member-feedback__mark member-feedback__mark--${kind}`}>{defaults.mark}</Text>
    <Text className='member-feedback__title'>{title || defaults.title}</Text>
    <Text className='member-feedback__description'>{description || defaults.description}</Text>
    {onAction ? <Button className='member-feedback__action' onClick={onAction}>{actionLabel || '重试'}</Button> : null}
  </View>;
}
