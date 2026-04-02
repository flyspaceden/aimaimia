import React, { useState } from 'react';
import { RefreshControl, ScrollView, View } from 'react-native';
import { AppHeader, Screen } from '../../src/components/layout';
import { EmptyState } from '../../src/components/feedback';
import { useTheme } from '../../src/theme';

export default function RecommendScreen() {
  const { spacing } = useTheme();
  const [refreshing, setRefreshing] = useState(false);
  const handleRefresh = async () => {
    setRefreshing(true);
    await new Promise((resolve) => setTimeout(resolve, 300));
    setRefreshing(false);
  };

  return (
    <Screen contentStyle={{ flex: 1 }}>
      <AppHeader title="为你推荐" />
      <ScrollView
        contentContainerStyle={{ padding: spacing.xl, paddingBottom: spacing['3xl'] }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} />}
      >
        <EmptyState title="推荐列表待接入" description="后续展示完整个性推荐列表" />
      </ScrollView>
    </Screen>
  );
}
