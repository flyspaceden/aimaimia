/**
 * 树画布底部图例说明
 * 展示节点状态颜色、连线含义、空位说明
 */
import React from 'react';
import { Typography } from 'antd';

const { Text } = Typography;

interface TreeLegendProps {
  treeType: 'vip' | 'normal';
}

const statusItems = [
  { color: '#389e0d', label: '活跃' },
  { color: '#8c8c8c', label: '沉默' },
  { color: '#cf1322', label: '冻结' },
  { color: '#531dab', label: '已出局' },
];

const TreeLegend: React.FC<TreeLegendProps> = ({ treeType }) => (
  <div
    style={{
      display: 'flex',
      alignItems: 'center',
      gap: 16,
      padding: '6px 16px',
      background: '#fafafa',
      borderTop: '1px solid #f0f0f0',
      borderRadius: '0 0 12px 12px',
      flexWrap: 'wrap',
      fontSize: 11,
      color: '#8c8c8c',
    }}
  >
    <Text type="secondary" style={{ fontSize: 11, fontWeight: 600 }}>图例</Text>

    {/* 节点状态 */}
    {statusItems.map((s) => (
      <div key={s.label} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
        <div style={{ width: 8, height: 8, borderRadius: '50%', backgroundColor: s.color }} />
        <span>{s.label}</span>
      </div>
    ))}

    {/* 普通树额外状态 */}
    {treeType === 'normal' && (
      <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
        <div style={{
          width: 8, height: 8, borderRadius: '50%',
          backgroundColor: '#1677ff',
        }} />
        <span>VIP停收</span>
      </div>
    )}

    {/* 分隔 */}
    <div style={{ width: 1, height: 14, background: '#e0e0e0' }} />

    {/* 连线说明 */}
    <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
      <div style={{ width: 16, height: 2, background: '#b0b0b0' }} />
      <span>父→子</span>
    </div>
    <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
      <svg width={16} height={2}><line x1={0} y1={1} x2={16} y2={1} stroke="#d0d0d0" strokeWidth={1.5} strokeDasharray="4 3" /></svg>
      <span>子→孙</span>
    </div>

    {/* 分隔 */}
    <div style={{ width: 1, height: 14, background: '#e0e0e0' }} />

    {/* 空位 */}
    <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
      <div style={{
        width: 20, height: 12, borderRadius: 3,
        border: '1.5px dashed #d9d9d9',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        <span style={{ fontSize: 7, color: '#bfbfbf' }}>空</span>
      </div>
      <span>空位</span>
    </div>

    {/* 树规则 */}
    <div style={{ width: 1, height: 14, background: '#e0e0e0' }} />
    <span>
      {treeType === 'vip'
        ? '三叉树 · 推荐优先 · BFS滑落'
        : '三叉树 · 轮询平衡插入'}
    </span>
  </div>
);

export default TreeLegend;
