import React from 'react';
import { StyleProp, View, ViewStyle } from 'react-native';
import { Image } from 'expo-image';

export type SeafoodIconName =
  | 'lobster'
  | 'fish'
  | 'crab'
  | 'scallop'
  | 'puffer'
  | 'seahorse'
  | 'shrimp'
  | 'abalone'
  | 'squid'
  | 'octopus'
  | 'oyster'
  | 'conch'
  | 'starfish'
  | 'seaCucumber'
  | 'supportCrab';

const SEAFOOD_ICON_SOURCES: Record<SeafoodIconName, number> = {
  lobster: require('../../../assets/seafood/icon-order-lobster.png'),
  fish: require('../../../assets/seafood/icon-order-fish.png'),
  crab: require('../../../assets/seafood/icon-order-crab.png'),
  scallop: require('../../../assets/seafood/icon-order-scallop.png'),
  puffer: require('../../../assets/seafood/icon-order-puffer.png'),
  seahorse: require('../../../assets/seafood/icon-tool-seahorse.png'),
  shrimp: require('../../../assets/seafood/icon-tool-shrimp.png'),
  abalone: require('../../../assets/seafood/icon-tool-abalone.png'),
  squid: require('../../../assets/seafood/icon-tool-squid.png'),
  octopus: require('../../../assets/seafood/icon-tool-octopus.png'),
  oyster: require('../../../assets/seafood/icon-tool-oyster.png'),
  conch: require('../../../assets/seafood/icon-tool-conch.png'),
  starfish: require('../../../assets/seafood/icon-tool-starfish.png'),
  seaCucumber: require('../../../assets/seafood/icon-tool-seacucumber.png'),
  supportCrab: require('../../../assets/seafood/icon-tool-support-crab.png'),
};

type SeafoodIconProps = {
  name: SeafoodIconName;
  size?: number;
  opacity?: number;
  style?: StyleProp<ViewStyle>;
  accessibilityLabel?: string;
};

/**
 * 统一渲染透明背景的卡通海鲜角色。
 * 外层尺寸固定，既能保证网格对齐，也不会出现可见的方形底框。
 */
export function SeafoodIcon({
  name,
  size = 40,
  opacity = 1,
  style,
  accessibilityLabel,
}: SeafoodIconProps) {
  return (
    <View
      style={[{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }, style]}
      accessibilityElementsHidden={!accessibilityLabel}
    >
      <Image
        source={SEAFOOD_ICON_SOURCES[name]}
        style={{ width: size, height: size, opacity }}
        contentFit="contain"
        transition={0}
        accessibilityLabel={accessibilityLabel}
      />
    </View>
  );
}
