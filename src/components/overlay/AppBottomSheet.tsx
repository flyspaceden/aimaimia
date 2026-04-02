import React, { useMemo } from 'react';
import { Modal, Platform, Pressable, ScrollView, StyleProp, StyleSheet, Text, View, ViewStyle } from 'react-native';
import Constants from 'expo-constants';
import { useTheme } from '../../theme';

type AppBottomSheetProps = {
  open: boolean;
  onClose: () => void;
  mode?: 'auto' | 'half';
  title?: string;
  contentStyle?: StyleProp<ViewStyle>;
  scrollable?: boolean;
  children: React.ReactNode;
};

const isExpoGo = Constants.executionEnvironment === 'storeClient';
const isWeb = Platform.OS === 'web';
const bottomSheetModule = !isExpoGo && !isWeb
  ? (require('@gorhom/bottom-sheet') as typeof import('@gorhom/bottom-sheet'))
  : null;
const BottomSheet = bottomSheetModule?.default;
const BottomSheetBackdrop = bottomSheetModule?.BottomSheetBackdrop;
const BottomSheetView = bottomSheetModule?.BottomSheetView;
const BottomSheetScrollView = bottomSheetModule?.BottomSheetScrollView;

// 底部抽屉：统一样式/遮罩/交互（支持 auto/half 高度）
export const AppBottomSheet = ({
  open,
  onClose,
  mode = 'auto',
  title,
  contentStyle,
  scrollable = false,
  children,
}: AppBottomSheetProps) => {
  const { colors, radius, spacing, typography } = useTheme();
  const snapPoints = useMemo(() => (mode === 'half' ? ['52%'] : ['92%']), [mode]);
  const contentContainerStyle = StyleSheet.flatten([styles.content, { padding: spacing.lg }, contentStyle]);
  const shouldFallback =
    isExpoGo || isWeb || !BottomSheet || !BottomSheetBackdrop || !BottomSheetView || (scrollable && !BottomSheetScrollView);

  if (shouldFallback) {
    if (!open) {
      return null;
    }
    // Expo Go 下使用简化版抽屉，避免原生 worklets 版本不匹配
    return (
      <Modal transparent visible={open} animationType="fade" onRequestClose={onClose}>
        <View style={styles.modalRoot}>
          <Pressable
            style={[styles.backdrop, { backgroundColor: colors.overlay }]}
            onPress={onClose}
          />
          <View
            style={[
              styles.fallbackSheet,
              {
                backgroundColor: colors.surface,
                borderTopLeftRadius: radius.xl,
                borderTopRightRadius: radius.xl,
                height: mode === 'half' ? '52%' : undefined,
                maxHeight: mode === 'auto' ? '92%' : undefined,
              },
            ]}
          >
            {scrollable ? (
              <ScrollView contentContainerStyle={contentContainerStyle} showsVerticalScrollIndicator={false}>
                {title ? (
                  <Text style={[typography.title3, { color: colors.text.primary, marginBottom: spacing.md }]}>
                    {title}
                  </Text>
                ) : null}
                {children}
              </ScrollView>
            ) : (
              <View style={contentContainerStyle}>
                {title ? (
                  <Text style={[typography.title3, { color: colors.text.primary, marginBottom: spacing.md }]}>
                    {title}
                  </Text>
                ) : null}
                {children}
              </View>
            )}
          </View>
        </View>
      </Modal>
    );
  }

  const ContentWrapper = (scrollable ? BottomSheetScrollView : BottomSheetView) as React.ComponentType<any>;
  const wrapperProps = scrollable
    ? { contentContainerStyle, showsVerticalScrollIndicator: false }
    : { style: contentContainerStyle };

  return (
    <BottomSheet
      index={open ? 0 : -1}
      snapPoints={snapPoints}
      enablePanDownToClose
      enableDynamicSizing={mode === 'auto'}
      onClose={onClose}
      backgroundStyle={{ backgroundColor: colors.surface, borderRadius: radius.xl }}
      handleIndicatorStyle={{ backgroundColor: colors.border }}
      backdropComponent={(props) => (
        <BottomSheetBackdrop {...props} appearsOnIndex={0} disappearsOnIndex={-1} opacity={0.25} />
      )}
    >
      <ContentWrapper {...wrapperProps}>
        {title ? (
          <Text style={[typography.title3, { color: colors.text.primary, marginBottom: spacing.md }]}>
            {title}
          </Text>
        ) : null}
        {children}
      </ContentWrapper>
    </BottomSheet>
  );
};

const styles = StyleSheet.create({
  content: {},
  modalRoot: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
  },
  fallbackSheet: {
    overflow: 'hidden',
  },
});
