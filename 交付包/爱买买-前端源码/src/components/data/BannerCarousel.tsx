import React from 'react';
import { ScrollView, StyleSheet, View, useWindowDimensions } from 'react-native';
import { Image } from 'expo-image';
import { useTheme } from '../../theme';

type BannerCarouselProps = {
  images: string[];
  height?: number;
};

// 轮播图：首页活动/推荐入口
export const BannerCarousel = ({ images, height = 160 }: BannerCarouselProps) => {
  const { width } = useWindowDimensions();
  const { radius, spacing } = useTheme();
  const itemWidth = width - spacing.xl * 2;

  return (
    <ScrollView
      horizontal
      pagingEnabled
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.container}
    >
      {images.map((uri, index) => (
        <View
          key={`${uri}-${index}`}
          style={{ width: itemWidth, marginRight: index === images.length - 1 ? 0 : 12 }}
        >
          <Image
            source={{ uri }}
            style={{ height, borderRadius: radius.lg, width: '100%' }}
            contentFit="cover"
          />
        </View>
      ))}
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: {},
});
