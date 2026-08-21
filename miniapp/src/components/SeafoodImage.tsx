import { Image } from '@tarojs/components';
import type { ComponentProps } from 'react';

export type SeafoodImageName =
  | 'home-lobster'
  | 'home-king-crab'
  | 'icon-order-crab'
  | 'icon-order-fish'
  | 'icon-order-lobster'
  | 'icon-order-puffer'
  | 'icon-order-scallop'
  | 'icon-tool-abalone'
  | 'icon-tool-conch'
  | 'icon-tool-octopus'
  | 'icon-tool-oyster'
  | 'icon-tool-seacucumber'
  | 'icon-tool-seahorse'
  | 'icon-tool-shrimp'
  | 'icon-tool-squid'
  | 'icon-tool-starfish'
  | 'icon-tool-support-crab'
  | 'me-shell-ivory'
  | 'me-shell-mint';

type Props = Omit<ComponentProps<typeof Image>, 'src'> & {
  name: SeafoodImageName;
};

/**
 * App 与小程序共用同一批海鲜角色原图。构建时由 Taro copy 规则放入
 * dist/assets/seafood，避免两端各维护一套视觉素材。
 */
export function SeafoodImage({ name, mode = 'aspectFit', ...props }: Props) {
  return <Image {...props} mode={mode} src={`/assets/seafood/${name}.png`} />;
}
