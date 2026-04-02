import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Image } from 'expo-image';
import { Company } from '../../types';
import { useTheme } from '../../theme';
import { Tag } from '../ui/Tag';

type CompanyCardProps = {
  company: Company;
  onPress?: (company: Company) => void;
};

// 企业卡片：用于展览馆列表展示
export const CompanyCard = ({ company, onPress }: CompanyCardProps) => {
  const { colors, radius, shadow, spacing, typography } = useTheme();

  return (
    <Pressable
      onPress={() => onPress?.(company)}
      style={[styles.card, shadow.sm, { backgroundColor: colors.surface, borderRadius: radius.lg }]}
    >
      <Image
        source={{ uri: company.cover }}
        style={{ height: 160, width: '100%', borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg }}
        contentFit="cover"
      />
      <View style={{ padding: spacing.md }}>
        <Text style={[typography.title3, { color: colors.text.primary }]} numberOfLines={1}>
          {company.name}
        </Text>
        <Text style={[typography.caption, { color: colors.text.secondary, marginTop: spacing.xs }]}>
          {company.mainBusiness}
        </Text>
        <View style={styles.metaRow}>
          <Text style={[typography.caption, { color: colors.text.secondary }]}>
            {company.location}
          </Text>
          <Text style={[typography.caption, { color: colors.text.secondary }]}>
            距离 {company.distanceKm.toFixed(1)} km
          </Text>
        </View>
        <View style={styles.tagRow}>
          {company.badges.map((badge, index) => (
            <Tag key={`${company.id}-${badge}-${index}`} label={badge} tone="accent" style={{ marginRight: spacing.xs }} />
          ))}
        </View>
        {company.latestTestedAt ? (
          <Text style={[typography.caption, { color: colors.muted, marginTop: spacing.xs }]}>
            最近检测：{company.latestTestedAt}
          </Text>
        ) : null}
      </View>
    </Pressable>
  );
};

const styles = StyleSheet.create({
  card: {
    overflow: 'hidden',
  },
  metaRow: {
    marginTop: 8,
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  tagRow: {
    marginTop: 10,
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
});
