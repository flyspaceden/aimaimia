import React from 'react';
import { ScrollView, Text, View } from 'react-native';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AppHeader, Screen } from '../../src/components/layout';
import { useToast } from '../../src/components/feedback/Toast';
import { DeliveryCustomerServiceRepo } from '../../src/repos/delivery';
import {
  DeliveryButton,
  DeliveryLoading,
  DeliveryMessageState,
  DeliveryPanel,
  DeliveryTextField,
  useDeliveryTheme,
} from './_components';

export default function DeliveryCustomerServiceScreen() {
  const { show } = useToast();
  const queryClient = useQueryClient();
  const { palette, spacing, typography } = useDeliveryTheme();
  const [subject, setSubject] = React.useState('');
  const [message, setMessage] = React.useState('');
  const [submitting, setSubmitting] = React.useState(false);

  const query = useQuery({
    queryKey: ['delivery-customer-service'],
    queryFn: () => DeliveryCustomerServiceRepo.list({ page: 1, pageSize: 20 }),
  });

  const conversations = query.data?.ok ? query.data.data : [];

  const handleSubmit = async () => {
    const normalizedMessage = message.trim();
    if (!normalizedMessage) {
      show({ message: '请先填写要咨询的问题', type: 'warning' });
      return;
    }

    setSubmitting(true);
    const result = await DeliveryCustomerServiceRepo.create({
      subject: subject.trim() || undefined,
      message: normalizedMessage,
    });
    setSubmitting(false);

    if (!result.ok) {
      show({ message: result.error.displayMessage ?? '提交配送客服失败', type: 'error' });
      return;
    }

    setSubject('');
    setMessage('');
    await queryClient.invalidateQueries({ queryKey: ['delivery-customer-service'] });
    show({ message: '问题已提交，客服会尽快处理', type: 'success' });
  };

  return (
    <Screen contentStyle={{ flex: 1 }}>
      <AppHeader title="配送客服" />
      <ScrollView contentContainerStyle={{ padding: spacing.xl, paddingBottom: spacing['3xl'] }}>
        <DeliveryPanel style={{ marginBottom: spacing.md }}>
          <Text style={[typography.headingSm, { color: palette.text.primary }]}>提交问题</Text>
          <DeliveryTextField
            label="问题标题"
            value={subject}
            onChangeText={setSubject}
            placeholder="例如：商品破损、配送进度"
            style={{ marginTop: spacing.lg }}
          />
          <DeliveryTextField
            label="问题描述"
            value={message}
            onChangeText={setMessage}
            placeholder="请描述你遇到的问题"
            multiline
            style={{ marginTop: spacing.lg }}
          />
          <DeliveryButton
            label={submitting ? '提交中...' : '提交'}
            onPress={handleSubmit}
            disabled={submitting}
            style={{ marginTop: spacing.xl }}
          />
        </DeliveryPanel>

        <DeliveryPanel>
          <Text style={[typography.headingSm, { color: palette.text.primary }]}>历史问题</Text>
          {query.isLoading ? (
            <View style={{ paddingVertical: spacing.xl }}>
              <DeliveryLoading />
            </View>
          ) : conversations.length === 0 ? (
            <DeliveryMessageState
              title="暂无客服记录"
              description="提交问题后会显示在这里"
              icon="headset"
            />
          ) : (
            <View style={{ gap: spacing.md, marginTop: spacing.lg }}>
              {conversations.map((conversation) => (
                <View
                  key={conversation.id}
                  style={{
                    borderWidth: 1,
                    borderColor: palette.border,
                    borderRadius: 8,
                    padding: spacing.md,
                    backgroundColor: palette.background,
                  }}
                >
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: spacing.md }}>
                    <Text style={[typography.bodyStrong, { color: palette.text.primary, flex: 1 }]} numberOfLines={1}>
                      {conversation.subject || '配送咨询'}
                    </Text>
                    <Text style={[typography.caption, { color: palette.brand.primaryDark }]}>
                      {conversation.status === 'CLOSED' ? '已关闭' : '处理中'}
                    </Text>
                  </View>
                  <Text
                    style={[typography.bodySm, { color: palette.text.secondary, marginTop: spacing.xs }]}
                    numberOfLines={2}
                  >
                    {conversation.lastMessagePreview || '暂无内容'}
                  </Text>
                </View>
              ))}
            </View>
          )}
        </DeliveryPanel>
      </ScrollView>
    </Screen>
  );
}
