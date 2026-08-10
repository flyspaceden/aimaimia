import { Button, Text, View } from '@tarojs/components';
import { SeafoodImage } from './SeafoodImage';
import './catalog-feedback.scss';

type Props = { kind: 'loading' | 'empty' | 'error'; title?: string; description?: string; onRetry?: () => void; actionLabel?: string };

export function CatalogFeedback({ kind, title, description, onRetry, actionLabel }: Props) {
  if (kind === 'loading') {
    return <View className='catalog-feedback catalog-feedback--loading'><View className='catalog-feedback__spinner' /><Text>正在从爱买买加载...</Text></View>;
  }
  return (
    <View className='catalog-feedback aim-card'>
      {kind === 'error'
        ? <Text className='catalog-feedback__symbol catalog-feedback__symbol--error'>!</Text>
        : <View className='catalog-feedback__illustration'><SeafoodImage name='icon-tool-abalone' /></View>}
      <Text className='catalog-feedback__title'>{title ?? (kind === 'error' ? '加载失败' : '暂无内容')}</Text>
      {description ? <Text className='catalog-feedback__description'>{description}</Text> : null}
      {onRetry ? <Button className='catalog-feedback__button' onClick={onRetry}>{actionLabel || '重新加载'}</Button> : null}
    </View>
  );
}
