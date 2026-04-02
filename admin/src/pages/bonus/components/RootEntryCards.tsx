/**
 * 树根节点快捷入口卡片
 *
 * VIP 树：展示 A1-A10 十棵根树入口卡片
 * 普通树：展示平台根节点单张入口卡片
 *
 * 每张卡片显示：根节点 ID、节点总数、活跃率、本周新增
 * 点击卡片后自动切换到该根节点
 */
import React from 'react';
import { Card, Spin, Typography } from 'antd';
import {
  ApartmentOutlined,
  TeamOutlined,
  RiseOutlined,
  CrownOutlined,
} from '@ant-design/icons';
import { useQuery } from '@tanstack/react-query';
import type { VipRootStat, NormalRootStat } from '@/types';

const { Text } = Typography;

// ============ VIP 根节点入口 ============

interface VipRootEntryCardsProps {
  themeColor: string;
  onSelectRoot: (rootNodeId: string) => void;
  fetchStats: () => Promise<VipRootStat[]>;
}

export const VipRootEntryCards: React.FC<VipRootEntryCardsProps> = ({
  themeColor,
  onSelectRoot,
  fetchStats,
}) => {
  const { data: stats, isLoading, isError } = useQuery({
    queryKey: ['vip-root-stats'],
    queryFn: fetchStats,
    staleTime: 30000,
  });

  if (isLoading) {
    return (
      <div style={{ padding: '24px 0', textAlign: 'center' }}>
        <Spin size="small" />
        <Text type="secondary" style={{ marginLeft: 8, fontSize: 12 }}>
          加载根节点...
        </Text>
      </div>
    );
  }

  if (isError || !stats?.length) return null;

  return (
    <div style={{ padding: '16px 20px 8px' }}>
      <div style={{ marginBottom: 12, display: 'flex', alignItems: 'center', gap: 6 }}>
        <CrownOutlined style={{ color: themeColor, fontSize: 14 }} />
        <Text strong style={{ fontSize: 13, color: '#595959' }}>
          VIP 根树入口
        </Text>
        <Text type="secondary" style={{ fontSize: 11 }}>
          点击进入对应子树
        </Text>
      </div>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))',
          gap: 8,
        }}
      >
        {stats.map((root) => (
          <RootCard
            key={root.rootId}
            label={root.rootId}
            totalNodes={root.totalNodes}
            activeRate={root.activeRate}
            weeklyNew={root.weeklyNew}
            themeColor={themeColor}
            onClick={() => onSelectRoot(root.rootNodeId)}
          />
        ))}
      </div>
    </div>
  );
};

// ============ 普通树根节点入口 ============

interface NormalRootEntryCardProps {
  themeColor: string;
  onSelectRoot: () => void;
  fetchStats: () => Promise<NormalRootStat>;
}

export const NormalRootEntryCard: React.FC<NormalRootEntryCardProps> = ({
  themeColor,
  onSelectRoot,
  fetchStats,
}) => {
  const { data: stats, isLoading } = useQuery({
    queryKey: ['normal-root-stats'],
    queryFn: fetchStats,
    staleTime: 30000,
  });

  return (
    <div style={{ padding: '16px 20px 8px' }}>
      <div style={{ marginBottom: 12, display: 'flex', alignItems: 'center', gap: 6 }}>
        <ApartmentOutlined style={{ color: themeColor, fontSize: 14 }} />
        <Text strong style={{ fontSize: 13, color: '#595959' }}>
          平台根节点
        </Text>
        <Text type="secondary" style={{ fontSize: 11 }}>
          点击进入普通分润树
        </Text>
      </div>
      <Card
        hoverable
        size="small"
        onClick={onSelectRoot}
        style={{
          borderRadius: 10,
          border: `1.5px solid ${themeColor}33`,
          cursor: 'pointer',
          transition: 'all 200ms ease-out',
          maxWidth: 280,
        }}
        styles={{ body: { padding: '12px 16px' } }}
      >
        {isLoading ? (
          <Spin size="small" />
        ) : (
          <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
            <div
              style={{
                width: 40,
                height: 40,
                borderRadius: 10,
                background: `linear-gradient(135deg, ${themeColor}, ${themeColor}88)`,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0,
              }}
            >
              <ApartmentOutlined style={{ fontSize: 18, color: '#fff' }} />
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <Text strong style={{ fontSize: 14 }}>
                平台根节点
              </Text>
              <div style={{ display: 'flex', gap: 16, marginTop: 4 }}>
                <StatItem
                  icon={<TeamOutlined />}
                  value={stats?.totalNodes ?? 0}
                  label="节点"
                  color="#595959"
                />
                <StatItem
                  icon={<CrownOutlined />}
                  value={stats?.activeRate ?? 0}
                  label="%活跃"
                  color="#1677ff"
                />
                <StatItem
                  icon={<RiseOutlined />}
                  value={stats?.weeklyNew ?? 0}
                  label="本周新增"
                  color={themeColor}
                />
              </div>
            </div>
          </div>
        )}
      </Card>
    </div>
  );
};

// ============ 通用根节点卡片 ============

interface RootCardProps {
  label: string;
  totalNodes: number;
  activeRate: number;
  weeklyNew: number;
  themeColor: string;
  onClick: () => void;
}

const RootCard: React.FC<RootCardProps> = ({
  label,
  totalNodes,
  activeRate,
  weeklyNew,
  themeColor,
  onClick,
}) => (
  <Card
    hoverable
    size="small"
    onClick={onClick}
    style={{
      borderRadius: 10,
      border: `1.5px solid ${themeColor}22`,
      cursor: 'pointer',
      transition: 'all 200ms ease-out',
    }}
    styles={{ body: { padding: '10px 12px' } }}
  >
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <div
        style={{
          width: 32,
          height: 32,
          borderRadius: 8,
          background: `linear-gradient(135deg, ${themeColor}, ${themeColor}88)`,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
        }}
      >
        <Text strong style={{ fontSize: 12, color: '#fff', lineHeight: 1 }}>
          {label}
        </Text>
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'baseline', flexWrap: 'wrap' }}>
          <StatItem
            icon={<TeamOutlined />}
            value={totalNodes}
            label=""
            color="#595959"
          />
          <Text style={{ fontSize: 10, color: '#1677ff' }}>
            活跃 {activeRate}%
          </Text>
          {weeklyNew > 0 && (
            <Text style={{ fontSize: 10, color: themeColor }}>
              +{weeklyNew}
            </Text>
          )}
        </div>
      </div>
    </div>
  </Card>
);

// ============ 统计数字小组件 ============

const StatItem: React.FC<{
  icon: React.ReactNode;
  value: number;
  label: string;
  color: string;
}> = ({ icon, value, label, color }) => (
  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, fontSize: 12, color }}>
    {icon}
    <Text strong style={{ fontSize: 13, color }}>
      {value}
    </Text>
    {label && (
      <Text type="secondary" style={{ fontSize: 10 }}>
        {label}
      </Text>
    )}
  </span>
);
