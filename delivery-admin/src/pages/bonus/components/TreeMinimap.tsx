/**
 * 树画布小地图
 * 当节点数 > 30 时显示缩略全景图
 * 高亮当前可视区域，点击小地图可跳转到对应滚动位置
 */
import React, { useRef, useEffect, useCallback } from 'react';
import type { VipTreeNodeView, VipTreeContextResponse } from '@/types';

interface TreeMinimapProps {
  /** 树数据 */
  treeData: VipTreeContextResponse;
  /** 可见节点总数 */
  visibleNodeCount: number;
  /** 主题色 */
  themeColor: string;
  /** 滚动容器 ref */
  scrollContainerRef: React.RefObject<HTMLDivElement | null>;
  /** 高亮路径节点 */
  highlightedPath?: string[];
  /** 已展开的节点 ID 集合（用于包含懒加载子节点） */
  expandedNodes?: Set<string>;
  /** 懒加载的子节点缓存 */
  lazyChildren?: Record<string, VipTreeNodeView[]>;
}

const MINIMAP_WIDTH = 160;
const MINIMAP_HEIGHT = 100;
const DOT_RADIUS = 3;
const MIN_NODES_TO_SHOW = 30;

const TreeMinimap: React.FC<TreeMinimapProps> = ({
  treeData,
  visibleNodeCount,
  themeColor,
  scrollContainerRef,
  highlightedPath = [],
  expandedNodes,
  lazyChildren = {},
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // 收集树数据中所有节点的平铺列表（带层级和位置信息）
  const collectNodes = useCallback(() => {
    const nodes: Array<{ userId: string; level: number; index: number; isHighlighted: boolean }> = [];
    let maxLevel = 0;

    // 添加父节点
    if (treeData.parent) {
      const parentLevel = treeData.parent.level;
      nodes.push({
        userId: treeData.parent.userId,
        level: parentLevel,
        index: 0,
        isHighlighted: highlightedPath.includes(treeData.parent.userId),
      });
      if (parentLevel > maxLevel) maxLevel = parentLevel;
    }

    // 添加当前节点
    nodes.push({
      userId: treeData.current.userId,
      level: treeData.current.level,
      index: 0,
      isHighlighted: highlightedPath.includes(treeData.current.userId),
    });
    if (treeData.current.level > maxLevel) maxLevel = treeData.current.level;

    // 递归添加子节点（含懒加载的节点）
    const addChildren = (children: VipTreeNodeView[], parentIndex: number) => {
      children.forEach((child, i) => {
        nodes.push({
          userId: child.userId,
          level: child.level,
          index: parentIndex * 3 + i,
          isHighlighted: highlightedPath.includes(child.userId),
        });
        if (child.level > maxLevel) maxLevel = child.level;
        // 优先使用节点自带的 children，回退到懒加载缓存
        const childNodes = child.children?.length
          ? child.children
          : (expandedNodes?.has(child.userId) ? (lazyChildren[child.userId] || []) : []);
        if (childNodes.length > 0) {
          addChildren(childNodes, parentIndex * 3 + i);
        }
      });
    };
    addChildren(treeData.children, 0);

    return { nodes, maxLevel };
  }, [treeData, highlightedPath, expandedNodes, lazyChildren]);

  // 绘制小地图
  const drawMinimap = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    canvas.width = MINIMAP_WIDTH * dpr;
    canvas.height = MINIMAP_HEIGHT * dpr;
    ctx.scale(dpr, dpr);

    // 清空画布
    ctx.clearRect(0, 0, MINIMAP_WIDTH, MINIMAP_HEIGHT);

    // 绘制背景
    ctx.fillStyle = 'rgba(250, 250, 250, 0.95)';
    ctx.strokeStyle = '#e0e0e0';
    ctx.lineWidth = 1;
    ctx.beginPath();
    // roundRect 可能不存在于旧版浏览器，使用 fallback
    if (typeof ctx.roundRect === 'function') {
      ctx.roundRect(0, 0, MINIMAP_WIDTH, MINIMAP_HEIGHT, 6);
    } else {
      ctx.rect(0, 0, MINIMAP_WIDTH, MINIMAP_HEIGHT);
    }
    ctx.fill();
    ctx.stroke();

    const { nodes, maxLevel } = collectNodes();
    if (nodes.length === 0) return;

    // 计算布局参数
    const minLevel = Math.min(...nodes.map(n => n.level));
    const levelRange = Math.max(maxLevel - minLevel, 1);
    const padding = 12;

    // 按层级分组，用于计算 x 坐标
    const levelGroups = new Map<number, typeof nodes>();
    for (const n of nodes) {
      const group = levelGroups.get(n.level) || [];
      group.push(n);
      levelGroups.set(n.level, group);
    }

    // 绘制节点圆点
    for (const n of nodes) {
      const y = padding + ((n.level - minLevel) / levelRange) * (MINIMAP_HEIGHT - padding * 2);
      const levelNodes = levelGroups.get(n.level) || [];
      const indexInLevel = levelNodes.indexOf(n);
      const levelCount = levelNodes.length;
      const x = padding + ((indexInLevel + 0.5) / Math.max(levelCount, 1)) * (MINIMAP_WIDTH - padding * 2);

      ctx.beginPath();
      ctx.arc(x, y, n.isHighlighted ? DOT_RADIUS + 1 : DOT_RADIUS, 0, Math.PI * 2);

      if (n.userId === treeData.current.userId) {
        ctx.fillStyle = themeColor;
      } else if (n.isHighlighted) {
        ctx.fillStyle = '#fa8c16';
      } else {
        ctx.fillStyle = '#b0b0b0';
      }
      ctx.fill();
    }

    // 绘制视口指示器
    const container = scrollContainerRef.current;
    if (container) {
      const { scrollLeft, scrollTop, scrollWidth, scrollHeight, clientWidth, clientHeight } = container;
      if (scrollWidth > 0 && scrollHeight > 0) {
        const vx = (scrollLeft / scrollWidth) * (MINIMAP_WIDTH - padding * 2) + padding;
        const vy = (scrollTop / scrollHeight) * (MINIMAP_HEIGHT - padding * 2) + padding;
        const vw = (clientWidth / scrollWidth) * (MINIMAP_WIDTH - padding * 2);
        const vh = (clientHeight / scrollHeight) * (MINIMAP_HEIGHT - padding * 2);

        ctx.strokeStyle = themeColor + '88';
        ctx.lineWidth = 1.5;
        ctx.strokeRect(vx, vy, Math.max(vw, 10), Math.max(vh, 6));
      }
    }
  }, [treeData, collectNodes, themeColor, scrollContainerRef]);

  // 当数据变化时重绘
  useEffect(() => {
    drawMinimap();
  }, [drawMinimap]);

  // 监听滚动容器的 scroll 事件以更新视口指示器
  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) return;
    const handleScroll = () => {
      drawMinimap();
    };
    container.addEventListener('scroll', handleScroll);
    return () => container.removeEventListener('scroll', handleScroll);
  }, [scrollContainerRef, drawMinimap]);

  // 点击小地图：将点击位置映射到滚动容器的对应区域
  const handleMinimapClick = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const container = scrollContainerRef.current;
    if (!container) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const clickX = (e.clientX - rect.left) / MINIMAP_WIDTH;
    const clickY = (e.clientY - rect.top) / MINIMAP_HEIGHT;
    // 将比例映射到滚动位置（居中视口）
    const targetScrollLeft = clickX * container.scrollWidth - container.clientWidth / 2;
    const targetScrollTop = clickY * container.scrollHeight - container.clientHeight / 2;
    container.scrollTo({
      left: Math.max(0, targetScrollLeft),
      top: Math.max(0, targetScrollTop),
      behavior: 'smooth',
    });
  }, [scrollContainerRef]);

  // 节点数不足时不显示小地图
  if (visibleNodeCount < MIN_NODES_TO_SHOW) return null;

  return (
    <div
      style={{
        position: 'absolute',
        bottom: 12,
        right: 12,
        zIndex: 20,
        borderRadius: 6,
        overflow: 'hidden',
        boxShadow: '0 2px 8px rgba(0,0,0,0.12)',
        cursor: 'pointer',
        opacity: 0.9,
        transition: 'opacity 200ms',
      }}
      onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.opacity = '1'; }}
      onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.opacity = '0.9'; }}
    >
      <canvas
        ref={canvasRef}
        onClick={handleMinimapClick}
        style={{ width: MINIMAP_WIDTH, height: MINIMAP_HEIGHT, display: 'block' }}
      />
    </div>
  );
};

export default TreeMinimap;
