import React from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTheme } from '../../theme';
import { CategoryItem } from '../../constants';

type CategoryGridProps = {
  data: CategoryItem[];
  onSelect?: (item: CategoryItem) => void;
};

// 分类宫格：首页快捷入口
export const CategoryGrid = ({ data, onSelect }: CategoryGridProps) => {
  const { colors, radius, spacing, typography } = useTheme();
  const palette = [
    { bg: colors.brand.primarySoft, icon: colors.brand.primary },
    { bg: colors.accent.blueSoft, icon: colors.accent.blue },
    { bg: colors.skeleton, icon: colors.brand.primaryDark },
    { bg: colors.background, icon: colors.text.secondary },
  ];

  return (
    <FlatList
      data={data}
      numColumns={4}
      scrollEnabled={false}
      columnWrapperStyle={{ justifyContent: 'space-between', marginBottom: spacing.md }}
      keyExtractor={(item) => item.id}
      renderItem={({ item, index }) => {
        const tone = palette[index % palette.length];

        return (
          <Pressable onPress={() => onSelect?.(item)} style={styles.item}>
            <View
              style={{
                width: 56,
                height: 56,
                borderRadius: radius.lg,
                backgroundColor: tone.bg,
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <MaterialCommunityIcons name={item.icon as any} size={24} color={tone.icon} />
            </View>
            <Text style={[typography.caption, { color: colors.text.secondary, marginTop: spacing.xs }]}>
              {item.name}
            </Text>
          </Pressable>
        );
      }}
    />
  );
};

const styles = StyleSheet.create({
  item: {
    alignItems: 'center',
    width: '24%',
  },
});
