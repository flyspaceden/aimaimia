/**
 * 普通奖励树页面
 *
 * 薄包装层，使用共享 TreeViewer 组件，传入普通树配置
 * 包含特有的绿色渐变横幅和平台根节点入口卡片
 */
import { Typography, Tag } from 'antd';
import { ApartmentOutlined } from '@ant-design/icons';
import {
  searchNormalTreeUsers,
  getNormalTreeContext,
  getNormalTreeChildren,
  getNormalTreeRootStats,
} from '@/api/bonus';
import TreeViewer, { NORMAL_TREE_ROOT_VIEW_ID } from './components/TreeViewer';
import { NormalRootEntryCard } from './components/RootEntryCards';

const { Title } = Typography;
const THEME_COLOR = '#2E7D32';

/** 普通树顶部绿色横幅 */
const NormalTreeBanner = (
  <div
    style={{
      background: `linear-gradient(135deg, ${THEME_COLOR}, #43A047)`,
      borderRadius: '12px 12px 0 0',
      padding: '10px 20px',
      display: 'flex',
      alignItems: 'center',
      gap: 10,
      flexShrink: 0,
    }}
  >
    <ApartmentOutlined style={{ fontSize: 18, color: '#fff' }} />
    <Title level={5} style={{ margin: 0, color: '#fff', letterSpacing: 1 }}>
      普通奖励体系
    </Title>
    <Tag
      style={{
        background: 'rgba(255,255,255,0.2)',
        border: 'none',
        color: '#fff',
        fontSize: 11,
      }}
    >
      NORMAL REWARD TREE
    </Tag>
  </div>
);

export default function NormalTreePage() {
  return (
    <TreeViewer
      treeType="normal"
      themeColor={THEME_COLOR}
      title="普通分润树"
      subtitle="入树规则：首笔有效消费后自动入树，按轮询平衡方式落位 | 奖励规则：第 k 次有效消费，上溯到第 k 层祖辈"
      searchApi={searchNormalTreeUsers}
      contextApi={getNormalTreeContext}
      childrenApi={getNormalTreeChildren}
      emptyText="搜索用户或点击平台根节点以查看普通奖励树"
      banner={NormalTreeBanner}
      renderRootEntry={(onNavigate) => (
        <NormalRootEntryCard
          themeColor={THEME_COLOR}
          onSelectRoot={() => onNavigate(NORMAL_TREE_ROOT_VIEW_ID)}
          fetchStats={getNormalTreeRootStats}
        />
      )}
    />
  );
}
