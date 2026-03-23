import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { BlurView } from 'expo-blur';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import Animated, {
  FadeIn,
  FadeOut,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withTiming,
} from 'react-native-reanimated';
import { AiBadge } from '../ui/AiBadge';
import { AiDivider } from '../ui/AiDivider';
import { useRecentSearches } from '../../hooks/useRecentSearches';
import { HOT_SEARCHES, AI_SUGGESTED_SEARCHES } from '../../constants/search';
import { useTheme } from '../../theme';
import { animation } from '../../theme/animation';

interface SearchOverlayProps {
  visible: boolean;
  onClose: () => void;
}

// AI 聚光搜索覆盖层
export function SearchOverlay({ visible, onClose }: SearchOverlayProps) {
  const { colors, radius, spacing, typography } = useTheme();
  const router = useRouter();
  const inputRef = useRef<TextInput>(null);
  const [query, setQuery] = useState('');
  const { recent, add: addRecent, clear: clearRecent } = useRecentSearches();

  // Stagger 动画值（3 个区块）
  const sectionOpacity = [
    useSharedValue(0),
    useSharedValue(0),
    useSharedValue(0),
  ];
  const sectionTranslateY = [
    useSharedValue(12),
    useSharedValue(12),
    useSharedValue(12),
  ];

  // 打开时自动聚焦 + stagger 区块渐入
  useEffect(() => {
    if (visible) {
      setQuery('');
      const timer = setTimeout(() => inputRef.current?.focus(), 100);
      // stagger 渐入各区块
      sectionOpacity.forEach((sv, i) => {
        sv.value = withDelay(
          i * animation.stagger.listItem,
          withTiming(1, { duration: animation.duration.standard })
        );
      });
      sectionTranslateY.forEach((sv, i) => {
        sv.value = withDelay(
          i * animation.stagger.listItem,
          withTiming(0, { duration: animation.duration.standard })
        );
      });
      return () => clearTimeout(timer);
    } else {
      // 关闭时重置
      sectionOpacity.forEach((sv) => { sv.value = 0; });
      sectionTranslateY.forEach((sv) => { sv.value = 12; });
    }
  }, [visible]);

  const sectionStyles = sectionOpacity.map((opacity, i) =>
    // eslint-disable-next-line react-hooks/rules-of-hooks
    useAnimatedStyle(() => ({
      opacity: opacity.value,
      transform: [{ translateY: sectionTranslateY[i].value }],
    }))
  );

  // 点击词条 → 导航搜索结果页
  const handleSelect = useCallback(
    (keyword: string) => {
      addRecent(keyword);
      onClose();
      router.push({ pathname: '/search', params: { q: keyword } });
    },
    [addRecent, onClose, router]
  );

  // 输入回车
  const handleSubmit = useCallback(() => {
    const term = query.trim();
    if (!term) return;
    handleSelect(term);
  }, [query, handleSelect]);

  if (!visible) return null;

  return (
    <Animated.View
      entering={FadeIn.duration(animation.duration.standard)}
      exiting={FadeOut.duration(animation.duration.micro)}
      style={[StyleSheet.absoluteFill, { zIndex: 100 }]}
    >
      {/* 毛玻璃背景 */}
      <BlurView intensity={80} tint="light" style={StyleSheet.absoluteFill} />
      <View style={[StyleSheet.absoluteFill, { backgroundColor: colors.overlay }]} />

      {/* 点击背景关闭 */}
      <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />

      {/* 面板内容 — box-none 让非子元素区域的点击穿透到背景 Pressable */}
      <View style={styles.panel} pointerEvents="box-none">
        {/* 搜索输入框 */}
        <View style={[styles.searchBar, { paddingHorizontal: spacing.xl, paddingVertical: spacing.sm }]}>
          <View
            style={[
              styles.inputWrap,
              { backgroundColor: colors.surface, borderRadius: radius.lg, borderColor: colors.border, borderWidth: 1 },
            ]}
          >
            <MaterialCommunityIcons name="magnify" size={20} color={colors.muted} />
            <TextInput
              ref={inputRef}
              value={query}
              onChangeText={setQuery}
              onSubmitEditing={handleSubmit}
              placeholder="搜索商品、企业、产地..."
              placeholderTextColor={colors.muted}
              returnKeyType="search"
              style={[styles.input, typography.bodySm, { color: colors.text.primary }]}
            />
            {query.length > 0 && (
              <Pressable onPress={() => setQuery('')} hitSlop={8}>
                <MaterialCommunityIcons name="close-circle" size={18} color={colors.muted} />
              </Pressable>
            )}
          </View>
          <Pressable onPress={onClose} hitSlop={8} style={{ marginLeft: spacing.md }}>
            <Text style={[typography.bodyStrong, { color: colors.text.secondary }]}>取消</Text>
          </Pressable>
        </View>

        <AiDivider />

        <ScrollView
          contentContainerStyle={{ flexGrow: 1, padding: spacing.xl, paddingBottom: spacing['3xl'] }}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {/* 点击空白区域关闭 — 内层 Pressable 覆盖整个滚动区，
              子元素的 Pressable 优先级更高，不会触发 onClose */}
          <Pressable onPress={onClose} style={{ flex: 1 }}>
            {/* AI 猜你想找 */}
            <Animated.View style={sectionStyles[0]}>
              <AiBadge variant="recommend" style={{ marginBottom: spacing.md }} />
              <Text style={[typography.title3, { color: colors.text.primary, marginBottom: spacing.md }]}>
                猜你想找
              </Text>
              {AI_SUGGESTED_SEARCHES.map((item) => (
                <Pressable
                  key={item.keyword}
                  onPress={() => handleSelect(item.keyword)}
                  style={[
                    styles.aiRow,
                    { backgroundColor: colors.ai.soft, borderRadius: radius.lg, marginBottom: spacing.sm },
                  ]}
                >
                  <View style={[styles.aiDot, { backgroundColor: colors.ai.start }]} />
                  <View style={{ flex: 1 }}>
                    <Text style={[typography.bodyStrong, { color: colors.ai.start }]}>
                      {item.keyword}
                    </Text>
                    <Text style={[typography.caption, { color: colors.text.tertiary, marginTop: 2 }]}>
                      {item.reason}
                    </Text>
                  </View>
                  <MaterialCommunityIcons name="chevron-right" size={18} color={colors.muted} />
                </Pressable>
              ))}
            </Animated.View>

            {/* 热门搜索 */}
            <Animated.View style={[sectionStyles[1], { marginTop: spacing['2xl'] }]}>
              <Text style={[typography.title3, { color: colors.text.primary, marginBottom: spacing.md }]}>
                热门搜索
              </Text>
              <View style={styles.tagCloud}>
                {HOT_SEARCHES.map((kw) => (
                  <Pressable
                    key={kw}
                    onPress={() => handleSelect(kw)}
                    style={[
                      styles.hotTag,
                      { backgroundColor: colors.bgSecondary, borderRadius: radius.pill },
                    ]}
                  >
                    <Text style={[typography.bodySm, { color: colors.text.primary }]}>{kw}</Text>
                  </Pressable>
                ))}
              </View>
            </Animated.View>

            {/* 最近搜索 */}
            {recent.length > 0 && (
              <Animated.View style={[sectionStyles[2], { marginTop: spacing['2xl'] }]}>
                <View style={styles.sectionRow}>
                  <Text style={[typography.title3, { color: colors.text.primary }]}>最近搜索</Text>
                  <Pressable onPress={clearRecent} hitSlop={8}>
                    <MaterialCommunityIcons name="trash-can-outline" size={18} color={colors.text.secondary} />
                  </Pressable>
                </View>
                <View style={[styles.tagCloud, { marginTop: spacing.md }]}>
                  {recent.map((kw) => (
                    <Pressable
                      key={kw}
                      onPress={() => handleSelect(kw)}
                      style={[
                        styles.hotTag,
                        { backgroundColor: colors.bgSecondary, borderRadius: radius.pill },
                      ]}
                    >
                      <Text style={[typography.bodySm, { color: colors.text.secondary }]}>{kw}</Text>
                    </Pressable>
                  ))}
                </View>
              </Animated.View>
            )}
          </Pressable>
        </ScrollView>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  panel: {
    flex: 1,
  },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  inputWrap: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  input: {
    flex: 1,
    marginHorizontal: 8,
    paddingVertical: 0,
  },
  aiRow: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 14,
  },
  aiDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginRight: 12,
  },
  tagCloud: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  hotTag: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    marginRight: 10,
    marginBottom: 10,
  },
  sectionRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
});
