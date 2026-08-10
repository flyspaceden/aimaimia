import { View } from '@tarojs/components';
import './functional-icon.scss';

export type FunctionalIconName = 'cart' | 'microphone' | 'search' | 'wallet' | 'crown';

type Props = {
  name: FunctionalIconName;
  className?: string;
};

/**
 * 小程序不能依赖系统 emoji 的字形，也不应拿单个汉字冒充功能图标。
 * 这些纯 WXSS 图标会继承父级文字颜色，保证首页、商品页和悬浮入口一致。
 */
export function FunctionalIcon({ name, className = '' }: Props) {
  const classes = `functional-icon functional-icon--${name}${className ? ` ${className}` : ''}`;

  if (name === 'cart') {
    return <View className={classes} aria-hidden>
      <View className='functional-icon__cart-handle' />
      <View className='functional-icon__cart-basket' />
      <View className='functional-icon__cart-wheel functional-icon__cart-wheel--left' />
      <View className='functional-icon__cart-wheel functional-icon__cart-wheel--right' />
    </View>;
  }

  if (name === 'microphone') {
    return <View className={classes} aria-hidden>
      <View className='functional-icon__mic-capsule' />
      <View className='functional-icon__mic-arc' />
      <View className='functional-icon__mic-stem' />
      <View className='functional-icon__mic-base' />
    </View>;
  }

  if (name === 'search') {
    return <View className={classes} aria-hidden>
      <View className='functional-icon__search-lens' />
      <View className='functional-icon__search-handle' />
    </View>;
  }

  if (name === 'wallet') {
    return <View className={classes} aria-hidden>
      <View className='functional-icon__wallet-body' />
      <View className='functional-icon__wallet-clasp'><View /></View>
    </View>;
  }

  return <View className={classes} aria-hidden>
    <View className='functional-icon__crown-spike functional-icon__crown-spike--left' />
    <View className='functional-icon__crown-spike functional-icon__crown-spike--middle' />
    <View className='functional-icon__crown-spike functional-icon__crown-spike--right' />
    <View className='functional-icon__crown-body' />
  </View>;
}
