/**
 * 普通奖励管理页面
 *
 * 上段：全局统计 + 配置参数
 * 中段：档位概览卡片
 * 下段：队列订单表格 + 展开行分配明细
 */
import { useState, useMemo } from 'react';
import { Card, Statistic, Spin, Empty, Typography, Table, Tag, Space, Row, Col, Tooltip } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import {
  GiftOutlined,
  ShoppingCartOutlined,
  TeamOutlined,
  SettingOutlined,
  ReloadOutlined,
} from '@ant-design/icons';
import { useQuery } from '@tanstack/react-query';
import { getBroadcastBuckets, getBroadcastWindow, getBroadcastDistributions } from '@/api/bonus';
import { getConfigs } from '@/api/config';
import type { BroadcastDistribution, BroadcastWindowOrder, RuleConfig } from '@/types';

const { Text } = Typography;

/** 档位颜色映射 */
const BUCKET_COLORS: Record<string, string> = {
  '0-10': '#1677ff',
  '10-50': '#52c41a',
  '50-100': '#faad14',
  '100-500': '#fa541c',
  '500-INF': '#722ed1',
};

const getBucketColor = (key: string): string => BUCKET_COLORS[key] || '#1677ff';

const getBucketLabel = (key: string): string => {
  if (key.endsWith('-INF')) return `¥${key.replace('-INF', '')}+`;
  const [lo, hi] = key.split('-');
  return `¥${lo}~${hi}`;
};

/** 从配置列表提取值 */
const extractValue = (configs: RuleConfig[], key: string, defaultVal: any): any => {
  const item = configs.find((c) => c.key === key);
  if (!item) return defaultVal;
  const v = item.value as any;
  return v && typeof v === 'object' && 'value' in v ? v.value : v;
};

export default function BroadcastWindowPage() {
  const [activeBucket, setActiveBucket] = useState<string | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [expandedOrderId, setExpandedOrderId] = useState<string | null>(null);

  // 查所有桶
  const { data: buckets = [], isLoading: isBucketsLoading } = useQuery({
    queryKey: ['broadcast-buckets'],
    queryFn: getBroadcastBuckets,
  });

  // 获取系统配置
  const { data: configs = [] } = useQuery({
    queryKey: ['admin-configs'],
    queryFn: getConfigs,
  });

  const windowSize = extractValue(configs, 'NORMAL_BROADCAST_X', 20);

  // 自动选中第一个桶
  const selectedBucket = activeBucket || buckets[0]?.bucketKey || null;

  // 查当前桶的窗口订单
  const { data: windowData, isLoading: isWindowLoading, refetch: refetchWindow } = useQuery({
    queryKey: ['broadcast-window', selectedBucket, currentPage],
    queryFn: () => getBroadcastWindow(selectedBucket!, currentPage, 20),
    enabled: !!selectedBucket,
  });

  // 展开行：查选中订单的分配明细
  const { data: distData, isLoading: isDistLoading } = useQuery({
    queryKey: ['broadcast-distributions', expandedOrderId],
    queryFn: () => getBroadcastDistributions(expandedOrderId!),
    enabled: !!expandedOrderId,
  });

  // 全局汇总
  const totalOrders = useMemo(() => buckets.reduce((s, b) => s + b.totalOrders, 0), [buckets]);
  const totalReward = useMemo(() => buckets.reduce((s, b) => s + b.totalReward, 0), [buckets]);

  // 队列订单表列
  const orderColumns: ColumnsType<BroadcastWindowOrder> = [
    {
      title: '#',
      width: 50,
      render: (_, __, idx) => <Text type="secondary">{(currentPage - 1) * 20 + idx + 1}</Text>,
    },
    {
      title: '订单号',
      dataIndex: 'orderId',
      width: 180,
      ellipsis: true,
      render: (v: string) => <Text copyable={{ text: v }}>{v.slice(0, 12)}...</Text>,
    },
    {
      title: '买家',
      dataIndex: 'nickname',
      width: 120,
      render: (v: string | null, r) => v || r.userId.slice(0, 8),
    },
    {
      title: '订单金额',
      dataIndex: 'amount',
      width: 120,
      render: (v: number) => <Text strong>¥{v.toFixed(2)}</Text>,
    },
    {
      title: '分配奖励',
      dataIndex: 'rewardDistributed',
      width: 120,
      render: (v: number) => (
        <Text strong style={{ color: '#fa541c' }}>¥{v.toFixed(2)}</Text>
      ),
    },
    {
      title: '加入时间',
      dataIndex: 'createdAt',
      width: 160,
      render: (v: string) => v?.slice(0, 16).replace('T', ' ') || '-',
    },
  ];

  // 分配明细表列
  const distColumns: ColumnsType<BroadcastDistribution> = [
    {
      title: '#',
      dataIndex: 'orderIndex',
      width: 50,
      render: (v: number) => <Text type="secondary">{v}</Text>,
    },
    {
      title: '受益人',
      dataIndex: 'recipientName',
      ellipsis: true,
      render: (name: string | null, r) => name || r.recipientId.slice(0, 8),
    },
    {
      title: '奖励金额',
      dataIndex: 'amount',
      width: 120,
      render: (v: number) => (
        <Text strong style={{ color: '#fa541c' }}>¥{v.toFixed(2)}</Text>
      ),
    },
    {
      title: '时间',
      dataIndex: 'createdAt',
      width: 160,
      render: (v: string) => <Text type="secondary" style={{ fontSize: 12 }}>{v?.slice(0, 16).replace('T', ' ')}</Text>,
    },
  ];

  // 展开行渲染
  const expandedRowRender = (record: BroadcastWindowOrder) => {
    if (expandedOrderId !== record.orderId) return null;
    return (
      <div style={{ padding: '8px 0' }}>
        <div style={{ marginBottom: 8 }}>
          <Space>
            <Text type="secondary">订单金额</Text>
            <Text strong>¥{record.amount.toFixed(2)}</Text>
            <Text type="secondary" style={{ marginLeft: 16 }}>分配给</Text>
            <Tag color="blue">{distData?.distributions.length || 0} 人</Tag>
            <Text type="secondary">每人</Text>
            <Text strong style={{ color: '#fa541c' }}>
              ¥{distData?.distributions[0]?.amount.toFixed(2) || '0.00'}
            </Text>
          </Space>
        </div>
        <Table<BroadcastDistribution>
          columns={distColumns}
          dataSource={distData?.distributions || []}
          loading={isDistLoading}
          rowKey="recipientId"
          size="small"
          pagination={false}
          scroll={{ y: 240 }}
        />
      </div>
    );
  };

  if (isBucketsLoading) {
    return (
      <div style={{ textAlign: 'center', padding: 60 }}>
        <Spin size="large" />
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* 第一段：全局统计 */}
      <Row gutter={16}>
        <Col span={6}>
          <Card size="small" bordered={false}>
            <Statistic
              title="总参与订单"
              value={totalOrders}
              prefix={<ShoppingCartOutlined style={{ color: '#1677ff' }} />}
            />
          </Card>
        </Col>
        <Col span={6}>
          <Card size="small" bordered={false}>
            <Statistic
              title="累计分配奖励"
              value={totalReward}
              precision={2}
              prefix={<GiftOutlined style={{ color: '#fa541c' }} />}
              suffix="元"
              valueStyle={{ color: '#fa541c' }}
            />
          </Card>
        </Col>
        <Col span={6}>
          <Card size="small" bordered={false}>
            <Statistic
              title="活跃档位"
              value={buckets.length}
              prefix={<TeamOutlined style={{ color: '#52c41a' }} />}
              suffix="个"
            />
          </Card>
        </Col>
        <Col span={6}>
          <Card size="small" bordered={false}>
            <Statistic
              title={
                <Tooltip title="每笔订单触发时，取同桶内前 X 笔历史订单平分奖励">
                  <Space><span>窗口大小</span><SettingOutlined /></Space>
                </Tooltip>
              }
              value={windowSize}
              prefix={<span>前</span>}
              suffix="笔"
            />
          </Card>
        </Col>
      </Row>

      {/* 第二段：档位概览 */}
      <Row gutter={16}>
        {buckets.length === 0 ? (
          <Col span={24}>
            <Card bordered={false}>
              <Empty description="暂无档位数据" image={Empty.PRESENTED_IMAGE_SIMPLE} />
            </Card>
          </Col>
        ) : (
          buckets.map((b) => {
            const isActive = selectedBucket === b.bucketKey;
            const color = getBucketColor(b.bucketKey);
            return (
              <Col key={b.bucketKey} flex={1}>
                <Card
                  size="small"
                  bordered={false}
                  hoverable
                  onClick={() => {
                    setActiveBucket(b.bucketKey);
                    setCurrentPage(1);
                    setExpandedOrderId(null);
                  }}
                  style={{
                    cursor: 'pointer',
                    borderLeft: `4px solid ${color}`,
                    boxShadow: isActive ? `0 0 0 2px ${color}40` : undefined,
                    background: isActive ? `${color}08` : undefined,
                  }}
                >
                  <div style={{ marginBottom: 8 }}>
                    <Tag color={color} style={{ fontWeight: 600, fontSize: 14 }}>
                      {getBucketLabel(b.bucketKey)}
                    </Tag>
                  </div>
                  <Space direction="vertical" size={4} style={{ width: '100%' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <Text type="secondary" style={{ fontSize: 12 }}>队列订单</Text>
                      <Text strong>{b.totalOrders}</Text>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <Text type="secondary" style={{ fontSize: 12 }}>累计奖励</Text>
                      <Text strong style={{ color: '#fa541c' }}>¥{b.totalReward.toFixed(2)}</Text>
                    </div>
                  </Space>
                </Card>
              </Col>
            );
          })
        )}
      </Row>

      {/* 第三段：队列订单表格 */}
      {selectedBucket && (
        <Card
          bordered={false}
          title={
            <Space>
              <Text strong>队列订单</Text>
              <Tag color={getBucketColor(selectedBucket)}>{getBucketLabel(selectedBucket)}</Tag>
            </Space>
          }
          extra={
            <Tooltip title="刷新">
              <ReloadOutlined
                style={{ cursor: 'pointer', color: '#1677ff' }}
                onClick={() => refetchWindow()}
              />
            </Tooltip>
          }
        >
          <Table<BroadcastWindowOrder>
            columns={orderColumns}
            dataSource={windowData?.windowOrders || []}
            loading={isWindowLoading}
            rowKey="orderId"
            size="small"
            expandable={{
              expandedRowKeys: expandedOrderId ? [expandedOrderId] : [],
              onExpand: (expanded, record) => {
                setExpandedOrderId(expanded ? record.orderId : null);
              },
              expandedRowRender,
            }}
            pagination={{
              current: currentPage,
              pageSize: 20,
              total: windowData?.pagination.total || 0,
              showTotal: (total) => `共 ${total} 条`,
              onChange: (page) => {
                setCurrentPage(page);
                setExpandedOrderId(null);
              },
            }}
            locale={{ emptyText: '该档位暂无订单' }}
          />
        </Card>
      )}
    </div>
  );
}
