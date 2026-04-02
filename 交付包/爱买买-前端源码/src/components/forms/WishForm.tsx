import React, { useCallback, useEffect, useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import { wishTags } from '../../constants';
import { AiTagSuggestion, Company, WishType } from '../../types';
import { useTheme } from '../../theme';
import { WishAiRepo } from '../../repos';
import { useToast } from '../feedback';

const wishSchema = z.object({
  type: z.enum(['platform', 'company', 'public']),
  title: z.string().min(2, '请输入心愿标题'),
  description: z.string().min(10, '请补充更多心愿细节'),
  tags: z.array(z.string()).min(1, '请至少选择一个标签'),
  companyId: z.string().optional(),
});

export type WishFormValues = z.infer<typeof wishSchema>;

type WishFormProps = {
  companies: Company[];
  onSubmit: (values: WishFormValues) => void;
};

// 心愿发布表单：类型/内容/标签/@企业（复杂逻辑需中文注释）
export const WishForm = ({ companies, onSubmit }: WishFormProps) => {
  const { colors, radius, spacing, typography } = useTheme();
  const { show } = useToast();
  const {
    control,
    handleSubmit,
    setValue,
    watch,
    formState: { errors },
  } = useForm<WishFormValues>({
    resolver: zodResolver(wishSchema),
    defaultValues: {
      type: 'public',
      title: '',
      description: '',
      tags: [],
      companyId: undefined,
    },
  });

  const selectedType = watch('type');
  const selectedTags = watch('tags');
  const selectedCompanyId = watch('companyId');
  const titleValue = watch('title');
  const descriptionValue = watch('description');
  const [aiTags, setAiTags] = useState<AiTagSuggestion[]>([]);
  const [aiLoading, setAiLoading] = useState(false);

  // 类型切换时清理已选企业，避免非企业心愿残留关联关系
  React.useEffect(() => {
    if (selectedType !== 'company' && selectedCompanyId) {
      setValue('companyId', undefined, { shouldValidate: true });
    }
  }, [selectedType, selectedCompanyId, setValue]);

  const toggleTag = (tag: string) => {
    const next = selectedTags.includes(tag)
      ? selectedTags.filter((item) => item !== tag)
      : [...selectedTags, tag];
    setValue('tags', next, { shouldValidate: true });
  };

  // AI 推荐标签：基于标题/正文语义给出打标建议
  const fetchAiTags = useCallback(async () => {
    const title = titleValue.trim();
    const description = descriptionValue.trim();
    if (!title && !description) {
      setAiLoading(false);
      setAiTags([]);
      return;
    }
    setAiLoading(true);
    const result = await WishAiRepo.suggestTags({ title, description });
    if (!result.ok) {
      show({ message: result.error.displayMessage ?? 'AI 标签生成失败', type: 'error' });
      setAiLoading(false);
      return;
    }
    setAiTags(result.data);
    setAiLoading(false);
  }, [descriptionValue, show, titleValue]);

  useEffect(() => {
    const timer = setTimeout(() => {
      fetchAiTags();
    }, 400);
    return () => clearTimeout(timer);
  }, [fetchAiTags, titleValue, descriptionValue]);

  const handleApplyAiTags = () => {
    if (!aiTags.length) {
      show({ message: '暂无可加入的标签', type: 'info' });
      return;
    }
    const nextTags = Array.from(new Set([...selectedTags, ...aiTags.map((item) => item.label)]));
    setValue('tags', nextTags, { shouldValidate: true });
    show({ message: '已加入 AI 推荐标签', type: 'success' });
  };

  return (
    <View>
      <Text style={[typography.caption, { color: colors.text.secondary }]}>心愿类型</Text>
      <Controller
        control={control}
        name="type"
        render={({ field: { value, onChange } }) => (
          <View style={styles.rowWrap}>
            {[
              { value: 'platform', label: '给平台' },
              { value: 'company', label: '给企业' },
              { value: 'public', label: '公开心愿' },
            ].map((item) => {
              const active = value === item.value;
              return (
                <Pressable
                  key={item.value}
                  onPress={() => onChange(item.value as WishType)}
                  style={[
                    styles.chip,
                    {
                      backgroundColor: active ? colors.brand.primary : colors.surface,
                      borderColor: active ? colors.brand.primary : colors.border,
                      borderRadius: radius.pill,
                    },
                  ]}
                >
                  <Text style={[typography.caption, { color: active ? colors.text.inverse : colors.text.secondary }]}>
                    {item.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        )}
      />

      <View style={{ marginTop: spacing.md }}>
        <Text style={[typography.caption, { color: colors.text.secondary }]}>心愿标题</Text>
        <Controller
          control={control}
          name="title"
          render={({ field: { value, onChange } }) => (
            <TextInput
              value={value}
              onChangeText={onChange}
              placeholder="一句话描述你的心愿"
              placeholderTextColor={colors.muted}
              style={[styles.input, { borderColor: colors.border, color: colors.text.primary }]}
            />
          )}
        />
        {errors.title ? (
          <Text style={[typography.caption, { color: colors.danger, marginTop: 4 }]}>{errors.title.message}</Text>
        ) : null}
      </View>

      <View style={{ marginTop: spacing.md }}>
        <Text style={[typography.caption, { color: colors.text.secondary }]}>详细描述</Text>
        <Controller
          control={control}
          name="description"
          render={({ field: { value, onChange } }) => (
            <TextInput
              value={value}
              onChangeText={onChange}
              placeholder="描述你的需求、场景、期望"
              placeholderTextColor={colors.muted}
              style={[styles.input, styles.textarea, { borderColor: colors.border, color: colors.text.primary }]}
              multiline
            />
          )}
        />
        {errors.description ? (
          <Text style={[typography.caption, { color: colors.danger, marginTop: 4 }]}>
            {errors.description.message}
          </Text>
        ) : null}
      </View>

      {selectedType === 'company' ? (
        <View style={{ marginTop: spacing.md }}>
          <Text style={[typography.caption, { color: colors.text.secondary }]}>@企业（可选）</Text>
          <Controller
            control={control}
            name="companyId"
            render={({ field: { value, onChange } }) => (
              <View style={styles.rowWrap}>
                {companies.map((company) => {
                  const active = value === company.id;
                  return (
                    <Pressable
                      key={company.id}
                      onPress={() => onChange(active ? undefined : company.id)}
                      style={[
                        styles.chip,
                        {
                          backgroundColor: active ? colors.accent.blue : colors.surface,
                          borderColor: active ? colors.accent.blue : colors.border,
                          borderRadius: radius.pill,
                        },
                      ]}
                    >
                      <Text style={[typography.caption, { color: active ? colors.text.inverse : colors.text.secondary }]}>
                        @{company.name}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            )}
          />
          {selectedCompanyId ? (
            <Text style={[typography.caption, { color: colors.text.secondary, marginTop: 6 }]}>
              已选择企业：{companies.find((item) => item.id === selectedCompanyId)?.name}
            </Text>
          ) : (
            <Text style={[typography.caption, { color: colors.muted, marginTop: 6 }]}>
              可先发布，后续再关联企业
            </Text>
          )}
        </View>
      ) : null}

      <View style={{ marginTop: spacing.md }}>
        <View style={styles.aiHeader}>
          <Text style={[typography.caption, { color: colors.text.secondary }]}>选择标签</Text>
          <Pressable onPress={fetchAiTags} hitSlop={8}>
            <Text style={[typography.caption, { color: colors.accent.blue }]}>
              {aiLoading ? '生成中...' : 'AI 推荐标签'}
            </Text>
          </Pressable>
        </View>
        {aiTags.length ? (
          <View style={styles.aiTagWrap}>
            {aiTags.map((tag) => {
              const active = selectedTags.includes(tag.label);
              return (
                <Pressable
                  key={tag.label}
                  onPress={() => toggleTag(tag.label)}
                  style={[
                    styles.aiChip,
                    {
                      backgroundColor: active ? colors.accent.blueSoft : colors.surface,
                      borderColor: active ? colors.accent.blue : colors.border,
                      borderRadius: radius.pill,
                    },
                  ]}
                >
                  <Text style={[typography.caption, { color: active ? colors.accent.blue : colors.text.secondary }]}>
                    {tag.label}
                  </Text>
                  {tag.reason ? (
                    <Text style={[typography.caption, { color: colors.muted, marginLeft: 4 }]}>· {tag.reason}</Text>
                  ) : null}
                </Pressable>
              );
            })}
            <Pressable
              onPress={handleApplyAiTags}
              style={[styles.aiApply, { borderRadius: radius.pill, borderColor: colors.brand.primary }]}
            >
              <Text style={[typography.caption, { color: colors.brand.primary }]}>一键加入</Text>
            </Pressable>
          </View>
        ) : (
          <Text style={[typography.caption, { color: colors.muted, marginTop: 6 }]}>
            填写内容后可生成 AI 推荐标签
          </Text>
        )}
        <View style={styles.rowWrap}>
          {wishTags.map((tag) => {
            const active = selectedTags.includes(tag);
            return (
              <Pressable
                key={tag}
                onPress={() => toggleTag(tag)}
                style={[
                  styles.chip,
                  {
                    backgroundColor: active ? colors.brand.primary : colors.surface,
                    borderColor: active ? colors.brand.primary : colors.border,
                    borderRadius: radius.pill,
                  },
                ]}
              >
                <Text style={[typography.caption, { color: active ? colors.text.inverse : colors.text.secondary }]}>
                  {tag}
                </Text>
              </Pressable>
            );
          })}
        </View>
        {errors.tags ? (
          <Text style={[typography.caption, { color: colors.danger, marginTop: 4 }]}>{errors.tags.message}</Text>
        ) : null}
      </View>

      <Pressable
        onPress={handleSubmit(onSubmit)}
        style={[styles.submitButton, { backgroundColor: colors.brand.primary }]}
      >
        <Text style={[typography.bodyStrong, { color: colors.text.inverse }]}>提交心愿</Text>
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
    minHeight: 90,
    textAlignVertical: 'top',
  },
  rowWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginTop: 8,
  },
  aiHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  aiTagWrap: {
    marginTop: 8,
  },
  aiChip: {
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 6,
    marginRight: 8,
    marginBottom: 8,
    flexDirection: 'row',
    alignItems: 'center',
  },
  aiApply: {
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 6,
    alignSelf: 'flex-start',
    marginBottom: 8,
  },
  chip: {
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 6,
    marginRight: 8,
    marginBottom: 8,
  },
  submitButton: {
    marginTop: 16,
    borderRadius: 999,
    paddingVertical: 12,
    alignItems: 'center',
  },
});
