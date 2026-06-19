import { useState } from 'react';
import { Tabs, Typography } from 'antd';
import {
  GiftOutlined,
  SendOutlined,
  CheckCircleOutlined,
  BarChartOutlined,
} from '@ant-design/icons';
import CampaignListPage from './campaigns';
import CouponInstancesPage from './instances';
import CouponUsagePage from './usage';
import CouponStatsPage from './stats';

const { Title, Text } = Typography;

/** 红包管理 — Tab 聚合页 */
export default function CouponManagementPage() {
  const [activeKey, setActiveKey] = useState('campaigns');

  return (
    <div style={{ padding: 24 }}>
      {/* 页面标题 */}
      <div style={{ marginBottom: 16 }}>
        <Title level={4} style={{ margin: 0 }}>红包管理</Title>
        <Text type="secondary" style={{ fontSize: 13 }}>
          管理红包活动生命周期、发放明细、核销记录与效果统计
        </Text>
      </div>

      <Tabs
        activeKey={activeKey}
        onChange={setActiveKey}
        type="card"
        size="large"
        destroyInactiveTabPane
        items={[
          {
            key: 'campaigns',
            label: (
              <span><GiftOutlined /> 红包活动</span>
            ),
            children: <CampaignListPage />,
          },
          {
            key: 'instances',
            label: (
              <span><SendOutlined /> 发放记录</span>
            ),
            children: <CouponInstancesPage />,
          },
          {
            key: 'usage',
            label: (
              <span><CheckCircleOutlined /> 使用记录</span>
            ),
            children: <CouponUsagePage />,
          },
          {
            key: 'stats',
            label: (
              <span><BarChartOutlined /> 统计</span>
            ),
            children: <CouponStatsPage />,
          },
        ]}
      />
    </div>
  );
}
