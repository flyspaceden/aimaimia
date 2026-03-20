/**
 * 赠品封面图组件 — 根据 coverMode 渲染组合封面
 * 从 app/vip/gifts.tsx 提取为共享组件，供 VIP 赠品选择页和结算页共用
 */
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Image } from 'expo-image';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import type { CoverMode, VipGiftItemInfo } from '../../types/domain/Bonus';

interface GiftCoverImageProps {
  items: Pick<VipGiftItemInfo, 'productImage'>[];
  coverMode: CoverMode;
  coverUrl: string | null | undefined;
  style: any;
  /** 回退占位图标颜色，默认 #C9A96E */
  placeholderColor?: string;
  /** 回退占位背景色，默认 rgba(255,255,255,0.03) */
  placeholderBg?: string;
}

export function GiftCoverImage({
  items,
  coverMode,
  coverUrl,
  style,
  placeholderColor = '#C9A96E',
  placeholderBg = 'rgba(255,255,255,0.03)',
}: GiftCoverImageProps) {
  // 收集有效的产品图片
  const images = items.map((it) => it.productImage).filter(Boolean) as string[];

  // 单个商品 — 直接显示产品图
  if (items.length === 1 && items[0].productImage) {
    return (
      <Image
        source={{ uri: items[0].productImage }}
        style={style}
        contentFit="cover"
        transition={300}
      />
    );
  }

  // CUSTOM 模式且有自定义封面 — 显示自定义封面
  if (coverMode === 'CUSTOM' && coverUrl) {
    return (
      <Image
        source={{ uri: coverUrl }}
        style={style}
        contentFit="cover"
        transition={300}
      />
    );
  }

  // 没有任何图片 — 回退占位
  if (images.length === 0) {
    return (
      <View style={[style, coverStyles.placeholder, { backgroundColor: placeholderBg }]}>
        <MaterialCommunityIcons name="gift" size={48} color={placeholderColor} />
      </View>
    );
  }

  // AUTO_DIAGONAL — 两张图对角线布局
  if (coverMode === 'AUTO_DIAGONAL' && images.length >= 2) {
    return (
      <View style={[style, coverStyles.container]}>
        <View style={coverStyles.diagonalTop}>
          <Image
            source={{ uri: images[0] }}
            style={coverStyles.diagonalImage}
            contentFit="cover"
            transition={300}
          />
        </View>
        <View style={coverStyles.diagonalBottom}>
          <Image
            source={{ uri: images[1] }}
            style={coverStyles.diagonalImage}
            contentFit="cover"
            transition={300}
          />
        </View>
      </View>
    );
  }

  // AUTO_STACKED — 层叠偏移布局
  if (coverMode === 'AUTO_STACKED' && images.length >= 2) {
    const stackImages = images.slice(0, 3);
    return (
      <View style={[style, coverStyles.container]}>
        {stackImages.map((uri, i) => (
          <View
            key={i}
            style={[
              coverStyles.stackedItem,
              {
                left: 10 + i * 20,
                top: 10 + i * 12,
                zIndex: stackImages.length - i,
              },
            ]}
          >
            <Image
              source={{ uri }}
              style={coverStyles.stackedImage}
              contentFit="cover"
              transition={300}
            />
          </View>
        ))}
      </View>
    );
  }

  // AUTO_GRID（默认）— 网格布局
  const gridImages = images.slice(0, 5);
  const showMore = images.length > 4;
  const displayImages = showMore ? images.slice(0, 4) : gridImages;

  // 2 张：并排
  if (displayImages.length === 2) {
    return (
      <View style={[style, coverStyles.container, coverStyles.gridRow]}>
        <Image source={{ uri: displayImages[0] }} style={coverStyles.gridHalf} contentFit="cover" transition={300} />
        <Image source={{ uri: displayImages[1] }} style={coverStyles.gridHalf} contentFit="cover" transition={300} />
      </View>
    );
  }

  // 3 张：上1下2
  if (displayImages.length === 3) {
    return (
      <View style={[style, coverStyles.container]}>
        <View style={coverStyles.gridTopRow}>
          <Image source={{ uri: displayImages[0] }} style={coverStyles.gridFull} contentFit="cover" transition={300} />
        </View>
        <View style={coverStyles.gridBottomRow}>
          <Image source={{ uri: displayImages[1] }} style={coverStyles.gridHalf} contentFit="cover" transition={300} />
          <Image source={{ uri: displayImages[2] }} style={coverStyles.gridHalf} contentFit="cover" transition={300} />
        </View>
      </View>
    );
  }

  // 4+ 张：2×2 网格 + 可选 "+N" 角标
  return (
    <View style={[style, coverStyles.container, coverStyles.gridWrap]}>
      {displayImages.map((uri, i) => (
        <View key={i} style={coverStyles.gridQuarter}>
          <Image source={{ uri }} style={coverStyles.gridQuarterImage} contentFit="cover" transition={300} />
        </View>
      ))}
      {showMore ? (
        <View style={coverStyles.moreOverlay}>
          <Text style={coverStyles.moreText}>+{images.length - 4}</Text>
        </View>
      ) : null}
    </View>
  );
}

const coverStyles = StyleSheet.create({
  container: {
    overflow: 'hidden',
  },
  placeholder: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  // AUTO_GRID 布局
  gridRow: {
    flexDirection: 'row',
  },
  gridHalf: {
    flex: 1,
    height: '100%',
  },
  gridTopRow: {
    flex: 1,
  },
  gridBottomRow: {
    flex: 1,
    flexDirection: 'row',
  },
  gridFull: {
    width: '100%',
    height: '100%',
  },
  gridWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  gridQuarter: {
    width: '50%',
    height: '50%',
  },
  gridQuarterImage: {
    width: '100%',
    height: '100%',
  },
  moreOverlay: {
    position: 'absolute',
    right: 0,
    bottom: 0,
    width: '50%',
    height: '50%',
    backgroundColor: 'rgba(0,0,0,0.55)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  moreText: {
    fontSize: 18,
    fontWeight: '700',
    color: '#fff',
  },
  // AUTO_DIAGONAL 布局
  diagonalTop: {
    position: 'absolute',
    top: 0,
    left: 0,
    width: '65%',
    height: '65%',
    borderBottomRightRadius: 16,
    overflow: 'hidden',
  },
  diagonalBottom: {
    position: 'absolute',
    bottom: 0,
    right: 0,
    width: '65%',
    height: '65%',
    borderTopLeftRadius: 16,
    overflow: 'hidden',
  },
  diagonalImage: {
    width: '100%',
    height: '100%',
  },
  // AUTO_STACKED 布局
  stackedItem: {
    position: 'absolute',
    width: '60%',
    height: '70%',
    borderRadius: 12,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOpacity: 0.3,
    shadowOffset: { width: 2, height: 2 },
    shadowRadius: 4,
    elevation: 4,
  },
  stackedImage: {
    width: '100%',
    height: '100%',
  },
});
