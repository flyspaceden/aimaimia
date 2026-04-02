<template>
  <Screen>
    <AppHeader title="搜索" />

    <scroll-view
      class="nm-search"
      scroll-y
      refresher-enabled
      :refresher-triggered="refreshing"
      @refresherrefresh="onRefresh"
    >
      <view class="nm-search__bar">
        <Icon class="nm-search__icon" name="magnify" :size="40" :color="textMuted" />
        <input
          class="nm-search__input"
          placeholder="搜索企业/城市/认证/距离"
          placeholder-class="nm-search__placeholder"
          v-model="keyword"
          @confirm="onSearch"
        />
        <view v-if="keyword" class="nm-search__clear" @click="clearKeyword">
          <Icon name="close-circle" :size="36" :color="textMuted" />
        </view>
      </view>

      <view v-if="loading" class="nm-loading">
        <Skeleton :count="2" type="card" />
      </view>
      <view v-else-if="productError && companyError" class="nm-loading">
        <ErrorState text="搜索加载失败" @retry="onRefresh" />
      </view>
      <view v-else-if="!hasResults" class="nm-loading">
        <EmptyState
          :text="hasQuery ? '未找到匹配结果' : '输入关键词开始搜索'"
          :hint="hasQuery ? '换个关键词试试' : '支持商品/企业/城市/认证等关键词'"
        />
      </view>
      <view v-else class="nm-results">
        <view v-if="hasQuery" class="nm-summary">
          <text class="nm-summary__text">商品 {{ shownProducts.length }} · 企业 {{ shownCompanies.length }}</text>
          <text class="nm-summary__text">关键词：{{ keyword.trim() }}</text>
        </view>

        <view class="nm-section">
          <view class="nm-section__header">
            <text class="nm-section__title">{{ hasQuery ? '商品结果' : '热门商品' }}</text>
          </view>
          <ErrorState v-if="productError" :text="productError" @retry="onRefresh" />
          <EmptyState v-else-if="shownProducts.length === 0" text="暂无商品" hint="换个关键词试试" />
          <view v-else>
            <view v-for="item in shownProducts" :key="item.id" class="nm-row" @click="goProduct(item.id)">
              <image class="nm-row__image" :src="item.image" mode="aspectFill" />
              <view class="nm-row__body">
                <text class="nm-row__title" lines="1">{{ item.title }}</text>
                <text class="nm-row__meta">{{ item.origin }}</text>
                <view class="nm-row__tags">
                  <Tag v-for="tag in item.tags.slice(0, 2)" :key="`${item.id}-${tag}`" :label="tag" tone="accent" />
                </view>
              </view>
              <text class="nm-row__price">￥{{ item.price }}</text>
            </view>
          </view>
        </view>

        <view class="nm-section nm-section--space">
          <view class="nm-section__header">
            <text class="nm-section__title">{{ hasQuery ? '企业结果' : '热门企业' }}</text>
          </view>
          <ErrorState v-if="companyError" :text="companyError" @retry="onRefresh" />
          <EmptyState v-else-if="shownCompanies.length === 0" text="暂无企业" hint="换个关键词试试" />
          <view v-else>
            <view v-for="item in shownCompanies" :key="item.id" class="nm-row" @click="goCompany(item.id)">
              <image class="nm-row__image nm-row__image--company" :src="item.cover" mode="aspectFill" />
              <view class="nm-row__body">
                <text class="nm-row__title" lines="1">{{ item.name }}</text>
                <text class="nm-row__meta">{{ item.mainBusiness }}</text>
                <view class="nm-row__meta-row">
                  <text class="nm-row__meta">{{ item.location }}</text>
                  <text class="nm-row__meta">{{ item.distanceKm.toFixed(1) }} km</text>
                </view>
                <view class="nm-row__tags">
                  <Tag v-for="badge in item.badges.slice(0, 3)" :key="`${item.id}-${badge}`" :label="badge" tone="success" />
                </view>
              </view>
            </view>
          </view>
        </view>
      </view>
    </scroll-view>
  </Screen>
</template>

<script setup lang="ts">
import { navTo } from '@/utils/nav';
import { ref, onMounted, computed } from 'vue';
import Screen from '@/components/layout/Screen.vue';
import AppHeader from '@/components/layout/AppHeader.vue';
import { EmptyState, ErrorState, Skeleton, Tag } from '@/components';
import Icon from '@/components/ui/Icon.vue';
import { CompanyRepo, ProductRepo, type Company, type Product } from '@/services/repos';

const keyword = ref('');
const textMuted = '#8A9B90';
const products = ref<Product[]>([]);
const companies = ref<Company[]>([]);
const productError = ref('');
const companyError = ref('');
const loading = ref(false);
const refreshing = ref(false);

const fetchProducts = async () => {
  const res = await ProductRepo.list({ page: 1, pageSize: 32 });
  if (res.ok) {
    products.value = res.data.items;
    productError.value = '';
  } else {
    productError.value = res.error.message || '商品加载失败';
  }
};

const fetchCompanies = async () => {
  const res = await CompanyRepo.list({ page: 1, pageSize: 20 });
  if (res.ok) {
    companies.value = res.data.items;
    companyError.value = '';
  } else {
    companyError.value = res.error.message || '企业加载失败';
  }
};

const handleFetch = async () => {
  if (loading.value) return;
  loading.value = true;
  await Promise.all([fetchProducts(), fetchCompanies()]);
  loading.value = false;
  if (refreshing.value) refreshing.value = false;
};

const onSearch = () => {
  keyword.value = keyword.value.trim();
  uni.hideKeyboard();
};

const clearKeyword = () => {
  keyword.value = '';
};

onMounted(() => {
  handleFetch();
});

const onRefresh = () => {
  if (refreshing.value) return;
  refreshing.value = true;
  handleFetch();
};

const hasQuery = computed(() => keyword.value.trim().length > 0);

const filteredProducts = computed(() => {
  const keywordValue = keyword.value.trim().toLowerCase();
  if (!keywordValue) return products.value;
  const tokens = keywordValue
    .split(/[\s,，、/]+/)
    .map((item) => item.trim())
    .filter(Boolean);
  return products.value.filter((product) => {
    const haystack = [product.title, product.origin, product.tags.join(' ')].join(' ').toLowerCase();
    return tokens.every((token) => haystack.includes(token));
  });
});

// 搜索企业：支持关键词与“附近/距离/认证”混合匹配（复杂逻辑需中文注释）
const filteredCompanies = computed(() => {
  const keywordValue = keyword.value.trim().toLowerCase();
  if (!keywordValue) return companies.value;

  const distanceMatch = keywordValue.match(/(\\d+(?:\\.\\d+)?)\\s*(km|公里)/i);
  const distanceLimit = distanceMatch ? Number(distanceMatch[1]) : keywordValue.includes('附近') ? 20 : null;
  const tokens = keywordValue
    .split(/[\s,，、/]+/)
    .map((item) => item.trim())
    .filter((item) => item.length > 0 && !item.includes('km') && !item.includes('公里') && item !== '附近');

  const badgeKeywordMap: Record<string, string> = {
    有机: '品质认证',
    绿色: '品质认证',
    gap: '品质认证',
    认证: '品质认证',
    证书: '品质认证',
    直供: '产地直供',
    产地: '产地直供',
    低碳: '低碳种植',
    基地: '优选基地',
  };
  const badgeHints = new Set<string>();
  tokens.forEach((token) => {
    Object.keys(badgeKeywordMap).forEach((key) => {
      if (token.includes(key)) {
        badgeHints.add(badgeKeywordMap[key]);
      }
    });
  });

  return companies.value
    .map((company) => {
      if (distanceLimit !== null && company.distanceKm > distanceLimit) {
        return null;
      }
      const fields = [company.name, company.mainBusiness, company.location, company.badges.join(' ')].map((item) =>
        item.toLowerCase()
      );
      let score = 0;
      tokens.forEach((token) => {
        if (fields[0].includes(token)) {
          score += 5;
          return;
        }
        if (fields[1].includes(token)) {
          score += 3;
          return;
        }
        if (fields[2].includes(token)) {
          score += 3;
          return;
        }
        if (fields[3].includes(token)) {
          score += 4;
          return;
        }
      });
      badgeHints.forEach((badge) => {
        if (company.badges.includes(badge)) {
          score += 4;
        }
      });
      if (distanceLimit !== null) {
        score += Math.max(0, (distanceLimit - company.distanceKm) / Math.max(distanceLimit, 1));
      }
      if (tokens.length === 0 && badgeHints.size === 0) {
        score = 1;
      }
      return score > 0 ? { company, score } : null;
    })
    .filter((item): item is { company: Company; score: number } => Boolean(item))
    .sort((a, b) => b.score - a.score)
    .map((item) => item.company);
});

const shownProducts = computed(() => (hasQuery.value ? filteredProducts.value : products.value.slice(0, 6)));
const shownCompanies = computed(() => (hasQuery.value ? filteredCompanies.value : companies.value.slice(0, 4)));
const hasResults = computed(() => shownProducts.value.length > 0 || shownCompanies.value.length > 0);

const goProduct = (id: string) => {
  navTo({ url: `/pages-sub/home/product-detail?id=${id}` });
};

const goCompany = (id: string) => {
  navTo({ url: `/pages-sub/museum/company-detail?id=${id}` });
};
</script>

<style scoped lang="scss">
@use '@/styles/tokens.scss' as *;

.nm-search {
  padding: $nm-space-xl;
  padding-bottom: $nm-space-3xl;
  flex: 1;
  background-color: $nm-background;
}

.nm-search__bar {
  flex-direction: row;
  align-items: center;
  padding: 16rpx $nm-space-md;
  border-radius: $nm-radius-lg;
  background-color: $nm-surface;
  border: 1rpx solid $nm-border;
}

.nm-search__icon {
  margin-right: $nm-space-sm;
}

.nm-search__input {
  flex: 1;
  font-size: $nm-font-body;
  color: $nm-text-primary;
}

.nm-search__placeholder {
  color: $nm-muted;
}

.nm-search__clear {
  margin-left: $nm-space-sm;
  align-items: center;
  justify-content: center;
}

.nm-loading {
  margin-top: $nm-space-lg;
}

.nm-results {
  margin-top: $nm-space-lg;
}

.nm-summary {
  flex-direction: row;
  justify-content: space-between;
  margin-bottom: $nm-space-md;
}

.nm-summary__text {
  font-size: $nm-font-caption;
  color: $nm-text-secondary;
}

.nm-section {
  margin-top: 0;
}

.nm-section--space {
  margin-top: $nm-space-lg;
}

.nm-section__header {
  flex-direction: row;
  justify-content: space-between;
  align-items: center;
  margin-bottom: $nm-space-md;
}

.nm-section__title {
  font-size: $nm-font-title3;
  font-weight: 600;
  color: $nm-text-primary;
}

.nm-row {
  margin-bottom: $nm-space-md;
  padding: $nm-space-md;
  border-radius: $nm-radius-lg;
  background-color: $nm-surface;
  border: 1rpx solid transparent;
  box-shadow: $nm-shadow-sm;
  flex-direction: row;
  align-items: center;
}

.nm-row__image {
  width: 144rpx;
  height: 144rpx;
  border-radius: $nm-radius-md;
  background-color: $nm-skeleton;
}

.nm-row__image--company {
  width: 172rpx;
  height: 172rpx;
}

.nm-row__body {
  flex: 1;
  margin-left: $nm-space-md;
}

.nm-row__title {
  font-size: $nm-font-body;
  font-weight: 600;
  color: $nm-text-primary;
}

.nm-row__meta {
  margin-top: 8rpx;
  font-size: $nm-font-caption;
  color: $nm-text-secondary;
}

.nm-row__meta-row {
  margin-top: 12rpx;
  flex-direction: row;
  justify-content: space-between;
}

.nm-row__tags {
  margin-top: $nm-space-sm;
  flex-direction: row;
  flex-wrap: wrap;
  gap: 12rpx;
}

.nm-row__price {
  font-size: $nm-font-body;
  font-weight: 600;
  color: $nm-brand-primary;
  align-self: center;
}
</style>
