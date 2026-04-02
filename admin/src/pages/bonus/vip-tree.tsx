/**
 * VIP 奖励树页面
 *
 * 薄包装层，使用共享 TreeViewer 组件，传入 VIP 树配置
 * 包含 VIP 根节点入口卡片（A1-A10）
 */
import {
  searchVipTreeUsers,
  getVipTreeContext,
  getVipTreeChildren,
  getVipTreeRootStats,
} from '@/api/bonus';
import TreeViewer from './components/TreeViewer';
import { VipRootEntryCards } from './components/RootEntryCards';

const VIP_THEME = '#1E40AF';

export default function VipTreePage() {
  return (
    <TreeViewer
      treeType="vip"
      themeColor={VIP_THEME}
      title="VIP 分润树"
      subtitle="入树规则：推荐优先，子树满位后按 BFS 滑落 | 奖励规则：第 k 次有效消费，上溯到第 k 层祖辈"
      searchApi={searchVipTreeUsers}
      contextApi={getVipTreeContext}
      childrenApi={getVipTreeChildren}
      emptyText="搜索用户或点击根节点入口以查看 VIP 树"
      renderRootEntry={(onNavigate) => (
        <VipRootEntryCards
          themeColor={VIP_THEME}
          onSelectRoot={onNavigate}
          fetchStats={getVipTreeRootStats}
        />
      )}
    />
  );
}
