import { Card, Row, Col, Statistic, Spin, Typography } from 'antd';
import {
  MessageOutlined,
  RobotOutlined,
  ClockCircleOutlined,
  SmileOutlined,
  TeamOutlined,
} from '@ant-design/icons';
import { useQuery } from '@tanstack/react-query';
import { getCsStats } from '@/api/cs';

const { Title } = Typography;

const STAT_CARDS = [
  {
    key: 'totalSessions' as const,
    title: '今日会话',
    icon: <MessageOutlined />,
    color: '#1677ff',
    suffix: '次',
  },
  {
    key: 'aiResolveRate' as const,
    title: 'AI解决率',
    icon: <RobotOutlined />,
    color: '#52c41a',
    suffix: '%',
    precision: 1,
  },
  {
    key: 'agentHandled' as const,
    title: '平均响应',
    icon: <ClockCircleOutlined />,
    color: '#faad14',
    suffix: 's',
  },
  {
    key: 'avgRating' as const,
    title: '满意度评分',
    icon: <SmileOutlined />,
    color: '#722ed1',
    suffix: '',
    precision: 1,
  },
  {
    key: 'queueCount' as const,
    title: '排队等待',
    icon: <TeamOutlined />,
    color: '#ff4d4f',
    suffix: '人',
  },
];

export default function CsDashboardPage() {
  const { data: stats, isLoading } = useQuery({
    queryKey: ['admin', 'cs', 'stats'],
    queryFn: getCsStats,
    refetchInterval: 30000, // 每30秒自动刷新
  });

  if (isLoading) {
    return (
      <div style={{ textAlign: 'center', padding: 60 }}>
        <Spin size="large" />
      </div>
    );
  }

  return (
    <div style={{ padding: 24 }}>
      <Title level={4} style={{ marginBottom: 24 }}>客服数据看板</Title>

      <Row gutter={[16, 16]}>
        {STAT_CARDS.map((card) => (
          <Col key={card.key} xs={24} sm={12} md={8} lg={4} xl={4}>
            <Card
              hoverable
              style={{ borderTop: `3px solid ${card.color}` }}
            >
              <Statistic
                title={
                  <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ color: card.color }}>{card.icon}</span>
                    {card.title}
                  </span>
                }
                value={stats?.[card.key] ?? 0}
                precision={card.precision}
                suffix={card.suffix}
                valueStyle={{ color: card.color, fontSize: 28 }}
              />
            </Card>
          </Col>
        ))}
      </Row>
    </div>
  );
}
