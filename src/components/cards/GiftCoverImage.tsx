/**
 * 赠品封面图组件 — 根据 coverMode 渲染组合封面
 * 从 app/vip/gifts.tsx 提取为共享组件，供 VIP 赠品选择页和结算页共用
 */
import React, { useState } from 'react';
import { LayoutChangeEvent, StyleSheet, Text, View } from 'react-native';
import { Image } from 'expo-image';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import Svg, { Defs, ClipPath, Polygon, Line, Image as SvgImage } from 'react-native-svg';
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

  // AUTO_DIAGONAL — 对角线分割布局（SVG ClipPath 实现真正对角线裁剪）
  if (coverMode === 'AUTO_DIAGONAL' && images.length >= 2) {
    return <DiagonalCover images={images} style={style} />;
  }

  // AUTO_STACKED — 层叠卡片布局（大图在底，小图叠在右下）
  if (coverMode === 'AUTO_STACKED' && images.length >= 2) {
    return (
      <View style={[style, coverStyles.container]}>
        {/* 底层大图 — 左上 */}
        <View style={coverStyles.stackedBase}>
          <Image
            source={{ uri: images[0] }}
            style={coverStyles.stackedImage}
            contentFit="cover"
            transition={300}
          />
        </View>
        {/* 叠加小图 — 右下，带白色边框 */}
        <View style={coverStyles.stackedOverlay}>
          <Image
            source={{ uri: images[1] }}
            style={coverStyles.stackedImage}
            contentFit="cover"
            transition={300}
          />
        </View>
        {/* 第三张（可选）— 右上角更小 */}
        {images.length >= 3 && (
          <View style={coverStyles.stackedThird}>
            <Image
              source={{ uri: images[2] }}
              style={coverStyles.stackedImage}
              contentFit="cover"
              transition={300}
            />
          </View>
        )}
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

/** 对角线分割子组件 — 使用 SVG ClipPath + SVG Image 实现真正的对角线裁剪 */
function DiagonalCover({ images, style }: { images: string[]; style: any }) {
  const [size, setSize] = useState({ w: 0, h: 0 });
  const onLayout = (e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    if (width !== size.w || height !== size.h) {
      setSize({ w: width, h: height });
    }
  };
  const { w, h } = size;

  return (
    <View style={[style, coverStyles.container]} onLayout={onLayout}>
      {w > 0 && h > 0 && (
        <Svg width={w} height={h}>
          <Defs>
            <ClipPath id="diag-tl">
              <Polygon points={`0,0 ${w},0 0,${h}`} />
            </ClipPath>
            <ClipPath id="diag-br">
              <Polygon points={`${w},0 ${w},${h} 0,${h}`} />
            </ClipPath>
          </Defs>
          {/* 图片1：左上三角 */}
          <SvgImage
            href={{ uri: images[0] }}
            x={0} y={0} width={w} height={h}
            preserveAspectRatio="xMidYMid slice"
            clipPath="url(#diag-tl)"
          />
          {/* 图片2：右下三角 */}
          <SvgImage
            href={{ uri: images[1] }}
            x={0} y={0} width={w} height={h}
            preserveAspectRatio="xMidYMid slice"
            clipPath="url(#diag-br)"
          />
          {/* 对角线分割线 */}
          <Line x1={0} y1={h} x2={w} y2={0} stroke="rgba(255,255,255,0.35)" strokeWidth={2} />
        </Svg>
      )}
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
  // AUTO_DIAGONAL 布局（SVG ClipPath，样式在 DiagonalCover 组件内处理）
  // AUTO_STACKED 布局
  stackedBase: {
    position: 'absolute',
    top: '5%',
    left: '5%',
    width: '68%',
    height: '68%',
    borderRadius: 12,
    overflow: 'hidden',
    zIndex: 1,
    shadowColor: '#000',
    shadowOpacity: 0.15,
    shadowOffset: { width: 2, height: 2 },
    shadowRadius: 6,
    elevation: 3,
  },
  stackedOverlay: {
    position: 'absolute',
    bottom: '5%',
    right: '5%',
    width: '55%',
    height: '55%',
    borderRadius: 10,
    overflow: 'hidden',
    zIndex: 2,
    borderWidth: 2,
    borderColor: '#fff',
    shadowColor: '#000',
    shadowOpacity: 0.25,
    shadowOffset: { width: 2, height: 2 },
    shadowRadius: 6,
    elevation: 5,
  },
  stackedThird: {
    position: 'absolute',
    top: '15%',
    right: '8%',
    width: '42%',
    height: '42%',
    borderRadius: 8,
    overflow: 'hidden',
    zIndex: 3,
    borderWidth: 2,
    borderColor: '#fff',
    shadowColor: '#000',
    shadowOpacity: 0.2,
    shadowOffset: { width: 1, height: 1 },
    shadowRadius: 4,
    elevation: 4,
  },
  stackedImage: {
    width: '100%',
    height: '100%',
  },
});
