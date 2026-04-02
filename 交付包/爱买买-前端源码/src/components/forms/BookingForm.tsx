import React, { useEffect } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import { identityOptions } from '../../constants';
import { CompanyEvent } from '../../types';
import { useTheme } from '../../theme';

const bookingSchema = z.object({
  date: z.string().min(1, '请选择日期'),
  headcount: z.number().min(1, '人数至少为 1'),
  identity: z.enum(['consumer', 'buyer', 'student', 'media', 'investor', 'other']),
  note: z.string().optional(),
  contactName: z.string().optional(),
  contactPhone: z.string().optional(),
});

export type BookingFormValues = z.infer<typeof bookingSchema>;

type BookingFormProps = {
  event?: CompanyEvent | null;
  onSubmit: (values: BookingFormValues) => void;
};

// 预约表单：封装字段与校验逻辑（复杂业务逻辑需中文注释）
export const BookingForm = ({ event, onSubmit }: BookingFormProps) => {
  const { colors, radius, spacing, typography } = useTheme();
  const {
    control,
    handleSubmit,
    setValue,
    formState: { errors },
  } = useForm<BookingFormValues>({
    resolver: zodResolver(bookingSchema),
    defaultValues: {
      date: event?.date ?? '',
      headcount: 1,
      identity: 'consumer',
      note: '',
      contactName: '',
      contactPhone: '',
    },
  });

  useEffect(() => {
    if (event?.date) {
      setValue('date', event.date);
    }
  }, [event?.date, setValue]);

  return (
    <View>
      {event ? (
        <View style={[styles.eventCard, { borderColor: colors.border, marginBottom: spacing.md }]}>
          <Text style={[typography.caption, { color: colors.text.secondary }]}>已选活动</Text>
          <Text style={[typography.bodyStrong, { color: colors.text.primary, marginTop: 4 }]}>
            {event.title}
          </Text>
          <Text style={[typography.caption, { color: colors.text.secondary, marginTop: 2 }]}>
            {event.date} {event.startTime}{event.endTime ? ` ~ ${event.endTime}` : ''}
          </Text>
        </View>
      ) : null}

      <View style={{ marginBottom: spacing.md }}>
        <Text style={[typography.caption, { color: colors.text.secondary }]}>期望参观日期</Text>
        <Controller
          control={control}
          name="date"
          render={({ field: { value, onChange } }) => (
            <TextInput
              value={value}
              onChangeText={onChange}
              placeholder="例如：2025-03-12"
              placeholderTextColor={colors.muted}
              style={[styles.input, { borderColor: colors.border, color: colors.text.primary }]}
            />
          )}
        />
        {errors.date ? (
          <Text style={[typography.caption, { color: colors.danger, marginTop: 4 }]}>{errors.date.message}</Text>
        ) : null}
      </View>

      <View style={{ marginBottom: spacing.md }}>
        <Text style={[typography.caption, { color: colors.text.secondary }]}>参观人数</Text>
        <Controller
          control={control}
          name="headcount"
          render={({ field: { value, onChange } }) => (
            <TextInput
              value={String(value ?? '')}
              onChangeText={(text) => {
                // 输入为字符串，表单层统一转为 number 处理
                const parsed = Number(text);
                onChange(Number.isNaN(parsed) ? 0 : parsed);
              }}
              keyboardType="number-pad"
              placeholder="请输入人数"
              placeholderTextColor={colors.muted}
              style={[styles.input, { borderColor: colors.border, color: colors.text.primary }]}
            />
          )}
        />
        {errors.headcount ? (
          <Text style={[typography.caption, { color: colors.danger, marginTop: 4 }]}>
            {errors.headcount.message}
          </Text>
        ) : null}
      </View>

      <View style={{ marginBottom: spacing.md }}>
        <Text style={[typography.caption, { color: colors.text.secondary }]}>身份</Text>
        <Controller
          control={control}
          name="identity"
          render={({ field: { value, onChange } }) => (
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginTop: spacing.sm }}>
              {identityOptions.map((option) => {
                const active = value === option.value;
                return (
                  <Pressable
                    key={option.value}
                    onPress={() => onChange(option.value)}
                    style={[
                      styles.identityChip,
                      {
                        backgroundColor: active ? colors.brand.primary : colors.surface,
                        borderColor: active ? colors.brand.primary : colors.border,
                        borderRadius: radius.pill,
                        marginRight: spacing.sm,
                        marginBottom: spacing.sm,
                      },
                    ]}
                  >
                    <Text style={[typography.caption, { color: active ? colors.text.inverse : colors.text.secondary }]}>
                      {option.label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          )}
        />
      </View>

      <View style={{ marginBottom: spacing.md }}>
        <Text style={[typography.caption, { color: colors.text.secondary }]}>联系人</Text>
        <Controller
          control={control}
          name="contactName"
          render={({ field: { value, onChange } }) => (
            <TextInput
              value={value}
              onChangeText={onChange}
              placeholder="姓名"
              placeholderTextColor={colors.muted}
              style={[styles.input, { borderColor: colors.border, color: colors.text.primary }]}
            />
          )}
        />
      </View>

      <View style={{ marginBottom: spacing.md }}>
        <Text style={[typography.caption, { color: colors.text.secondary }]}>联系电话</Text>
        <Controller
          control={control}
          name="contactPhone"
          render={({ field: { value, onChange } }) => (
            <TextInput
              value={value}
              onChangeText={onChange}
              placeholder="手机号"
              placeholderTextColor={colors.muted}
              keyboardType="phone-pad"
              style={[styles.input, { borderColor: colors.border, color: colors.text.primary }]}
            />
          )}
        />
      </View>

      <View style={{ marginBottom: spacing.md }}>
        <Text style={[typography.caption, { color: colors.text.secondary }]}>备注</Text>
        <Controller
          control={control}
          name="note"
          render={({ field: { value, onChange } }) => (
            <TextInput
              value={value}
              onChangeText={onChange}
              placeholder="可填写参观诉求/特殊安排"
              placeholderTextColor={colors.muted}
              style={[styles.input, styles.textarea, { borderColor: colors.border, color: colors.text.primary }]}
              multiline
            />
          )}
        />
      </View>

      <Pressable
        onPress={handleSubmit(onSubmit)}
        style={[styles.submitButton, { backgroundColor: colors.brand.primary }]}
      >
        <Text style={[typography.bodyStrong, { color: colors.text.inverse }]}>提交预约</Text>
      </Pressable>
    </View>
  );
};

const styles = StyleSheet.create({
  input: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginTop: 6,
  },
  textarea: {
    minHeight: 80,
    textAlignVertical: 'top',
  },
  identityChip: {
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  submitButton: {
    borderRadius: 999,
    paddingVertical: 12,
    alignItems: 'center',
  },
  eventCard: {
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
  },
});
