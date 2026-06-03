import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTheme } from '../../theme';

interface Props {
  recipientName: string;
  recipientPhone: string;
  fullAddress: string;
}

export function AddressCard({ recipientName, recipientPhone, fullAddress }: Props) {
  const { colors, radius, spacing, typography } = useTheme();
  return (
    <View style={[styles.card, { backgroundColor: colors.surface, borderRadius: radius.md, padding: spacing.md }]}>
      <View style={styles.row}>
        <MaterialCommunityIcons name="map-marker" size={18} color={colors.brand.primary} />
        <View style={{ flex: 1, marginLeft: 8 }}>
          <Text style={[typography.bodyStrong, { color: colors.text.primary }]}>
            {recipientName} <Text style={{ color: colors.text.secondary, fontWeight: '400' }}>{recipientPhone}</Text>
          </Text>
          <Text style={[typography.caption, { color: colors.text.secondary, marginTop: 2 }]}>{fullAddress}</Text>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {},
  row: { flexDirection: 'row', alignItems: 'flex-start' },
});
