import React, { useEffect, useMemo, useRef, useState } from 'react';
import { LayoutChangeEvent, Pressable, RefreshControl, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { Image } from 'expo-image';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { useForm, Controller, FieldErrors } from 'react-hook-form';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import { AppHeader, Screen } from '../../src/components/layout';
import { EmptyState, ErrorState, Skeleton, useToast } from '../../src/components/feedback';
import { PostCard } from '../../src/components/cards';
import { AppBottomSheet } from '../../src/components/overlay';
import { farmingTags, postTags } from '../../src/constants';
import { AiRepo, DraftRepo, FeedRepo, ProductRepo } from '../../src/repos';
import { mockUserProfile } from '../../src/mocks';
import { useTheme } from '../../src/theme';
import { AiMusicTrack, AiTagSuggestion, Post, PostTemplate, PostVisibility, Product } from '../../src/types';
import { Price } from '../../src/components/ui';

const templateOptions: Array<{ value: PostTemplate; label: string; helper: string }> = [
  { value: 'story', label: '产品故事', helper: '讲清产地/人物/品牌故事' },
  { value: 'diary', label: '种植日志', helper: '记录周期与关键节点' },
  { value: 'recipe', label: '食谱教程', helper: '菜谱步骤与搭配建议' },
  { value: 'general', label: '随手记录', helper: '自由表达观点与动态' },
];

const visibilityOptions: Array<{ value: PostVisibility; label: string; helper: string }> = [
  { value: 'public', label: '公开', helper: '所有人可见' },
  { value: 'followers', label: '关注可见', helper: '仅关注者可见' },
  { value: 'private', label: '仅自己', helper: '仅自己可见' },
];

const visibilityLabels: Record<PostVisibility, string> = {
  public: '公开',
  followers: '关注可见',
  private: '仅自己',
};

const TITLE_LIMIT = 40;
const CONTENT_LIMIT = 1200;

const postSchema = z.object({
  template: z.enum(['story', 'diary', 'recipe', 'general']),
  title: z.string().min(2, '请输入标题').max(TITLE_LIMIT, `标题最多 ${TITLE_LIMIT} 字`),
  content: z.string().min(5, '请补充更多内容').max(CONTENT_LIMIT, `正文最多 ${CONTENT_LIMIT} 字`),
  tags: z.array(z.string()).optional(),
  storyOrigin: z.string().optional(),
  storyProcess: z.string().optional(),
  storyTaste: z.string().optional(),
  diaryStage: z.string().optional(),
  diaryWeather: z.string().optional(),
  diaryNote: z.string().optional(),
  recipeIngredients: z.string().optional(),
  recipeSteps: z.string().optional(),
  recipeTips: z.string().optional(),
});

type PostFormValues = z.infer<typeof postSchema>;

const placeholderImages = [
  'https://placehold.co/900x900/png',
  'https://placehold.co/900x900/png?text=Farm',
  'https://placehold.co/900x900/png?text=Harvest',
  'https://placehold.co/900x900/png?text=Greenhouse',
  'https://placehold.co/900x900/png?text=Recipe',
  'https://placehold.co/900x900/png?text=Story',
];

export default function PostCreateScreen() {
  const { colors, radius, shadow, spacing, typography } = useTheme();
  const { show } = useToast();
  const router = useRouter();
  const params = useLocalSearchParams<{ template?: string; draftId?: string; postId?: string }>();
  const [images, setImages] = useState<string[]>([]);
  const [imageSheetOpen, setImageSheetOpen] = useState(false);
  const [productSheetOpen, setProductSheetOpen] = useState(false);
  const [previewSheetOpen, setPreviewSheetOpen] = useState(false);
  const [musicSheetOpen, setMusicSheetOpen] = useState(false);
  const [tagSheetOpen, setTagSheetOpen] = useState(false);
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
  const [selectedMusic, setSelectedMusic] = useState<AiMusicTrack | null>(null);
  const [playingTrackId, setPlayingTrackId] = useState<string | null>(null);
  const [aiTagSuggestions, setAiTagSuggestions] = useState<AiTagSuggestion[]>([]);
  const [aiMusicCandidates, setAiMusicCandidates] = useState<AiMusicTrack[]>([]);
  const [pendingAiTags, setPendingAiTags] = useState<string[]>([]);
  const [uploadIndex, setUploadIndex] = useState(1);
  const [visibility, setVisibility] = useState<PostVisibility>('public');
  const [allowComments, setAllowComments] = useState(true);
  const [syncToCompany, setSyncToCompany] = useState(false);
  const [currentDraftId, setCurrentDraftId] = useState<string | null>(null);
  const [imageError, setImageError] = useState(false);
  const [editingPostId, setEditingPostId] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const draftLoadedRef = useRef(false);
  const editLoadedRef = useRef(false);
  const lastTemplateRef = useRef<PostTemplate | null>(null);
  const draftIdParam = Array.isArray(params.draftId) ? params.draftId[0] : params.draftId;
  const postIdParam = Array.isArray(params.postId) ? params.postId[0] : params.postId;
  const scrollRef = useRef<ScrollView>(null);
  const sectionPositions = useRef<Record<string, number>>({});
  const sectionLocalOffsets = useRef<Record<string, number>>({});
  const tagDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const defaultTemplate = useMemo(() => {
    const templateParam = Array.isArray(params.template) ? params.template[0] : params.template;
    if (templateParam && templateOptions.some((item) => item.value === templateParam)) {
      return templateParam as PostTemplate;
    }
    return 'story' as PostTemplate;
  }, [params.template]);

  const {
    control,
    handleSubmit,
    setValue,
    watch,
    getValues,
    formState: { errors },
  } = useForm<PostFormValues>({
    resolver: zodResolver(postSchema),
    defaultValues: {
      template: defaultTemplate,
      title: '',
      content: '',
      tags: [],
    },
  });

  const selectedTemplate = watch('template');
  const selectedTags = watch('tags') ?? [];
  const titleValue = watch('title');
  const contentValue = watch('content');
  const watchedValues = watch();

  const { data: productResult, isLoading: productLoading, refetch: refetchProducts } = useQuery({
    queryKey: ['post-products'],
    queryFn: () => ProductRepo.list({ page: 1, pageSize: 10 }),
  });
  const productItems = productResult?.ok ? productResult.data.items : [];
  const {
    data: musicResult,
    isLoading: musicLoading,
    isFetching: musicFetching,
    refetch: refetchMusic,
  } = useQuery({
    queryKey: ['ai-music', selectedTemplate, titleValue, contentValue],
    queryFn: () =>
      AiRepo.recommendMusic({
        template: selectedTemplate,
        title: titleValue ?? '',
        content: contentValue ?? '',
      }),
    enabled: false,
  });
  const {
    data: tagResult,
    isLoading: tagLoading,
    isFetching: tagFetching,
    refetch: refetchTags,
  } = useQuery({
    queryKey: ['ai-tags', selectedTemplate, titleValue, contentValue],
    queryFn: () =>
      AiRepo.recommendTags({
        template: selectedTemplate,
        title: titleValue ?? '',
        content: contentValue ?? '',
      }),
    enabled: false,
  });

  const registerSection = (key: string) => (event: LayoutChangeEvent) => {
    sectionPositions.current[key] = event.nativeEvent.layout.y;
  };

  const registerLocalSection = (key: string) => (event: LayoutChangeEvent) => {
    sectionLocalOffsets.current[key] = event.nativeEvent.layout.y;
  };

  // 表单校验失败时滚动定位（复杂交互需中文注释）
  const scrollToSection = (key: string) => {
    const baseY = sectionPositions.current.contentPanel;
    const localY = sectionLocalOffsets.current[key];
    const y =
      (key === 'title' || key === 'content') && typeof baseY === 'number' && typeof localY === 'number'
        ? baseY + localY
        : sectionPositions.current[key];
    if (typeof y === 'number') {
      scrollRef.current?.scrollTo({ y: Math.max(0, y - spacing.lg), animated: true });
    }
  };

  useEffect(() => {
    if (!draftIdParam || draftLoadedRef.current) {
      return;
    }
    DraftRepo.getById(String(draftIdParam)).then((result) => {
      if (!result.ok) {
        show({ message: result.error.displayMessage ?? '草稿加载失败', type: 'error' });
        return;
      }
      const draft = result.data;
      draftLoadedRef.current = true;
      setCurrentDraftId(draft.id);
      lastTemplateRef.current = draft.template;
      setValue('template', draft.template);
      setValue('title', draft.title);
      setValue('content', draft.content);
      setValue('tags', draft.tags);
      setValue('storyOrigin', draft.storyOrigin ?? '');
      setValue('storyProcess', draft.storyProcess ?? '');
      setValue('storyTaste', draft.storyTaste ?? '');
      setValue('diaryStage', draft.diaryStage ?? '');
      setValue('diaryWeather', draft.diaryWeather ?? '');
      setValue('diaryNote', draft.diaryNote ?? '');
      setValue('recipeIngredients', draft.recipeIngredients ?? '');
      setValue('recipeSteps', draft.recipeSteps ?? '');
      setValue('recipeTips', draft.recipeTips ?? '');
      setImages(draft.images);
      setSelectedProduct(draft.product ?? null);
      setSelectedMusic(draft.music ?? null);
      setAiTagSuggestions(draft.aiTagSuggestions ?? []);
      setAiMusicCandidates(draft.aiMusicCandidates ?? []);
      setVisibility(draft.visibility);
      setAllowComments(draft.allowComments);
      setSyncToCompany(draft.syncToCompany);
    });
  }, [draftIdParam, setValue, show]);

  useEffect(() => {
    if (!postIdParam || editLoadedRef.current || draftIdParam) {
      return;
    }
    FeedRepo.getById(String(postIdParam)).then((result) => {
      if (!result.ok) {
        show({ message: result.error.displayMessage ?? '帖子加载失败', type: 'error' });
        return;
      }
      const post = result.data;
      editLoadedRef.current = true;
      setEditingPostId(post.id);
      lastTemplateRef.current = post.template ?? 'general';
      setValue('template', post.template ?? 'general');
      setValue('title', post.title);
      setValue('content', post.content);
      setValue('tags', post.tags ?? []);
      setImages(post.images ?? []);
      setVisibility(post.visibility ?? 'public');
      setAllowComments(post.allowComments ?? true);
      setSyncToCompany(post.syncToCompany ?? false);
      if (post.productId) {
        ProductRepo.getById(post.productId).then((productResult) => {
          if (productResult.ok) {
            setSelectedProduct(productResult.data);
          }
        });
      } else {
        setSelectedProduct(null);
      }
      setSelectedMusic(post.music ?? null);
      setAiTagSuggestions([]);
      setAiMusicCandidates([]);
    });
  }, [draftIdParam, postIdParam, setValue, show]);

  const handleRefresh = async () => {
    setRefreshing(true);
    await refetchProducts();
    setRefreshing(false);
  };

  useEffect(() => {
    if (images.length > 0) {
      setImageError(false);
    }
  }, [images.length]);

  useEffect(() => {
    if (musicResult?.ok) {
      setAiMusicCandidates(musicResult.data);
    }
  }, [musicResult]);

  useEffect(() => {
    if (tagResult?.ok) {
      setAiTagSuggestions(tagResult.data);
      setPendingAiTags((prev) =>
        prev.filter((label) => tagResult.data.some((item) => item.label === label))
      );
    }
  }, [tagResult]);

  useEffect(() => {
    if (tagDebounceRef.current) {
      clearTimeout(tagDebounceRef.current);
    }
    tagDebounceRef.current = setTimeout(() => {
      refetchTags();
    }, 500);
    return () => {
      if (tagDebounceRef.current) {
        clearTimeout(tagDebounceRef.current);
      }
    };
  }, [selectedTemplate, titleValue, contentValue, refetchTags]);

  useEffect(() => {
    if (lastTemplateRef.current === selectedTemplate) {
      return;
    }
    const baseTagMap: Record<PostTemplate, string> = {
      story: '产品故事',
      diary: '种植日志',
      recipe: '食谱教程',
      general: '企业动态',
    };
    const baseTag = baseTagMap[selectedTemplate];
    lastTemplateRef.current = selectedTemplate;
    if (baseTag && !selectedTags.includes(baseTag)) {
      setValue('tags', [...selectedTags, baseTag]);
    }
  }, [selectedTemplate, selectedTags, setValue]);

  // 模板结构化字段：用于补齐模板内容（复杂逻辑需中文注释）
  const buildStructuredContent = (values: PostFormValues) => {
    if (values.template === 'story') {
      const parts = [
        values.storyOrigin ? `产地/故事：${values.storyOrigin}` : '',
        values.storyProcess ? `制作过程：${values.storyProcess}` : '',
        values.storyTaste ? `口感体验：${values.storyTaste}` : '',
      ].filter(Boolean);
      return parts.length ? parts.join('\n') : '';
    }
    if (values.template === 'diary') {
      const parts = [
        values.diaryStage ? `生长阶段：${values.diaryStage}` : '',
        values.diaryWeather ? `天气/环境：${values.diaryWeather}` : '',
        values.diaryNote ? `关键记录：${values.diaryNote}` : '',
      ].filter(Boolean);
      return parts.length ? parts.join('\n') : '';
    }
    if (values.template === 'recipe') {
      const parts = [
        values.recipeIngredients ? `食材清单：${values.recipeIngredients}` : '',
        values.recipeSteps ? `步骤：${values.recipeSteps}` : '',
        values.recipeTips ? `小贴士：${values.recipeTips}` : '',
      ].filter(Boolean);
      return parts.length ? parts.join('\n') : '';
    }
    return '';
  };

  const buildMergedContent = (values: PostFormValues) => {
    const structured = buildStructuredContent(values);
    return structured ? `${values.content}\n\n${structured}` : values.content;
  };

  const toggleTag = (tag: string) => {
    const next = selectedTags.includes(tag)
      ? selectedTags.filter((item) => item !== tag)
      : [...selectedTags, tag];
    setValue('tags', next);
  };

  const applyAiDraft = () => {
    const templateLabel = templateOptions.find((item) => item.value === selectedTemplate)?.label ?? '内容';
    const draft = `【${templateLabel}】\n\n核心亮点：\n- 产地/环境：\n- 栽培/加工亮点：\n- 口感/体验：\n\n小结：欢迎交流与建议。`;
    setValue('content', draft, { shouldValidate: true });
    show({ message: '已生成 AI 草稿', type: 'success' });
  };

  const handlePublish = async (values: PostFormValues) => {
    if (images.length === 0) {
      show({ message: '请至少选择 1 张图片', type: 'info' });
      setImageError(true);
      scrollToSection('images');
      return;
    }
    const mergedContent = buildMergedContent(values);
    const productTagLabel = selectedProduct ? `挂商品 · ${selectedProduct.title}` : undefined;
    const payload = {
      title: values.title,
      content: mergedContent,
      images,
      tags: values.tags,
      template: values.template,
      productId: selectedProduct?.id,
      productTagLabel,
      music: selectedMusic ?? undefined,
      visibility,
      allowComments,
      syncToCompany,
    };
    const result = editingPostId
      ? await FeedRepo.update(editingPostId, payload)
      : await FeedRepo.create(payload);
    if (!result.ok) {
      show({ message: result.error.displayMessage ?? '发布失败', type: 'error' });
      return;
    }
    if (currentDraftId) {
      await DraftRepo.remove(currentDraftId);
      setCurrentDraftId(null);
    }
    show({ message: editingPostId ? '已更新发布内容' : '已发布，正在进入圈子', type: 'success' });
    router.back();
  };

  const toggleImage = (uri: string) => {
    if (images.includes(uri)) {
      setImages((prev) => prev.filter((item) => item !== uri));
      return;
    }
    if (images.length >= 9) {
      show({ message: '最多选择 9 张图片', type: 'info' });
      return;
    }
    setImages((prev) => [...prev, uri]);
  };

  const handleUploadPlaceholder = () => {
    if (images.length >= 9) {
      show({ message: '最多选择 9 张图片', type: 'info' });
      return;
    }
    const next = `https://placehold.co/900x900/png?text=Upload${uploadIndex}`;
    setUploadIndex(uploadIndex + 1);
    setImages((prev) => [...prev, next]);
    show({ message: '已模拟上传 1 张图片', type: 'success' });
  };

  const moveImage = (index: number, direction: -1 | 1) => {
    setImages((prev) => {
      const next = [...prev];
      const targetIndex = index + direction;
      if (targetIndex < 0 || targetIndex >= next.length) {
        return prev;
      }
      [next[index], next[targetIndex]] = [next[targetIndex], next[index]];
      return next;
    });
  };

  const setAsCover = (index: number) => {
    setImages((prev) => {
      if (index <= 0) {
        return prev;
      }
      const next = [...prev];
      const [selected] = next.splice(index, 1);
      next.unshift(selected);
      return next;
    });
  };

  const handleSaveDraft = async () => {
    const values = getValues();
    const payload = {
      id: currentDraftId ?? undefined,
      title: values.title || '未命名草稿',
      content: values.content || '',
      tags: values.tags ?? [],
      images,
      template: values.template,
      storyOrigin: values.storyOrigin,
      storyProcess: values.storyProcess,
      storyTaste: values.storyTaste,
      diaryStage: values.diaryStage,
      diaryWeather: values.diaryWeather,
      diaryNote: values.diaryNote,
      recipeIngredients: values.recipeIngredients,
      recipeSteps: values.recipeSteps,
      recipeTips: values.recipeTips,
      product: selectedProduct,
      music: selectedMusic,
      aiTagSuggestions,
      aiMusicCandidates,
      visibility,
      allowComments,
      syncToCompany,
    };
    const result = await DraftRepo.save(payload);
    if (!result.ok) {
      show({ message: result.error.displayMessage ?? '草稿保存失败', type: 'error' });
      return;
    }
    setCurrentDraftId(result.data.id);
    show({ message: '草稿已保存', type: 'success' });
  };

  const previewPost: Post = useMemo(
    () => ({
      id: 'preview-post',
      title: watchedValues.title || '未命名标题',
      content: buildMergedContent(watchedValues),
      images,
      createdAt: '刚刚',
      likeCount: 0,
      commentCount: 0,
      shareCount: 0,
      likedBy: [],
      productId: selectedProduct?.id,
      productTagLabel: selectedProduct ? `挂商品 · ${selectedProduct.title}` : undefined,
      tags: watchedValues.tags,
      template: watchedValues.template,
      music: selectedMusic ?? undefined,
      visibility,
      allowComments,
      syncToCompany,
      author: {
        id: mockUserProfile.id,
        name: mockUserProfile.name,
        avatar: mockUserProfile.avatar,
        type: 'user',
        tags: ['内容创作者'],
      },
    }),
    [
      watchedValues,
      images,
      selectedProduct,
      selectedMusic,
      aiTagSuggestions,
      visibility,
      allowComments,
      syncToCompany,
    ]
  );

  const mergedPreviewContent = useMemo(() => buildMergedContent(watchedValues), [watchedValues]);

  const handleSelectProduct = (product: Product) => {
    setSelectedProduct(product);
    setProductSheetOpen(false);
    show({ message: '已挂载商品', type: 'success' });
  };

  const handleClearProduct = () => {
    setSelectedProduct(null);
    show({ message: '已取消挂载商品', type: 'info' });
  };

  const tagSuggestions = tagResult?.ok ? tagResult.data : aiTagSuggestions;
  const musicCandidates = musicResult?.ok ? musicResult.data : aiMusicCandidates;

  const toggleMusicPlay = (track: AiMusicTrack) => {
    if (playingTrackId === track.id) {
      setPlayingTrackId(null);
      show({ message: '已暂停试听（占位）', type: 'info' });
      return;
    }
    setPlayingTrackId(track.id);
    show({ message: '试听中（占位）', type: 'success' });
  };

  const handleApplyTagSuggestions = (items: AiTagSuggestion[]) => {
    const selectedSet = new Set(selectedTags);
    const pending = pendingAiTags.filter((label) => !selectedSet.has(label));
    if (pending.length === 0) {
      show({ message: '请先选择要加入的标签', type: 'info' });
      return;
    }
    const next = Array.from(new Set([...selectedTags, ...pending]));
    setValue('tags', next, { shouldValidate: true });
    setPendingAiTags([]);
    show({ message: `已加入 ${pending.length} 个标签`, type: 'success' });
  };

  const handleToggleTagSuggestion = (item: AiTagSuggestion) => {
    if (selectedTags.includes(item.label)) {
      return;
    }
    setPendingAiTags((prev) =>
      prev.includes(item.label) ? prev.filter((label) => label !== item.label) : [...prev, item.label]
    );
  };
  const isEditing = Boolean(editingPostId);

  const handleInvalid = (formErrors: FieldErrors<PostFormValues>) => {
    if (formErrors.title) {
      scrollToSection('title');
      return;
    }
    if (formErrors.content) {
      scrollToSection('content');
      return;
    }
    if (images.length === 0) {
      setImageError(true);
      scrollToSection('images');
    }
  };

  return (
    <Screen contentStyle={{ flex: 1 }}>
      <AppHeader
        title={isEditing ? '编辑内容' : '发布内容'}
        rightSlot={
          <Pressable onPress={() => router.push('/post/drafts')} hitSlop={8} style={styles.headerAction}>
            <MaterialCommunityIcons name="file-document-outline" size={18} color={colors.text.secondary} />
            <Text style={[typography.caption, { color: colors.text.secondary, marginLeft: 4 }]}>草稿箱</Text>
          </Pressable>
        }
      />
      <ScrollView
        ref={scrollRef}
        contentContainerStyle={{ padding: spacing.xl, paddingBottom: spacing['3xl'] }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} />}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
      >
        <View
          onLayout={registerSection('images')}
          style={[styles.panel, shadow.sm, { backgroundColor: colors.surface, borderRadius: radius.lg }]}
        >
          <View style={styles.sectionHeader}>
            <Text style={[typography.bodyStrong, { color: colors.text.primary }]}>图片内容</Text>
            <View style={styles.sectionMeta}>
              <Text style={[typography.caption, { color: colors.text.secondary }]}>
                已选 {images.length}/9
              </Text>
              <Pressable onPress={() => setImageSheetOpen(true)} hitSlop={8} style={styles.sectionAction}>
                <Text style={[typography.caption, { color: colors.accent.blue }]}>选择图片</Text>
              </Pressable>
            </View>
          </View>
          {images.length === 0 ? (
            <Pressable
              onPress={() => setImageSheetOpen(true)}
              style={[styles.imagePlaceholder, { borderColor: colors.border }]}
            >
              <MaterialCommunityIcons name="image-plus" size={22} color={colors.text.secondary} />
              <Text style={[typography.caption, { color: colors.text.secondary, marginTop: 6 }]}>
                选择图片（最多 9 张）
              </Text>
            </Pressable>
          ) : (
            <View style={styles.imageGrid}>
              {images.map((uri, index) => (
                <View key={`${uri}-${index}`} style={styles.imageItem}>
                  <Image source={{ uri }} style={{ width: '100%', height: '100%', borderRadius: 12 }} />
                  <Pressable
                    onPress={() => setImages((prev) => prev.filter((_, idx) => idx !== index))}
                    style={[styles.imageRemove, { backgroundColor: colors.overlay }]}
                  >
                    <MaterialCommunityIcons name="close" size={12} color={colors.text.inverse} />
                  </Pressable>
                  <View style={[styles.imageTools, { backgroundColor: colors.overlay }]}>
                    {index === 0 ? (
                      <View style={styles.coverBadge}>
                        <Text style={[typography.caption, { color: colors.text.inverse }]}>封面</Text>
                      </View>
                    ) : (
                      <Pressable onPress={() => setAsCover(index)} hitSlop={6}>
                        <Text style={[typography.caption, { color: colors.text.inverse }]}>设为封面</Text>
                      </Pressable>
                    )}
                    <View style={styles.imageMoveRow}>
                      <Pressable
                        onPress={() => moveImage(index, -1)}
                        disabled={index === 0}
                        style={styles.imageMoveButton}
                      >
                        <MaterialCommunityIcons
                          name="chevron-left"
                          size={14}
                          color={index === 0 ? colors.muted : colors.text.inverse}
                        />
                      </Pressable>
                      <Pressable
                        onPress={() => moveImage(index, 1)}
                        disabled={index === images.length - 1}
                        style={styles.imageMoveButton}
                      >
                        <MaterialCommunityIcons
                          name="chevron-right"
                          size={14}
                          color={index === images.length - 1 ? colors.muted : colors.text.inverse}
                        />
                      </Pressable>
                    </View>
                  </View>
                </View>
              ))}
              {images.length < 9 ? (
                <Pressable
                  onPress={() => setImageSheetOpen(true)}
                  style={[styles.imageAdd, { borderColor: colors.border }]}
                >
                  <MaterialCommunityIcons name="plus" size={18} color={colors.text.secondary} />
                </Pressable>
              ) : null}
            </View>
          )}
          {images.length > 0 ? (
            <Text style={[typography.caption, { color: colors.text.secondary, marginTop: 8 }]}>
              封面默认为第一张，可左右调整顺序
            </Text>
          ) : null}
          <Text style={[typography.caption, { color: colors.text.secondary, marginTop: 8 }]}>
            至少选择 1 张图片
          </Text>
          {imageError ? (
            <Text style={[typography.caption, { color: colors.danger, marginTop: 4 }]}>
              请至少选择 1 张图片
            </Text>
          ) : null}
        </View>

        <View style={[styles.panel, shadow.sm, { backgroundColor: colors.surface, borderRadius: radius.lg }]}>
          <Text style={[typography.bodyStrong, { color: colors.text.primary }]}>发布模板</Text>
          <View style={styles.templateRow}>
            {templateOptions.map((item) => {
              const active = item.value === selectedTemplate;
              return (
                <Pressable
                  key={item.value}
                  onPress={() => setValue('template', item.value)}
                  style={[
                    styles.templateCard,
                    {
                      backgroundColor: active ? colors.brand.primary : colors.surface,
                      borderColor: active ? colors.brand.primary : colors.border,
                      borderRadius: radius.lg,
                    },
                  ]}
                >
                  <Text style={[typography.bodyStrong, { color: active ? colors.text.inverse : colors.text.primary }]}>
                    {item.label}
                  </Text>
                  <Text style={[typography.caption, { color: active ? colors.text.inverse : colors.text.secondary, marginTop: 4 }]}>
                    {item.helper}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </View>

        <View style={[styles.panel, shadow.sm, { backgroundColor: colors.surface, borderRadius: radius.lg }]}>
          <Text style={[typography.bodyStrong, { color: colors.text.primary }]}>智能创作助手</Text>
          <View style={styles.aiRow}>
            <Pressable onPress={applyAiDraft} style={[styles.aiChip, { borderColor: colors.border }]}>
              <Text style={[typography.caption, { color: colors.text.secondary }]}>AI 文案助手</Text>
            </Pressable>
            <Pressable
              onPress={() => {
                setMusicSheetOpen(true);
                refetchMusic();
              }}
              style={[styles.aiChip, { borderColor: colors.border }]}
            >
              <Text style={[typography.caption, { color: colors.text.secondary }]}>AI 智能配乐</Text>
            </Pressable>
          </View>
          {selectedMusic ? (
            <View style={[styles.aiMetaRow, { borderColor: colors.border }]}>
              <Text style={[typography.caption, { color: colors.text.secondary }]}>
                已选配乐
              </Text>
              <Text style={[typography.caption, { color: colors.text.primary }]}>
                {selectedMusic.title} · {selectedMusic.mood}
              </Text>
              <Pressable onPress={() => setSelectedMusic(null)} hitSlop={8}>
                <Text style={[typography.caption, { color: colors.danger }]}>移除</Text>
              </Pressable>
            </View>
          ) : null}
          <Text style={[typography.caption, { color: colors.text.secondary, marginTop: 4 }]}>
            {musicFetching ? '正在生成配乐推荐…' : `推荐配乐 ${musicCandidates.length} 条`}
          </Text>
        </View>

        <View
          onLayout={registerSection('contentPanel')}
          style={[styles.panel, shadow.sm, { backgroundColor: colors.surface, borderRadius: radius.lg }]}
        >
          <Text style={[typography.bodyStrong, { color: colors.text.primary }]}>内容信息</Text>
          <View style={styles.inputHeader} onLayout={registerLocalSection('title')}>
            <Text style={[typography.caption, { color: colors.text.secondary }]}>标题</Text>
            <Text style={[typography.caption, { color: colors.text.secondary }]}>
              {(titleValue ?? '').length}/{TITLE_LIMIT}
            </Text>
          </View>
          <Text style={[typography.caption, { color: colors.text.secondary, marginTop: 4 }]}>
            标题至少 2 字
          </Text>
          <Controller
            control={control}
            name="title"
            render={({ field: { value, onChange } }) => (
              <TextInput
                value={value}
                onChangeText={onChange}
                placeholder="请输入标题"
                placeholderTextColor={colors.muted}
                maxLength={TITLE_LIMIT}
                style={[styles.input, { borderColor: colors.border, color: colors.text.primary }]}
              />
            )}
          />
          {errors.title ? (
            <Text style={[typography.caption, { color: colors.danger, marginTop: 4 }]}>{errors.title.message}</Text>
          ) : null}
          <View style={styles.inputHeader} onLayout={registerLocalSection('content')}>
            <Text style={[typography.caption, { color: colors.text.secondary }]}>正文</Text>
            <Text style={[typography.caption, { color: colors.text.secondary }]}>
              {(contentValue ?? '').length}/{CONTENT_LIMIT}
            </Text>
          </View>
          <Text style={[typography.caption, { color: colors.text.secondary, marginTop: 4 }]}>
            正文至少 5 字
          </Text>
          <Controller
            control={control}
            name="content"
            render={({ field: { value, onChange } }) => (
              <TextInput
                value={value}
                onChangeText={onChange}
                placeholder="分享你的故事、过程或经验"
                placeholderTextColor={colors.muted}
                multiline
                maxLength={CONTENT_LIMIT}
                style={[styles.input, styles.textarea, { borderColor: colors.border, color: colors.text.primary }]}
              />
            )}
          />
          {errors.content ? (
            <Text style={[typography.caption, { color: colors.danger, marginTop: 4 }]}>{errors.content.message}</Text>
          ) : null}

          {selectedTemplate === 'story' ? (
            <View style={{ marginTop: spacing.md }}>
              <Text style={[typography.caption, { color: colors.text.secondary }]}>产品故事结构</Text>
              <Controller
                control={control}
                name="storyOrigin"
                render={({ field: { value, onChange } }) => (
                  <TextInput
                    value={value}
                    onChangeText={onChange}
                    placeholder="产地/故事背景"
                    placeholderTextColor={colors.muted}
                    style={[styles.input, { borderColor: colors.border, color: colors.text.primary }]}
                  />
                )}
              />
              <Controller
                control={control}
                name="storyProcess"
                render={({ field: { value, onChange } }) => (
                  <TextInput
                    value={value}
                    onChangeText={onChange}
                    placeholder="制作过程亮点"
                    placeholderTextColor={colors.muted}
                    style={[styles.input, { borderColor: colors.border, color: colors.text.primary }]}
                  />
                )}
              />
              <Controller
                control={control}
                name="storyTaste"
                render={({ field: { value, onChange } }) => (
                  <TextInput
                    value={value}
                    onChangeText={onChange}
                    placeholder="口感与体验"
                    placeholderTextColor={colors.muted}
                    style={[styles.input, { borderColor: colors.border, color: colors.text.primary }]}
                  />
                )}
              />
            </View>
          ) : null}

          {selectedTemplate === 'diary' ? (
            <View style={{ marginTop: spacing.md }}>
              <Text style={[typography.caption, { color: colors.text.secondary }]}>种植日志结构</Text>
              <Controller
                control={control}
                name="diaryStage"
                render={({ field: { value, onChange } }) => (
                  <TextInput
                    value={value}
                    onChangeText={onChange}
                    placeholder="当前生长阶段"
                    placeholderTextColor={colors.muted}
                    style={[styles.input, { borderColor: colors.border, color: colors.text.primary }]}
                  />
                )}
              />
              <Controller
                control={control}
                name="diaryWeather"
                render={({ field: { value, onChange } }) => (
                  <TextInput
                    value={value}
                    onChangeText={onChange}
                    placeholder="天气/环境记录"
                    placeholderTextColor={colors.muted}
                    style={[styles.input, { borderColor: colors.border, color: colors.text.primary }]}
                  />
                )}
              />
              <Controller
                control={control}
                name="diaryNote"
                render={({ field: { value, onChange } }) => (
                  <TextInput
                    value={value}
                    onChangeText={onChange}
                    placeholder="关键节点/收获"
                    placeholderTextColor={colors.muted}
                    style={[styles.input, { borderColor: colors.border, color: colors.text.primary }]}
                  />
                )}
              />
            </View>
          ) : null}

          {selectedTemplate === 'recipe' ? (
            <View style={{ marginTop: spacing.md }}>
              <Text style={[typography.caption, { color: colors.text.secondary }]}>食谱教程结构</Text>
              <Controller
                control={control}
                name="recipeIngredients"
                render={({ field: { value, onChange } }) => (
                  <TextInput
                    value={value}
                    onChangeText={onChange}
                    placeholder="食材清单"
                    placeholderTextColor={colors.muted}
                    style={[styles.input, { borderColor: colors.border, color: colors.text.primary }]}
                  />
                )}
              />
              <Controller
                control={control}
                name="recipeSteps"
                render={({ field: { value, onChange } }) => (
                  <TextInput
                    value={value}
                    onChangeText={onChange}
                    placeholder="步骤（可用 1/2/3 分隔）"
                    placeholderTextColor={colors.muted}
                    style={[styles.input, { borderColor: colors.border, color: colors.text.primary }]}
                  />
                )}
              />
              <Controller
                control={control}
                name="recipeTips"
                render={({ field: { value, onChange } }) => (
                  <TextInput
                    value={value}
                    onChangeText={onChange}
                    placeholder="小贴士"
                    placeholderTextColor={colors.muted}
                    style={[styles.input, { borderColor: colors.border, color: colors.text.primary }]}
                  />
                )}
              />
            </View>
          ) : null}

          <View style={[styles.tagHeaderRow, { marginTop: spacing.md }]}>
            <Text style={[typography.caption, { color: colors.text.secondary }]}>内容标签</Text>
            <Pressable
              onPress={() => {
                setTagSheetOpen(true);
                refetchTags();
              }}
              style={styles.tagAiButton}
              hitSlop={8}
            >
              <MaterialCommunityIcons name="auto-fix" size={14} color={colors.accent.blue} />
              <Text style={[typography.caption, { color: colors.accent.blue, marginLeft: 6 }]}>
                AI 推荐标签
              </Text>
            </Pressable>
          </View>
          <Text style={[typography.caption, { color: colors.text.secondary, marginTop: 4 }]}>
            模板标签会自动添加，可手动增删
          </Text>
          <View style={styles.tagRow}>
            {postTags.map((tag) => {
              const active = selectedTags.includes(tag);
              return (
                <Pressable
                  key={tag}
                  onPress={() => toggleTag(tag)}
                  style={[
                    styles.tagChip,
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
          <Text style={[typography.caption, { color: colors.text.secondary, marginTop: spacing.sm }]}>农事标签</Text>
          <View style={styles.tagRow}>
            {farmingTags.map((tag) => {
              const active = selectedTags.includes(tag);
              return (
                <Pressable
                  key={tag}
                  onPress={() => toggleTag(tag)}
                  style={[
                    styles.tagChip,
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
        </View>

        <View style={[styles.panel, shadow.sm, { backgroundColor: colors.surface, borderRadius: radius.lg }]}>
          <View style={styles.sectionHeader}>
            <Text style={[typography.bodyStrong, { color: colors.text.primary }]}>关联商品（可选）</Text>
            <Pressable onPress={() => setProductSheetOpen(true)} hitSlop={8}>
              <Text style={[typography.caption, { color: colors.accent.blue }]}>
                {selectedProduct ? '更换商品' : '选择商品'}
              </Text>
            </Pressable>
          </View>
          {selectedProduct ? (
            <View style={[styles.productCard, { borderColor: colors.border, borderRadius: radius.lg }]}>
              <Image source={{ uri: selectedProduct.image }} style={[styles.productThumb, { borderRadius: radius.md }]} />
              <View style={styles.productMeta}>
                <View style={styles.rowBetween}>
                  <Text style={[typography.bodyStrong, { color: colors.text.primary, flex: 1 }]} numberOfLines={2}>
                    {selectedProduct.title}
                  </Text>
                  <Pressable onPress={handleClearProduct} style={[styles.removeChip, { backgroundColor: colors.brand.primarySoft }]}>
                    <Text style={[typography.caption, { color: colors.brand.primary }]}>移除</Text>
                  </Pressable>
                </View>
                <Text style={[typography.caption, { color: colors.text.secondary, marginTop: 6 }]}>
                  {selectedProduct.origin}
                </Text>
                <Price
                  value={selectedProduct.price}
                  unit={selectedProduct.unit}
                  strikeValue={selectedProduct.strikePrice}
                  style={{ marginTop: 8 }}
                />
              </View>
            </View>
          ) : (
            <Pressable
              onPress={() => setProductSheetOpen(true)}
              style={[styles.productPlaceholder, { borderColor: colors.border }]}
            >
              <MaterialCommunityIcons name="cart-outline" size={20} color={colors.text.secondary} />
              <Text style={[typography.caption, { color: colors.text.secondary, marginLeft: 8 }]}>
                选择要挂载的商品
              </Text>
            </Pressable>
          )}
        </View>

        <View style={[styles.panel, shadow.sm, { backgroundColor: colors.surface, borderRadius: radius.lg }]}>
          <Text style={[typography.bodyStrong, { color: colors.text.primary }]}>发布设置</Text>
          <Text style={[typography.caption, { color: colors.text.secondary, marginTop: 6 }]}>可见范围</Text>
          <View style={styles.visibilityRow}>
            {visibilityOptions.map((option) => {
              const active = visibility === option.value;
              return (
                <Pressable
                  key={option.value}
                  onPress={() => setVisibility(option.value)}
                  style={[
                    styles.visibilityChip,
                    {
                      backgroundColor: active ? colors.brand.primary : colors.surface,
                      borderColor: active ? colors.brand.primary : colors.border,
                      borderRadius: radius.lg,
                    },
                  ]}
                >
                  <Text style={[typography.caption, { color: active ? colors.text.inverse : colors.text.primary }]}>
                    {option.label}
                  </Text>
                  <Text style={[typography.caption, { color: active ? colors.text.inverse : colors.text.secondary, marginTop: 4 }]}>
                    {option.helper}
                  </Text>
                </Pressable>
              );
            })}
          </View>
          <View style={styles.switchRow}>
            <View>
              <Text style={[typography.body, { color: colors.text.primary }]}>允许评论</Text>
              <Text style={[typography.caption, { color: colors.text.secondary, marginTop: 4 }]}>
                关闭后将隐藏评论入口
              </Text>
            </View>
            <Switch
              value={allowComments}
              onValueChange={setAllowComments}
              trackColor={{ false: colors.border, true: colors.brand.primarySoft }}
              thumbColor={allowComments ? colors.brand.primary : colors.muted}
            />
          </View>
          <View style={styles.switchRow}>
            <View>
              <Text style={[typography.body, { color: colors.text.primary }]}>同步到企业主页</Text>
              <Text style={[typography.caption, { color: colors.text.secondary, marginTop: 4 }]}>
                同步企业动态，展示在展览馆
              </Text>
            </View>
            <Switch
              value={syncToCompany}
              onValueChange={setSyncToCompany}
              trackColor={{ false: colors.border, true: colors.brand.primarySoft }}
              thumbColor={syncToCompany ? colors.brand.primary : colors.muted}
            />
          </View>
        </View>

        <View style={styles.actionRow}>
          <Pressable
            onPress={handleSaveDraft}
            style={[styles.ghostButton, { borderColor: colors.border, flex: 1, marginRight: spacing.sm }]}
          >
            <Text style={[typography.bodyStrong, { color: colors.text.primary }]}>保存草稿</Text>
          </Pressable>
          <Pressable
            onPress={() => setPreviewSheetOpen(true)}
            style={[styles.ghostButton, { borderColor: colors.border, flex: 1 }]}
          >
            <Text style={[typography.bodyStrong, { color: colors.text.primary }]}>预览</Text>
          </Pressable>
        </View>
        <Pressable
          onPress={handleSubmit(handlePublish, handleInvalid)}
          style={[styles.primaryButton, { backgroundColor: colors.brand.primary, marginBottom: spacing.lg }]}
        >
          <Text style={[typography.bodyStrong, { color: colors.text.inverse }]}>
            {isEditing ? '保存修改' : '发布'}
          </Text>
        </Pressable>
      </ScrollView>

      <AppBottomSheet
        open={imageSheetOpen}
        onClose={() => setImageSheetOpen(false)}
        mode="half"
        title="选择图片"
      >
        <View style={styles.sheetHeader}>
          <Text style={[typography.caption, { color: colors.text.secondary }]}>示例图库（已选 {images.length}/9）</Text>
          <Pressable onPress={handleUploadPlaceholder} style={[styles.uploadChip, { borderColor: colors.border }]}>
            <MaterialCommunityIcons name="cloud-upload-outline" size={14} color={colors.text.secondary} />
            <Text style={[typography.caption, { color: colors.text.secondary, marginLeft: 6 }]}>模拟上传</Text>
          </Pressable>
        </View>
        <View style={styles.sheetGrid}>
          {placeholderImages.map((uri) => {
            const active = images.includes(uri);
            return (
              <Pressable
                key={uri}
                onPress={() => toggleImage(uri)}
                style={[
                  styles.sheetItem,
                  { borderColor: active ? colors.brand.primary : colors.border, borderRadius: radius.md },
                ]}
              >
                <Image source={{ uri }} style={{ width: '100%', height: '100%', borderRadius: 12 }} />
                {active ? (
                  <View style={[styles.sheetBadge, { backgroundColor: colors.brand.primary }]}>
                    <MaterialCommunityIcons name="check" size={12} color={colors.text.inverse} />
                  </View>
                ) : null}
              </Pressable>
            );
          })}
        </View>
        <Pressable
          onPress={() => setImageSheetOpen(false)}
          style={[styles.primaryButton, { backgroundColor: colors.brand.primary, marginTop: spacing.md }]}
        >
          <Text style={[typography.bodyStrong, { color: colors.text.inverse }]}>完成</Text>
        </Pressable>
      </AppBottomSheet>

      <AppBottomSheet
        open={productSheetOpen}
        onClose={() => setProductSheetOpen(false)}
        mode="half"
        title="选择商品"
        scrollable
      >
        {productLoading ? (
          <View>
            <Skeleton height={120} radius={radius.lg} />
            <Skeleton height={16} radius={radius.md} style={{ marginTop: spacing.md }} />
          </View>
        ) : !productResult || !productResult.ok ? (
          <ErrorState
            title="商品加载失败"
            description={productResult?.ok === false ? productResult.error.displayMessage ?? '请稍后再试' : '请稍后再试'}
            onAction={refetchProducts}
          />
        ) : productItems.length === 0 ? (
          <EmptyState title="暂无商品" description="稍后再来看看" />
        ) : (
          <View style={styles.productList}>
            {productItems.map((product) => {
              const active = selectedProduct?.id === product.id;
              return (
                <Pressable
                  key={product.id}
                  onPress={() => handleSelectProduct(product)}
                  style={[
                    styles.productRow,
                    {
                      borderColor: active ? colors.brand.primary : colors.border,
                      backgroundColor: active ? colors.brand.primarySoft : colors.surface,
                      borderRadius: radius.md,
                    },
                  ]}
                >
                  <Image source={{ uri: product.image }} style={[styles.productThumb, { borderRadius: radius.md }]} />
                  <View style={{ flex: 1, marginLeft: spacing.md }}>
                    <Text style={[typography.bodyStrong, { color: colors.text.primary }]} numberOfLines={2}>
                      {product.title}
                    </Text>
                    <Text style={[typography.caption, { color: colors.text.secondary, marginTop: 4 }]}>
                      {product.origin}
                    </Text>
                    <Price value={product.price} unit={product.unit} strikeValue={product.strikePrice} style={{ marginTop: 6 }} />
                  </View>
                  <MaterialCommunityIcons
                    name={active ? 'check-circle' : 'plus-circle-outline'}
                    size={20}
                    color={active ? colors.brand.primary : colors.text.secondary}
                  />
                </Pressable>
              );
            })}
          </View>
        )}
        {selectedProduct ? (
          <Pressable
            onPress={handleClearProduct}
            style={[styles.ghostButton, { borderColor: colors.border, marginTop: spacing.md }]}
          >
            <Text style={[typography.caption, { color: colors.text.secondary }]}>取消挂载</Text>
          </Pressable>
        ) : null}
      </AppBottomSheet>

      <AppBottomSheet
        open={previewSheetOpen}
        onClose={() => setPreviewSheetOpen(false)}
        mode="auto"
        title="发布预览"
        scrollable
      >
        <Text style={[typography.bodyStrong, { color: colors.text.primary }]}>卡片预览</Text>
        <View style={{ marginTop: spacing.sm }}>
          <PostCard post={previewPost} />
        </View>
        <Text style={[typography.bodyStrong, { color: colors.text.primary, marginTop: spacing.lg }]}>
          内容合成预览
        </Text>
        <View style={[styles.previewBox, { borderColor: colors.border, backgroundColor: colors.background }]}>
          <Text style={[typography.body, { color: colors.text.primary }]}>
            {mergedPreviewContent || '暂无内容'}
          </Text>
        </View>
        <View style={[styles.previewMeta, { borderColor: colors.border }]}>
          <View style={styles.previewRow}>
            <Text style={[typography.caption, { color: colors.text.secondary }]}>可见范围</Text>
            <Text style={[typography.caption, { color: colors.text.primary }]}>
              {visibilityLabels[visibility]}
            </Text>
          </View>
          <View style={styles.previewRow}>
            <Text style={[typography.caption, { color: colors.text.secondary }]}>允许评论</Text>
            <Text style={[typography.caption, { color: colors.text.primary }]}>
              {allowComments ? '开启' : '关闭'}
            </Text>
          </View>
          <View style={styles.previewRow}>
            <Text style={[typography.caption, { color: colors.text.secondary }]}>同步企业主页</Text>
            <Text style={[typography.caption, { color: colors.text.primary }]}>
              {syncToCompany ? '已开启' : '未开启'}
            </Text>
          </View>
          <View style={styles.previewRow}>
            <Text style={[typography.caption, { color: colors.text.secondary }]}>挂载商品</Text>
            <Text style={[typography.caption, { color: colors.text.primary }]} numberOfLines={1}>
              {selectedProduct ? selectedProduct.title : '未挂载'}
            </Text>
          </View>
          <View style={styles.previewRow}>
            <Text style={[typography.caption, { color: colors.text.secondary }]}>AI 配乐</Text>
            <Text style={[typography.caption, { color: colors.text.primary }]} numberOfLines={1}>
              {selectedMusic ? `${selectedMusic.title} · ${selectedMusic.mood}` : '未选择'}
            </Text>
          </View>
          <View style={styles.previewRow}>
            <Text style={[typography.caption, { color: colors.text.secondary }]}>AI 推荐标签</Text>
            <Text style={[typography.caption, { color: colors.text.primary }]} numberOfLines={1}>
              {aiTagSuggestions.length ? aiTagSuggestions.map((item) => item.label).join('、') : '暂无'}
            </Text>
          </View>
        </View>
      </AppBottomSheet>

      <AppBottomSheet
        open={musicSheetOpen}
        onClose={() => {
          setMusicSheetOpen(false);
          setPlayingTrackId(null);
        }}
        mode="half"
        title="AI 智能配乐"
        scrollable
      >
        {musicLoading || musicFetching ? (
          <View>
            <Skeleton height={120} radius={radius.lg} />
            <Skeleton height={16} radius={radius.md} style={{ marginTop: spacing.md }} />
          </View>
        ) : musicResult && !musicResult.ok ? (
          <ErrorState
            title="配乐生成失败"
            description={musicResult?.ok === false ? musicResult.error.displayMessage ?? '请稍后再试' : '请稍后再试'}
            onAction={refetchMusic}
          />
        ) : !musicCandidates.length ? (
          <EmptyState title="暂无推荐配乐" description="继续完善内容后再试试" />
        ) : (
          <View>
            {musicCandidates.map((track) => {
              const active = selectedMusic?.id === track.id;
              const playing = playingTrackId === track.id;
              return (
                <Pressable
                  key={track.id}
                  onPress={() => setSelectedMusic(track)}
                  style={[
                    styles.musicRow,
                    {
                      borderColor: active ? colors.brand.primary : colors.border,
                      backgroundColor: active ? colors.brand.primarySoft : colors.surface,
                      borderRadius: radius.md,
                    },
                  ]}
                >
                  <Image source={{ uri: track.cover }} style={[styles.musicCover, { borderRadius: radius.md }]} />
                  <View style={{ flex: 1, marginLeft: spacing.md }}>
                    <Text style={[typography.bodyStrong, { color: colors.text.primary }]} numberOfLines={1}>
                      {track.title}
                    </Text>
                    <Text style={[typography.caption, { color: colors.text.secondary, marginTop: 4 }]}>
                      {track.mood} · {track.bpm} BPM · {track.duration}
                    </Text>
                    <Text style={[typography.caption, { color: colors.text.secondary, marginTop: 2 }]}>
                      {playing ? '试听中…' : '点击试听'}
                    </Text>
                  </View>
                  <View style={styles.musicActions}>
                    <Pressable onPress={() => toggleMusicPlay(track)} hitSlop={8} style={styles.musicActionButton}>
                      <MaterialCommunityIcons
                        name={playing ? 'pause-circle-outline' : 'play-circle-outline'}
                        size={22}
                        color={playing ? colors.brand.primary : colors.text.secondary}
                      />
                    </Pressable>
                    <MaterialCommunityIcons
                      name={active ? 'check-circle' : 'music-note-outline'}
                      size={20}
                      color={active ? colors.brand.primary : colors.text.secondary}
                    />
                  </View>
                </Pressable>
              );
            })}
          </View>
        )}
        {selectedMusic ? (
          <Pressable
            onPress={() => setSelectedMusic(null)}
            style={[styles.ghostButton, { borderColor: colors.border, marginTop: spacing.md }]}
          >
            <Text style={[typography.caption, { color: colors.text.secondary }]}>取消配乐</Text>
          </Pressable>
        ) : null}
      </AppBottomSheet>

      <AppBottomSheet
        open={tagSheetOpen}
        onClose={() => setTagSheetOpen(false)}
        mode="half"
        title="AI 推荐标签"
        scrollable
      >
        {tagLoading || tagFetching ? (
          <View>
            <Skeleton height={100} radius={radius.lg} />
            <Skeleton height={100} radius={radius.lg} style={{ marginTop: spacing.md }} />
          </View>
        ) : tagResult && !tagResult.ok ? (
          <ErrorState
            title="标签推荐失败"
            description={tagResult?.ok === false ? tagResult.error.displayMessage ?? '请稍后再试' : '请稍后再试'}
            onAction={refetchTags}
          />
        ) : !tagSuggestions.length ? (
          <EmptyState title="暂无推荐标签" description="继续完善内容后再试试" />
        ) : (
          <View>
            <View style={styles.tagSuggestRow}>
              {tagSuggestions.map((item) => {
                const isAdded = selectedTags.includes(item.label);
                const isPending = pendingAiTags.includes(item.label);
                return (
                  <Pressable
                    key={item.label}
                    onPress={() => handleToggleTagSuggestion(item)}
                    disabled={isAdded}
                    style={[
                      styles.tagSuggestChip,
                      {
                        backgroundColor: isAdded
                          ? colors.brand.primarySoft
                          : isPending
                            ? colors.accent.blueSoft
                            : colors.background,
                        borderColor: isAdded
                          ? colors.brand.primary
                          : isPending
                            ? colors.accent.blue
                            : colors.border,
                        borderRadius: radius.md,
                      },
                    ]}
                  >
                    <View style={styles.tagSuggestTitleRow}>
                      <Text
                        style={[
                          typography.bodyStrong,
                          { color: isAdded ? colors.brand.primary : isPending ? colors.accent.blue : colors.text.primary },
                        ]}
                      >
                        {item.label}
                      </Text>
                      <MaterialCommunityIcons
                        name={isAdded ? 'check-circle' : isPending ? 'checkbox-marked-circle-outline' : 'plus-circle-outline'}
                        size={16}
                        color={isAdded ? colors.brand.primary : isPending ? colors.accent.blue : colors.text.secondary}
                      />
                    </View>
                    {item.reason ? (
                      <Text style={[typography.caption, { color: colors.text.secondary, marginTop: 6 }]}>
                        {item.reason}
                      </Text>
                    ) : null}
                    {isAdded ? (
                      <Text style={[typography.caption, { color: colors.brand.primary, marginTop: 4 }]}>
                        已加入
                      </Text>
                    ) : isPending ? (
                      <Text style={[typography.caption, { color: colors.accent.blue, marginTop: 4 }]}>
                        待加入
                      </Text>
                    ) : null}
                  </Pressable>
                );
              })}
            </View>
            <Pressable
              onPress={() => handleApplyTagSuggestions(tagSuggestions)}
              style={[styles.primaryButton, { backgroundColor: colors.brand.primary, marginTop: spacing.md }]}
            >
              <Text style={[typography.bodyStrong, { color: colors.text.inverse }]}>
                一键加入{pendingAiTags.length ? `（${pendingAiTags.length}）` : ''}
              </Text>
            </Pressable>
          </View>
        )}
      </AppBottomSheet>
    </Screen>
  );
}

const styles = StyleSheet.create({
  panel: {
    padding: 16,
    borderWidth: 1,
    borderColor: 'transparent',
    marginBottom: 16,
  },
  headerAction: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  sectionMeta: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  sectionAction: {
    marginLeft: 12,
  },
  inputHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 12,
  },
  imagePlaceholder: {
    borderWidth: 1,
    borderRadius: 14,
    paddingVertical: 28,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 12,
  },
  imageGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginTop: 12,
    justifyContent: 'space-between',
  },
  imageItem: {
    width: '31%',
    aspectRatio: 1,
    marginBottom: 12,
  },
  imageRemove: {
    position: 'absolute',
    top: 6,
    right: 6,
    width: 18,
    height: 18,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
  },
  imageTools: {
    position: 'absolute',
    left: 6,
    right: 6,
    bottom: 6,
    paddingHorizontal: 6,
    paddingVertical: 4,
    borderRadius: 8,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  coverBadge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 999,
  },
  imageMoveRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  imageMoveButton: {
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 4,
  },
  imageAdd: {
    width: '31%',
    aspectRatio: 1,
    borderWidth: 1,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  templateRow: {
    marginTop: 12,
  },
  templateCard: {
    borderWidth: 1,
    padding: 12,
    marginBottom: 12,
  },
  aiRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginTop: 12,
  },
  aiMetaRow: {
    marginTop: 10,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 8,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  aiChip: {
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
    marginRight: 8,
    marginBottom: 8,
  },
  input: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginTop: 12,
  },
  textarea: {
    minHeight: 120,
    textAlignVertical: 'top',
  },
  tagRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginTop: 8,
  },
  tagChip: {
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 6,
    marginRight: 8,
    marginBottom: 8,
  },
  tagHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  tagAiButton: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  visibilityRow: {
    marginTop: 12,
  },
  visibilityChip: {
    borderWidth: 1,
    padding: 12,
    marginBottom: 12,
  },
  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 12,
  },
  ghostButton: {
    borderWidth: 1,
    paddingVertical: 12,
    borderRadius: 999,
    alignItems: 'center',
  },
  primaryButton: {
    paddingVertical: 12,
    borderRadius: 999,
    alignItems: 'center',
  },
  actionRow: {
    flexDirection: 'row',
    marginTop: 8,
  },
  productCard: {
    borderWidth: 1,
    padding: 12,
    flexDirection: 'row',
    marginTop: 12,
  },
  productPlaceholder: {
    borderWidth: 1,
    borderRadius: 14,
    paddingVertical: 18,
    marginTop: 12,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
  },
  productThumb: {
    width: 68,
    height: 68,
  },
  productMeta: {
    flex: 1,
    marginLeft: 12,
  },
  productList: {
    marginTop: 8,
  },
  productRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    padding: 12,
    marginBottom: 12,
  },
  rowBetween: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  removeChip: {
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 4,
    marginLeft: 8,
  },
  sheetHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  uploadChip: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  musicRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    padding: 12,
    marginBottom: 12,
  },
  musicCover: {
    width: 56,
    height: 56,
  },
  musicActions: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  musicActionButton: {
    padding: 4,
    marginBottom: 4,
  },
  tagSuggestRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  tagSuggestChip: {
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginRight: 8,
    marginBottom: 8,
    minWidth: 140,
  },
  tagSuggestTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  previewBox: {
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
    marginTop: 12,
  },
  previewMeta: {
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
    marginTop: 12,
  },
  previewRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  sheetGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginTop: 4,
    justifyContent: 'space-between',
  },
  sheetItem: {
    width: '31%',
    aspectRatio: 1,
    borderWidth: 1,
    marginBottom: 12,
    overflow: 'hidden',
  },
  sheetBadge: {
    position: 'absolute',
    top: 6,
    right: 6,
    width: 18,
    height: 18,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
