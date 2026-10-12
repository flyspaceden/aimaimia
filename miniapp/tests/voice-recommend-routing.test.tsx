import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resolveAiAction } from '@/packages/ai/intent';
import RecommendPage from '@/packages/ai/recommend';

const state = vi.hoisted(() => ({ params: {} as Record<string, string>, queryOptions: [] as Array<{ queryFn: () => unknown }> }));
const getPlan = vi.hoisted(() => vi.fn().mockResolvedValue({ ok: true, data: {} }));
vi.mock('react', async (original) => ({ ...await original<typeof import('react')>(), useMemo: (fn: () => unknown) => fn() }));
vi.mock('@tarojs/taro', () => ({ default: {}, useRouter: () => ({ params: state.params }), usePullDownRefresh: vi.fn() }));
vi.mock('@tarojs/components', () => ({ Button: 'button', Image: 'image', Text: 'text', View: 'view' }));
vi.mock('@tanstack/react-query', () => ({
  useQuery: (options: { queryFn: () => unknown }) => { state.queryOptions.push(options); return { data: undefined, isLoading: false }; },
  useMutation: () => ({}),
}));
vi.mock('@/store/auth', () => ({ useAuthStore: (selector: (value: unknown) => unknown) => selector({ accessToken: '', revision: 0 }) }));
vi.mock('@/query/client', () => ({ queryClient: {} }));
vi.mock('@/repos', () => ({ CartRepo: { get: vi.fn() } }));
vi.mock('@/components/catalog-product-card', () => ({ CatalogProductCard: 'product-card' }));
vi.mock('@/components/catalog-feedback', () => ({ CatalogFeedback: 'feedback' }));
vi.mock('@/components/functional-icon', () => ({ FunctionalIcon: 'icon' }));
vi.mock('@/packages/ai/recommend-repo', () => ({ AiRecommendRepo: { getPlan, getInsights: vi.fn() } }));

beforeEach(() => { state.queryOptions = []; getPlan.mockClear(); });
describe('voice recommendation destination', () => {
  it('decodes the generated route before asking the recommendation API', async () => {
    const action = resolveAiAction({ type: 'recommend', transcript: '推荐山东水果', feedback: '为你推荐',
      recommend: { query: '水果', constraints: ['organic', 'low-sugar'], recommendThemes: ['discount', 'seasonal'],
        budget: 80, slots: { originPreference: '山东' } } });
    state.params = Object.fromEntries(action!.url!.split('?')[1].split('&').map((pair) => pair.split('=')));
    RecommendPage();
    await state.queryOptions[0].queryFn();
    expect(getPlan).toHaveBeenCalledWith(expect.objectContaining({ query: '水果', constraints: ['organic', 'low-sugar'],
      recommendThemes: ['discount', 'seasonal'], maxPrice: 80, originPreference: '山东' }));
  });

  it('accepts plain text and does not crash on a literal percent sign', async () => {
    state.params = { q: '99%鲜活', originPreference: '山东', recommendThemes: 'seasonal' };
    RecommendPage();
    await state.queryOptions[0].queryFn();
    expect(getPlan).toHaveBeenCalledWith(expect.objectContaining({ query: '99%鲜活', originPreference: '山东', recommendThemes: ['seasonal'] }));
  });
});
