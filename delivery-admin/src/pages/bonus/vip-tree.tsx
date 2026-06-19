/**
 * VIP 奖励可视化页面
 *
 * 薄包装层，使用共享 TreeViewer 组件，传入 VIP 配置
 * 包含 VIP 入口卡片（A1-A10）
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
      title="VIP 奖励可视化"
      searchApi={searchVipTreeUsers}
      contextApi={getVipTreeContext}
      childrenApi={getVipTreeChildren}
      emptyText="搜索用户或选择入口以查看 VIP 奖励分布"
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
