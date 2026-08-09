import { Text, View } from '@tarojs/components';
import type { PropsWithChildren } from 'react';
import './PageHeader.scss';

type Props = PropsWithChildren<{ title: string; eyebrow?: string }>;

export function PageHeader({ title, eyebrow, children }: Props) {
  return (
    <View className='page-header'>
      <View className='page-header__copy'>
        {eyebrow ? <Text className='page-header__eyebrow'>{eyebrow}</Text> : null}
        <Text className='page-header__title'>{title}</Text>
      </View>
      {children}
    </View>
  );
}
