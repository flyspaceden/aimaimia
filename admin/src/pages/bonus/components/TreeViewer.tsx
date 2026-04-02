/**
 * 树可视化共享组件
 *
 * 从 vip-tree.tsx 与 normal-tree.tsx 中提取全部公共逻辑，
 * 通过 props 注入：主题色、API、标题、banner 等差异项。
 *
 * 能力：
 * - URL 状态同步（useSearchParams），支持外部跳转 & 浏览器前进后退
 * - 错误态 Result + 重试
 * - 搜索结果展示"已入树/未入树"标签
 * - 复制链接、回到当前用户、刷新按钮
 * - 根节点快捷入口卡片（VIP 显示 A1-A10，普通显示平台根节点）
 * - 空状态引导（搜索 + 根节点入口）
 * - 搜索历史 + 最近浏览（localStorage 持久化）
 */
import React, { useState, useCallback, useMemo, useRef, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  Avatar,
  Card,
  Input,
  AutoComplete,
  Breadcrumb,
  Drawer,
  Grid,
  Spin,
  Typography,
  Button,
  Tooltip,
  InputNumber,
  Result,
  Tag,
  message,
} from 'antd';
import {
  SearchOutlined,
  ApartmentOutlined,
  ZoomInOutlined,
  ZoomOutOutlined,
  HomeOutlined,
  MenuFoldOutlined,
  MenuUnfoldOutlined,
  ReloadOutlined,
  UserOutlined,
  LinkOutlined,
  CompressOutlined,
  NodeExpandOutlined,
  CameraOutlined,
  ClockCircleOutlined,
  HistoryOutlined,
  DeleteOutlined,
} from '@ant-design/icons';
import { useQuery } from '@tanstack/react-query';
import type { VipTreeNodeView, VipTreeContextResponse } from '@/types';
import TreeNodeCard, { EmptySlotNode } from './TreeNode';
import NodeDetail from './NodeDetail';
import TreeLegend from './TreeLegend';
import TreeMinimap from './TreeMinimap';

// ============ 搜索历史 & 最近浏览 ============

interface SearchHistoryItem {
  userId: string;
  nickname: string | null;
  timestamp: number;
}

const HISTORY_MAX = 10;

function getStorageKey(treeType: string, kind: 'search' | 'browse') {
  return `tree-${treeType}-${kind}-history`;
}

function loadHistory(treeType: string, kind: 'search' | 'browse'): SearchHistoryItem[] {
  try {
    const raw = localStorage.getItem(getStorageKey(treeType, kind));
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveHistory(treeType: string, kind: 'search' | 'browse', items: SearchHistoryItem[]) {
  try {
    localStorage.setItem(getStorageKey(treeType, kind), JSON.stringify(items.slice(0, HISTORY_MAX)));
  } catch { /* localStorage 不可用时静默忽略 */ }
}

function addToHistory(treeType: string, kind: 'search' | 'browse', userId: string, nickname: string | null) {
  const list = loadHistory(treeType, kind);
  // 去重：如果已存在则移到最前面
  const filtered = list.filter((item) => item.userId !== userId);
  filtered.unshift({ userId, nickname, timestamp: Date.now() });
  saveHistory(treeType, kind, filtered);
}

function clearHistory(treeType: string, kind: 'search' | 'browse') {
  try {
    localStorage.removeItem(getStorageKey(treeType, kind));
  } catch { /* 静默忽略 */ }
}

const { Text, Title } = Typography;
const { useBreakpoint } = Grid;
export const NORMAL_TREE_ROOT_VIEW_ID = '__NORMAL_TREE_ROOT__';
const SOURCE_LABELS: Record<string, string> = {
  'member-detail': '会员详情',
  'order-detail': '订单详情',
  'reward-ledger': '奖励流水',
  withdrawal: '提现审核',
};

// ============ 搜索结果类型 ============

export interface TreeSearchResult {
  userId: string;
  nickname: string | null;
  phone: string | null;
  avatarUrl?: string | null;
  tier: string;
  treeStatus?: 'active' | 'silent' | 'frozen' | 'exited' | null;
  hasVipNode?: boolean;
  hasNormalNode?: boolean;
}

const SEARCH_STATUS_TAGS: Record<NonNullable<TreeSearchResult['treeStatus']>, { color: string; text: string }> = {
  active: { color: 'green', text: '活跃' },
  silent: { color: 'default', text: '沉默' },
  frozen: { color: 'orange', text: '冻结' },
  exited: { color: 'purple', text: '已出局' },
};

// ============ Props ============

export interface TreeViewerProps {
  /** 树类型标识 */
  treeType: 'vip' | 'normal';
  /** 主题色 */
  themeColor: string;
  /** 页面标题 */
  title: string;
  /** 副标题说明 */
  subtitle: string;
  /** 搜索API */
  searchApi: (keyword: string) => Promise<TreeSearchResult[]>;
  /** 上下文API */
  contextApi: (userId: string, descendantDepth: number) => Promise<VipTreeContextResponse>;
  /** 懒加载子节点API（Phase 3 启用） */
  childrenApi?: (userId: string) => Promise<{ children: VipTreeNodeView[] }>;
  /** 空态提示文字 */
  emptyText: string;
  /** 顶部自定义banner（普通树有一个绿色渐变横幅） */
  banner?: React.ReactNode;
  /**
   * 根节点入口渲染函数
   * 接收 onNavigate 回调，内部使用 TreeViewer 的导航逻辑（保留 source/sourceLabel，不覆盖 initialUserId）
   */
  renderRootEntry?: (onNavigate: (rootNodeId: string) => void) => React.ReactNode;
}

// ============ 连线样式常量 ============

const L2_COLOR = '#b0b0b0';
const L2_WIDTH = 2;
const L3_COLOR = '#d0d0d0';
const L3_WIDTH = 1.5;
const L3_DASH = '4 3';
const VERT_GAP = 28;

// 缩放范围
const ZOOM_MIN = 0.4;
const ZOOM_MAX = 1.2;
const ZOOM_STEP = 0.1;

// 详情面板宽度
const DETAIL_PANEL_WIDTH = 340;
const COLLAPSED_WIDTH = 40;

// L1 使用主题色，宽度固定 3
const L1_WIDTH = 3;

// VIP 树每个节点最多 3 子节点（三叉树），普通树也是 3
const MAX_CHILDREN: Record<string, number> = { vip: 3, normal: 3 };

// ============ 主组件 ============

export default function TreeViewer({
  treeType,
  themeColor,
  title,
  subtitle,
  searchApi,
  contextApi,
  childrenApi,
  emptyText,
  banner,
  renderRootEntry,
}: TreeViewerProps) {
  const [searchParams, setSearchParams] = useSearchParams();
  const urlUserId = searchParams.get('userId');
  const urlDepth = searchParams.get('depth');
  const urlMode = searchParams.get('mode') === 'subtree' ? 'subtree' : 'locate';
  const urlSource = searchParams.get('source');
  const urlSourceLabel = searchParams.get('sourceLabel') || (urlSource ? SOURCE_LABELS[urlSource] : null);
  const screens = useBreakpoint();
  const isCompactLayout = !screens.lg;

  const [searchText, setSearchText] = useState('');
  const [centeredUserId, setCenteredUserId] = useState<string | null>(null);
  const [selectedNode, setSelectedNode] = useState<VipTreeNodeView | null>(null);
  const [zoom, setZoom] = useState(0.85);
  const [treeDepth, setTreeDepth] = useState(() => {
    if (!urlDepth) return 3;
    const n = Number(urlDepth);
    return Number.isFinite(n) ? Math.max(1, Math.min(5, n)) : 3;
  });
  const [detailCollapsed, setDetailCollapsed] = useState(false);
  const [detailDrawerOpen, setDetailDrawerOpen] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const internalNavigationRef = useRef(false);

  // Phase 3: 展开/收起状态
  const [expandedNodes, setExpandedNodes] = useState<Set<string>>(new Set());
  // Phase 3: 懒加载的子节点缓存
  const [lazyChildren, setLazyChildren] = useState<Record<string, VipTreeNodeView[]>>({});
  // Phase 3: 拖拽手势
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0, scrollLeft: 0, scrollTop: 0 });
  // Phase 3: 子树模式（以选中节点为根）
  const [subtreeRoot, setSubtreeRoot] = useState<string | null>(null);
  // Phase 3: 截断提示
  const [isTruncated, setIsTruncated] = useState(false);

  // Phase 5: 奖励路径高亮
  const [highlightedPath, setHighlightedPath] = useState<string[]>([]);
  const [pathSource, setPathSource] = useState<string | null>(null);
  const [pathTarget, setPathTarget] = useState<string | null>(null);

  // 搜索历史
  const [isSearchFocused, setIsSearchFocused] = useState(false);
  const [browseHistory, setBrowseHistory] = useState<SearchHistoryItem[]>(() => loadHistory(treeType, 'browse'));
  const [searchHistory, setSearchHistory] = useState<SearchHistoryItem[]>(() => loadHistory(treeType, 'search'));
  const [unavailableTarget, setUnavailableTarget] = useState<TreeSearchResult | null>(null);

  // 根节点入口折叠状态（树加载后默认折叠，节省空间）
  const [rootEntryCollapsed, setRootEntryCollapsed] = useState(true);

  // 记录外部传入的"当前用户"（从 URL 跳入时的目标），URL 外部变更时同步更新
  const [initialUserId, setInitialUserId] = useState<string | null>(urlUserId);

  // URL 同步：URL 中 userId 变化时自动居中 + 更新"当前用户"基准 + 清空搜索框
  useEffect(() => {
    if (urlUserId && urlUserId !== centeredUserId) {
      if (!internalNavigationRef.current) {
        setInitialUserId(urlUserId);
      }
      setCenteredUserId(urlUserId);
      setUnavailableTarget(null);
      setSelectedNode(null);
      setSearchText(''); // 新 treeData 加载后面包屑会显示用户信息
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [urlUserId]);

  useEffect(() => {
    internalNavigationRef.current = false;
  }, [urlUserId, urlDepth, urlMode, urlSource, urlSourceLabel]);

  useEffect(() => {
    if (!urlDepth) return;
    const n = Number(urlDepth);
    if (!Number.isFinite(n)) return;
    const nextDepth = Math.max(1, Math.min(5, n));
    setTreeDepth((prev) => (prev === nextDepth ? prev : nextDepth));
  }, [urlDepth]);

  useEffect(() => {
    setSubtreeRoot(urlMode === 'subtree' ? urlUserId : null);
  }, [urlMode, urlUserId]);

  // 切换聚焦用户时重置展开状态和懒加载缓存
  useEffect(() => {
    setExpandedNodes(new Set());
    setLazyChildren({});
    setIsTruncated(false);
    setHighlightedPath([]);
    setPathSource(null);
    setPathTarget(null);
  }, [centeredUserId]);


  useEffect(() => {
    if (!isCompactLayout) {
      setDetailDrawerOpen(false);
      return;
    }
    if (selectedNode) {
      setDetailDrawerOpen(true);
    }
  }, [isCompactLayout, selectedNode]);

  // 更新 URL 参数
  const updateUrl = useCallback(
    (userId: string, depth: number, mode: 'locate' | 'subtree' = 'locate') => {
      internalNavigationRef.current = true;
      const nextParams: Record<string, string> = {
        userId,
        depth: String(depth),
      };
      if (mode === 'subtree') nextParams.mode = 'subtree';
      if (urlSource) nextParams.source = urlSource;
      if (urlSourceLabel) nextParams.sourceLabel = urlSourceLabel;
      setSearchParams(nextParams, { replace: true });
    },
    [setSearchParams, urlSource, urlSourceLabel],
  );

  // ============ React Query ============

  // 搜索
  const { data: searchResults = [] } = useQuery({
    queryKey: [treeType + '-tree-search', searchText],
    queryFn: () => searchApi(searchText),
    enabled: searchText.length >= 1,
    staleTime: 5000,
  });

  // 树上下文
  const {
    data: treeData,
    isLoading: isTreeLoading,
    isError,
    refetch,
  } = useQuery({
    queryKey: [treeType + '-tree-context', centeredUserId, treeDepth],
    queryFn: () => contextApi(centeredUserId!, treeDepth),
    enabled: !!centeredUserId,
  });

  // 检测截断标志
  useEffect(() => {
    if (treeData && treeData.truncated) {
      setIsTruncated(true);
    } else {
      setIsTruncated(false);
    }
  }, [treeData]);

  // 树数据加载后，自动展开当前节点（其子节点来自 treeData.children）
  useEffect(() => {
    if (treeData?.current) {
      setExpandedNodes((prev) => {
        if (prev.has(treeData.current.userId)) return prev;
        const next = new Set(prev);
        next.add(treeData.current.userId);
        return next;
      });
    }
  }, [treeData?.current?.userId]);

  // ============ 事件处理 ============

  // 选中搜索结果 -> 居中到该用户
  const handleSelectUser = useCallback(
    (_value: string, option: any) => {
      const hasNode = option.hasNode as boolean | undefined;
      if (hasNode === false) {
        setCenteredUserId(null);
        setSelectedNode(null);
        setUnavailableTarget({
          userId: option.userId,
          nickname: option.nickname ?? null,
          phone: option.phone ?? null,
          avatarUrl: option.avatarUrl ?? null,
          tier: option.tier ?? 'NORMAL',
          treeStatus: option.treeStatus ?? null,
          hasVipNode: option.hasVipNode,
          hasNormalNode: option.hasNormalNode,
        });
        setSearchText(option.nickname || option.userId);
        message.warning(treeType === 'vip' ? '该用户尚未进入 VIP 树' : '该用户尚未进入普通树');
        return;
      }
      setCenteredUserId(option.userId);
      setUnavailableTarget(null);
      setSelectedNode(null);
      setSearchText(option.nickname || option.userId);
      updateUrl(option.userId, treeDepth, 'locate');
      // 记录搜索历史
      addToHistory(treeType, 'search', option.userId, option.nickname);
      setSearchHistory(loadHistory(treeType, 'search'));
    },
    [treeDepth, treeType, updateUrl],
  );

  // 居中到某个节点（替代原先的 handleDoubleClick）
  const handleCenterNode = useCallback(
    (node: VipTreeNodeView) => {
      setCenteredUserId(node.userId);
      setUnavailableTarget(null);
      setSelectedNode(null);
      setSearchText(node.nickname || node.userId);
      updateUrl(node.userId, treeDepth, 'locate');
      // 记录浏览历史
      addToHistory(treeType, 'browse', node.userId, node.nickname);
      setBrowseHistory(loadHistory(treeType, 'browse'));
    },
    [treeDepth, treeType, updateUrl],
  );

  // 面包屑点击
  const handleBreadcrumbClick = useCallback(
    (userId: string, nickname: string | null) => {
      setCenteredUserId(userId);
      setUnavailableTarget(null);
      setSelectedNode(null);
      setSearchText(nickname || userId);
      updateUrl(userId, treeDepth, 'locate');
    },
    [treeDepth, updateUrl],
  );

  // 回到根节点
  const handleBackToRoot = useCallback(() => {
    if (!treeData) return;

    if (treeType === 'normal') {
      setCenteredUserId(NORMAL_TREE_ROOT_VIEW_ID);
      setUnavailableTarget(null);
      setSelectedNode(null);
      setSearchText('');
      updateUrl(NORMAL_TREE_ROOT_VIEW_ID, treeDepth, 'locate');
      return;
    }

    if (treeData.breadcrumb.length === 0) return;
    const root = treeData.breadcrumb.find((b) => b.userId != null);
    if (!root?.userId) return;

    setCenteredUserId(root.userId);
    setUnavailableTarget(null);
    setSelectedNode(null);
    setSearchText(root.nickname || root.userId);
    updateUrl(root.userId, treeDepth, 'locate');
  }, [treeData, treeDepth, treeType, updateUrl]);

  // 回到 URL 传入的初始用户
  const handleBackToCurrentUser = useCallback(() => {
    if (initialUserId) {
      setCenteredUserId(initialUserId);
      setUnavailableTarget(null);
      setSelectedNode(null);
      setSearchText('');
      updateUrl(initialUserId, treeDepth, 'locate');
    }
  }, [initialUserId, treeDepth, updateUrl]);

  // 复制当前链接
  const handleCopyLink = useCallback(() => {
    navigator.clipboard
      .writeText(window.location.href)
      .then(() => message.success('链接已复制到剪贴板'))
      .catch(() => message.error('复制失败'));
  }, []);

  // 根节点快捷导航：不覆盖 initialUserId（保留"回到当前用户"），保留 source/sourceLabel
  const handleRootNavigate = useCallback(
    (rootNodeId: string) => {
      setCenteredUserId(rootNodeId);
      setUnavailableTarget(null);
      setSelectedNode(null);
      setSearchText('');
      updateUrl(rootNodeId, treeDepth, 'locate');
    },
    [treeDepth, updateUrl],
  );

  // 渲染根节点入口卡片（始终可用，不仅限于空状态）
  const rootEntryElement = useMemo(
    () => renderRootEntry?.(handleRootNavigate) ?? null,
    [renderRootEntry, handleRootNavigate],
  );

  // 展开/收起节点
  const handleToggleExpand = useCallback(
    (node: VipTreeNodeView) => {
      const nodeId = node.userId;
      setExpandedNodes((prev) => {
        const next = new Set(prev);
        if (next.has(nodeId)) {
          next.delete(nodeId);
        } else {
          next.add(nodeId);
        }
        return next;
      });
      // 当前节点的子节点已在 treeData.children 中，无需 API 调用
      const isCurrentNode = treeData?.current.userId === nodeId;
      const hasPreloadedChildren = isCurrentNode && (treeData?.children?.length ?? 0) > 0;
      // 如果没有缓存的子节点，通过 childrenApi 懒加载
      if (!node.children?.length && !lazyChildren[nodeId] && !hasPreloadedChildren && childrenApi) {
        childrenApi(nodeId).then((result) => {
          setLazyChildren((prev) => ({ ...prev, [nodeId]: result.children }));
        }).catch(() => { /* 系统根节点无 children 端点，忽略 */ });
      }
    },
    [childrenApi, lazyChildren, treeData],
  );

  // 子树模式切换：以选中节点为根重新加载，隐藏父节点
  const handleSubtreeToggle = useCallback(() => {
    if (subtreeRoot) {
      setSubtreeRoot(null);
      if (centeredUserId) updateUrl(centeredUserId, treeDepth, 'locate');
    } else if (selectedNode) {
      setSubtreeRoot(selectedNode.userId);
      setCenteredUserId(selectedNode.userId);
      setSelectedNode(null);
      updateUrl(selectedNode.userId, treeDepth, 'subtree');
    }
  }, [centeredUserId, subtreeRoot, selectedNode, treeDepth, updateUrl]);

  // 奖励路径高亮回调
  const handleHighlightPath = useCallback(
    (pathUserIds: string[], sourceUserId: string | null, targetUserId: string | null) => {
      setHighlightedPath(pathUserIds);
      setPathSource(sourceUserId);
      setPathTarget(targetUserId);
    },
    [],
  );

  // Phase 6: 导出截图
  const handleScreenshot = useCallback(async () => {
    const canvas = scrollRef.current;
    if (!canvas) return;
    try {
      const { default: html2canvas } = await import('html2canvas');
      const result = await html2canvas(canvas, {
        backgroundColor: '#ffffff',
        scale: 2,
      });
      const link = document.createElement('a');
      const timestamp = new Date().toISOString().slice(0, 19).replace(/[T:]/g, '-');
      link.download = `${treeType}-tree-${centeredUserId || 'view'}-${timestamp}.png`;
      link.href = result.toDataURL('image/png');
      link.click();
      message.success('截图已导出');
    } catch {
      message.error('截图导出失败，请安装 html2canvas');
    }
  }, [treeType, centeredUserId]);

  // 缩放控制
  const handleZoomIn = useCallback(() => setZoom((z) => Math.min(z + ZOOM_STEP, ZOOM_MAX)), []);
  const handleZoomOut = useCallback(() => setZoom((z) => Math.max(z - ZOOM_STEP, ZOOM_MIN)), []);
  const handleZoomReset = useCallback(() => setZoom(0.85), []);

  // 鼠标滚轮缩放（按住 Ctrl/Cmd）
  const handleWheel = useCallback((e: React.WheelEvent) => {
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      setZoom((z) => {
        const next = z + (e.deltaY > 0 ? -ZOOM_STEP : ZOOM_STEP);
        return Math.min(Math.max(next, ZOOM_MIN), ZOOM_MAX);
      });
    }
  }, []);

  // 拖拽手势
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    // 只响应左键，且不是点击节点
    if (e.button !== 0) return;
    const target = e.target as HTMLElement;
    // 如果点击的是节点卡片内部，不启动拖拽
    if (target.closest('[data-tree-node]')) return;

    const container = scrollRef.current;
    if (!container) return;
    setIsDragging(true);
    setDragStart({
      x: e.clientX,
      y: e.clientY,
      scrollLeft: container.scrollLeft,
      scrollTop: container.scrollTop,
    });
    e.preventDefault();
  }, []);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!isDragging) return;
    const container = scrollRef.current;
    if (!container) return;
    container.scrollLeft = dragStart.scrollLeft - (e.clientX - dragStart.x);
    container.scrollTop = dragStart.scrollTop - (e.clientY - dragStart.y);
  }, [isDragging, dragStart]);

  const handleMouseUp = useCallback(() => {
    setIsDragging(false);
  }, []);

  // 窗口级别的 mouseup 监听（防止拖出容器后释放无法停止）
  useEffect(() => {
    const handleGlobalMouseUp = () => setIsDragging(false);
    window.addEventListener('mouseup', handleGlobalMouseUp);
    return () => window.removeEventListener('mouseup', handleGlobalMouseUp);
  }, []);

  // 自动居中到当前节点
  useEffect(() => {
    if (!treeData || !scrollRef.current) return;
    // 使用 requestAnimationFrame 等待 DOM 更新
    requestAnimationFrame(() => {
      const currentEl = scrollRef.current?.querySelector('[data-current-node]');
      if (currentEl) {
        currentEl.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' });
      }
    });
  }, [treeData, centeredUserId]);

  // 统计可见节点数
  const visibleNodeCount = useMemo(() => {
    if (!treeData) return 0;
    let count = 1; // current
    if (treeData.parent) count++;
    const countChildren = (nodes: VipTreeNodeView[]): number => {
      let c = nodes.length;
      for (const n of nodes) {
        if (expandedNodes.has(n.userId)) {
          const children = n.children?.length ? n.children : (lazyChildren[n.userId] || []);
          c += countChildren(children);
        }
      }
      return c;
    };
    count += countChildren(treeData.children);
    return count;
  }, [treeData, expandedNodes, lazyChildren]);

  // ============ AutoComplete 选项 ============

  // 搜索结果选项
  const searchOptions = useMemo(
    () =>
      searchResults.map((u) => ({
        value: u.nickname || u.userId,
        userId: u.userId,
        nickname: u.nickname,
        phone: u.phone,
        avatarUrl: u.avatarUrl,
        tier: u.tier,
        treeStatus: u.treeStatus,
        hasVipNode: u.hasVipNode,
        hasNormalNode: u.hasNormalNode,
        hasNode: treeType === 'vip' ? u.hasVipNode : u.hasNormalNode,
        label: (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <Avatar src={u.avatarUrl} icon={<UserOutlined />} size={28} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
                <span style={{ fontWeight: 500 }}>{u.nickname || u.userId}</span>
                <Tag color={u.tier === 'VIP' ? 'gold' : 'default'} style={{ margin: 0, fontSize: 10, lineHeight: '16px', padding: '0 4px' }}>
                  {u.tier}
                </Tag>
                {u.treeStatus && (
                  <Tag
                    color={SEARCH_STATUS_TAGS[u.treeStatus].color}
                    style={{ margin: 0, fontSize: 10, lineHeight: '16px', padding: '0 4px' }}
                  >
                    {SEARCH_STATUS_TAGS[u.treeStatus].text}
                  </Tag>
                )}
                {(() => {
                  const hasNode = treeType === 'vip' ? u.hasVipNode : u.hasNormalNode;
                  if (hasNode === undefined) return null;
                  return (
                    <Tag
                      color={hasNode ? 'green' : 'default'}
                      style={{ margin: 0, fontSize: 10, lineHeight: '16px', padding: '0 4px' }}
                    >
                      {hasNode ? '已入树' : '未入树'}
                    </Tag>
                  );
                })()}
              </div>
              <Text type="secondary" style={{ fontSize: 11 }}>
                {u.phone || u.userId}
              </Text>
            </div>
          </div>
        ),
      })),
    [searchResults, treeType],
  );

  // 清除搜索历史
  const handleClearSearchHistory = useCallback(() => {
    clearHistory(treeType, 'search');
    setSearchHistory([]);
  }, [treeType]);

  const handleClearBrowseHistory = useCallback(() => {
    clearHistory(treeType, 'browse');
    setBrowseHistory([]);
  }, [treeType]);

  // 历史选项（聚焦且搜索框为空时显示）
  const historyOptions = useMemo(() => {
    if (searchText.length > 0) return [];
    const groups: any[] = [];

    if (searchHistory.length > 0) {
      groups.push({
        label: (
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span><HistoryOutlined style={{ marginRight: 4 }} />搜索历史</span>
            <a
              onClick={(e) => { e.stopPropagation(); handleClearSearchHistory(); }}
              style={{ fontSize: 11, color: '#999' }}
            >
              <DeleteOutlined style={{ marginRight: 2 }} />清除
            </a>
          </div>
        ),
        options: searchHistory.slice(0, 5).map((item) => ({
          value: item.nickname || item.userId,
          userId: item.userId,
          nickname: item.nickname,
          label: (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <ClockCircleOutlined style={{ color: '#bfbfbf', fontSize: 11 }} />
              <span>{item.nickname || item.userId}</span>
              <Text type="secondary" style={{ fontSize: 10 }}>
                {item.userId.slice(0, 8)}
              </Text>
            </div>
          ),
        })),
      });
    }

    if (browseHistory.length > 0) {
      groups.push({
        label: (
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span><UserOutlined style={{ marginRight: 4 }} />最近浏览</span>
            <a
              onClick={(e) => { e.stopPropagation(); handleClearBrowseHistory(); }}
              style={{ fontSize: 11, color: '#999' }}
            >
              <DeleteOutlined style={{ marginRight: 2 }} />清除
            </a>
          </div>
        ),
        options: browseHistory.slice(0, 5).map((item) => ({
          value: item.nickname || item.userId,
          userId: item.userId,
          nickname: item.nickname,
          label: (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <UserOutlined style={{ color: themeColor, fontSize: 11 }} />
              <span>{item.nickname || item.userId}</span>
              <Text type="secondary" style={{ fontSize: 10 }}>
                {item.userId.slice(0, 8)}
              </Text>
            </div>
          ),
        })),
      });
    }

    return groups;
  }, [searchText, searchHistory, browseHistory, themeColor, handleClearSearchHistory, handleClearBrowseHistory]);

  // 最终选项：有搜索文字时显示搜索结果，无文字时显示历史
  const options = useMemo(() => {
    if (searchText.length > 0) return searchOptions;
    return historyOptions;
  }, [searchText, searchOptions, historyOptions]);

  const canBackToRoot = useMemo(() => {
    if (!treeData) return false;
    if (treeType === 'normal') return treeData.current.userId !== NORMAL_TREE_ROOT_VIEW_ID;
    return treeData.breadcrumb.some((b) => !!b.userId);
  }, [treeData, treeType]);

  // 递归渲染节点及其子树
  const renderSubtree = (
    node: VipTreeNodeView,
    depth: number,
    options: {
      isCurrent?: boolean;
      isParent?: boolean;
    } = {},
  ): React.ReactNode => {
    const isExpanded = expandedNodes.has(node.userId);
    // 获取子节点：优先用 node.children，其次用懒加载缓存
    const nodeChildren = node.children?.length ? node.children : (lazyChildren[node.userId] || []);
    const maxSlots = MAX_CHILDREN[treeType] || 3;
    const hasChildren = nodeChildren.length > 0 || node.childCount > 0;
    const showChildren = isExpanded && nodeChildren.length > 0;

    // 连线样式随深度变化
    const connColor = depth <= 1 ? L2_COLOR : L3_COLOR;
    const connWidth = depth <= 1 ? L2_WIDTH : L3_WIDTH;
    const connDash = depth > 1 ? L3_DASH : undefined;
    const isSmall = depth >= 2;

    // Phase 5: 路径高亮判定
    const isInPath = highlightedPath.includes(node.userId);
    const isPathSource = pathSource === node.userId;
    const isPathTarget = pathTarget === node.userId;

    return (
      <div
        key={node.userId}
        style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}
      >
        <div style={isInPath ? {
          borderRadius: 14,
          boxShadow: isPathSource
            ? '0 0 0 3px rgba(22,119,255,0.3), 0 0 12px rgba(22,119,255,0.15)'
            : isPathTarget
              ? `0 0 0 3px ${themeColor}44, 0 0 12px ${themeColor}22`
              : '0 0 0 2px rgba(250,140,22,0.25)',
          transition: 'box-shadow 300ms ease-out',
        } : undefined}>
          <TreeNodeCard
            node={node}
            isCurrent={options.isCurrent}
            isParent={options.isParent}
            isGrandchild={isSmall}
            themeColor={themeColor}
            isSelected={selectedNode?.userId === node.userId}
            onClick={setSelectedNode}
            onDoubleClick={handleCenterNode}
            onCenterNode={handleCenterNode}
            onToggleExpand={hasChildren && childrenApi ? handleToggleExpand : undefined}
            isExpanded={isExpanded}
            childrenLoaded={nodeChildren.length > 0}
          />
        </div>

        {/* 展开的子节点 */}
        {showChildren && (
          <ConnectorGroup color={connColor} width={connWidth} dash={connDash}>
            {nodeChildren.map((child, i) => (
              <ConnectorColumn
                key={child.userId}
                isFirst={i === 0}
                isLast={i === nodeChildren.length - 1 && nodeChildren.length >= maxSlots}
                isOnly={nodeChildren.length === 1 && nodeChildren.length >= maxSlots}
                color={connColor}
                width={connWidth}
                dash={connDash}
              >
                {connDash ? (
                  <DashedVLine height={VERT_GAP / 2} color={connColor} width={connWidth} dash={connDash} />
                ) : (
                  <div style={{ width: connWidth, height: VERT_GAP / 2, background: connColor }} />
                )}
                {renderSubtree(child, depth + 1)}
              </ConnectorColumn>
            ))}
            {/* 空位占位 */}
            {nodeChildren.length < maxSlots && Array.from({ length: maxSlots - nodeChildren.length }).map((_, i) => (
              <ConnectorColumn
                key={`empty-${node.userId}-${i}`}
                isFirst={false}
                isLast={i === maxSlots - nodeChildren.length - 1}
                isOnly={false}
                color={connColor}
                width={connWidth}
                dash={connDash}
              >
                {connDash ? (
                  <DashedVLine height={VERT_GAP / 2} color={connColor} width={connWidth} dash={connDash} />
                ) : (
                  <div style={{ width: connWidth, height: VERT_GAP / 2, background: connColor }} />
                )}
                <EmptySlotNode small={isSmall} />
              </ConnectorColumn>
            ))}
          </ConnectorGroup>
        )}
      </div>
    );
  };

  // ============ 渲染 ============

  return (
    <div style={{ display: 'flex', gap: 16, height: 'calc(100vh - 120px)', minHeight: 600, overflow: 'hidden' }}>
      {/* 左侧：搜索 + 树 */}
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 0 }}>
        {/* 可选 banner（普通树在顶部有渐变横幅） */}
        {banner}

        {/* 固定顶部工具栏：搜索 + 缩放 + 深度 + 按钮组 */}
        <Card
          size="small"
          bordered={false}
          style={{
            borderRadius: banner ? 0 : '12px 12px 0 0',
            flexShrink: 0,
            zIndex: 10,
            borderBottom: '1px solid #f0f0f0',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            {!banner && (
              <>
                <ApartmentOutlined style={{ fontSize: 20, color: themeColor }} />
                <Tooltip title={subtitle}>
                  <Title level={5} style={{ margin: 0, flex: 'none', cursor: 'help' }}>
                    {title}
                  </Title>
                </Tooltip>
              </>
            )}
            <AutoComplete
              style={{ flex: 1, maxWidth: 360 }}
              value={searchText}
              options={options}
              onSearch={setSearchText}
              onChange={setSearchText}
              onSelect={handleSelectUser}
              onFocus={() => setIsSearchFocused(true)}
              onBlur={() => setTimeout(() => setIsSearchFocused(false), 200)}
              open={isSearchFocused && (searchText.length > 0 || historyOptions.length > 0) ? undefined : false}
              placeholder="搜索用户（手机号/ID/昵称）"
            >
              <Input prefix={<SearchOutlined style={{ color: '#bfbfbf' }} />} allowClear />
            </AutoComplete>

            {/* 分隔线 */}
            <div style={{ width: 1, height: 24, background: '#e8e8e8' }} />

            {urlSourceLabel && (
              <Tag color="processing" style={{ marginInlineEnd: 0 }}>
                来自：{urlSourceLabel}
              </Tag>
            )}

            {/* 展开深度 */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <Text type="secondary" style={{ fontSize: 12, whiteSpace: 'nowrap' }}>
                深度
              </Text>
              <InputNumber
                size="small"
                min={1}
                max={5}
                value={treeDepth}
                onChange={(v) => {
                  if (v) {
                    setTreeDepth(v);
                    if (centeredUserId) updateUrl(centeredUserId, v, subtreeRoot ? 'subtree' : 'locate');
                  }
                }}
                style={{ width: 56 }}
              />
            </div>

            {/* 缩放按钮 */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <Tooltip title="缩小 (Ctrl+滚轮)">
                <Button
                  size="small"
                  icon={<ZoomOutOutlined />}
                  onClick={handleZoomOut}
                  disabled={zoom <= ZOOM_MIN}
                />
              </Tooltip>
              <Tooltip title="重置缩放">
                <Button size="small" onClick={handleZoomReset} style={{ fontSize: 12, minWidth: 44 }}>
                  {Math.round(zoom * 100)}%
                </Button>
              </Tooltip>
              <Tooltip title="放大 (Ctrl+滚轮)">
                <Button
                  size="small"
                  icon={<ZoomInOutlined />}
                  onClick={handleZoomIn}
                  disabled={zoom >= ZOOM_MAX}
                />
              </Tooltip>
            </div>

            {/* 分隔线 */}
            <div style={{ width: 1, height: 24, background: '#e8e8e8' }} />

            {/* 回到根节点（面包屑全为系统根节点时禁用） */}
            <Tooltip title="回到根节点">
              <Button
                size="small"
                icon={<HomeOutlined />}
                onClick={handleBackToRoot}
                disabled={!canBackToRoot}
              />
            </Tooltip>

            {/* 回到当前用户（仅当从 URL 传入了 userId 时显示） */}
            {initialUserId && (
              <Tooltip title="回到当前用户">
                <Button
                  size="small"
                  icon={<UserOutlined />}
                  onClick={handleBackToCurrentUser}
                  disabled={centeredUserId === initialUserId}
                />
              </Tooltip>
            )}

            {/* 刷新 */}
            <Tooltip title="刷新">
              <Button
                size="small"
                icon={<ReloadOutlined />}
                onClick={() => refetch()}
                disabled={!centeredUserId}
              />
            </Tooltip>

            {/* 复制链接 */}
            <Tooltip title="复制链接">
              <Button size="small" icon={<LinkOutlined />} onClick={handleCopyLink} />
            </Tooltip>

            {/* 可见节点数 */}
            {treeData && (
              <Text type="secondary" style={{ fontSize: 11 }}>
                {visibleNodeCount} 节点
              </Text>
            )}

            {/* Phase 6: 导出截图 */}
            <Tooltip title="导出截图">
              <Button size="small" icon={<CameraOutlined />} onClick={handleScreenshot} />
            </Tooltip>

            {/* 子树模式：进入需要 selectedNode，退出按钮由 subtreeRoot 控制 */}
            {(subtreeRoot || selectedNode) && (
              <Tooltip title={subtreeRoot ? '退出子树模式' : '以选中节点为子树根'}>
                <Button
                  size="small"
                  icon={subtreeRoot ? <CompressOutlined /> : <NodeExpandOutlined />}
                  onClick={handleSubtreeToggle}
                  type={subtreeRoot ? 'primary' : 'default'}
                />
              </Tooltip>
            )}

            {/* Phase 5: 清除路径高亮 */}
            {highlightedPath.length > 0 && (
              <Tooltip title="清除路径高亮">
                <Button
                  size="small"
                  type="primary"
                  danger
                  onClick={() => handleHighlightPath([], null, null)}
                >
                  清除路径
                </Button>
              </Tooltip>
            )}
          </div>
        </Card>

        {/* 面包屑 */}
        {treeData && (
          <Card
            size="small"
            bordered={false}
            style={{
              borderRadius: 0,
              flexShrink: 0,
              borderBottom: '1px solid #f0f0f0',
            }}
          >
            <Breadcrumb
              items={[
                ...treeData.breadcrumb.map((b) => ({
                  title: b.userId ? (
                    <a onClick={() => handleBreadcrumbClick(b.userId!, b.nickname)} style={{ cursor: 'pointer' }}>
                      {b.nickname || b.userId}
                      <Text type="secondary" style={{ fontSize: 11, marginLeft: 4 }}>
                        L{b.level}
                      </Text>
                    </a>
                  ) : treeType === 'normal' ? (
                    <a onClick={handleBackToRoot} style={{ cursor: 'pointer' }}>
                      {b.nickname || '平台根节点'}
                      <Text type="secondary" style={{ fontSize: 11, marginLeft: 4 }}>
                        L{b.level}
                      </Text>
                    </a>
                  ) : (
                    <Text type="secondary">
                      {b.nickname || '系统根节点'}
                      <Text type="secondary" style={{ fontSize: 11, marginLeft: 4 }}>
                        L{b.level}
                      </Text>
                    </Text>
                  ),
                })),
                {
                  title: (
                    <Text strong style={{ color: themeColor }}>
                      {treeData.current.nickname || treeData.current.userId}
                    </Text>
                  ),
                },
              ]}
            />
          </Card>
        )}

        {/* 根节点快捷入口（树加载后可折叠显示） */}
        {treeData && rootEntryElement && (
          <div style={{ borderBottom: '1px solid #f0f0f0', flexShrink: 0 }}>
            <div
              onClick={() => setRootEntryCollapsed((c) => !c)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                padding: '4px 16px',
                cursor: 'pointer',
                fontSize: 11,
                color: '#8c8c8c',
                userSelect: 'none',
              }}
            >
              <HomeOutlined style={{ fontSize: 11 }} />
              <span>{rootEntryCollapsed ? '展开根节点入口' : '收起根节点入口'}</span>
              <span style={{ transform: rootEntryCollapsed ? 'rotate(-90deg)' : 'rotate(0deg)', transition: 'transform 200ms', display: 'inline-block', fontSize: 10 }}>▼</span>
            </div>
            {!rootEntryCollapsed && rootEntryElement}
          </div>
        )}

        {/* 树可视化区域 */}
        <Card
          bordered={false}
          style={{
            borderRadius: 0,
            flex: 1,
            overflow: 'hidden',
            position: 'relative',
          }}
          styles={{ body: { height: '100%', padding: 0 } }}
        >
          {isTreeLoading ? (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%' }}>
              <Spin tip="加载中..." />
            </div>
          ) : isError ? (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%' }}>
              <Result
                status="error"
                title="加载失败"
                subTitle="无法获取树数据，请重试"
                extra={
                  <Button type="primary" onClick={() => refetch()}>
                    重试
                  </Button>
                }
              />
            </div>
          ) : !treeData ? (
            <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'auto' }}>
              {/* 根节点快捷入口（始终显示） */}
              {rootEntryElement}

              {/* 空状态引导 / 未入树提示 */}
              <div style={{
                flex: 1,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                padding: '24px 40px',
                gap: 16,
              }}>
                {unavailableTarget ? (
                  <Result
                    status="warning"
                    title={`${unavailableTarget.nickname || unavailableTarget.userId} 尚未进入${treeType === 'vip' ? ' VIP' : '普通'}树`}
                    subTitle={treeType === 'vip'
                      ? '可以先查看对应根树，或等待该用户满足入树条件后再定位。'
                      : '可以先查看平台根节点，或等待该用户首单入树后再定位。'}
                    extra={[
                      <Button
                        key="clear"
                        onClick={() => {
                          setUnavailableTarget(null);
                          setSearchText('');
                        }}
                      >
                        清除选择
                      </Button>,
                      treeType === 'normal' ? (
                        <Button
                          key="root"
                          type="primary"
                          onClick={() => {
                            setUnavailableTarget(null);
                            setCenteredUserId(NORMAL_TREE_ROOT_VIEW_ID);
                            updateUrl(NORMAL_TREE_ROOT_VIEW_ID, treeDepth, 'locate');
                          }}
                        >
                          查看平台根节点
                        </Button>
                      ) : null,
                    ].filter(Boolean)}
                  />
                ) : (
                  <>
                    <ApartmentOutlined style={{ fontSize: 48, color: '#d9d9d9' }} />
                    <div style={{ textAlign: 'center' }}>
                      <Text style={{ fontSize: 15, color: '#595959', display: 'block', marginBottom: 4 }}>
                        {emptyText}
                      </Text>
                      <Text type="secondary" style={{ fontSize: 12 }}>
                        {rootEntryElement ? '点击上方根节点入口卡片，或在搜索框中输入用户信息' : '在搜索框中输入昵称、手机号或用户 ID'}
                      </Text>
                    </div>
                  </>
                )}
                {browseHistory.length > 0 && (
                  <div style={{ marginTop: 8 }}>
                    <Text type="secondary" style={{ fontSize: 12, marginBottom: 8, display: 'block' }}>
                      <ClockCircleOutlined style={{ marginRight: 4 }} />最近浏览
                    </Text>
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'center' }}>
                      {browseHistory.slice(0, 6).map((item) => (
                        <Tag
                          key={item.userId}
                          color="default"
                          style={{ cursor: 'pointer', borderRadius: 6, padding: '2px 10px' }}
                          onClick={() => {
                            setCenteredUserId(item.userId);
                            setUnavailableTarget(null);
                            setSearchText(item.nickname || item.userId);
                            updateUrl(item.userId, treeDepth, 'locate');
                          }}
                        >
                          {item.nickname || item.userId.slice(0, 8)}
                        </Tag>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div
              ref={scrollRef}
              onWheel={handleWheel}
              onMouseDown={handleMouseDown}
              onMouseMove={handleMouseMove}
              onMouseUp={handleMouseUp}
              style={{
                width: '100%',
                height: '100%',
                overflow: 'auto',
                cursor: isDragging ? 'grabbing' : 'grab',
              }}
            >
              {/* 缩放容器：inline-block 使其宽度由内容决定，margin auto 居中 */}
              <div
                style={{
                  display: 'inline-flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  transform: `scale(${zoom})`,
                  transformOrigin: 'top center',
                  minWidth: `${100 / zoom}%`,
                  padding: '24px 40px',
                  boxSizing: 'border-box',
                }}
              >
                {/* 父节点（淡化处理） */}
                {treeData.parent && !subtreeRoot && (() => {
                  const parentInPath = highlightedPath.includes(treeData.parent!.userId);
                  const parentIsPathSource = pathSource === treeData.parent!.userId;
                  const parentIsPathTarget = pathTarget === treeData.parent!.userId;
                  return (
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                      <div style={parentInPath ? {
                        borderRadius: 14,
                        boxShadow: parentIsPathSource
                          ? '0 0 0 3px rgba(22,119,255,0.3), 0 0 12px rgba(22,119,255,0.15)'
                          : parentIsPathTarget
                            ? `0 0 0 3px ${themeColor}44, 0 0 12px ${themeColor}22`
                            : '0 0 0 2px rgba(250,140,22,0.25)',
                        transition: 'box-shadow 300ms ease-out',
                      } : undefined}>
                        <TreeNodeCard
                          node={treeData.parent!}
                          isParent
                          themeColor={themeColor}
                          onClick={setSelectedNode}
                          onDoubleClick={handleCenterNode}
                          onCenterNode={handleCenterNode}
                        />
                      </div>
                      <div style={{ width: L1_WIDTH, height: VERT_GAP, background: themeColor }} />
                    </div>
                  );
                })()}

                {/* 当前节点（强调处理） */}
                {(() => {
                  const currentInPath = highlightedPath.includes(treeData.current.userId);
                  const currentIsPathSource = pathSource === treeData.current.userId;
                  const currentIsPathTarget = pathTarget === treeData.current.userId;
                  return (
                    <div data-current-node>
                      <div style={currentInPath ? {
                        borderRadius: 14,
                        boxShadow: currentIsPathSource
                          ? '0 0 0 3px rgba(22,119,255,0.3), 0 0 12px rgba(22,119,255,0.15)'
                          : currentIsPathTarget
                            ? `0 0 0 3px ${themeColor}44, 0 0 12px ${themeColor}22`
                            : '0 0 0 2px rgba(250,140,22,0.25)',
                        transition: 'box-shadow 300ms ease-out',
                      } : undefined}>
                        <TreeNodeCard
                          node={treeData.current}
                          isCurrent
                          themeColor={themeColor}
                          isSelected={selectedNode?.userId === treeData.current.userId}
                          onClick={setSelectedNode}
                          onDoubleClick={handleCenterNode}
                          onCenterNode={handleCenterNode}
                          onToggleExpand={childrenApi ? handleToggleExpand : undefined}
                          isExpanded={expandedNodes.has(treeData.current.userId)}
                          childrenLoaded={treeData.children.length > 0}
                        />
                      </div>
                    </div>
                  );
                })()}

                {/* 子节点递归渲染（受当前节点展开/收起控制） */}
                {expandedNodes.has(treeData.current.userId) && (() => {
                  const rootChildren = treeData.children;
                  const maxSlots = MAX_CHILDREN[treeType] || 3;

                  if (rootChildren.length === 0) return null;

                  return (
                    <ConnectorGroup color={L2_COLOR} width={L2_WIDTH}>
                      {rootChildren.map((child, i) => (
                        <ConnectorColumn
                          key={child.userId}
                          isFirst={i === 0}
                          isLast={i === rootChildren.length - 1 && rootChildren.length >= maxSlots}
                          isOnly={rootChildren.length === 1 && rootChildren.length >= maxSlots}
                          color={L2_COLOR}
                          width={L2_WIDTH}
                        >
                          <div style={{ width: L2_WIDTH, height: VERT_GAP / 2, background: L2_COLOR }} />
                          {renderSubtree(child, 1)}
                        </ConnectorColumn>
                      ))}
                      {/* 空位占位 */}
                      {rootChildren.length < maxSlots && rootChildren.length > 0 && Array.from({ length: maxSlots - rootChildren.length }).map((_, i) => (
                        <ConnectorColumn
                          key={`empty-root-${i}`}
                          isFirst={false}
                          isLast={i === maxSlots - rootChildren.length - 1}
                          isOnly={false}
                          color={L2_COLOR}
                          width={L2_WIDTH}
                        >
                          <div style={{ width: L2_WIDTH, height: VERT_GAP / 2, background: L2_COLOR }} />
                          <EmptySlotNode />
                        </ConnectorColumn>
                      ))}
                    </ConnectorGroup>
                  );
                })()}

                {/* 截断提示 */}
                {isTruncated && (
                  <div style={{
                    marginTop: 16,
                    padding: '8px 16px',
                    background: '#fffbe6',
                    border: '1px solid #ffe58f',
                    borderRadius: 8,
                    fontSize: 12,
                    color: '#ad6800',
                    textAlign: 'center',
                  }}>
                    节点数量较多，部分深层节点已自动收起。点击节点底部的"展开"按钮查看更多。
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Phase 6: 小地图 */}
          {treeData && (
            <TreeMinimap
              treeData={treeData}
              visibleNodeCount={visibleNodeCount}
              themeColor={themeColor}
              scrollContainerRef={scrollRef}
              highlightedPath={highlightedPath}
              expandedNodes={expandedNodes}
              lazyChildren={lazyChildren}
            />
          )}

          {isCompactLayout && (
            <div style={{ position: 'absolute', left: 16, bottom: 16, zIndex: 20 }}>
              <Button type="primary" icon={<MenuUnfoldOutlined />} onClick={() => setDetailDrawerOpen(true)}>
                {selectedNode ? '查看详情' : '节点详情'}
              </Button>
            </div>
          )}
        </Card>

        {/* Phase 6: 底部图例 */}
        <TreeLegend treeType={treeType} />
      </div>

      {/* 右侧：可折叠详情面板 */}
      {!isCompactLayout && (
        <div
          style={{
            flex: `0 0 ${detailCollapsed ? COLLAPSED_WIDTH : DETAIL_PANEL_WIDTH}px`,
            transition: 'flex-basis 250ms ease-out',
            display: 'flex',
            flexDirection: 'row',
            overflow: 'hidden',
          }}
        >
          <Tooltip title={detailCollapsed ? '展开详情面板' : '折叠详情面板'} placement="left">
            <div
              onClick={() => setDetailCollapsed((c) => !c)}
              style={{
                width: COLLAPSED_WIDTH,
                flexShrink: 0,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: 'pointer',
                borderRadius: detailCollapsed ? 12 : '12px 0 0 12px',
                background: '#fafafa',
                border: '1px solid #f0f0f0',
                borderRight: detailCollapsed ? '1px solid #f0f0f0' : 'none',
                transition: 'all 250ms ease-out',
              }}
            >
              {detailCollapsed ? (
                <MenuUnfoldOutlined style={{ fontSize: 16, color: themeColor }} />
              ) : (
                <MenuFoldOutlined style={{ fontSize: 16, color: themeColor }} />
              )}
            </div>
          </Tooltip>

          {!detailCollapsed && (
            <Card
              bordered={false}
              style={{
                borderRadius: '0 12px 12px 0',
                flex: 1,
                overflow: 'auto',
                minWidth: 0,
              }}
              styles={{ body: { padding: 16 } }}
            >
              <NodeDetail
                node={selectedNode}
                treeType={treeType}
                themeColor={themeColor}
                onHighlightPath={handleHighlightPath}
              />
            </Card>
          )}
        </div>
      )}

      {isCompactLayout && (
        <Drawer
          title={selectedNode ? selectedNode.nickname || selectedNode.userId : '节点详情'}
          placement="right"
          open={detailDrawerOpen}
          onClose={() => setDetailDrawerOpen(false)}
          width={DETAIL_PANEL_WIDTH}
          destroyOnClose={false}
        >
          <NodeDetail
            node={selectedNode}
            treeType={treeType}
            themeColor={themeColor}
            onHighlightPath={handleHighlightPath}
          />
        </Drawer>
      )}
    </div>
  );
}

// ============ 连线子组件（支持自定义颜色/粗细/虚线） ============

/**
 * 连接器组：垂直线 -> 水平横杆 -> 各子列
 *
 *   父节点
 *      |       <- 垂直线
 * +----+----+  <- 横杆（border-top 拼接）
 * |    |    |
 * C1   C2   C3
 */
function ConnectorGroup({
  children,
  color,
  width,
  dash,
}: {
  children: React.ReactNode;
  color: string;
  width: number;
  dash?: string;
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', width: '100%' }}>
      {/* 垂直线 */}
      {dash ? (
        <DashedVLine height={VERT_GAP / 2} color={color} width={width} dash={dash} />
      ) : (
        <div style={{ width, height: VERT_GAP / 2, background: color }} />
      )}
      {/* 子列容器 */}
      <div style={{ display: 'flex', justifyContent: 'center' }}>{children}</div>
    </div>
  );
}

/**
 * 单个子列：带 border-top 的容器
 * 支持实线和虚线横杆
 */
function ConnectorColumn({
  children,
  isFirst,
  isLast,
  isOnly,
  color,
  width,
  dash,
}: {
  children: React.ReactNode;
  isFirst?: boolean;
  isLast?: boolean;
  isOnly?: boolean;
  color: string;
  width: number;
  dash?: string;
}) {
  const borderStyle = dash ? 'dashed' : 'solid';
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
      {/* 横杆容器：左右各一半 */}
      <div style={{ display: 'flex', width: '100%' }}>
        <div
          style={{
            flex: 1,
            borderTop: isOnly || isFirst ? 'none' : `${width}px ${borderStyle} ${color}`,
          }}
        />
        <div
          style={{
            flex: 1,
            borderTop: isOnly || isLast ? 'none' : `${width}px ${borderStyle} ${color}`,
          }}
        />
      </div>
      {/* 节点内容 */}
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '0 10px' }}>
        {children}
      </div>
    </div>
  );
}

/** 虚线垂直线（用 SVG 实现真实虚线） */
function DashedVLine({
  height,
  color,
  width,
  dash,
}: {
  height: number;
  color: string;
  width: number;
  dash: string;
}) {
  return (
    <svg width={width + 2} height={height} style={{ display: 'block' }}>
      <line
        x1={(width + 2) / 2}
        y1={0}
        x2={(width + 2) / 2}
        y2={height}
        stroke={color}
        strokeWidth={width}
        strokeDasharray={dash}
      />
    </svg>
  );
}
