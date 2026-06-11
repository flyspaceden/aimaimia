import React, { useState } from 'react';
import { RefreshControl, ScrollView } from 'react-native';
import { AppHeader, Screen } from '../src/components/layout';
import { LegalDocumentView } from '../src/components/legal/LegalDocumentView';
import { MEMBER_SERVICE_AGREEMENT } from '../src/content/legal/memberServiceAgreement';
import { useTheme } from '../src/theme';

export default function MemberServiceAgreementScreen() {
  const { spacing } = useTheme();
  const [refreshing, setRefreshing] = useState(false);
  const handleRefresh = async () => {
    setRefreshing(true);
    await new Promise((resolve) => setTimeout(resolve, 300));
    setRefreshing(false);
  };

  return (
    <Screen contentStyle={{ flex: 1 }}>
      <AppHeader title="会员服务协议" />
      <ScrollView
        contentContainerStyle={{ padding: spacing.xl, paddingBottom: spacing['3xl'] }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} />}
      >
        <LegalDocumentView document={MEMBER_SERVICE_AGREEMENT} />
      </ScrollView>
    </Screen>
  );
}
