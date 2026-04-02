/**
 * 树节点详情面板（Tab 式）
 *
 * 4 个 Tab：节点概况 / 奖励记录 / 路径解释 / 关联订单
 */
import React, { useState, useEffect } from 'react';
import {
  Button,
  Card,
  Descriptions,
  Empty,
  Row,
  Col,
  Spin,
  Statistic,
  Table,
  Tabs,
  Tag,
  Typography,
} from 'antd';
import {
  CrownOutlined,
  DollarOutlined,
  ExportOutlined,
  LockOutlined,
  ShoppingOutlined,
  TeamOutlined,
  UserOutlined,
} from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import dayjs from 'dayjs';
import {
  getVipTreeRewardRecords,
  getNormalTreeRewardRecords,
  getVipTreeRelatedOrders,
  getNormalTreeRelatedOrders,
  getVipPathExplain,
  getNormalPathExplain,
} from '@/api/bonus';
import type { VipTreeNodeView, TreeRelatedOrder, TreeRewardRecord } from '@/types';

const { Text } = Typography;

// ---------- 常量映射 ----------

const STATUS_LABELS: Record<string, { text: string; color: string }> = {
  active: { text: '活跃', color: 'green' },
  silent: { text: '沉默', color: 'default' },
  frozen: { text: '冻结', color: 'red' },
  exited: { text: '已出局', color: 'purple' },
};

const ENTRY_TYPE_MAP: Record<string, { text: string; color: string }> = {
  FREEZE: { text: '冻结', color: 'blue' },
  RELEASE: { text: '释放', color: 'green' },
  VOID: { text: '作废', color: 'default' },
};

const REWARD_STATUS_MAP: Record<string, { text: string; color: string }> = {
  FROZEN: { text: '冻结中', color: 'orange' },
  AVAILABLE: { text: '可用', color: 'green' },
  WITHDRAWN: { text: '已提现', color: 'blue' },
  VOIDED: { text: '已作废', color: 'default' },
};

// ---------- Props ----------

interface NodeDetailProps {
  node: VipTreeNodeView | null;
  /** 树类型，用于调用正确的奖励记录 API */
  treeType: 'vip' | 'normal';
  /** 主题色 */
  themeColor?: string;
  /** Phase 5: 奖励路径高亮回调 */
  onHighlightPath?: (pathUserIds: string[], sourceUserId: string | null, targetUserId: string | null) => void;
}

// ---------- 组件 ----------

const NodeDetail: React.FC<NodeDetailProps> = ({
  node,
  treeType,
  themeColor = '#1E40AF',
  onHighlightPath,
}) => {
  const navigate = useNavigate();
  const [rewardPage, setRewardPage] = useState(1);
  const [orderPage, setOrderPage] = useState(1);
  const [selectedLedgerId, setSelectedLedgerId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState('overview');

  // 根据树类型选择 API
  const rewardApi = treeType === 'vip' ? getVipTreeRewardRecords : getNormalTreeRewardRecords;
  const orderApi = treeType === 'vip' ? getVipTreeRelatedOrders : getNormalTreeRelatedOrders;
  const pathApi = treeType === 'vip' ? getVipPathExplain : getNormalPathExplain;

  const { data: rewardData, isLoading: rewardLoading } = useQuery({
    queryKey: [`${treeType}-tree-rewards`, node?.userId, rewardPage],
    queryFn: () => rewardApi(node!.userId, rewardPage, 10),
    enabled: !!node && !node.isSystemNode,
  });

  const { data: orderData, isLoading: orderLoading } = useQuery({
    queryKey: [`${treeType}-tree-orders`, node?.userId, orderPage],
    queryFn: () => orderApi(node!.userId, orderPage, 10),
    enabled: !!node && !node.isSystemNode && activeTab === 'orders',
  });

  // Phase 5: 路径解释查询
  const { data: pathData, isLoading: pathLoading } = useQuery({
    queryKey: [`${treeType}-path-explain`, node?.userId, selectedLedgerId],
    queryFn: () => pathApi(node!.userId, selectedLedgerId!),
    enabled: !!node && !node.isSystemNode && !!selectedLedgerId,
  });

  // Phase 5: 当 pathData 加载完成后通知 TreeViewer 高亮路径
  useEffect(() => {
    if (pathData && onHighlightPath) {
      onHighlightPath(
        pathData.path.map(p => p.userId),
        pathData.sourceUserId,
        pathData.recipientUserId,
      );
    }
  }, [pathData, onHighlightPath]);

  // Phase 5: 节点切换时重置路径状态并清除树画布高亮
  useEffect(() => {
    setRewardPage(1);
    setOrderPage(1);
    setSelectedLedgerId(null);
    setActiveTab('overview');
    onHighlightPath?.([], null, null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [node?.userId]);

  // ---------- 奖励记录表格列 ----------

  const rewardColumns = [
    {
      title: '类型',
      dataIndex: 'entryType',
      width: 60,
      render: (v: string) => {
        const m = ENTRY_TYPE_MAP[v] || { text: v, color: 'default' };
        return <Tag color={m.color}>{m.text}</Tag>;
      },
    },
    {
      title: '金额',
      dataIndex: 'amount',
      width: 80,
      render: (v: number) => `¥${v.toFixed(2)}`,
    },
    {
      title: '状态',
      dataIndex: 'status',
      width: 70,
      render: (v: string) => {
        const m = REWARD_STATUS_MAP[v] || { text: v, color: 'default' };
        return <Tag color={m.color}>{m.text}</Tag>;
      },
    },
    {
      title: '来源',
      dataIndex: 'sourceNickname',
      width: 80,
      ellipsis: true,
      render: (_: string | null, row: TreeRewardRecord) =>
        row.sourceNickname || row.sourceUserId || '-',
    },
    {
      title: '层级',
      dataIndex: 'layer',
      width: 50,
      render: (v: number | null) => (v != null ? `L${v}` : '-'),
    },
    {
      title: '时间',
      dataIndex: 'createdAt',
      width: 90,
      render: (v: string) => dayjs(v).format('MM-DD HH:mm'),
    },
    {
      title: '操作',
      key: 'action',
      width: 70,
      render: (_: any, record: TreeRewardRecord) => (
        <Button
          type="link"
          size="small"
          onClick={() => {
            setSelectedLedgerId(record.id);
            setActiveTab('path');
            // 如果 pathData 已缓存（同一条记录再次点击），立即通知高亮
            if (pathData && selectedLedgerId === record.id) {
              onHighlightPath?.(
                pathData.path.map(p => p.userId),
                pathData.sourceUserId,
                pathData.recipientUserId,
              );
            }
          }}
        >
          路径
        </Button>
      ),
    },
  ];

  // ---------- 空状态 ----------

  if (!node) {
    return (
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          height: '100%',
          minHeight: 400,
        }}
      >
        <Empty description="点击左侧节点查看详情" image={Empty.PRESENTED_IMAGE_SIMPLE} />
      </div>
    );
  }

  const st = STATUS_LABELS[node.status] || STATUS_LABELS.active;

  // ---------- Tab 1: 节点概况 ----------

  const overviewContent = (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* 用户信息卡片 */}
      <Card size="small" bordered={false} style={{ background: '#fafafa', borderRadius: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
          <div
            style={{
              width: 48,
              height: 48,
              borderRadius: '50%',
              background: `linear-gradient(135deg, ${themeColor}, ${themeColor}99)`,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#fff',
              fontSize: 20,
              fontWeight: 700,
              flexShrink: 0,
            }}
          >
            {node.isSystemNode ? node.userId : (node.nickname?.[0] || <UserOutlined />)}
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Text strong style={{ fontSize: 16 }}>
                {node.nickname || node.userId}
              </Text>
              <Tag color={st.color}>{st.text}</Tag>
              {node.isSystemNode && <Tag color="gold">系统节点</Tag>}
            </div>
            <Text type="secondary" style={{ fontSize: 12 }}>
              {node.phone || `ID: ${node.userId}`} · L{node.level}
            </Text>
          </div>
        </div>
      </Card>

      {/* 统计指标 */}
      <Row gutter={[12, 12]}>
        <Col span={12}>
          <Card size="small" bordered={false} style={{ borderRadius: 10, background: '#f6ffed' }}>
            <Statistic
              title={<Text type="secondary" style={{ fontSize: 12 }}>购买次数</Text>}
              value={node.selfPurchaseCount}
              prefix={<ShoppingOutlined style={{ color: '#389e0d' }} />}
              valueStyle={{ fontSize: 20, fontWeight: 700, color: '#389e0d' }}
            />
          </Card>
        </Col>
        <Col span={12}>
          <Card size="small" bordered={false} style={{ borderRadius: 10, background: '#fff7e6' }}>
            <Statistic
              title={<Text type="secondary" style={{ fontSize: 12 }}>累计收入</Text>}
              value={node.totalEarned}
              prefix={<DollarOutlined style={{ color: '#fa8c16' }} />}
              suffix="元"
              precision={2}
              valueStyle={{ fontSize: 20, fontWeight: 700, color: '#fa8c16' }}
            />
          </Card>
        </Col>
        <Col span={12}>
          <Card size="small" bordered={false} style={{ borderRadius: 10, background: '#fff1f0' }}>
            <Statistic
              title={<Text type="secondary" style={{ fontSize: 12 }}>冻结金额</Text>}
              value={node.frozenAmount}
              prefix={<LockOutlined style={{ color: '#cf1322' }} />}
              suffix="元"
              precision={2}
              valueStyle={{ fontSize: 20, fontWeight: 700, color: '#cf1322' }}
            />
          </Card>
        </Col>
        <Col span={12}>
          <Card size="small" bordered={false} style={{ borderRadius: 10, background: '#e6f4ff' }}>
            <Statistic
              title={<Text type="secondary" style={{ fontSize: 12 }}>子节点</Text>}
              value={node.childCount}
              prefix={<TeamOutlined style={{ color: '#1677ff' }} />}
              suffix="人"
              valueStyle={{ fontSize: 20, fontWeight: 700, color: '#1677ff' }}
            />
          </Card>
        </Col>
        {/* 普通树可用余额 */}
        {treeType === 'normal' && node.balance !== undefined && (
          <Col span={12}>
            <Card size="small" bordered={false} style={{ borderRadius: 10, background: '#f0f5ff' }}>
              <Statistic
                title={<Text type="secondary" style={{ fontSize: 12 }}>可用余额</Text>}
                value={node.balance}
                prefix={<DollarOutlined style={{ color: '#1677ff' }} />}
                suffix="元"
                precision={2}
                valueStyle={{ fontSize: 20, fontWeight: 700, color: '#1677ff' }}
              />
            </Card>
          </Col>
        )}
      </Row>

      {/* 详细信息 */}
      <Card
        size="small"
        title="详细信息"
        bordered={false}
        style={{ borderRadius: 12 }}
        styles={{ header: { fontSize: 13, fontWeight: 600, borderBottom: '1px solid #f0f0f0' } }}
      >
        <Descriptions column={1} size="small" labelStyle={{ color: '#8c8c8c', width: 80 }}>
          <Descriptions.Item label="用户 ID">
            {node.isSystemNode ? (
              <Text style={{ fontSize: 12 }}>系统平台根节点</Text>
            ) : (
              <Text copyable style={{ fontSize: 12 }}>{node.userId}</Text>
            )}
          </Descriptions.Item>
          <Descriptions.Item label="VIP 等级">
            {node.tier === 'VIP' ? (
              <Tag icon={<CrownOutlined />} color="green">VIP</Tag>
            ) : (
              <Tag>普通</Tag>
            )}
          </Descriptions.Item>
          <Descriptions.Item label="树层级">L{node.level}</Descriptions.Item>
          <Descriptions.Item label="手机号">{node.phone || '-'}</Descriptions.Item>
        </Descriptions>
      </Card>

      {/* 扩展信息 */}
      <Descriptions
        column={1}
        size="small"
        style={{ marginTop: 16 }}
        labelStyle={{ color: '#8c8c8c', fontSize: 12 }}
        contentStyle={{ fontSize: 12 }}
      >
        {/* 通用字段 */}
        <Descriptions.Item label="入树时间">
          {node.joinedTreeAt ? new Date(node.joinedTreeAt).toLocaleDateString('zh-CN') : '-'}
        </Descriptions.Item>
        <Descriptions.Item label="层级位置">
          L{node.level} · 第 {(node.position ?? 0) + 1} 位
        </Descriptions.Item>
        <Descriptions.Item label="已解锁层级">
          {node.unlockedLevel ?? 0} 层
        </Descriptions.Item>

        {/* VIP 特有字段 */}
        {treeType === 'vip' && (
          <>
            <Descriptions.Item label="所属根树">
              {node.rootId ?? '-'}
            </Descriptions.Item>
            <Descriptions.Item label="入树方式">
              <Tag color={node.entryMode === 'REFERRAL' ? 'blue' : node.entryMode === 'SYSTEM' ? 'gold' : 'default'}>
                {node.entryMode === 'REFERRAL' ? '推荐邀请'
                  : node.entryMode === 'SYSTEM' ? '系统节点'
                  : '无推荐人 · 系统自动分配'}
              </Tag>
            </Descriptions.Item>
            <Descriptions.Item label="推荐人">
              {node.referrerNickname || node.referrerUserId || '无'}
            </Descriptions.Item>
            {node.exitedAt && (
              <Descriptions.Item label="出局时间">
                <Text type="danger">{new Date(node.exitedAt).toLocaleDateString('zh-CN')}</Text>
              </Descriptions.Item>
            )}
          </>
        )}

        {/* 普通树特有字段 */}
        {treeType === 'normal' && (
          <>
            <Descriptions.Item label="奖励资格">
              {node.isSystemNode ? (
                <Tag color="gold">系统平台根</Tag>
              ) : node.normalRewardEligible ? (
                <Tag color="green">可接收奖励</Tag>
              ) : (
                <Tag color="red">已停止</Tag>
              )}
            </Descriptions.Item>
            {node.stoppedReason && (
              <Descriptions.Item label="停止原因">
                <Tag color={node.stoppedReason === 'UPGRADED_VIP' ? 'blue' : 'orange'}>
                  {node.stoppedReason === 'UPGRADED_VIP' ? '已升级 VIP · 停收普通奖励' : '冻结停收'}
                </Tag>
              </Descriptions.Item>
            )}
            {node.upgradedToVipAt && (
              <Descriptions.Item label="升级 VIP 时间">
                {new Date(node.upgradedToVipAt).toLocaleDateString('zh-CN')}
              </Descriptions.Item>
            )}
          </>
        )}
      </Descriptions>

      {/* 落位解释 */}
      <Card
        size="small"
        title={
          <Text style={{ fontSize: 13, fontWeight: 600 }}>
            {treeType === 'vip' ? '推荐落位说明' : '轮询落位说明'}
          </Text>
        }
        style={{ marginTop: 16, borderRadius: 8, background: '#fafafa' }}
        styles={{ body: { padding: '8px 12px', fontSize: 12 } }}
      >
        {treeType === 'vip' ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, color: '#595959' }}>
            {node.isSystemNode ? (
              <Text type="secondary">系统根节点 {node.rootId}，无需落位</Text>
            ) : node.entryMode === 'REFERRAL' ? (
              <>
                <div>该用户由 <Text strong>{node.referrerNickname || node.referrerUserId || '未知'}</Text> 推荐入树</div>
                <div>落入推荐人子树 L{node.level} 第 {(node.position ?? 0) + 1} 位（直挂或 BFS 滑落到子树空位）</div>
              </>
            ) : (
              <>
                <div>无推荐人，由系统自动分配</div>
                <div>通过 BFS 算法落入 L{node.level} 第 {(node.position ?? 0) + 1} 位</div>
              </>
            )}
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, color: '#595959' }}>
            {node.isSystemNode ? (
              <>
                <div>这是普通奖励树的平台根节点</div>
                <div>所有普通用户节点都从这里向下展开，便于整体查看树的顶部结构</div>
              </>
            ) : (
              <>
                <div>首次有效消费后自动入树</div>
                <div>按轮询平衡算法分配到 L{node.level} 第 {(node.position ?? 0) + 1} 位</div>
              </>
            )}
            {node.stoppedReason === 'UPGRADED_VIP' && (
              <div style={{ marginTop: 4 }}>
                <Tag color="blue" style={{ fontSize: 11 }}>已升级 VIP</Tag>
                <Text type="secondary" style={{ fontSize: 11 }}> 普通树位置保留，但不再接收普通奖励</Text>
              </div>
            )}
            {node.stoppedReason === 'FROZEN' && (
              <div style={{ marginTop: 4 }}>
                <Tag color="orange" style={{ fontSize: 11 }}>已冻结</Tag>
                <Text type="secondary" style={{ fontSize: 11 }}> 账户冻结，暂停接收普通奖励</Text>
              </div>
            )}
          </div>
        )}
      </Card>

      {/* 查看会员详情 */}
      {!node.isSystemNode && (
        <Button
          type="link"
          icon={<ExportOutlined />}
          onClick={() => navigate(`/bonus/members/${node.userId}`)}
        >
          查看会员详情 →
        </Button>
      )}
    </div>
  );

  // ---------- Tab 2: 奖励记录 ----------

  const rewardsContent = (
    <Table<TreeRewardRecord>
      rowKey="id"
      size="small"
      columns={rewardColumns}
      dataSource={rewardData?.items ?? []}
      loading={rewardLoading}
      pagination={{
        current: rewardPage,
        pageSize: 10,
        total: rewardData?.total ?? 0,
        simple: true,
        onChange: (p) => setRewardPage(p),
      }}
      locale={{ emptyText: <Empty description="暂无奖励记录" image={Empty.PRESENTED_IMAGE_SIMPLE} /> }}
    />
  );

  // ---------- Tab 3: 路径解释 ----------

  const pathContent = (
    <div key="path">
      {!selectedLedgerId ? (
        <Empty
          description="在「奖励记录」中点击「路径」按钮查看分配路径"
          image={Empty.PRESENTED_IMAGE_SIMPLE}
        />
      ) : pathLoading ? (
        <div style={{ textAlign: 'center', padding: 24 }}>
          <Spin tip="加载路径数据..." />
        </div>
      ) : pathData ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {/* 奖励概要 */}
          <Card size="small" style={{ borderRadius: 8, background: '#fafafa' }} styles={{ body: { padding: '8px 12px' } }}>
            <div style={{ fontSize: 12, display: 'flex', flexDirection: 'column', gap: 4 }}>
              <div>
                <Text type="secondary">消费用户：</Text>
                <Text strong>{pathData.sourceNickname || pathData.sourceUserId || '未知'}</Text>
              </div>
              <div>
                <Text type="secondary">第 </Text>
                <Text strong>{pathData.consumptionIndex ?? '?'}</Text>
                <Text type="secondary"> 次有效消费 → 上溯第 </Text>
                <Text strong>{pathData.consumptionIndex ?? '?'}</Text>
                <Text type="secondary"> 层祖辈</Text>
              </div>
              <div>
                <Text type="secondary">奖励金额：</Text>
                <Text strong style={{ color: '#fa8c16' }}>¥{pathData.rewardAmount.toFixed(2)}</Text>
              </div>
              <div>
                <Text type="secondary">状态：</Text>
                <Tag
                  color={
                    pathData.rewardStatus === 'AVAILABLE' ? 'green'
                    : pathData.rewardStatus === 'FROZEN' ? 'orange'
                    : pathData.rewardStatus === 'EXPIRED' ? 'default'
                    : pathData.rewardStatus === 'WITHDRAWN' ? 'blue'
                    : 'default'
                  }
                >
                  {pathData.rewardStatus === 'AVAILABLE' ? '已到账'
                    : pathData.rewardStatus === 'FROZEN' ? '冻结中'
                    : pathData.rewardStatus === 'EXPIRED' ? '已过期'
                    : pathData.rewardStatus === 'WITHDRAWN' ? '已提现'
                    : pathData.rewardStatus}
                </Tag>
              </div>
            </div>
          </Card>

          {/* 路径可视化 */}
          <Card
            size="small"
            title={<Text style={{ fontSize: 13, fontWeight: 600 }}>分配路径</Text>}
            style={{ borderRadius: 8 }}
            styles={{ body: { padding: '8px 12px' } }}
          >
            <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
              {pathData.path.map((p, i) => (
                <div key={p.userId}>
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                      padding: '6px 8px',
                      borderRadius: 6,
                      background: p.isSource
                        ? '#e6f4ff'
                        : p.isTarget
                          ? (themeColor || '#1E40AF') + '15'
                          : 'transparent',
                      border: p.isTarget ? `1px solid ${themeColor || '#1E40AF'}44` : '1px solid transparent',
                    }}
                  >
                    <div
                      style={{
                        width: 20,
                        height: 20,
                        borderRadius: '50%',
                        background: p.isSource ? '#1677ff' : p.isTarget ? (themeColor || '#1E40AF') : '#d9d9d9',
                        color: '#fff',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontSize: 10,
                        fontWeight: 700,
                        flexShrink: 0,
                      }}
                    >
                      {p.isSource ? '消' : p.isTarget ? '收' : i}
                    </div>
                    <div style={{ flex: 1, fontSize: 12 }}>
                      <Text strong>{p.nickname || p.userId}</Text>
                      <Text type="secondary" style={{ marginLeft: 6, fontSize: 11 }}>L{p.level}</Text>
                    </div>
                    {p.isSource && <Tag color="blue" style={{ margin: 0, fontSize: 10 }}>消费者</Tag>}
                    {p.isTarget && <Tag color="green" style={{ margin: 0, fontSize: 10 }}>接收者</Tag>}
                  </div>
                  {/* 连接箭头 */}
                  {i < pathData.path.length - 1 && (
                    <div style={{ display: 'flex', justifyContent: 'flex-start', paddingLeft: 17 }}>
                      <div style={{ width: 2, height: 12, background: '#d9d9d9' }} />
                    </div>
                  )}
                </div>
              ))}
            </div>
          </Card>

          {/* 命中结果 */}
          <Card size="small" style={{ borderRadius: 8, background: '#fffbe6' }} styles={{ body: { padding: '8px 12px' } }}>
            <div style={{ fontSize: 12 }}>
              <Text type="secondary">结果：</Text>
              <Text strong>{pathData.hitResult}</Text>
            </div>
          </Card>

          {/* 清除路径按钮 */}
          <Button
            size="small"
            onClick={() => {
              setSelectedLedgerId(null);
              onHighlightPath?.([], null, null);
            }}
          >
            清除路径高亮
          </Button>
        </div>
      ) : (
        <Empty description="无法获取路径数据" image={Empty.PRESENTED_IMAGE_SIMPLE} />
      )}
    </div>
  );

  // ---------- Tab 4: 关联订单 ----------

  const ordersContent = (
    <Table<TreeRelatedOrder>
      rowKey="orderId"
      size="small"
      loading={orderLoading}
      dataSource={orderData?.items ?? []}
      pagination={{
        current: orderData?.page ?? orderPage,
        pageSize: orderData?.pageSize ?? 10,
        total: orderData?.total ?? 0,
        size: 'small',
        onChange: setOrderPage,
      }}
      columns={[
        {
          title: '订单 ID',
          dataIndex: 'orderId',
          render: (v: string) => (
            <Button type="link" size="small" onClick={() => navigate(`/orders/${v}`)}>
              {v}
            </Button>
          ),
        },
        {
          title: '来源用户',
          dataIndex: 'sourceNickname',
          render: (_: string | null, row: TreeRelatedOrder) => row.sourceNickname || row.sourceUserId || '-',
        },
        {
          title: '累计奖励',
          dataIndex: 'totalReward',
          width: 100,
          render: (v: number) => `¥${v.toFixed(2)}`,
        },
        {
          title: '奖励笔数',
          dataIndex: 'entryCount',
          width: 90,
        },
        {
          title: '最新状态',
          dataIndex: 'latestStatus',
          width: 90,
          render: (v: string) => {
            const m = REWARD_STATUS_MAP[v] || { text: v, color: 'default' };
            return <Tag color={m.color}>{m.text}</Tag>;
          },
        },
        {
          title: '最新时间',
          dataIndex: 'latestCreatedAt',
          width: 110,
          render: (v: string) => dayjs(v).format('MM-DD HH:mm'),
        },
      ]}
      locale={{
        emptyText: (
          <Empty description="暂无关联订单" image={Empty.PRESENTED_IMAGE_SIMPLE} />
        ),
      }}
    />
  );

  // ---------- Render ----------

  const tabItems = node.isSystemNode
    ? [{ key: 'overview', label: '节点概况', children: overviewContent }]
    : [
        { key: 'overview', label: '节点概况', children: overviewContent },
        { key: 'rewards', label: '奖励记录', children: rewardsContent },
        { key: 'path', label: '路径解释', children: pathContent },
        { key: 'orders', label: '关联订单', children: ordersContent },
      ];

  return (
    <Tabs
      size="small"
      activeKey={activeTab}
      onChange={setActiveTab}
      items={tabItems}
    />
  );
};

export default NodeDetail;
