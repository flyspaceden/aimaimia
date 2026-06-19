import React from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleProp,
  StyleSheet,
  Text,
  TextInput,
  TextInputProps,
  View,
  ViewStyle,
} from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTheme } from '../../src/theme';
import { deliveryDarkColors, deliveryLightColors } from '../../src/theme/delivery';

export const useDeliveryTheme = () => {
  const base = useTheme();
  const palette = base.isDark ? deliveryDarkColors : deliveryLightColors;
  return {
    ...base,
    palette,
  };
};

export const formatDeliveryMoney = (value: number) => `¥${value.toFixed(2)}`;

export const DELIVERY_ORDER_STATUS_LABELS: Record<string, string> = {
  PENDING_SHIPMENT: '待发货',
  SHIPPED: '已发货',
  DELIVERED: '已送达',
  COMPLETED: '已完成',
};

export const DeliveryPanel = ({
  children,
  style,
}: {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
}) => {
  const { palette, radius, shadow } = useDeliveryTheme();
  return (
    <View
      style={[
        styles.panel,
        {
          backgroundColor: palette.surface,
          borderColor: palette.border,
          borderRadius: radius.lg,
        },
        shadow.sm,
        style,
      ]}
    >
      {children}
    </View>
  );
};

export const DeliveryButton = ({
  label,
  onPress,
  icon,
  variant = 'primary',
  disabled,
  style,
}: {
  label: string;
  onPress?: () => void;
  icon?: keyof typeof MaterialCommunityIcons.glyphMap;
  variant?: 'primary' | 'secondary' | 'ghost';
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
}) => {
  const { palette, radius, spacing, typography } = useDeliveryTheme();
  const tone =
    variant === 'primary'
      ? {
          backgroundColor: palette.brand.primary,
          borderColor: palette.brand.primary,
          color: palette.text.inverse,
        }
      : variant === 'secondary'
        ? {
            backgroundColor: palette.brand.primarySoft,
            borderColor: palette.border,
            color: palette.brand.primaryDark,
          }
        : {
            backgroundColor: 'transparent',
            borderColor: palette.border,
            color: palette.text.secondary,
          };

  return (
    <Pressable
      disabled={disabled}
      onPress={onPress}
      style={[
        styles.button,
        {
          backgroundColor: tone.backgroundColor,
          borderColor: tone.borderColor,
          borderRadius: radius.md,
          paddingHorizontal: spacing.lg,
          paddingVertical: spacing.md,
          opacity: disabled ? 0.45 : 1,
        },
        style,
      ]}
    >
      {icon ? (
        <MaterialCommunityIcons
          name={icon}
          size={18}
          color={tone.color}
          style={{ marginRight: spacing.xs }}
        />
      ) : null}
      <Text style={[typography.bodyStrong, { color: tone.color }]} numberOfLines={1}>
        {label}
      </Text>
    </Pressable>
  );
};

export const DeliveryTextField = ({
  label,
  style,
  ...props
}: TextInputProps & {
  label?: string;
  style?: StyleProp<ViewStyle>;
}) => {
  const { palette, radius, spacing, typography } = useDeliveryTheme();

  return (
    <View style={style}>
      {label ? (
        <Text style={[typography.caption, { color: palette.text.secondary, marginBottom: spacing.xs }]}>
          {label}
        </Text>
      ) : null}
      <TextInput
        placeholderTextColor={palette.text.tertiary}
        {...props}
        style={[
          styles.textField,
          {
            color: palette.text.primary,
            borderColor: palette.border,
            backgroundColor: palette.background,
            borderRadius: radius.md,
            paddingHorizontal: spacing.md,
            paddingVertical: spacing.md,
          },
          props.multiline && { minHeight: 92, textAlignVertical: 'top' },
        ]}
      />
    </View>
  );
};

export const DeliveryStatusPill = ({ status }: { status: string }) => {
  const { palette, radius, spacing, typography } = useDeliveryTheme();
  return (
    <View
      style={[
        styles.statusPill,
        {
          borderRadius: radius.pill,
          backgroundColor: palette.brand.primarySoft,
          paddingHorizontal: spacing.sm,
          paddingVertical: spacing.xs,
        },
      ]}
    >
      <Text style={[typography.captionSm, { color: palette.brand.primaryDark }]}>
        {DELIVERY_ORDER_STATUS_LABELS[status] ?? status}
      </Text>
    </View>
  );
};

export const DeliveryQuantityControl = ({
  value,
  min,
  max,
  step,
  onChange,
}: {
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (next: number) => void;
}) => {
  const { palette, radius, typography } = useDeliveryTheme();
  const decreaseDisabled = value - step < min;
  const increaseDisabled = value + step > max;

  return (
    <View
      style={[
        styles.qtyWrap,
        {
          borderRadius: radius.pill,
          borderColor: palette.border,
          backgroundColor: palette.background,
        },
      ]}
    >
      <Pressable
        disabled={decreaseDisabled}
        onPress={() => onChange(Math.max(min, value - step))}
        style={[styles.qtyButton, { opacity: decreaseDisabled ? 0.35 : 1 }]}
      >
        <MaterialCommunityIcons name="minus" size={16} color={palette.text.secondary} />
      </Pressable>
      <Text style={[typography.bodyStrong, { color: palette.text.primary, minWidth: 32, textAlign: 'center' }]}>
        {value}
      </Text>
      <Pressable
        disabled={increaseDisabled}
        onPress={() => onChange(Math.min(max, value + step))}
        style={[styles.qtyButton, { opacity: increaseDisabled ? 0.35 : 1 }]}
      >
        <MaterialCommunityIcons name="plus" size={16} color={palette.text.secondary} />
      </Pressable>
    </View>
  );
};

export const DeliveryLoading = ({ label = '加载中...' }: { label?: string }) => {
  const { palette, spacing, typography } = useDeliveryTheme();
  return (
    <View style={[styles.centerBlock, { padding: spacing['3xl'] }]}>
      <ActivityIndicator size="large" color={palette.brand.primary} />
      <Text style={[typography.bodySm, { color: palette.text.secondary, marginTop: spacing.md }]}>
        {label}
      </Text>
    </View>
  );
};

export const DeliveryMessageState = ({
  title,
  description,
  actionLabel,
  onAction,
  icon = 'package-variant-closed',
}: {
  title: string;
  description: string;
  actionLabel?: string;
  onAction?: () => void;
  icon?: keyof typeof MaterialCommunityIcons.glyphMap;
}) => {
  const { palette, spacing, typography } = useDeliveryTheme();

  return (
    <View style={[styles.centerBlock, { padding: spacing['3xl'] }]}>
      <MaterialCommunityIcons name={icon} size={40} color={palette.brand.primary} />
      <Text style={[typography.headingSm, { color: palette.text.primary, marginTop: spacing.md }]}>
        {title}
      </Text>
      <Text
        style={[
          typography.bodySm,
          { color: palette.text.secondary, marginTop: spacing.sm, textAlign: 'center' },
        ]}
      >
        {description}
      </Text>
      {actionLabel && onAction ? (
        <DeliveryButton
          label={actionLabel}
          onPress={onAction}
          style={{ marginTop: spacing.lg, minWidth: 144 }}
        />
      ) : null}
    </View>
  );
};

const styles = StyleSheet.create({
  panel: {
    borderWidth: 1,
    padding: 16,
  },
  button: {
    minHeight: 44,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    maxWidth: '100%',
  },
  textField: {
    borderWidth: 1,
    fontSize: 15,
  },
  statusPill: {
    alignSelf: 'flex-start',
  },
  qtyWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    paddingHorizontal: 4,
    minHeight: 36,
  },
  qtyButton: {
    width: 28,
    height: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },
  centerBlock: {
    alignItems: 'center',
    justifyContent: 'center',
  },
});
