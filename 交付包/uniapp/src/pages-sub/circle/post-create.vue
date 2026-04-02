<template>
  <Screen :safeTop="true">
    <AppHeader title="发布内容">
      <template #right>
        <view class="nm-header-action" @click="goDrafts">
          <Icon name="file-document-outline" :size="32" :color="textSecondary" />
          <text class="nm-header-link">草稿箱</text>
        </view>
      </template>
    </AppHeader>

    <scroll-view
      class="nm-page"
      scroll-y
      :scroll-into-view="scrollTarget"
      scroll-with-animation
      refresher-enabled
      :refresher-triggered="refreshing"
      @refresherrefresh="onRefresh"
    >
      <view id="nm-images" class="nm-card">
        <view class="nm-section-header nm-section-header--row">
          <text class="nm-card__title">图片内容</text>
          <view class="nm-section-meta">
            <text class="nm-section-hint">已选 {{ images.length }}/{{ maxImages }}</text>
            <text class="nm-link" @click="openImageSheet">选择图片</text>
          </view>
        </view>
        <view v-if="images.length === 0" class="nm-image-placeholder" @click="openImageSheet">
          <Icon name="image-plus" :size="40" :color="textSecondary" />
          <text class="nm-image-placeholder__text">选择图片（最多 9 张）</text>
        </view>
        <view v-else class="nm-image-grid">
          <view v-for="(img, index) in images" :key="img" class="nm-image">
            <image :src="img" class="nm-image__thumb" mode="aspectFill" />
            <view class="nm-image__remove" @click.stop="removeImage(index)">
              <Icon name="close" :size="20" :color="textInverse" />
            </view>
            <view class="nm-image__tools">
              <view v-if="index === 0" class="nm-image__badge">封面</view>
              <text v-else class="nm-image__set" @click.stop="setCover(index)">设为封面</text>
              <view class="nm-image__move">
                <view
                  :class="['nm-image__move-btn', index === 0 ? 'nm-image__move-btn--disabled' : '']"
                  @click.stop="moveImage(index, -1)"
                >
                  <Icon name="chevron-left" :size="20" :color="index === 0 ? textSecondary : textInverse" />
                </view>
                <view
                  :class="['nm-image__move-btn', index === images.length - 1 ? 'nm-image__move-btn--disabled' : '']"
                  @click.stop="moveImage(index, 1)"
                >
                  <Icon name="chevron-right" :size="20" :color="index === images.length - 1 ? textSecondary : textInverse" />
                </view>
              </view>
            </view>
          </view>
          <view v-if="images.length < maxImages" class="nm-image nm-image--add" @click="openImageSheet">
            <Icon name="plus" :size="28" :color="textSecondary" />
          </view>
        </view>
        <text v-if="images.length" class="nm-hint">封面默认为第一张，可左右调整顺序</text>
        <text class="nm-hint">至少选择 1 张图片</text>
        <text v-if="imageError" class="nm-error-text">请至少选择 1 张图片</text>
      </view>

      <view class="nm-card">
        <text class="nm-card__title">发布模板</text>
        <view class="nm-template-grid">
          <view
            v-for="option in templateOptions"
            :key="option.value"
            :class="['nm-template-card', template === option.value ? 'nm-template-card--active' : '']"
            @click="template = option.value"
          >
            <text :class="['nm-template-card__title', template === option.value ? 'nm-template-card__title--active' : '']">
              {{ option.label }}
            </text>
            <text class="nm-template-card__helper">{{ option.helper }}</text>
          </view>
        </view>
      </view>

      <view class="nm-card">
        <text class="nm-card__title">智能创作助手</text>
        <view class="nm-ai-row">
          <view class="nm-ai-chip" @click="generateAiDraft">
            <text class="nm-ai-title">AI 文案助手</text>
          </view>
          <view class="nm-ai-chip" @click="openMusicSheet">
            <text class="nm-ai-title">AI 智能配乐</text>
          </view>
        </view>
        <view v-if="selectedMusic" class="nm-ai-meta">
          <text class="nm-ai-meta__label">已选配乐</text>
          <text class="nm-ai-meta__value">{{ selectedMusic.title }} · {{ selectedMusic.mood }}</text>
          <text class="nm-ai-meta__remove" @click="clearMusic">移除</text>
        </view>
        <text class="nm-hint">{{ musicHintText }}</text>
      </view>

      <view class="nm-card">
        <text class="nm-card__title">内容信息</text>
        <view id="nm-title" class="nm-input-header">
          <text class="nm-label">标题</text>
          <text class="nm-count">{{ titleCount }}/{{ TITLE_LIMIT }}</text>
        </view>
        <text class="nm-hint">标题至少 2 字</text>
        <input
          class="nm-input"
          :maxlength="TITLE_LIMIT"
          placeholder="请输入标题"
          placeholder-class="nm-placeholder"
          v-model="title"
          @input="clearError('title')"
        />
        <FormError :text="errors.title" />

        <view id="nm-content" class="nm-input-header">
          <text class="nm-label">正文</text>
          <text class="nm-count">{{ contentCount }}/{{ CONTENT_LIMIT }}</text>
        </view>
        <text class="nm-hint">正文至少 5 字</text>
        <textarea
          class="nm-textarea"
          :maxlength="CONTENT_LIMIT"
          placeholder="分享你的故事、过程或经验"
          placeholder-class="nm-placeholder"
          v-model="content"
          @input="clearError('content')"
        />
        <FormError :text="errors.content" />

        <view v-if="template === 'story'" class="nm-subsection">
          <text class="nm-label">产品故事结构</text>
          <input class="nm-input" v-model="story.origin" placeholder="产地/故事背景" placeholder-class="nm-placeholder" />
          <input class="nm-input" v-model="story.process" placeholder="制作过程亮点" placeholder-class="nm-placeholder" />
          <input class="nm-input" v-model="story.taste" placeholder="口感与体验" placeholder-class="nm-placeholder" />
        </view>

        <view v-if="template === 'diary'" class="nm-subsection">
          <text class="nm-label">种植日志结构</text>
          <input class="nm-input" v-model="diary.stage" placeholder="当前生长阶段" placeholder-class="nm-placeholder" />
          <input class="nm-input" v-model="diary.weather" placeholder="天气与环境" placeholder-class="nm-placeholder" />
          <input class="nm-input" v-model="diary.note" placeholder="今日记录" placeholder-class="nm-placeholder" />
        </view>

        <view v-if="template === 'recipe'" class="nm-subsection">
          <text class="nm-label">食谱教程结构</text>
          <textarea class="nm-textarea" v-model="recipe.ingredients" placeholder="所需食材" placeholder-class="nm-placeholder" />
          <textarea class="nm-textarea" v-model="recipe.steps" placeholder="步骤（可用 1/2/3 分隔）" placeholder-class="nm-placeholder" />
          <textarea class="nm-textarea" v-model="recipe.tips" placeholder="小贴士" placeholder-class="nm-placeholder" />
        </view>

        <view class="nm-row nm-row--between nm-tag-header">
          <text class="nm-label">内容标签</text>
          <view class="nm-ai-btn" @click="openTagSheet">
            <Icon name="auto-fix" :size="28" :color="accentBlue" />
            <text class="nm-ai-btn__text">AI 推荐标签</text>
          </view>
        </view>
        <text class="nm-hint">模板标签会自动添加，可手动增删</text>
        <view class="nm-row">
          <view
            v-for="tag in postTags"
            :key="tag"
            :class="['nm-chip', selectedTags.includes(tag) ? 'nm-chip--active' : '']"
            @click="toggleTag(tag)"
          >{{ tag }}</view>
        </view>
        <text class="nm-label nm-label--sub">农事标签</text>
        <view class="nm-row">
          <view
            v-for="tag in farmingTags"
            :key="tag"
            :class="['nm-chip', selectedTags.includes(tag) ? 'nm-chip--active' : '']"
            @click="toggleTag(tag)"
          >{{ tag }}</view>
        </view>
        <FormError :text="errors.tags" />
      </view>

      <view class="nm-card">
        <view class="nm-row nm-row--between">
          <text class="nm-card__title">关联商品（可选）</text>
          <text class="nm-link" @click="openProductPicker">
            {{ selectedProduct ? '更换商品' : '选择商品' }}
          </text>
        </view>
        <view v-if="selectedProduct" class="nm-product-card">
          <image class="nm-product-thumb" :src="selectedProduct.image" mode="aspectFill" />
          <view class="nm-product-body">
            <view class="nm-row nm-row--between nm-product-title-row">
              <text class="nm-product-title" lines="2">{{ selectedProduct.title }}</text>
              <text class="nm-product-remove" @click="clearProduct">移除</text>
            </view>
            <text class="nm-product-meta">{{ selectedProduct.origin }}</text>
            <text class="nm-product-price">¥{{ selectedProduct.price }} / {{ selectedProduct.unit }}</text>
          </view>
        </view>
        <view v-else class="nm-product-placeholder" @click="openProductPicker">
          <Icon class="nm-product-placeholder__icon" name="cart-outline" :size="40" :color="textSecondary" />
          <text class="nm-product-placeholder__text">选择要挂载的商品</text>
        </view>
      </view>

      <view class="nm-card">
        <text class="nm-card__title">发布设置</text>
        <text class="nm-label nm-label--sub">可见范围</text>
        <view class="nm-visibility-grid">
          <view
            v-for="item in visibilityOptions"
            :key="item.value"
            :class="['nm-visibility-card', settings.visibility === item.value ? 'nm-visibility-card--active' : '']"
            @click="setVisibility(item.value)"
          >
            <text class="nm-visibility-title">{{ item.label }}</text>
            <text class="nm-visibility-desc">{{ item.desc }}</text>
          </view>
        </view>
        <view class="nm-switch-row">
          <view>
            <text class="nm-setting-title">允许评论</text>
            <text class="nm-setting-desc">关闭后将隐藏评论入口</text>
          </view>
          <ToggleSwitch v-model="settings.allowComment" />
        </view>
        <view class="nm-switch-row">
          <view>
            <text class="nm-setting-title">同步到企业主页</text>
            <text class="nm-setting-desc">同步企业动态，展示在展览馆</text>
          </view>
          <ToggleSwitch v-model="settings.syncCompany" />
        </view>
      </view>

      <view class="nm-action-row">
        <view :class="['nm-ghost', isSavingDraft ? 'nm-button--disabled' : '']" @click="saveDraft">
          {{ isSavingDraft ? '保存中...' : '保存草稿' }}
        </view>
        <view class="nm-ghost" @click="showPreviewSheet = true">预览</view>
      </view>
      <view :class="['nm-primary', isPublishing ? 'nm-button--disabled' : '']" @click="publish">
        {{ isPublishing ? '发布中...' : '发布' }}
      </view>
      <FormError :text="publishError" />
    </scroll-view>

    <BottomSheet :open="showImageSheet" title="选择图片" :scrollable="true" @close="showImageSheet = false">
      <view class="nm-sheet">
        <view class="nm-sheet__header">
          <text class="nm-sheet__hint">示例图库（已选 {{ images.length }}/{{ maxImages }}）</text>
          <view class="nm-sheet__upload" @click="simulateUpload">
            <Icon name="cloud-upload-outline" :size="24" :color="textSecondary" />
            <text class="nm-sheet__upload-text">模拟上传</text>
          </view>
        </view>
        <view class="nm-sheet__grid">
          <view
            v-for="item in imageCandidates"
            :key="item"
            :class="['nm-sheet__image', images.includes(item) ? 'nm-sheet__image--active' : '']"
            @click="toggleImage(item)"
          >
            <image :src="item" class="nm-sheet__thumb" mode="aspectFill" />
            <view v-if="images.includes(item)" class="nm-sheet__badge">
              <Icon name="check" :size="24" :color="textInverse" />
            </view>
          </view>
        </view>
        <view class="nm-sheet__confirm" @click="showImageSheet = false">完成</view>
      </view>
    </BottomSheet>

    <BottomSheet :open="showMusicSheet" title="AI 智能配乐" :scrollable="true" @close="showMusicSheet = false">
      <view class="nm-sheet">
        <view v-if="musicLoading" class="nm-skeleton">
          <Skeleton :count="2" type="line" />
        </view>
        <view v-else-if="musicTracks.length === 0" class="nm-empty">
          <EmptyState text="暂无推荐配乐" hint="继续完善内容后再试试" />
        </view>
        <view v-else>
          <view
            v-for="track in musicTracks"
            :key="track.id"
            :class="['nm-music-row', selectedMusic && selectedMusic.id === track.id ? 'nm-music-row--active' : '']"
            @click="selectMusic(track)"
          >
            <view class="nm-music-cover" />
            <view class="nm-music-info">
              <text class="nm-music-title">{{ track.title }}</text>
              <text class="nm-music-meta">{{ track.mood }} · {{ track.bpm }} BPM · {{ track.duration }}</text>
              <text class="nm-music-meta">{{ playingTrackId === track.id ? '试听中…' : '点击试听' }}</text>
            </view>
            <view class="nm-music-actions">
              <view class="nm-music-action-btn" @click.stop="togglePlay(track)">
                <Icon
                  :name="playingTrackId === track.id ? 'pause-circle-outline' : 'play-circle-outline'"
                  :size="40"
                  :color="playingTrackId === track.id ? brandPrimary : textSecondary"
                />
              </view>
              <Icon
                :name="selectedMusic && selectedMusic.id === track.id ? 'check-circle' : 'music-note-outline'"
                :size="36"
                :color="selectedMusic && selectedMusic.id === track.id ? brandPrimary : textSecondary"
              />
            </view>
          </view>
        </view>
        <view v-if="selectedMusic" class="nm-sheet__ghost" @click="clearMusic">取消配乐</view>
      </view>
    </BottomSheet>

    <BottomSheet :open="showTagSheet" title="AI 推荐标签" :scrollable="true" @close="showTagSheet = false">
      <view class="nm-sheet">
        <view v-if="tagLoading" class="nm-skeleton">
          <Skeleton :count="2" type="line" />
        </view>
        <view v-else-if="aiTagSuggestions.length === 0" class="nm-empty">
          <EmptyState text="暂无推荐标签" hint="继续完善内容后再试试" />
        </view>
        <view v-else class="nm-tag-suggest">
          <view
            v-for="item in aiTagSuggestions"
            :key="item.id"
            :class="[
              'nm-tag-suggest__item',
              selectedTags.includes(item.label) ? 'nm-tag-suggest__item--added' : pendingTags.includes(item.label) ? 'nm-tag-suggest__item--pending' : '',
            ]"
            @click="togglePendingTag(item.label)"
          >
            <view class="nm-tag-suggest__row">
              <text class="nm-tag-suggest__title">{{ item.label }}</text>
              <Icon
                :name="
                  selectedTags.includes(item.label)
                    ? 'check-circle'
                    : pendingTags.includes(item.label)
                      ? 'checkbox-marked-circle-outline'
                      : 'plus-circle-outline'
                "
                :size="32"
                :color="selectedTags.includes(item.label) ? brandPrimary : pendingTags.includes(item.label) ? accentBlue : textSecondary"
              />
            </view>
            <text v-if="item.reason" class="nm-tag-suggest__meta">{{ item.reason }}</text>
            <text v-if="selectedTags.includes(item.label)" class="nm-tag-suggest__state nm-tag-suggest__state--added">已加入</text>
            <text v-else-if="pendingTags.includes(item.label)" class="nm-tag-suggest__state nm-tag-suggest__state--pending">待加入</text>
          </view>
        </view>
        <view class="nm-sheet__confirm" @click="applyAiTags">
          一键加入{{ pendingTags.length ? `（${pendingTags.length}）` : '' }}
        </view>
      </view>
    </BottomSheet>

    <BottomSheet :open="showPreviewSheet" title="发布预览" :scrollable="true" @close="showPreviewSheet = false">
      <view class="nm-preview">
        <text class="nm-preview__title">卡片预览</text>
        <view class="nm-preview__card">
          <PostCard :item="previewPost" :currentUserId="'u_mock'" />
        </view>
        <text class="nm-preview__title nm-preview__title--spaced">内容合成预览</text>
        <view class="nm-preview__box">
          <text class="nm-preview__desc">{{ mergedPreviewContent || '暂无内容' }}</text>
        </view>
        <view class="nm-preview__meta">
          <view class="nm-preview__row">
            <text class="nm-preview__label">可见范围</text>
            <text class="nm-preview__value">{{ visibilityLabel }}</text>
          </view>
          <view class="nm-preview__row">
            <text class="nm-preview__label">允许评论</text>
            <text class="nm-preview__value">{{ settings.allowComment ? '开启' : '关闭' }}</text>
          </view>
          <view class="nm-preview__row">
            <text class="nm-preview__label">同步企业主页</text>
            <text class="nm-preview__value">{{ settings.syncCompany ? '已开启' : '未开启' }}</text>
          </view>
          <view class="nm-preview__row">
            <text class="nm-preview__label">挂载商品</text>
            <text class="nm-preview__value">{{ selectedProduct ? selectedProduct.title : '未挂载' }}</text>
          </view>
          <view class="nm-preview__row">
            <text class="nm-preview__label">AI 配乐</text>
            <text class="nm-preview__value">{{ selectedMusic ? selectedMusic.title : '未选择' }}</text>
          </view>
          <view class="nm-preview__row">
            <text class="nm-preview__label">AI 推荐标签</text>
            <text class="nm-preview__value">
              {{ aiTagSuggestions.length ? aiTagSuggestions.map((item) => item.label).join('、') : '暂无' }}
            </text>
          </view>
        </view>
      </view>
    </BottomSheet>

    <BottomSheet :open="showProductSheet" title="选择商品" :scrollable="true" @close="showProductSheet = false">
      <view class="nm-sheet">
        <view v-if="productLoading" class="nm-skeleton">
          <Skeleton :count="2" type="card" />
        </view>
        <view v-else-if="productError" class="nm-error" @click="onProductSearch">
          <ErrorState :text="productError" @retry="onProductSearch" />
        </view>
        <view v-else-if="productList.length === 0" class="nm-empty">
          <EmptyState text="暂无商品" hint="稍后再来看看" />
        </view>
        <view v-else class="nm-product-list">
          <view
            v-for="item in productList"
            :key="item.id"
            :class="['nm-product-row', selectedProduct && selectedProduct.id === item.id ? 'nm-product-row--active' : '']"
            @click="toggleProduct(item)"
          >
            <image class="nm-product-row__thumb" :src="item.image" mode="aspectFill" />
            <view class="nm-product-row__info">
              <text class="nm-product-row__title" lines="2">{{ item.title }}</text>
              <text class="nm-product-row__meta">{{ item.origin }}</text>
              <text class="nm-product-row__price">¥{{ item.price }} / {{ item.unit }}</text>
            </view>
            <Icon
              :name="selectedProduct && selectedProduct.id === item.id ? 'check-circle' : 'plus-circle-outline'"
              :size="36"
              :color="selectedProduct && selectedProduct.id === item.id ? brandPrimary : textSecondary"
            />
          </view>
        </view>
        <view v-if="selectedProduct" class="nm-sheet__ghost" @click="clearProduct">取消挂载</view>
      </view>
    </BottomSheet>
  </Screen>
</template>

<script setup lang="ts">
import { navTo } from '@/utils/nav';
import { reactive, ref, computed } from 'vue';
import { onLoad } from '@dcloudio/uni-app';
import { Screen, AppHeader, BottomSheet, Skeleton, ToggleSwitch, FormError, EmptyState, ErrorState, Icon } from '@/components';
import PostCard from '@/components/cards/PostCard.vue';
import {
  ProductRepo,
  DraftRepo,
  PostRepo,
  type Product,
  AiRepo,
  type AiMusicTrack,
  type AiTagSuggestion,
  type Draft,
  type DraftInput,
} from '@/services/repos';

type Template = 'story' | 'diary' | 'recipe' | 'general';
const TITLE_LIMIT = 40;
const CONTENT_LIMIT = 1200;
const maxImages = 9;
const textSecondary = '#4B5B53';
const textInverse = '#FFFFFF';
const accentBlue = '#2B6CB0';
const brandPrimary = '#2F8F4E';

const templateOptions: Array<{ value: Template; label: string; helper: string }> = [
  { value: 'story', label: '产品故事', helper: '讲清产地/人物/品牌故事' },
  { value: 'diary', label: '种植日志', helper: '记录周期与关键节点' },
  { value: 'recipe', label: '食谱教程', helper: '步骤与搭配建议' },
  { value: 'general', label: '随手记录', helper: '自由表达观点与动态' },
];

const template = ref<Template>('story');
const title = ref('');
const content = ref('');
const story = reactive({ origin: '', process: '', taste: '' });
const diary = reactive({ stage: '', weather: '', note: '' });
const recipe = reactive({ ingredients: '', steps: '', tips: '' });
const images = ref<string[]>([]);
const coverIndex = ref(0);
const imageCandidates = [
  'https://placehold.co/900x900/png',
  'https://placehold.co/900x900/png?text=Farm',
  'https://placehold.co/900x900/png?text=Harvest',
  'https://placehold.co/900x900/png?text=Greenhouse',
  'https://placehold.co/900x900/png?text=Recipe',
  'https://placehold.co/900x900/png?text=Story',
];

const aiTagSuggestions = ref<AiTagSuggestion[]>([]);
const pendingTags = ref<string[]>([]);
const selectedTags = ref<string[]>([]);
const postTags = ['产品故事', '种植日志', '食谱教程', '企业动态', '合作招募'];
const farmingTags = ['#育苗期#', '#成长期#', '#采收季#', '#丰收#', '#轻食#'];

const musicTracks = ref<AiMusicTrack[]>([]);
const selectedMusic = ref<AiMusicTrack | null>(null);
const playingTrackId = ref<string>('');
const musicLoading = ref(false);
const tagLoading = ref(false);

const scrollTarget = ref('');
const refreshing = ref(false);
const showImageSheet = ref(false);
const showMusicSheet = ref(false);
const showTagSheet = ref(false);
const showProductSheet = ref(false);
const showPreviewSheet = ref(false);
const imageError = ref(false);

type Visibility = 'public' | 'followers' | 'private';

const settings = reactive({
  visibility: 'public' as Visibility,
  allowComment: true,
  syncCompany: false,
});

const selectedProduct = ref<Product | null>(null);
const productList = ref<Product[]>([]);
const productKeyword = ref('');
const productPage = ref(1);
const productPageSize = ref(6);
const productHasMore = ref(true);
const productLoading = ref(false);
const productError = ref('');

const visibilityOptions: Array<{ value: Visibility; label: string; desc: string }> = [
  { value: 'public', label: '公开', desc: '所有人可见' },
  { value: 'followers', label: '关注可见', desc: '仅关注者可见' },
  { value: 'private', label: '仅自己', desc: '仅自己可见' },
];

const visibilityLabel = computed(() => {
  const match = visibilityOptions.find((item) => item.value === settings.visibility);
  return match ? match.label : '公开';
});

const templateLabel = computed(() => {
  const match = templateOptions.find((item) => item.value === template.value);
  return match ? match.label : '发布模板';
});

const titleCount = computed(() => title.value.length);
const contentCount = computed(() => content.value.length);

const musicHintText = computed(() =>
  musicLoading.value ? '正在生成配乐推荐…' : `推荐配乐 ${musicTracks.value.length} 条`
);

const mergedPreviewContent = computed(() => {
  const parts: string[] = [];
  if (content.value.trim()) parts.push(content.value.trim());
  if (template.value === 'story') {
    if (story.origin) parts.push(`产地/故事背景：${story.origin}`);
    if (story.process) parts.push(`制作过程：${story.process}`);
    if (story.taste) parts.push(`口感体验：${story.taste}`);
  }
  if (template.value === 'diary') {
    if (diary.stage) parts.push(`阶段：${diary.stage}`);
    if (diary.weather) parts.push(`天气：${diary.weather}`);
    if (diary.note) parts.push(`记录：${diary.note}`);
  }
  if (template.value === 'recipe') {
    if (recipe.ingredients) parts.push(`食材：${recipe.ingredients}`);
    if (recipe.steps) parts.push(`步骤：${recipe.steps}`);
    if (recipe.tips) parts.push(`小贴士：${recipe.tips}`);
  }
  return parts.join('\\n');
});

const previewPost = computed(() => ({
  id: 'preview',
  author: '江晴',
  authorId: 'u_mock',
  authorName: '江晴',
  authorType: 'user',
  city: '杭州',
  tag: '农脉圈创作者',
  title: title.value || '未填写标题',
  content: content.value || '未填写正文内容',
  likes: 0,
  comments: 0,
  shares: 0,
  followed: true,
  createdAt: '刚刚',
  tags: selectedTags.value,
  images: images.value.length ? images.value : ['https://placehold.co/900x900/png'],
  image: images.value.length ? images.value[0] : 'https://placehold.co/900x900/png',
  productId: selectedProduct.value?.id,
  productTagLabel: selectedProduct.value ? '即看即买' : undefined,
  intimacyLevel: 28,
}));

const drafts = ref<Draft[]>([]);
const draftPage = ref(1);
const draftPageSize = ref(6);
const draftHasMore = ref(true);
const draftLoading = ref(false);
const draftError = ref('');
const isSavingDraft = ref(false);
const isPublishing = ref(false);
const publishError = ref('');

const errors = reactive<{ title: string; content: string; tags: string }>({
  title: '',
  content: '',
  tags: '',
});

const clearError = (field: 'title' | 'content' | 'tags') => {
  errors[field] = '';
};

const onRefresh = () => {
  if (refreshing.value) return;
  refreshing.value = true;
  setTimeout(() => {
    refreshing.value = false;
  }, 300);
};

const goDrafts = () => {
  navTo({ url: '/pages-sub/circle/drafts' });
};

const buildDraftPayload = (): DraftInput => ({
  title: title.value,
  content: content.value,
  tags: selectedTags.value,
  images: images.value,
  template: template.value,
  coverIndex: coverIndex.value,
  visibility: settings.visibility,
  allowComments: settings.allowComment,
  syncToCompany: settings.syncCompany,
  music: selectedMusic.value ?? undefined,
});

const generateAiDraft = () => {
  if (!content.value) {
    content.value = 'AI 草稿占位：这里将生成符合模板结构的内容。';
  }
  uni.showToast({ title: '已生成 AI 草稿（占位）', icon: 'none' });
};

const openMusicSheet = async () => {
  showMusicSheet.value = true;
  if (musicTracks.value.length === 0) {
    await fetchMusic();
  }
};

const openTagSheet = async () => {
  showTagSheet.value = true;
  if (aiTagSuggestions.value.length === 0) {
    await fetchAiTags();
  }
};

const openImageSheet = () => {
  showImageSheet.value = true;
};

const toggleImage = (src: string) => {
  if (images.value.includes(src)) {
    images.value = images.value.filter((item) => item !== src);
  } else if (images.value.length < maxImages) {
    images.value = images.value.concat(src);
  }
  coverIndex.value = 0;
  imageError.value = images.value.length === 0;
};

const simulateUpload = () => {
  const next = imageCandidates.find((item) => !images.value.includes(item));
  if (next) {
    toggleImage(next);
  }
};

const removeImage = (index: number) => {
  images.value = images.value.filter((_, i) => i !== index);
  coverIndex.value = 0;
  imageError.value = images.value.length === 0;
};

const setCover = (index: number) => {
  if (index <= 0) return;
  const next = images.value.slice();
  const [item] = next.splice(index, 1);
  next.unshift(item);
  images.value = next;
  coverIndex.value = 0;
};

const moveImage = (index: number, direction: number) => {
  const target = index + direction;
  if (target < 0 || target >= images.value.length) return;
  const next = images.value.slice();
  const [item] = next.splice(index, 1);
  next.splice(target, 0, item);
  images.value = next;
  coverIndex.value = 0;
};

const toggleTag = (tag: string) => {
  if (selectedTags.value.includes(tag)) {
    selectedTags.value = selectedTags.value.filter((item) => item !== tag);
  } else {
    selectedTags.value = selectedTags.value.concat(tag);
  }
};

const removeTag = (tag: string) => {
  selectedTags.value = selectedTags.value.filter((item) => item !== tag);
};

const togglePendingTag = (tag: string) => {
  if (selectedTags.value.includes(tag)) return;
  if (pendingTags.value.includes(tag)) {
    pendingTags.value = pendingTags.value.filter((item) => item !== tag);
  } else {
    pendingTags.value = pendingTags.value.concat(tag);
  }
};

const applyAiTags = () => {
  if (!pendingTags.value.length) {
    uni.showToast({ title: '请先选择要加入的标签', icon: 'none' });
    return;
  }
  const next = new Set(selectedTags.value);
  pendingTags.value.forEach((tag) => next.add(tag));
  selectedTags.value = Array.from(next);
  pendingTags.value = [];
  showTagSheet.value = false;
  uni.showToast({ title: '已加入推荐标签', icon: 'none' });
};

const fetchAiTags = async () => {
  tagLoading.value = true;
  const res = await AiRepo.recommendTags({ template: template.value, title: title.value, content: content.value });
  if (res.ok) {
    aiTagSuggestions.value = res.data;
  }
  tagLoading.value = false;
};

const fetchMusic = async () => {
  musicLoading.value = true;
  const res = await AiRepo.recommendMusic({ template: template.value, title: title.value, content: content.value });
  if (res.ok) {
    musicTracks.value = res.data;
  }
  musicLoading.value = false;
};

const togglePlay = (track: AiMusicTrack) => {
  playingTrackId.value = playingTrackId.value === track.id ? '' : track.id;
  uni.showToast({ title: playingTrackId.value ? '开始试听（占位）' : '停止试听', icon: 'none' });
};

const selectMusic = (track: AiMusicTrack) => {
  selectedMusic.value = track;
};

const clearMusic = () => {
  selectedMusic.value = null;
  playingTrackId.value = '';
};

const openProductPicker = () => {
  showProductSheet.value = true;
  if (productList.value.length === 0) {
    onProductSearch();
  }
};

const saveDraft = async () => {
  if (isSavingDraft.value) return;
  isSavingDraft.value = true;
  const res = await DraftRepo.save(buildDraftPayload());
  isSavingDraft.value = false;
  if (res.ok) {
    await fetchDrafts(true);
    uni.showToast({ title: '已保存草稿', icon: 'none' });
  }
};

const toggleProduct = (item: Product) => {
  if (selectedProduct.value && selectedProduct.value.id === item.id) {
    selectedProduct.value = null;
  } else {
    selectedProduct.value = item;
  }
};

const confirmProduct = () => {
  showProductSheet.value = false;
  if (selectedProduct.value) {
    uni.showToast({ title: '已选择商品', icon: 'none' });
  }
};

const clearProduct = () => {
  selectedProduct.value = null;
};

const fetchProducts = async (reset: boolean) => {
  if (productLoading.value) return;
  if (!productHasMore.value && !reset) return;
  productLoading.value = true;
  const nextPage = reset ? 1 : productPage.value + 1;
  const res = await ProductRepo.list({
    page: nextPage,
    pageSize: productPageSize.value,
    category: productKeyword.value || undefined,
  });
  if (res.ok) {
    productError.value = '';
    productList.value = reset ? res.data.items : productList.value.concat(res.data.items);
    productPage.value = res.data.page;
    productHasMore.value = res.data.hasMore;
  } else {
    productError.value = res.error.message || '加载失败';
  }
  productLoading.value = false;
};

const onProductSearch = () => {
  productHasMore.value = true;
  productError.value = '';
  fetchProducts(true);
};

const onProductLoadMore = () => {
  fetchProducts(false);
};

const fetchDrafts = async (reset: boolean) => {
  if (draftLoading.value) return;
  if (!draftHasMore.value && !reset) return;
  draftLoading.value = true;
  const nextPage = reset ? 1 : draftPage.value + 1;
  const res = await DraftRepo.list({ page: nextPage, pageSize: draftPageSize.value });
  if (res.ok) {
    draftError.value = '';
    drafts.value = reset ? res.data.items : drafts.value.concat(res.data.items);
    draftPage.value = res.data.page;
    draftHasMore.value = res.data.hasMore;
  } else {
    draftError.value = res.error.message || '加载失败';
  }
  draftLoading.value = false;
};

const setVisibility = (value: Visibility) => {
  settings.visibility = value;
};

const publish = async () => {
  if (isPublishing.value) return;
  imageError.value = images.value.length === 0;
  errors.title = '';
  errors.content = '';
  errors.tags = '';
  let invalidTarget = '';
  if (imageError.value) {
    invalidTarget = 'nm-images';
  }
  if (title.value.trim().length < 2) {
    errors.title = '标题至少 2 个字';
    if (!invalidTarget) invalidTarget = 'nm-title';
  }
  if (content.value.trim().length < 5) {
    errors.content = '正文至少 5 个字';
    if (!invalidTarget) invalidTarget = 'nm-content';
  }
  if (!selectedTags.value.length) {
    errors.tags = '请至少选择一个标签';
  }
  if (invalidTarget) {
    scrollTarget.value = invalidTarget;
    setTimeout(() => {
      scrollTarget.value = '';
    }, 300);
    return;
  }
  publishError.value = '';
  isPublishing.value = true;
  const res = await PostRepo.create({
    title: title.value,
    content: content.value,
    tags: selectedTags.value,
    template: template.value,
    images: images.value,
    coverIndex: coverIndex.value,
    music: selectedMusic.value ? { id: selectedMusic.value.id, title: selectedMusic.value.title, artist: selectedMusic.value.artist } : undefined,
    extras: {
      storyOrigin: story.origin,
      storyProcess: story.process,
      storyTaste: story.taste,
      diaryStage: diary.stage,
      diaryWeather: diary.weather,
      diaryNote: diary.note,
      recipeIngredients: recipe.ingredients,
      recipeSteps: recipe.steps,
      recipeTips: recipe.tips,
    },
    settings,
    productId: selectedProduct.value ? selectedProduct.value.id : undefined,
  });
  isPublishing.value = false;
  if (res.ok) {
    uni.showToast({ title: '发布成功（占位）', icon: 'success' });
  } else {
    await DraftRepo.save(buildDraftPayload());
    await fetchDrafts(true);
    publishError.value = res.error.message || '发布失败，已自动保存草稿';
    uni.showToast({ title: publishError.value, icon: 'none' });
  }
};

onLoad((options?: Record<string, string>) => {
  fetchDrafts(true);
  if (options?.draftId) {
    DraftRepo.getById(options.draftId).then((res) => {
      if (res.ok) {
        title.value = res.data.title;
        content.value = res.data.content;
        selectedTags.value = res.data.tags || [];
        template.value = res.data.template || 'general';
        const nextImages = res.data.images || [];
        const nextCover = res.data.coverIndex ?? 0;
        if (nextCover > 0 && nextCover < nextImages.length) {
          const reordered = nextImages.slice();
          const [item] = reordered.splice(nextCover, 1);
          reordered.unshift(item);
          images.value = reordered;
          coverIndex.value = 0;
        } else {
          images.value = nextImages;
          coverIndex.value = 0;
        }
        settings.visibility = res.data.visibility || settings.visibility;
        settings.allowComment = res.data.allowComments ?? settings.allowComment;
        settings.syncCompany = res.data.syncToCompany ?? settings.syncCompany;
        selectedMusic.value = res.data.music ?? null;
      }
    });
  }
});
</script>

<style scoped lang="scss">
@use '@/styles/tokens.scss' as *;

.nm-page {
  padding: $nm-space-xl $nm-space-xl $nm-space-3xl;
  box-sizing: border-box;
  background-color: $nm-background;
}

.nm-header-action {
  display: flex;
  flex-direction: row;
  align-items: center;
}

.nm-header-link {
  margin-left: 8rpx;
  font-size: $nm-font-caption;
  color: $nm-text-secondary;
}

.nm-card {
  margin-bottom: $nm-space-lg;
  padding: $nm-space-lg;
  border-radius: $nm-radius-lg;
  border: 1rpx solid transparent;
  background-color: $nm-surface;
  box-shadow: $nm-shadow-sm;
  box-sizing: border-box;
}

.nm-card__title {
  font-size: $nm-font-body;
  font-weight: 600;
  color: $nm-text-primary;
  margin-bottom: $nm-space-sm;
}

.nm-section-title {
  font-size: $nm-font-body;
  font-weight: 600;
  color: $nm-text-primary;
}

.nm-section-desc {
  margin-top: $nm-space-xs;
  font-size: $nm-font-caption;
  color: $nm-text-secondary;
}

.nm-hint {
  margin-top: 8rpx;
  font-size: $nm-font-caption;
  color: $nm-text-secondary;
}

.nm-error-text {
  margin-top: 8rpx;
  font-size: $nm-font-caption;
  color: $nm-danger;
}

.nm-section-header {
  margin-bottom: $nm-space-sm;
}

.nm-section-header--row {
  display: flex;
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
}

.nm-section-meta {
  display: flex;
  flex-direction: row;
  align-items: center;
}

.nm-section-hint {
  font-size: $nm-font-caption;
  color: $nm-text-secondary;
  margin-right: $nm-space-sm;
}

.nm-section-header--row .nm-card__title {
  margin-bottom: 0;
}

.nm-label {
  font-size: $nm-font-caption;
  color: $nm-text-secondary;
}

.nm-label--sub {
  margin-top: $nm-space-sm;
}

.nm-input-header {
  margin-top: $nm-space-md;
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.nm-count {
  font-size: $nm-font-caption;
  color: $nm-text-secondary;
}

.nm-template-grid {
  display: flex;
  flex-direction: column;
  margin-top: $nm-space-md;
}

.nm-template-card {
  width: 100%;
  padding: $nm-space-md;
  border-radius: $nm-radius-lg;
  border: 1rpx solid $nm-border;
  background-color: $nm-surface;
  margin-bottom: $nm-space-md;
  box-sizing: border-box;
}

.nm-template-card--active {
  border-color: $nm-brand-primary;
  background-color: $nm-brand-primary;
}

.nm-template-card__title {
  font-size: $nm-font-body;
  font-weight: 600;
  color: $nm-text-primary;
}

.nm-template-card__title--active {
  color: $nm-text-inverse;
}

.nm-template-card__helper {
  margin-top: 6rpx;
  font-size: $nm-font-caption;
  color: $nm-text-secondary;
}

.nm-template-card--active .nm-template-card__helper {
  color: $nm-text-inverse;
}

.nm-ai-row {
  display: flex;
  flex-wrap: wrap;
  margin-top: $nm-space-md;
  align-items: center;
}

.nm-ai-chip {
  display: flex;
  align-items: center;
  padding: 12rpx 20rpx;
  border-radius: $nm-radius-pill;
  border: 1rpx solid $nm-border;
  background-color: $nm-surface;
  margin-right: 16rpx;
  margin-bottom: 16rpx;
  box-sizing: border-box;
}

.nm-ai-title {
  font-size: $nm-font-caption;
  color: $nm-text-secondary;
}

.nm-ai-meta {
  margin-top: 20rpx;
  padding: 16rpx 20rpx;
  border-radius: $nm-radius-md;
  border: 1rpx solid $nm-border;
  background-color: $nm-surface;
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.nm-ai-meta__label {
  font-size: $nm-font-caption;
  color: $nm-text-secondary;
}

.nm-ai-meta__value {
  font-size: $nm-font-caption;
  color: $nm-text-primary;
  flex: 1;
  margin-left: 12rpx;
}

.nm-ai-meta__remove {
  font-size: $nm-font-caption;
  color: $nm-danger;
}

.nm-input {
  margin-top: $nm-space-md;
  border-radius: $nm-radius-md;
  background-color: $nm-surface;
  border: 1rpx solid $nm-border;
  padding: 20rpx 24rpx;
  color: $nm-text-primary;
  width: 100%;
  box-sizing: border-box;
}

.nm-textarea {
  margin-top: $nm-space-md;
  min-height: 240rpx;
  border-radius: $nm-radius-md;
  background-color: $nm-surface;
  border: 1rpx solid $nm-border;
  padding: 20rpx 24rpx;
  color: $nm-text-primary;
  width: 100%;
  box-sizing: border-box;
}

.nm-placeholder {
  color: $nm-text-secondary;
}

.nm-subsection {
  margin-top: $nm-space-md;
  padding: 0;
  border-radius: 0;
  border: 0;
  background-color: transparent;
}

.nm-row {
  display: flex;
  flex-direction: row;
  flex-wrap: wrap;
  margin-top: $nm-space-sm;
  align-items: center;
}

.nm-row--between {
  justify-content: space-between;
  align-items: center;
}

.nm-tag-header {
  margin-top: $nm-space-sm;
}

.nm-image-grid {
  display: flex;
  flex-direction: row;
  flex-wrap: wrap;
  margin-top: $nm-space-md;
  justify-content: space-between;
}

.nm-image {
  width: 31%;
  aspect-ratio: 1;
  border-radius: $nm-radius-md;
  border: 1rpx solid $nm-border;
  margin-bottom: $nm-space-md;
  position: relative;
  overflow: hidden;
  background-color: $nm-surface;
  box-sizing: border-box;
}

.nm-image__thumb {
  width: 100%;
  height: 100%;
}

.nm-image--add {
  align-items: center;
  justify-content: center;
  background-color: $nm-surface;
}

.nm-image__remove {
  position: absolute;
  right: 8rpx;
  top: 8rpx;
  width: 36rpx;
  height: 36rpx;
  border-radius: 18rpx;
  background-color: $nm-overlay;
  display: flex;
  align-items: center;
  justify-content: center;
}

.nm-image__tools {
  position: absolute;
  left: 8rpx;
  right: 8rpx;
  bottom: 8rpx;
  padding: 6rpx 8rpx;
  border-radius: 16rpx;
  background-color: $nm-overlay;
  display: flex;
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
}

.nm-image__badge {
  padding: 4rpx 12rpx;
  border-radius: $nm-radius-pill;
  background-color: transparent;
  color: $nm-text-inverse;
  font-size: $nm-font-caption;
}

.nm-image__set {
  font-size: $nm-font-caption;
  color: $nm-text-inverse;
}

.nm-image__move {
  display: flex;
  flex-direction: row;
  align-items: center;
}

.nm-image__move-btn {
  width: 32rpx;
  height: 32rpx;
  border-radius: 16rpx;
  display: flex;
  align-items: center;
  justify-content: center;
  margin-left: 6rpx;
}

.nm-image__move-btn--disabled {
  opacity: 0.6;
  pointer-events: none;
}

.nm-image-placeholder {
  margin-top: $nm-space-md;
  border-radius: 28rpx;
  border: 1rpx solid $nm-border;
  padding: 56rpx 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background-color: $nm-surface;
}

.nm-image-placeholder__text {
  margin-top: 12rpx;
  font-size: $nm-font-caption;
  color: $nm-text-secondary;
}

.nm-ai-btn {
  display: flex;
  flex-direction: row;
  align-items: center;
}

.nm-ai-btn__text {
  margin-left: 8rpx;
  font-size: $nm-font-caption;
  color: $nm-accent-blue;
}

.nm-chip {
  padding: 12rpx 24rpx;
  border-radius: $nm-radius-pill;
  background-color: $nm-surface;
  border: 1rpx solid $nm-border;
  margin-right: 16rpx;
  margin-bottom: 16rpx;
  font-size: $nm-font-caption;
  color: $nm-text-secondary;
}

.nm-chip--active {
  background-color: $nm-brand-primary;
  border-color: $nm-brand-primary;
  color: $nm-text-inverse;
}

.nm-link {
  font-size: $nm-font-caption;
  color: $nm-accent-blue;
}

.nm-product-card {
  margin-top: $nm-space-md;
  display: flex;
  padding: $nm-space-md;
  border-radius: $nm-radius-lg;
  border: 1rpx solid $nm-border;
  background-color: $nm-surface;
  align-items: center;
  box-sizing: border-box;
}

.nm-product-thumb {
  width: 136rpx;
  height: 136rpx;
  border-radius: $nm-radius-md;
  margin-right: $nm-space-md;
  background-color: $nm-skeleton;
}

.nm-product-body {
  flex: 1;
}

.nm-product-title {
  font-size: $nm-font-body;
  font-weight: 600;
  color: $nm-text-primary;
  flex: 1;
  margin-right: $nm-space-sm;
}

.nm-product-remove {
  font-size: $nm-font-caption;
  color: $nm-brand-primary;
  background-color: $nm-brand-primary-soft;
  border-radius: $nm-radius-pill;
  padding: 8rpx 16rpx;
}

.nm-product-meta {
  margin-top: 4rpx;
  font-size: $nm-font-caption;
  color: $nm-text-secondary;
}

.nm-product-price {
  margin-top: 4rpx;
  font-size: $nm-font-body;
  color: $nm-text-primary;
}

.nm-product-placeholder {
  margin-top: $nm-space-md;
  border-radius: 28rpx;
  border: 1rpx solid $nm-border;
  background-color: $nm-surface;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-direction: row;
  padding: 36rpx 0;
  box-sizing: border-box;
}

.nm-product-placeholder__icon {
  margin-right: 12rpx;
}

.nm-product-placeholder__text {
  font-size: $nm-font-caption;
  color: $nm-text-secondary;
}

.nm-visibility-grid {
  display: flex;
  flex-direction: column;
  margin-top: $nm-space-md;
}

.nm-visibility-card {
  width: 100%;
  margin-bottom: $nm-space-md;
  padding: $nm-space-md;
  border-radius: $nm-radius-lg;
  border: 1rpx solid $nm-border;
  background-color: $nm-surface;
  box-sizing: border-box;
}

.nm-visibility-card:nth-child(2n) {
  margin-right: 0;
}

.nm-visibility-card--active {
  border-color: $nm-brand-primary;
  background-color: $nm-brand-primary;
}

.nm-visibility-title {
  font-size: $nm-font-body;
  font-weight: 600;
  color: $nm-text-primary;
}

.nm-visibility-desc {
  margin-top: 4rpx;
  font-size: $nm-font-caption;
  color: $nm-text-secondary;
}

.nm-visibility-card--active .nm-visibility-title,
.nm-visibility-card--active .nm-visibility-desc {
  color: $nm-text-inverse;
}

.nm-switch-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-top: $nm-space-md;
}

.nm-setting-title {
  font-size: $nm-font-body;
  color: $nm-text-primary;
}

.nm-setting-desc {
  margin-top: 4rpx;
  font-size: $nm-font-caption;
  color: $nm-text-secondary;
}

.nm-action-row {
  display: flex;
  justify-content: space-between;
  margin-top: $nm-space-sm;
}

.nm-ghost,
.nm-primary {
  flex: 1;
  padding: 24rpx 0;
  border-radius: $nm-radius-pill;
  text-align: center;
  font-size: $nm-font-body;
  font-weight: 600;
  display: flex;
  align-items: center;
  justify-content: center;
  box-sizing: border-box;
}

.nm-ghost {
  border: 1rpx solid $nm-border;
  color: $nm-text-primary;
  background-color: $nm-surface;
}

.nm-ghost + .nm-ghost {
  margin-left: $nm-space-sm;
}

.nm-primary {
  background-color: $nm-brand-primary;
  color: $nm-text-inverse;
  margin-top: $nm-space-sm;
  margin-bottom: $nm-space-lg;
}

.nm-button--disabled {
  opacity: 0.5;
  pointer-events: none;
}

.nm-sheet {
  padding: $nm-space-md;
}

.nm-sheet__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: $nm-space-sm;
}

.nm-sheet__hint {
  font-size: $nm-font-caption;
  color: $nm-text-secondary;
}

.nm-sheet__upload {
  padding: 8rpx 16rpx;
  border-radius: $nm-radius-pill;
  border: 1rpx solid $nm-border;
  font-size: $nm-font-caption;
  color: $nm-text-primary;
  background-color: $nm-surface;
  display: flex;
  flex-direction: row;
  align-items: center;
}

.nm-sheet__upload-text {
  margin-left: 8rpx;
  font-size: $nm-font-caption;
  color: $nm-text-secondary;
}

.nm-sheet__grid {
  display: flex;
  flex-direction: row;
  flex-wrap: wrap;
  justify-content: space-between;
  margin-top: $nm-space-xs;
}

.nm-sheet__image {
  width: 31%;
  aspect-ratio: 1;
  margin-bottom: $nm-space-md;
  border-radius: $nm-radius-md;
  border: 1rpx solid $nm-border;
  overflow: hidden;
  position: relative;
  background-color: $nm-surface;
  box-sizing: border-box;
}

.nm-sheet__image--active {
  border-color: $nm-brand-primary;
}

.nm-sheet__thumb {
  width: 100%;
  height: 100%;
  border-radius: $nm-radius-md;
}

.nm-sheet__badge {
  position: absolute;
  right: 8rpx;
  top: 8rpx;
  width: 36rpx;
  height: 36rpx;
  border-radius: 18rpx;
  background-color: $nm-brand-primary;
  color: $nm-text-inverse;
  display: flex;
  align-items: center;
  justify-content: center;
}

.nm-sheet__confirm {
  margin-top: $nm-space-sm;
  padding: 24rpx 0;
  border-radius: $nm-radius-pill;
  background-color: $nm-brand-primary;
  color: $nm-text-inverse;
  text-align: center;
  font-weight: 600;
  font-size: $nm-font-body;
}

.nm-sheet__ghost {
  margin-top: $nm-space-sm;
  padding: 20rpx 0;
  border-radius: $nm-radius-pill;
  border: 1rpx solid $nm-border;
  color: $nm-text-primary;
  text-align: center;
  background-color: $nm-surface;
  font-weight: 600;
  font-size: $nm-font-body;
}

.nm-skeleton,
.nm-empty {
  margin-top: $nm-space-sm;
}

.nm-music-row {
  display: flex;
  flex-direction: row;
  align-items: center;
  padding: $nm-space-md;
  border-radius: $nm-radius-md;
  border: 1rpx solid $nm-border;
  margin-bottom: $nm-space-md;
  background-color: $nm-surface;
  box-sizing: border-box;
}

.nm-music-row--active {
  background-color: $nm-brand-primary-soft;
  border-color: $nm-brand-primary;
}

.nm-music-cover {
  width: 112rpx;
  height: 112rpx;
  border-radius: $nm-radius-md;
  background-color: $nm-skeleton;
  margin-right: $nm-space-md;
}

.nm-music-info {
  flex: 1;
}

.nm-music-title {
  font-size: $nm-font-body;
  font-weight: 600;
  color: $nm-text-primary;
}

.nm-music-meta {
  margin-top: 4rpx;
  font-size: $nm-font-caption;
  color: $nm-text-secondary;
}

.nm-music-actions {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
}

.nm-music-action-btn {
  padding: 4rpx;
  margin-bottom: 6rpx;
}

.nm-tag-suggest__item {
  width: 48%;
  padding: $nm-space-md;
  border-radius: $nm-radius-md;
  border: 1rpx solid $nm-border;
  background-color: $nm-background;
  margin-bottom: $nm-space-md;
  box-sizing: border-box;
}

.nm-tag-suggest {
  margin-top: $nm-space-sm;
  display: flex;
  flex-direction: row;
  flex-wrap: wrap;
  justify-content: space-between;
}

.nm-tag-suggest__item--pending {
  border-color: $nm-accent-blue;
  background-color: $nm-accent-blue-soft;
}

.nm-tag-suggest__item--added {
  border-color: $nm-brand-primary;
  background-color: $nm-brand-primary-soft;
}

.nm-tag-suggest__item--pending .nm-tag-suggest__title {
  color: $nm-accent-blue;
}

.nm-tag-suggest__item--added .nm-tag-suggest__title {
  color: $nm-brand-primary;
}

.nm-tag-suggest__row {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.nm-tag-suggest__title {
  font-size: $nm-font-body;
  font-weight: 600;
  color: $nm-text-primary;
}

.nm-tag-suggest__meta {
  margin-top: 6rpx;
  font-size: $nm-font-caption;
  color: $nm-text-secondary;
}

.nm-tag-suggest__state {
  margin-top: 4rpx;
  font-size: $nm-font-caption;
  color: $nm-text-secondary;
}

.nm-tag-suggest__state--pending {
  color: $nm-accent-blue;
}

.nm-tag-suggest__state--added {
  color: $nm-brand-primary;
}

.nm-preview {
  padding-bottom: $nm-space-lg;
}

.nm-preview__title {
  font-size: $nm-font-body;
  font-weight: 600;
  color: $nm-text-primary;
}

.nm-preview__title--spaced {
  margin-top: $nm-space-lg;
}

.nm-preview__card {
  margin-top: $nm-space-sm;
  border-radius: $nm-radius-md;
  border: 0;
  background-color: transparent;
  padding: 0;
}

.nm-preview__box {
  margin-top: $nm-space-sm;
  border-radius: $nm-radius-md;
  border: 1rpx solid $nm-border;
  background-color: $nm-background;
  padding: $nm-space-md;
}

.nm-preview__desc {
  font-size: $nm-font-body;
  color: $nm-text-primary;
}

.nm-preview__meta {
  margin-top: $nm-space-sm;
  border-radius: $nm-radius-md;
  border: 1rpx solid $nm-border;
  background-color: $nm-background;
  padding: $nm-space-md;
}

.nm-preview__row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 8rpx;
}

.nm-preview__row:last-child {
  margin-bottom: 0;
}

.nm-preview__label {
  font-size: $nm-font-caption;
  color: $nm-text-secondary;
}

.nm-preview__value {
  font-size: $nm-font-caption;
  color: $nm-text-primary;
}

.nm-product-list {
  margin-top: $nm-space-sm;
}

.nm-product-row {
  display: flex;
  align-items: center;
  padding: $nm-space-md;
  border: 1rpx solid $nm-border;
  border-radius: $nm-radius-md;
  margin-bottom: $nm-space-md;
  background-color: $nm-surface;
  box-sizing: border-box;
}

.nm-product-row--active {
  background-color: $nm-brand-primary-soft;
  border-color: $nm-brand-primary;
}

.nm-product-row__thumb {
  width: 88rpx;
  height: 88rpx;
  border-radius: $nm-radius-md;
  margin-right: $nm-space-md;
  background-color: $nm-skeleton;
}

.nm-product-row__info {
  flex: 1;
}

.nm-product-row__title {
  font-size: $nm-font-body;
  font-weight: 600;
  color: $nm-text-primary;
}

.nm-product-row__meta {
  margin-top: 4rpx;
  font-size: $nm-font-caption;
  color: $nm-text-secondary;
}

.nm-product-row__price {
  margin-top: 4rpx;
  font-size: $nm-font-caption;
  color: $nm-text-primary;
}

.nm-product-row__check {
  font-size: $nm-font-caption;
  color: $nm-brand-primary;
}
</style>
