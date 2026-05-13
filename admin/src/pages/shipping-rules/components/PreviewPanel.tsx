import { useMemo, useState } from 'react';
import { App, Alert, Button, Card, Col, Descriptions, InputNumber, Row, Select, Space, Tag, Typography } from 'antd';
import { SearchOutlined } from '@ant-design/icons';
import { previewRule } from '@/api/shipping-rules';
import type { ShippingPreview } from '@/api/shipping-rules';
import { SHIPPING_REGION_OPTIONS, formatRuleRegionCode } from '../regions';

const { Text } = Typography;

const formatRegion = (regionCode?: string) => {
  if (!regionCode) return '未指定';
  return formatRuleRegionCode(regionCode);
};

export default function PreviewPanel() {
  const { message } = App.useApp();
  const [goodsAmount, setGoodsAmount] = useState<number>(100);
  const [regionCode, setRegionCode] = useState<string>('');
  const [totalWeight, setTotalWeight] = useState<number>(1);
  const [result, setResult] = useState<ShippingPreview | null>(null);
  const [loading, setLoading] = useState(false);

  const resultInput = useMemo(() => result?.input, [result]);

  const handlePreview = async () => {
    setLoading(true);
    try {
      const data = await previewRule({
        goodsAmount,
        regionCode: regionCode || undefined,
        totalWeight,
      });
      setResult(data);
    } catch (err) {
      message.error(err instanceof Error ? err.message : '预览失败');
      setResult(null);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Card title="运费预览测试" style={{ marginTop: 16 }}>
      <Row gutter={[12, 12]} align="bottom">
        <Col xs={24} sm={8} md={6} lg={5}>
          <Text type="secondary" style={{ display: 'block', marginBottom: 4, fontSize: 12 }}>
            商品金额（元）
          </Text>
          <InputNumber
            value={goodsAmount}
            onChange={(value) => setGoodsAmount(value ?? 0)}
            min={0}
            step={10}
            precision={2}
            style={{ width: '100%' }}
          />
        </Col>
        <Col xs={24} sm={8} md={6} lg={5}>
          <Text type="secondary" style={{ display: 'block', marginBottom: 4, fontSize: 12 }}>
            省份/地区
          </Text>
          <Select
            value={regionCode || undefined}
            onChange={(value) => setRegionCode(value || '')}
            placeholder="选择省份"
            allowClear
            showSearch
            optionFilterProp="label"
            options={SHIPPING_REGION_OPTIONS}
            style={{ width: '100%' }}
          />
        </Col>
        <Col xs={24} sm={8} md={6} lg={5}>
          <Text type="secondary" style={{ display: 'block', marginBottom: 4, fontSize: 12 }}>
            整单重量（kg）
          </Text>
          <InputNumber
            value={totalWeight}
            onChange={(value) => setTotalWeight(value ?? 0)}
            min={0}
            step={0.5}
            precision={2}
            style={{ width: '100%' }}
          />
        </Col>
        <Col xs={24} sm={8} md={6} lg={4}>
          <Button type="primary" icon={<SearchOutlined />} loading={loading} onClick={handlePreview}>
            测试
          </Button>
        </Col>
      </Row>

      {result?.fallbackUsed && (
        <Alert
          type="warning"
          showIcon
          style={{ marginTop: 16 }}
          message="未命中启用规则，当前结果来自 DEFAULT_SHIPPING_FEE 兜底配置"
        />
      )}

      {result && (
        <Descriptions bordered size="small" column={3} style={{ marginTop: 16 }}>
          <Descriptions.Item label="运费">
            <span style={{ fontSize: 18, fontWeight: 600, color: '#1677ff' }}>
              ¥{Number(result.fee || 0).toFixed(2)}
            </span>
          </Descriptions.Item>
          <Descriptions.Item label="命中规则">
            {result.matchedRule ? (
              <Space size={4}>
                <Tag color="blue">{result.matchedRule.name}</Tag>
                <Text type="secondary">{result.matchedRule.id}</Text>
              </Space>
            ) : (
              <Tag color="orange">兜底配置</Tag>
            )}
          </Descriptions.Item>
          <Descriptions.Item label="计费重量">
            {typeof result.billingWeightKg === 'number' ? `${result.billingWeightKg.toFixed(2)}kg` : '-'}
          </Descriptions.Item>
          <Descriptions.Item label="输入金额">
            ¥{Number(resultInput?.goodsAmount || 0).toFixed(2)}
          </Descriptions.Item>
          <Descriptions.Item label="输入地区">
            {formatRegion(resultInput?.regionCode)}
          </Descriptions.Item>
          <Descriptions.Item label="输入重量">
            {typeof resultInput?.totalWeight === 'number' ? `${resultInput.totalWeight.toFixed(2)}kg` : '未指定'}
          </Descriptions.Item>
          <Descriptions.Item label="计算公式" span={3}>
            <Text code>{result.formula || '-'}</Text>
          </Descriptions.Item>
        </Descriptions>
      )}
    </Card>
  );
}
