import { Card, Col, Row, Statistic, Spin, Empty } from 'antd';
import {
  TagsOutlined,
  ThunderboltOutlined,
  SendOutlined,
  CheckCircleOutlined,
  DollarOutlined,
  PercentageOutlined,
} from '@ant-design/icons';
import { useQuery } from '@tanstack/react-query';
import { Column, Pie } from '@ant-design/charts';
import { getCouponStats } from '@/api/coupon';
import type { CouponStats } from '@/api/coupon';

export default function CouponStatsPage() {
  const { data: stats, isLoading } = useQuery<CouponStats>({
    queryKey: ['coupon-stats'],
    queryFn: getCouponStats,
  });

  if (isLoading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: 400 }}>
        <Spin size="large" />
      </div>
    );
  }

  if (!stats) {
    return (
      <div>
        <Empty description="暂无统计数据" />
      </div>
    );
  }

  // 近7天发放/使用趋势柱状图数据
  const trendData = (stats.dailyTrend || []).flatMap((d) => [
    { date: d.date, value: d.issued, type: '发放' },
    { date: d.date, value: d.used, type: '使用' },
  ]);

  // 各活动使用率对比数据
  const usageRateData = (stats.campaignUsageRates || []).map((d) => ({
    name: d.name,
    usageRate: Math.round(d.usageRate),
  }));

  // 抵扣金额分布饼图数据
  const discountDistData = (stats.discountDistribution || []).map((d) => ({
    type: d.type,
    value: d.amount,
  }));

  return (
    <div>
      {/* KPI 指标卡片 */}
      <Row gutter={[16, 16]} style={{ marginBottom: 24 }}>
        <Col xs={12} sm={8} lg={4}>
          <Card>
            <Statistic
              title="活动总数"
              value={stats.totalCampaigns}
              prefix={<TagsOutlined />}
            />
          </Card>
        </Col>
        <Col xs={12} sm={8} lg={4}>
          <Card>
            <Statistic
              title="进行中活动"
              value={stats.activeCampaigns}
              prefix={<ThunderboltOutlined />}
              valueStyle={{ color: '#52c41a' }}
            />
          </Card>
        </Col>
        <Col xs={12} sm={8} lg={4}>
          <Card>
            <Statistic
              title="总发放量"
              value={stats.totalIssued}
              prefix={<SendOutlined />}
            />
          </Card>
        </Col>
        <Col xs={12} sm={8} lg={4}>
          <Card>
            <Statistic
              title="总使用量"
              value={stats.totalUsed}
              prefix={<CheckCircleOutlined />}
              valueStyle={{ color: '#1890ff' }}
            />
          </Card>
        </Col>
        <Col xs={12} sm={8} lg={4}>
          <Card>
            <Statistic
              title="总抵扣金额"
              value={stats.totalDiscountAmount}
              precision={2}
              prefix={<DollarOutlined />}
              valueStyle={{ color: '#f5222d' }}
              suffix="元"
            />
          </Card>
        </Col>
        <Col xs={12} sm={8} lg={4}>
          <Card>
              <Statistic
                title="平均使用率"
                value={Math.round(stats.avgUsageRate ?? stats.usageRate ?? 0)}
                prefix={<PercentageOutlined />}
                suffix="%"
                valueStyle={{ color: '#722ed1' }}
              />
          </Card>
        </Col>
      </Row>

      {/* 图表区域 */}
      <Row gutter={[16, 16]}>
        {/* 近7天发放/使用趋势 */}
        <Col xs={24} lg={14}>
          <Card title="近7天发放/使用趋势">
            {trendData.length > 0 ? (
              <Column
                data={trendData}
                xField="date"
                yField="value"
                colorField="type"
                group
                height={320}
                style={{ fill: (_: unknown, idx: number) => idx % 2 === 0 ? '#1890ff' : '#52c41a' }}
                label={{
                  text: 'value',
                  position: 'top' as const,
                  style: { fontSize: 11 },
                }}
                legend={{ color: { position: 'top-right' as const } }}
                axis={{
                  x: {
                    labelFormatter: (v: string) => typeof v === 'string' ? v.slice(5) : v,
                  },
                }}
              />
            ) : (
              <Empty description="暂无趋势数据" style={{ minHeight: 320, display: 'flex', alignItems: 'center', justifyContent: 'center' }} />
            )}
          </Card>
        </Col>

        {/* 抵扣金额分布 */}
        <Col xs={24} lg={10}>
          <Card title="抵扣金额分布">
            {discountDistData.length > 0 ? (
              <Pie
                data={discountDistData}
                angleField="value"
                colorField="type"
                radius={0.85}
                innerRadius={0.5}
                height={320}
                label={{
                  text: 'type',
                  position: 'outside' as const,
                  style: { fontSize: 12 },
                }}
                tooltip={{
                  title: 'type',
                }}
                legend={{ color: { position: 'bottom' as const } }}
              />
            ) : (
              <Empty description="暂无分布数据" style={{ minHeight: 320, display: 'flex', alignItems: 'center', justifyContent: 'center' }} />
            )}
          </Card>
        </Col>

        {/* 各活动使用率对比 */}
        <Col span={24}>
          <Card title="各活动使用率对比">
            {usageRateData.length > 0 ? (
              <Column
                data={usageRateData}
                xField="name"
                yField="usageRate"
                height={300}
                style={{ fill: '#722ed1' }}
                label={{
                  text: (d: Record<string, unknown>) =>
                    d.usageRate !== undefined ? `${d.usageRate}%` : '',
                  position: 'top' as const,
                  style: { fontSize: 11 },
                }}
                axis={{
                  y: {
                    labelFormatter: (v: number) => `${v}%`,
                    max: 100,
                  },
                  x: {
                    labelAutoRotate: true,
                    labelAutoHide: false,
                  },
                }}
              />
            ) : (
              <Empty description="暂无活动数据" style={{ minHeight: 300, display: 'flex', alignItems: 'center', justifyContent: 'center' }} />
            )}
          </Card>
        </Col>
      </Row>
    </div>
  );
}
