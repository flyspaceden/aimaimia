import { Card, Col, Row, Table, Statistic } from 'antd';
import { useQuery } from '@tanstack/react-query';
import { getOverview, getSalesTrend, getProductRanking, getOrderStats } from '@/api/analytics';
import { orderStatusMap } from '@/constants/statusMaps';
import { Line, Pie } from '@ant-design/charts';

export default function AnalyticsPage() {
  const { data: overview } = useQuery({
    queryKey: ['seller-analytics-overview'],
    queryFn: getOverview,
  });

  const { data: salesTrend } = useQuery({
    queryKey: ['seller-analytics-trend'],
    queryFn: () => getSalesTrend(30),
  });

  const { data: ranking } = useQuery({
    queryKey: ['seller-analytics-ranking'],
    queryFn: () => getProductRanking(10),
  });

  const { data: orderStats } = useQuery({
    queryKey: ['seller-analytics-orders'],
    queryFn: getOrderStats,
  });

  return (
    <div>
      {/* 月度概览 */}
      <Row gutter={16} style={{ marginBottom: 24 }}>
        <Col span={6}>
          <Card><Statistic title="本月订单" value={overview?.month.orderCount || 0} /></Card>
        </Col>
        <Col span={6}>
          <Card><Statistic title="本月销售额" value={overview?.month.revenue || 0} precision={2} suffix="元" /></Card>
        </Col>
        <Col span={6}>
          <Card><Statistic title="换货率" value={(overview?.month.replacementRate || 0) * 100} precision={1} suffix="%" /></Card>
        </Col>
        <Col span={6}>
          <Card><Statistic title="总销售额" value={overview?.total.totalRevenue || 0} precision={2} suffix="元" /></Card>
        </Col>
      </Row>

      <Row gutter={16} style={{ marginBottom: 24 }}>
        {/* 销售趋势 */}
        <Col span={14}>
          <Card title="近 30 天销售趋势">
            {salesTrend && salesTrend.length > 0 ? (
              <Line
                data={salesTrend}
                xField="date"
                yField="revenue"
                height={300}
                smooth
                point={{ size: 3 }}
                yAxis={{ label: { formatter: (v: string) => `¥${v}` } }}
              />
            ) : (
              <div style={{ textAlign: 'center', padding: '80px 0', color: '#999' }}>暂无数据</div>
            )}
          </Card>
        </Col>

        {/* 订单分布 */}
        <Col span={10}>
          <Card title="订单状态分布">
            {orderStats && orderStats.length > 0 ? (
              <Pie
                data={orderStats.map((s) => ({
                  type: orderStatusMap[s.status]?.text || s.status,
                  value: s.count,
                }))}
                angleField="value"
                colorField="type"
                height={300}
                innerRadius={0.6}
                label={{ type: 'spider' }}
              />
            ) : (
              <div style={{ textAlign: 'center', padding: '80px 0', color: '#999' }}>暂无数据</div>
            )}
          </Card>
        </Col>
      </Row>

      {/* 商品排行 */}
      <Card title="商品销售排行 TOP 10">
        <Table
          dataSource={ranking || []}
          rowKey="productId"
          pagination={false}
          columns={[
            { title: '排名', render: (_, __, i) => i + 1, width: 60 },
            { title: '商品名称', dataIndex: 'title', ellipsis: true },
            { title: '销量', dataIndex: 'totalSold', width: 100 },
            {
              title: '销售额',
              dataIndex: 'totalRevenue',
              width: 120,
              render: (v: number) => `¥${v.toFixed(2)}`,
            },
          ]}
        />
      </Card>
    </div>
  );
}
