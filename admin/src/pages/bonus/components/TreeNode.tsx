/**
 * VIP 树节点卡片组件
 *
 * 胶囊形卡片，展示：状态色 + 昵称 + 等级 + 购买次数 / 累计收入 / 子节点数
 * 单击选中、双击以该节点为中心重新加载
 *
 * 视觉层级：
 * - isParent：父节点，略微淡化（opacity 0.75，无阴影放大）
 * - isCurrent：当前聚焦节点，加粗边框 + 外发光 + 轻微放大
 * - isGrandchild：孙节点，缩小尺寸 + 更淡
 * - 默认（子节点）：正常样式
 *
 * 交互增强：
 * - 悬浮显示 🎯 按钮，点击以此节点为中心展开
 * - 右键上下文菜单（以此为中心 / 复制用户 ID）
 * - +N 子节点提示（未展开时显示）
 */
import React, { useState } from 'react';
import { Tag, Tooltip, Dropdown } from 'antd';
import type { MenuProps } from 'antd';
import {
  CrownOutlined,
  TeamOutlined,
  ShoppingOutlined,
  DollarOutlined,
  AimOutlined,
  CopyOutlined,
} from '@ant-design/icons';
import type { VipTreeNodeView } from '@/types';

/** 状态色映射 */
const STATUS_CONFIG: Record<string, { color: string; bg: string; border: string; label: string }> = {
  active:  { color: '#389e0d', bg: '#f6ffed', border: '#b7eb8f', label: '活跃' },
  silent:  { color: '#8c8c8c', bg: '#fafafa', border: '#d9d9d9', label: '沉默' },
  frozen:  { color: '#cf1322', bg: '#fff1f0', border: '#ffa39e', label: '冻结' },
  exited:  { color: '#531dab', bg: '#f9f0ff', border: '#d3adf7', label: '已出局' },
};

interface TreeNodeCardProps {
  node: VipTreeNodeView;
  isSelected?: boolean;
  isCurrent?: boolean;
  /** 标记为父节点（淡化处理） */
  isParent?: boolean;
  /** 标记为孙节点（缩小处理） */
  isGrandchild?: boolean;
  /** 主题色，用于当前节点边框/发光，默认 VIP 蓝色 */
  themeColor?: string;
  onClick?: (node: VipTreeNodeView) => void;
  onDoubleClick?: (node: VipTreeNodeView) => void;
  /** 以此节点为中心重新加载树（悬浮显示 🎯 按钮） */
  onCenterNode?: (node: VipTreeNodeView) => void;
  /** 子节点是否已加载（控制 +N 提示可见性） */
  childrenLoaded?: boolean;
  /** 展开/收起子节点回调 */
  onToggleExpand?: (node: VipTreeNodeView) => void;
  /** 子节点是否已展开 */
  isExpanded?: boolean;
}

const TreeNodeCard: React.FC<TreeNodeCardProps> = ({
  node,
  isSelected,
  isCurrent,
  isParent,
  isGrandchild,
  themeColor = '#1E40AF',
  onClick,
  onDoubleClick,
  onCenterNode,
  childrenLoaded,
  onToggleExpand,
  isExpanded,
}) => {
  const [hovered, setHovered] = useState(false);

  const cfg = STATUS_CONFIG[node.status] || STATUS_CONFIG.active;

  // 根据层级角色计算样式
  const borderColor = isSelected
    ? '#1677ff'
    : isCurrent
      ? themeColor
      : cfg.border;

  const boxShadow = isSelected
    ? '0 0 0 3px rgba(22,119,255,0.15), 0 2px 8px rgba(0,0,0,0.08)'
    : isCurrent
      ? `0 0 0 4px ${themeColor}22, 0 4px 16px rgba(0,0,0,0.12)`
      : isParent
        ? '0 1px 2px rgba(0,0,0,0.04)'
        : isGrandchild
          ? '0 1px 2px rgba(0,0,0,0.04)'
          : '0 1px 4px rgba(0,0,0,0.06)';

  const borderWidth = isCurrent ? 2.5 : 2;
  const opacity = isParent ? 0.72 : isGrandchild ? 0.82 : 1;
  const scale = isCurrent ? 'scale(1.04)' : isGrandchild ? 'scale(0.92)' : 'scale(1)';

  // 是否显示展开/收起区域
  const showExpandArea = node.childCount > 0 && onToggleExpand;
  const showChildHint = node.childCount > 0 && !onToggleExpand && !childrenLoaded;

  // 右键上下文菜单
  const contextMenuItems: MenuProps['items'] = [
    onCenterNode ? { key: 'center', icon: <AimOutlined />, label: '以此为中心' } : null,
    { key: 'copy', icon: <CopyOutlined />, label: '复制用户 ID' },
  ].filter(Boolean) as MenuProps['items'];

  const handleMenuClick: MenuProps['onClick'] = ({ key }) => {
    if (key === 'center') onCenterNode?.(node);
    if (key === 'copy') {
      navigator.clipboard.writeText(node.userId);
    }
  };

  return (
    <Tooltip
      title={
        <div style={{ fontSize: 12 }}>
          <div>ID: {node.userId}</div>
          {node.phone && <div>手机: {node.phone}</div>}
          <div>层级: L{node.level}</div>
        </div>
      }
      mouseEnterDelay={0.4}
    >
      <Dropdown
        menu={{ items: contextMenuItems, onClick: handleMenuClick }}
        trigger={['contextMenu']}
      >
        <div
          data-tree-node
          onClick={() => onClick?.(node)}
          onDoubleClick={() => onDoubleClick?.(node)}
          onMouseEnter={() => setHovered(true)}
          onMouseLeave={() => setHovered(false)}
          style={{
            position: 'relative',
            display: 'inline-flex',
            flexDirection: 'column',
            alignItems: 'stretch',
            minWidth: isGrandchild ? 140 : 160,
            maxWidth: isGrandchild ? 180 : 200,
            borderRadius: 12,
            border: `${borderWidth}px solid ${borderColor}`,
            backgroundColor: cfg.bg,
            boxShadow,
            opacity,
            transform: scale,
            cursor: 'pointer',
            transition: 'all 200ms ease-out',
            overflow: 'hidden',
            userSelect: 'none',
          }}
        >
          {/* 悬浮时显示"以此为中心"按钮（当前节点不显示） */}
          {hovered && onCenterNode && !isCurrent && (
            <Tooltip title="以此为中心">
              <div
                onClick={(e) => { e.stopPropagation(); onCenterNode(node); }}
                style={{
                  position: 'absolute',
                  top: 4,
                  right: 4,
                  width: 22,
                  height: 22,
                  borderRadius: '50%',
                  background: themeColor,
                  color: '#fff',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: 11,
                  cursor: 'pointer',
                  zIndex: 2,
                  boxShadow: '0 1px 4px rgba(0,0,0,0.15)',
                }}
              >
                <AimOutlined />
              </div>
            </Tooltip>
          )}

          {/* 当前节点顶部强调色条 */}
          {isCurrent && (
            <div style={{
              height: 3,
              background: `linear-gradient(90deg, ${themeColor}, ${themeColor}88)`,
            }} />
          )}

          {/* 头部：状态色条 + 昵称 + 等级 */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              padding: isCurrent ? '6px 12px 4px' : '8px 12px 4px',
            }}
          >
            <div
              style={{
                width: 8,
                height: 8,
                borderRadius: '50%',
                backgroundColor: cfg.color,
                flexShrink: 0,
              }}
            />
            <span
              style={{
                flex: 1,
                fontWeight: isCurrent ? 700 : 600,
                fontSize: isGrandchild ? 12 : 13,
                color: isParent ? '#595959' : '#262626',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {node.nickname || node.userId}
            </span>
            {node.isSystemNode ? (
              <Tag color="gold" style={{ margin: 0, fontSize: 11, lineHeight: '18px', padding: '0 4px' }}>
                ROOT
              </Tag>
            ) : node.tier === 'VIP' ? (
              <Tag
                icon={<CrownOutlined />}
                color="green"
                style={{ margin: 0, fontSize: 11, lineHeight: '18px', padding: '0 4px' }}
              >
                VIP
              </Tag>
            ) : null}
            {/* VIP 入树方式标签 */}
            {node.entryMode === 'AUTO_PLACE' && (
              <Tag color="default" style={{ margin: 0, fontSize: 10, lineHeight: '16px', padding: '0 3px' }}>
                自动
              </Tag>
            )}
            {/* 普通树停收标签 */}
            {node.stoppedReason === 'UPGRADED_VIP' && (
              <Tag color="blue" style={{ margin: 0, fontSize: 10, lineHeight: '16px', padding: '0 3px' }}>
                VIP
              </Tag>
            )}
            {node.stoppedReason === 'FROZEN' && (
              <Tag color="orange" style={{ margin: 0, fontSize: 10, lineHeight: '16px', padding: '0 3px' }}>
                冻结
              </Tag>
            )}
          </div>

          {/* 数据行 */}
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              padding: (showExpandArea || showChildHint) ? '4px 12px 4px' : '4px 12px 8px',
              fontSize: isGrandchild ? 10 : 11,
              color: '#8c8c8c',
              gap: 8,
            }}
          >
            <span title="购买次数">
              <ShoppingOutlined style={{ marginRight: 2 }} />
              {node.selfPurchaseCount}
            </span>
            <span title="累计收入" style={{ color: '#fa8c16' }}>
              <DollarOutlined style={{ marginRight: 2 }} />
              {node.totalEarned.toFixed(1)}
            </span>
            <span title="子节点数">
              <TeamOutlined style={{ marginRight: 2 }} />
              {node.childCount}
            </span>
            {node.exitedAt && (
              <span title="已出局" style={{ color: '#531dab' }}>
                ✕
              </span>
            )}
          </div>

          {/* 展开/收起按钮（集成在卡片内部） */}
          {showExpandArea && (
            <div
              onClick={(e) => { e.stopPropagation(); onToggleExpand!(node); }}
              style={{
                display: 'flex',
                justifyContent: 'center',
                alignItems: 'center',
                gap: 4,
                padding: '3px 0 5px',
                fontSize: 10,
                color: themeColor,
                fontWeight: 600,
                cursor: 'pointer',
                userSelect: 'none',
                borderTop: `1px solid ${borderColor}33`,
              }}
            >
              {isExpanded ? '收起' : `+${node.childCount} 展开`}
            </div>
          )}

          {/* 子节点数量提示（无展开回调时） */}
          {showChildHint && (
            <div
              style={{
                display: 'flex',
                justifyContent: 'center',
                padding: '3px 0 5px',
                fontSize: 10,
                color: themeColor,
                fontWeight: 600,
                userSelect: 'none',
                borderTop: `1px solid ${borderColor}33`,
              }}
            >
              +{node.childCount} 子节点
            </div>
          )}
        </div>
      </Dropdown>
    </Tooltip>
  );
};

/** 空位占位节点 */
export const EmptySlotNode: React.FC<{
  /** 缩小样式（用于孙节点层级的空位） */
  small?: boolean;
}> = ({ small }) => (
  <div
    style={{
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      minWidth: small ? 140 : 160,
      maxWidth: small ? 180 : 200,
      height: small ? 48 : 56,
      borderRadius: 12,
      border: '2px dashed #d9d9d9',
      backgroundColor: '#fafafa',
      opacity: 0.6,
      transform: small ? 'scale(0.92)' : 'scale(1)',
      userSelect: 'none',
    }}
  >
    <span style={{ color: '#bfbfbf', fontSize: small ? 11 : 12, fontWeight: 500 }}>空位</span>
  </div>
);

export default TreeNodeCard;
