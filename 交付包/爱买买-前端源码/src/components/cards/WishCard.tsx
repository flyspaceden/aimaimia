import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Image } from 'expo-image';
import { wishPowerLevels } from '../../constants';
import { Wish } from '../../types';
import { useTheme } from '../../theme';
import { LikeButton, StatusPill, Tag } from '../ui';

type WishCardProps = {
  wish: Wish;
  onPress?: (wish: Wish) => void;
  onLike?: (wish: Wish) => void;
  highlight?: boolean;
};

// 心愿卡片：用于心愿池列表展示
export const WishCard = ({ wish, onPress, onLike, highlight }: WishCardProps) => {
  const { colors, radius, shadow, spacing, typography } = useTheme();
  const tone =
    wish.status === 'adopted' ? 'accent' : wish.status === 'planning' ? 'brand' : 'neutral';
  const powerLevel = wishPowerLevels.find((level) => level.id === wish.wishPower.level)?.label ?? '心愿力';

  return (
    <Pressable
      onPress={() => onPress?.(wish)}
      style={[
        styles.card,
        shadow.sm,
        {
          backgroundColor: colors.surface,
          borderRadius: radius.lg,
          borderColor: highlight ? colors.accent.blue : colors.border,
        },
      ]}
    >
      <View style={styles.headerRow}>
        <View style={styles.authorRow}>
          {wish.author.avatar ? (
            <Image source={{ uri: wish.author.avatar }} style={styles.avatar} />
          ) : (
            <View style={[styles.avatarFallback, { backgroundColor: colors.brand.primarySoft }]} />
          )}
          <View>
            <Text style={[typography.bodyStrong, { color: colors.text.primary }]}>{wish.author.name}</Text>
            <Text style={[typography.caption, { color: colors.text.secondary, marginTop: 2 }]}>
              {wish.createdAt}
            </Text>
          </View>
        </View>
        <View style={styles.headerBadges}>
          {wish.isPinned ? (
            <StatusPill label="置顶" tone="accent" />
          ) : (
            <StatusPill
              label={wish.status === 'done' ? '已实现' : wish.status === 'adopted' ? '已采纳' : '规划中'}
              tone={tone}
            />
          )}
          <View style={[styles.powerPill, { backgroundColor: colors.brand.primarySoft }]}>
            <Text style={[typography.caption, { color: colors.brand.primary }]}>
              {powerLevel} · {wish.wishPower.score}
            </Text>
          </View>
        </View>
      </View>

      <Text style={[typography.title3, { color: colors.text.primary, marginTop: spacing.sm }]} numberOfLines={2}>
        {wish.title}
      </Text>
      <Text style={[typography.body, { color: colors.text.secondary, marginTop: spacing.xs }]} numberOfLines={3}>
        {wish.description}
      </Text>

      <View style={styles.tagRow}>
        {wish.tags.slice(0, 3).map((tag, index) => (
          <Tag key={`${wish.id}-${tag}-${index}`} label={tag} tone="neutral" style={{ marginRight: spacing.xs }} />
        ))}
        {wish.mentions?.length ? (
          <Tag label={`@${wish.mentions[0].name}`} tone="accent" />
        ) : null}
      </View>

      {wish.badges?.length ? (
        <View style={styles.badgeRow}>
          {wish.badges.slice(0, 3).map((badge) => (
            <Tag key={`${wish.id}-${badge.id}`} label={badge.label} tone={badge.tone} style={{ marginRight: 6 }} />
          ))}
        </View>
      ) : null}

      <View style={styles.footerRow}>
        <View style={styles.countRow}>
          <Text style={[typography.caption, { color: colors.text.secondary }]}>评论</Text>
          <Text style={[typography.caption, { color: colors.text.primary, marginLeft: 4 }]}>
            {wish.commentCount}
          </Text>
        </View>
        <LikeButton
          liked={wish.likedBy.includes('u-001')}
          count={wish.likeCount}
          onPress={() => onLike?.(wish)}
        />
      </View>
    </Pressable>
  );
};

const styles = StyleSheet.create({
  card: {
    padding: 16,
    borderWidth: 1,
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  headerBadges: {
    alignItems: 'flex-end',
  },
  powerPill: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
    marginTop: 6,
  },
  authorRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  avatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    marginRight: 10,
  },
  avatarFallback: {
    width: 36,
    height: 36,
    borderRadius: 18,
    marginRight: 10,
  },
  tagRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginTop: 12,
  },
  badgeRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginTop: 8,
  },
  footerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 12,
  },
  countRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
});
