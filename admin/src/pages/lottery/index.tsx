import { useRef, useState, useMemo, useCallback, useEffect } from 'react';
import {
  ProTable,
  ProFormText,
  ProFormDigit,
  StepsForm,
} from '@ant-design/pro-components';
import type { ActionType, ProColumns, ProFormInstance } from '@ant-design/pro-components';
import {
  Button,
  Tag,
  message,
  Modal,
  Tabs,
  Card,
  Statistic,
  Row,
  Col,
  Table,
  InputNumber,
  Slider,
  Space,
  Popconfirm,
  Form,
  Tooltip,
  Alert,
  Drawer,
  Radio,
  Progress,
  Typography,
  Image,
  Switch,
} from 'antd';
import {
  PlusOutlined,
  EditOutlined,
  DeleteOutlined,
  LockOutlined,
  UnlockOutlined,
  TrophyOutlined,
  UnorderedListOutlined,
  BarChartOutlined,
  TagOutlined,
  GiftOutlined,
  StopOutlined,
} from '@ant-design/icons';
import { Pie } from '@ant-design/charts';
import {
  getPrizes,
  createPrize,
  updatePrize,
  deletePrize,
  batchUpdateProbabilities,
  getDrawRecords,
  getLotteryStats,
} from '@/api/lottery';
import type { Prize, DrawRecord, LotteryStats, LotteryPrizeType } from '@/api/lottery';
import PermissionGate from '@/components/PermissionGate';
import RewardProductPicker from '@/components/RewardProductPicker';
import { PERMISSIONS } from '@/constants/permissions';
import { useQuery } from '@tanstack/react-query';
import dayjs from 'dayjs';

const prizeTypeMap: Record<string, { text: string; color: string }> = {
  DISCOUNT_BUY: { text: '低价购', color: 'blue' },
  THRESHOLD_GIFT: { text: '满额赠', color: 'green' },
  NO_PRIZE: { text: '谢谢参与', color: 'default' },
};

const drawResultMap: Record<string, { text: string; color: string }> = {
  WON: { text: '中奖', color: 'gold' },
  NO_PRIZE: { text: '未中奖', color: 'default' },
};

// 批量编辑数据项类型
interface BatchProbItem {
  id: string;
  name: string;
  type: LotteryPrizeType;
  probability: number;
  locked: boolean;
}

// 饼图颜色映射
const pieColorMap: Record<string, string> = {
  DISCOUNT_BUY: '#1890ff',
  THRESHOLD_GIFT: '#52c41a',
  NO_PRIZE: '#bfbfbf',
};

/**
 * 自动平衡算法：拖动一个奖品的概率时，按比例分摊差值到其他未锁定奖品
 * 返回新的 items 数组，总和精确 100%
 */
function rebalance(items: BatchProbItem[], changedIndex: number, newValue: number): BatchProbItem[] {
  const next = items.map((item) => ({ ...item }));
  const clamped = Math.min(100, Math.max(0, newValue));
  const oldValue = next[changedIndex].probability;
  const delta = clamped - oldValue;

  if (Math.abs(delta) < 0.001) {
    next[changedIndex].probability = clamped;
    return next;
  }

  // 找出可调整的其他未锁定奖品（排除当前正在拖动的）
  const adjustableIndices = next
    .map((_, i) => i)
    .filter((i) => i !== changedIndex && !next[i].locked);

  if (adjustableIndices.length === 0) {
    // 无可调整项，不允许变化
    return items;
  }

  // 先设置当前项的新值
  next[changedIndex].probability = clamped;

  // 可调整项的当前概率总和
  const adjustableSum = adjustableIndices.reduce((s, i) => s + next[i].probability, 0);

  if (adjustableIndices.length === 1) {
    // 只有一个可调整项，直接吸收全部 delta
    const idx = adjustableIndices[0];
    next[idx].probability = Math.max(0, Math.min(100, next[idx].probability - delta));
  } else if (adjustableSum > 0.001) {
    // 按当前比例分摊 delta
    let remaining = delta;
    for (let k = 0; k < adjustableIndices.length - 1; k++) {
      const idx = adjustableIndices[k];
      const ratio = next[idx].probability / adjustableSum;
      const share = Math.round(delta * ratio * 100) / 100;
      const newProb = Math.max(0, Math.min(100, next[idx].probability - share));
      remaining -= (next[idx].probability - newProb);
      next[idx].probability = newProb;
    }
    // 最后一项吸收浮点误差
    const lastIdx = adjustableIndices[adjustableIndices.length - 1];
    next[lastIdx].probability = Math.max(0, Math.min(100, next[lastIdx].probability - remaining));
  } else {
    // 所有可调整项概率为 0
    if (delta > 0) {
      // 无法从 0 概率项中扣减，阻止此次变化
      return items;
    }
    // delta < 0：减少了当前项，将释放的概率均匀分配
    const perItem = Math.round((-delta / adjustableIndices.length) * 100) / 100;
    for (let k = 0; k < adjustableIndices.length - 1; k++) {
      next[adjustableIndices[k]].probability = perItem;
    }
    // 最后一项吸收余额
    const allocated = perItem * (adjustableIndices.length - 1);
    const lastIdx = adjustableIndices[adjustableIndices.length - 1];
    next[lastIdx].probability = Math.round((-delta - allocated) * 100) / 100;
  }

  // 精度修正：四舍五入到两位小数，最后一项吸收误差
  for (const item of next) {
    item.probability = Math.round(item.probability * 100) / 100;
  }
  const totalAfterRound = next.reduce((s, item) => s + item.probability, 0);
  const diff = Math.round((100 - totalAfterRound) * 100) / 100;
  if (Math.abs(diff) > 0.001) {
    // 从未锁定项中找最后一个吸收
    const lastAdjustable = adjustableIndices[adjustableIndices.length - 1];
    next[lastAdjustable].probability = Math.round((next[lastAdjustable].probability + diff) * 100) / 100;
  }

  return next;
}

/** 智能概率编辑器组件 */
function SmartProbabilityEditor({
  items,
  onChange,
}: {
  items: BatchProbItem[];
  onChange: (items: BatchProbItem[]) => void;
}) {
  const unlockedCount = items.filter((d) => !d.locked).length;

  // 切换锁定状态
  const handleToggleLock = useCallback(
    (index: number) => {
      const item = items[index];
      if (!item.locked) {
        // 要锁定：检查是否至少保留 2 个未锁定
        if (unlockedCount <= 2) {
          message.warning('至少保留 2 个未锁定奖品，否则无法自动平衡');
          return;
        }
      }
      const next = items.map((d, i) => (i === index ? { ...d, locked: !d.locked } : d));
      onChange(next);
    },
    [items, onChange, unlockedCount],
  );

  // 滑块变化
  const handleSliderChange = useCallback(
    (index: number, value: number) => {
      if (items[index].locked) return;
      const newItems = rebalance(items, index, value);
      onChange(newItems);
    },
    [items, onChange],
  );

  // 饼图数据
  const pieData = useMemo(
    () =>
      items.map((d) => ({
        name: d.name,
        value: Math.round(d.probability * 100) / 100,
        type: d.type,
      })),
    [items],
  );

  const pieConfig = useMemo(
    () => ({
      data: pieData,
      angleField: 'value',
      colorField: 'name',
      radius: 0.85,
      innerRadius: 0.5,
      label: {
        text: 'value',
        formatter: (v: number) => `${v}%`,
        position: 'outside' as const,
        style: { fontSize: 11 },
      },
      tooltip: {
        title: 'name',
      },
      legend: false as const,
      scale: {
        color: {
          range: pieData.map((d) => pieColorMap[d.type] || '#d9d9d9'),
        },
      },
      animate: false,
      height: 280,
    }),
    [pieData],
  );

  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 24 }}>
      {/* 左侧：奖品滑块列表 - 响应式宽度 */}
      <div style={{ flex: '1 1 420px', minWidth: 0, maxHeight: 480, overflowY: 'auto' }}>
        <div style={{ fontSize: 13, color: '#8c8c8c', marginBottom: 12, paddingLeft: 4 }}>
          拖动滑块调整概率，点击锁图标锁定/解锁。未锁定项会自动平衡至总和 100%。
        </div>
        {items.map((item, index) => (
          <div
            key={item.id}
            style={{
              padding: '10px 14px',
              marginBottom: 8,
              background: item.locked ? '#fafafa' : '#fff',
              borderRadius: 8,
              border: `1px solid ${item.locked ? '#f0f0f0' : '#e8e8e8'}`,
              transition: 'border-color 0.2s, box-shadow 0.2s',
            }}
          >
            {/* 奖品名称行 */}
            <div style={{ display: 'flex', alignItems: 'center', marginBottom: 6 }}>
              <Tooltip title={item.locked ? '点击解锁' : '点击锁定'}>
                <Button
                  type="text"
                  size="small"
                  icon={item.locked ? <LockOutlined style={{ color: '#faad14' }} /> : <UnlockOutlined style={{ color: '#52c41a' }} />}
                  onClick={() => handleToggleLock(index)}
                  style={{ marginRight: 8 }}
                />
              </Tooltip>
              <Tag color={prizeTypeMap[item.type]?.color} style={{ marginRight: 8 }}>
                {prizeTypeMap[item.type]?.text}
              </Tag>
              <span style={{ fontSize: 13, fontWeight: 500, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {item.name}
              </span>
              <span style={{ fontSize: 13, fontWeight: 600, color: pieColorMap[item.type] || '#999', minWidth: 56, textAlign: 'right' }}>
                {item.probability.toFixed(1)}%
              </span>
            </div>
            {/* 滑块 + 数值 */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, paddingLeft: 32 }}>
              <Slider
                style={{ flex: 1 }}
                min={0}
                max={100}
                step={0.5}
                value={item.probability}
                disabled={item.locked}
                onChange={(v) => handleSliderChange(index, v)}
                tooltip={{ formatter: (v) => (v !== undefined ? `${v.toFixed(2)}%` : '') }}
                styles={{
                  track: { background: item.locked ? '#d9d9d9' : (pieColorMap[item.type] || '#1890ff') },
                  rail: { background: '#f0f0f0' },
                }}
              />
              <InputNumber
                min={0}
                max={100}
                step={0.5}
                precision={2}
                value={item.probability}
                disabled={item.locked}
                style={{ width: 86 }}
                onChange={(v) => v !== null && handleSliderChange(index, v)}
                formatter={(v) => (v !== undefined ? `${v}%` : '')}
                parser={(v) => parseFloat(v?.replace('%', '') || '0') as any}
              />
            </div>
          </div>
        ))}
      </div>

      {/* 右侧：饼图预览 - 响应式，窄屏时堆叠到下方 */}
      <div style={{ flex: '1 1 280px', minWidth: 240, display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
        <div style={{ fontSize: 13, fontWeight: 500, color: '#595959', marginBottom: 8, alignSelf: 'flex-start' }}>
          概率分布预览
        </div>
        <div style={{ width: '100%', minHeight: 280 }}>
          {items.length > 0 && <Pie {...pieConfig} />}
        </div>
        {/* 图例说明 */}
        <div style={{ marginTop: 12, width: '100%' }}>
          {items.map((d) => (
            <div key={d.id} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6, fontSize: 12 }}>
              <span
                style={{
                  display: 'inline-block',
                  width: 12,
                  height: 12,
                  borderRadius: 3,
                  background: pieColorMap[d.type] || '#d9d9d9',
                  flexShrink: 0,
                }}
              />
              <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {d.name}
              </span>
              <span style={{ color: '#595959', fontWeight: 500 }}>{d.probability.toFixed(2)}%</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// 奖品类型卡片配置
const prizeTypeCards: Array<{
  value: LotteryPrizeType;
  label: string;
  description: string;
  icon: React.ReactNode;
  color: string;
}> = [
  {
    value: 'DISCOUNT_BUY',
    label: '折扣购买',
    description: '用户以优惠价格购买商品',
    icon: <TagOutlined style={{ fontSize: 28 }} />,
    color: '#1890ff',
  },
  {
    value: 'THRESHOLD_GIFT',
    label: '消费赠品',
    description: '满足消费门槛即可获赠',
    icon: <GiftOutlined style={{ fontSize: 28 }} />,
    color: '#52c41a',
  },
  {
    value: 'NO_PRIZE',
    label: '谢谢参与',
    description: '未中奖，感谢参与抽奖',
    icon: <StopOutlined style={{ fontSize: 28 }} />,
    color: '#bfbfbf',
  },
];

/** 构建提交 payload（新增和编辑共用） */
function buildPrizePayload(values: any) {
  const pickerValue = values._productPicker as
    | { productId?: string; skuId?: string }
    | undefined;
  return {
    name: values.name,
    type: values.type,
    probability: values.probability,
    productId: pickerValue?.productId || undefined,
    skuId: pickerValue?.skuId || undefined,
    prizePrice: values.type === 'THRESHOLD_GIFT' ? 0 : values.prizePrice,
    originalPrice: undefined,
    threshold: values.type === 'THRESHOLD_GIFT' ? values.threshold : undefined,
    prizeQuantity: values.prizeQuantity,
    dailyLimit: values.dailyLimit,
    totalLimit: values.totalLimit,
    sortOrder: values.sortOrder,
    expirationHours: values.expirationHours,
    isActive: values.isActive,
  };
}

/** 奖品类型选择卡片 + 概率输入（新增和编辑共用） */
function PrizeTypeFields({
  probValue,
  onTypeChange,
  onProbChange,
}: {
  selectedType?: LotteryPrizeType;
  probValue: number;
  onTypeChange: (t: LotteryPrizeType) => void;
  onProbChange: (v: number) => void;
}) {
  return (
    <>
      <ProFormText
        name="name"
        label="奖品名称"
        placeholder="请输入奖品名称"
        rules={[{ required: true, message: '请输入奖品名称' }]}
        fieldProps={{ maxLength: 50 }}
      />
      <Form.Item
        name="type"
        label="奖品类型"
        rules={[{ required: true, message: '请选择奖品类型' }]}
      >
        <Radio.Group style={{ width: '100%' }} onChange={(e) => onTypeChange(e.target.value)}>
          <div style={{ display: 'flex', gap: 12 }}>
            {prizeTypeCards.map((card) => (
              <Radio.Button
                key={card.value}
                value={card.value}
                style={{ height: 'auto', flex: 1, padding: 0, borderRadius: 8, overflow: 'hidden' }}
              >
                <div style={{ padding: '16px 12px', textAlign: 'center', minHeight: 110, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
                  <span style={{ color: card.color }}>{card.icon}</span>
                  <Typography.Text strong style={{ fontSize: 14 }}>{card.label}</Typography.Text>
                  <Typography.Text type="secondary" style={{ fontSize: 11, lineHeight: '16px' }}>{card.description}</Typography.Text>
                </div>
              </Radio.Button>
            ))}
          </div>
        </Radio.Group>
      </Form.Item>
      <Form.Item label="中奖概率(%)" required style={{ marginBottom: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <Form.Item name="probability" noStyle rules={[{ required: true, message: '请输入概率' }]}>
            <InputNumber min={0} max={100} step={0.01} precision={2} style={{ width: 120 }}
              formatter={(v) => (v !== undefined ? `${v}%` : '')}
              parser={(v) => parseFloat(v?.replace('%', '') || '0') as any}
              onChange={(v) => { if (v !== null) onProbChange(v); }}
            />
          </Form.Item>
          <div style={{ flex: 1 }}>
            <Progress percent={Math.min(100, Math.max(0, probValue))} size="small"
              format={(p) => `${(p ?? 0).toFixed(1)}%`}
              strokeColor={probValue > 50 ? '#52c41a' : probValue > 20 ? '#faad14' : '#1890ff'}
            />
          </div>
        </div>
        <Typography.Text type="secondary" style={{ fontSize: 12, marginTop: 4, display: 'block' }}>
          保存后其他奖品概率将自动按比例调整，保持总和 100%
        </Typography.Text>
      </Form.Item>
    </>
  );
}

/** 商品与定价字段（新增和编辑共用） */
function ProductPricingFields({ selectedType }: { selectedType?: LotteryPrizeType }) {
  if (selectedType === 'NO_PRIZE') return null;
  return (
    <>
      <Form.Item
        name="_productPicker"
        label="关联奖励商品"
        rules={[{
          validator: async (_, val) => {
            if ((selectedType as string) === 'NO_PRIZE') return;
            if (!val?.productId) return Promise.reject(new Error('请选择关联商品'));
            if (!val?.skuId) return Promise.reject(new Error('请选择商品规格'));
          },
        }]}
        extra="选择奖励商品及对应的商品规格（包装/重量等）"
      >
        <RewardProductPicker />
      </Form.Item>
      {selectedType === 'DISCOUNT_BUY' && (
        <ProFormDigit name="prizePrice" label="奖品价格" min={0}
          rules={[{ required: true, message: '请输入奖品价格' }]}
          fieldProps={{ step: 0.01, precision: 2 }} extra="用户抽中后的低价购买价格" />
      )}
      {selectedType === 'THRESHOLD_GIFT' && (
        <ProFormDigit name="threshold" label="消费门槛" min={0}
          rules={[{ required: true, message: '请输入消费门槛' }]}
          fieldProps={{ step: 0.01, precision: 2 }} extra="用户消费满此金额后可获赠该奖品" />
      )}
    </>
  );
}

/** 数量与限制字段（新增和编辑共用） */
function LimitsFields() {
  return (
    <>
      <ProFormDigit name="prizeQuantity" label="奖品数量" min={1} fieldProps={{ precision: 0 }} extra="该奖品总可用数量" />
      <ProFormDigit name="expirationHours" label="过期时间(小时)" min={1} fieldProps={{ precision: 0 }} extra="中奖后奖品在购物车中的有效时长" />
    </>
  );
}

/** 编辑奖品 Drawer — 单页表单，所有字段一次显示 */
function PrizeEditDrawer({
  visible,
  prize,
  submitError,
  setSubmitError,
  onClose,
  onSuccess,
}: {
  visible: boolean;
  prize: Prize;
  submitError: string | null;
  setSubmitError: (err: string | null) => void;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [form] = Form.useForm();
  const [selectedType, setSelectedType] = useState<LotteryPrizeType>(prize.type);
  const [probValue, setProbValue] = useState<number>(prize.probability);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (visible) {
      setSelectedType(prize.type);
      setProbValue(prize.probability);
      setSubmitError(null);
      form.setFieldsValue({
        name: prize.name,
        type: prize.type,
        probability: prize.probability,
        _productPicker: prize.productId ? { productId: prize.productId, skuId: prize.skuId } : undefined,
        prizePrice: prize.prizePrice,
        threshold: prize.threshold,
        prizeQuantity: prize.prizeQuantity,
        expirationHours: prize.expirationHours,
        isActive: prize.isActive,
      });
    }
  }, [visible, prize, form, setSubmitError]);

  const handleSubmit = async () => {
    try {
      const values = await form.validateFields();
      setLoading(true);
      setSubmitError(null);
      const payload = buildPrizePayload(values);
      await updatePrize(prize.id, payload);
      message.success('更新成功');
      onSuccess();
    } catch (err) {
      if (err && typeof err === 'object' && 'errorFields' in err) return; // 表单校验失败
      const raw = err instanceof Error ? err.message : '操作失败';
      const hint = raw.includes('抽奖奖品只能关联平台商品')
        ? '当前奖品关联的是旧数据（非奖励商品），请重新选择「关联奖励商品」和「商品规格」后再保存。'
        : raw;
      setSubmitError(hint);
      message.error(hint);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Drawer
      title="编辑奖品"
      width="60vw"
      open={visible}
      onClose={onClose}
      destroyOnClose
      footer={
        <div style={{ textAlign: 'right' }}>
          <Button onClick={onClose} style={{ marginRight: 8 }}>取消</Button>
          <Button type="primary" loading={loading} onClick={handleSubmit}>保存修改</Button>
        </div>
      }
      styles={{ body: { paddingTop: 8 } }}
    >
      {submitError && (
        <Alert type="error" showIcon message={submitError} style={{ marginBottom: 16 }} closable onClose={() => setSubmitError(null)} />
      )}
      <Form form={form} layout="vertical" onValuesChange={(changed) => {
        if (changed.type) setSelectedType(changed.type);
        if (changed.probability !== undefined) setProbValue(changed.probability);
        if (submitError) setSubmitError(null);
      }}>
        <Card title="奖品类型" size="small" style={{ marginBottom: 16 }}>
          <PrizeTypeFields selectedType={selectedType} probValue={probValue} onTypeChange={setSelectedType} onProbChange={setProbValue} />
        </Card>
        {selectedType !== 'NO_PRIZE' && (
          <Card title="商品与定价" size="small" style={{ marginBottom: 16 }}>
            <ProductPricingFields selectedType={selectedType} />
          </Card>
        )}
        <Card title="数量与限制" size="small">
          <LimitsFields />
        </Card>
      </Form>
    </Drawer>
  );
}

/** 新增奖品 Drawer + StepsForm */
function PrizeCreateDrawer({
  visible,
  submitError,
  setSubmitError,
  onClose,
  onSuccess,
}: {
  visible: boolean;
  submitError: string | null;
  setSubmitError: (err: string | null) => void;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const formRef = useRef<ProFormInstance>(null);
  const [currentStep, setCurrentStep] = useState(0);
  const [selectedType, setSelectedType] = useState<LotteryPrizeType | undefined>();
  const [probValue, setProbValue] = useState<number>(0);

  useEffect(() => {
    if (visible) {
      setCurrentStep(0);
      setSelectedType(undefined);
      setProbValue(0);
      setSubmitError(null);
    }
  }, [visible, setSubmitError]);

  return (
    <Drawer
      title="新增奖品"
      width="75vw"
      open={visible}
      onClose={onClose}
      destroyOnClose
      footer={null}
      styles={{ body: { paddingTop: 8 } }}
    >
      {submitError && (
        <Alert type="error" showIcon message={submitError} style={{ marginBottom: 16 }} closable onClose={() => setSubmitError(null)} />
      )}
      <StepsForm
        formRef={formRef}
        current={currentStep}
        onCurrentChange={(step) => setCurrentStep(step)}
        stepsProps={{
          size: 'small',
          items: [
            { title: '奖品类型', description: '选择奖品类型和中奖概率' },
            { title: '商品与定价', description: '关联奖励商品和设置价格' },
            { title: '数量与限制', description: '配置数量限制和有效期' },
          ],
        }}
        submitter={{
          render: (props) => {
            const { step } = props;
            const btns: React.ReactNode[] = [];
            if (step > 0) btns.push(<Button key="pre" onClick={() => props.onPre?.()}>上一步</Button>);
            if (step < 2) {
              const isNoPrizeStep1 = step === 1 && selectedType === 'NO_PRIZE';
              btns.push(<Button key="next" type="primary" onClick={() => props.onSubmit?.()}>{isNoPrizeStep1 ? '跳过此步' : '下一步'}</Button>);
            }
            if (step === 2) btns.push(<Button key="submit" type="primary" onClick={() => props.onSubmit?.()}>创建奖品</Button>);
            return btns;
          },
        }}
        containerStyle={{ minHeight: 380 }}
        onFinish={async (values) => {
          setSubmitError(null);
          const payload = buildPrizePayload(values);
          try {
            await createPrize(payload);
            message.success('创建成功');
            onSuccess();
            return true;
          } catch (err) {
            const raw = err instanceof Error ? err.message : '操作失败';
            const hint = raw.includes('抽奖奖品只能关联平台商品')
              ? '当前奖品关联的是旧数据（非奖励商品），请重新选择「关联奖励商品」和「商品规格」后再保存。'
              : raw;
            setSubmitError(hint);
            message.error(hint);
            return false;
          }
        }}
      >
        {/* ========== 步骤1: 奖品类型 ========== */}
        <StepsForm.StepForm name="step_type" title="奖品类型"
          onFinish={async (values) => { setSelectedType(values.type); setProbValue(values.probability ?? 0); return true; }}
          onValuesChange={(changed) => {
            if (changed.type) setSelectedType(changed.type);
            if (changed.probability !== undefined) setProbValue(changed.probability);
            if (submitError) setSubmitError(null);
          }}
        >
          <PrizeTypeFields selectedType={selectedType} probValue={probValue} onTypeChange={setSelectedType} onProbChange={setProbValue} />
        </StepsForm.StepForm>

        {/* ========== 步骤2: 商品与定价 ========== */}
        <StepsForm.StepForm name="step_product" title="商品与定价"
          onValuesChange={() => { if (submitError) setSubmitError(null); }}
        >
          {selectedType === 'NO_PRIZE' ? (
            <Alert type="info" showIcon message="谢谢参与类型无需关联商品"
              description="该类型奖品不需要关联商品或设置价格，请直接进入下一步配置数量限制。"
              style={{ marginBottom: 16 }} />
          ) : (
            <ProductPricingFields selectedType={selectedType} />
          )}
        </StepsForm.StepForm>

        {/* ========== 步骤3: 数量与限制 ========== */}
        <StepsForm.StepForm name="step_limits" title="数量与限制"
          initialValues={{ isActive: true }}
          onValuesChange={() => { if (submitError) setSubmitError(null); }}
        >
          <LimitsFields />
        </StepsForm.StepForm>
      </StepsForm>
    </Drawer>
  );
}

/** 兼容组件：根据 prize 是否存在决定用编辑表单还是新增向导 */
function PrizeDrawerForm(props: {
  visible: boolean;
  prize: Prize | null;
  submitError: string | null;
  setSubmitError: (err: string | null) => void;
  onClose: () => void;
  onSuccess: () => void;
}) {
  if (props.prize) {
    return <PrizeEditDrawer {...props} prize={props.prize} />;
  }
  return <PrizeCreateDrawer {...props} />;
}

function PrizeManagementTab() {
  const actionRef = useRef<ActionType>(null);
  const [editModal, setEditModal] = useState<{ visible: boolean; prize: Prize | null }>({
    visible: false,
    prize: null,
  });
  const [batchModal, setBatchModal] = useState(false);
  const [batchData, setBatchData] = useState<BatchProbItem[]>([]);
  const [batchLoading, setBatchLoading] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const handleOpenBatchModal = async () => {
    try {
      const res = await getPrizes({ page: 1, pageSize: 200 });
      const activeItems = res.items.filter((p) => p.isActive);
      setBatchData(
        activeItems.map((p) => ({
          id: p.id,
          name: p.name,
          type: p.type,
          probability: p.probability,
          locked: false,
        })),
      );
      setBatchModal(true);
    } catch (err) {
      message.error(err instanceof Error ? err.message : '加载奖品失败');
    }
  };

  const handleBatchSave = async () => {
    setBatchLoading(true);
    try {
      await batchUpdateProbabilities(batchData.map((d) => ({ id: d.id, probability: d.probability })));
      message.success('批量更新概率成功');
      setBatchModal(false);
      actionRef.current?.reload();
    } catch (err) {
      message.error(err instanceof Error ? err.message : '批量更新失败');
    } finally {
      setBatchLoading(false);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await deletePrize(id);
      message.success('停用成功');
      actionRef.current?.reload();
    } catch (err) {
      message.error(err instanceof Error ? err.message : '操作失败');
    }
  };

  const columns: ProColumns<Prize>[] = [
    {
      title: '商品图片',
      dataIndex: ['product', 'media'],
      width: 80,
      search: false,
      render: (_: unknown, r: Prize) => {
        const imageUrl = r.product?.media?.[0]?.url;
        return imageUrl ? (
          <Image
            src={imageUrl}
            width={48}
            height={48}
            style={{ objectFit: 'cover', borderRadius: 4 }}
            fallback="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="
          />
        ) : (
          <span style={{ color: '#999' }}>-</span>
        );
      },
    },
    { title: '奖品名称', dataIndex: 'name', width: 160 },
    {
      title: '类型',
      dataIndex: 'type',
      width: 120,
      valueEnum: Object.fromEntries(
        Object.entries(prizeTypeMap).map(([k, v]) => [k, { text: v.text }]),
      ),
      render: (_: unknown, r: Prize) => {
        const t = prizeTypeMap[r.type];
        return <Tag color={t?.color}>{t?.text || r.type}</Tag>;
      },
    },
    {
      title: '概率',
      dataIndex: 'probability',
      width: 100,
      search: false,
      render: (_: unknown, r: Prize) => `${r.probability.toFixed(2)}%`,
    },
    {
      title: '已中次数',
      dataIndex: 'wonCount',
      width: 100,
      search: false,
    },
    {
      title: '关联商品/规格',
      width: 220,
      search: false,
      render: (_: unknown, r: Prize) => {
        if (r.type === 'NO_PRIZE') return '-';
        const productTitle = r.product?.title || r.productId || '-';
        const skuTitle = r.sku?.title || r.skuId || '-';
        return `${productTitle} / ${skuTitle}`;
      },
    },
    {
      title: '价格/门槛',
      width: 150,
      search: false,
      render: (_: unknown, r: Prize) => {
        if (r.type === 'NO_PRIZE') return '-';
        if (r.type === 'THRESHOLD_GIFT') {
          return `门槛 ¥${(r.threshold ?? 0).toFixed(2)}`;
        }
        return `价格 ¥${(r.prizePrice ?? 0).toFixed(2)}`;
      },
    },
    {
      title: '原价',
      dataIndex: 'originalPrice',
      width: 100,
      search: false,
      render: (_: unknown, r: Prize) => {
        if (r.type === 'NO_PRIZE') return '-';
        return r.originalPrice != null ? `¥${r.originalPrice.toFixed(2)}` : '-';
      },
    },
    {
      title: '状态',
      dataIndex: 'isActive',
      width: 90,
      valueEnum: {
        true: { text: '启用' },
        false: { text: '停用' },
      },
      render: (_: unknown, r: Prize) => (
        <Switch
          checked={r.isActive}
          checkedChildren="启用"
          unCheckedChildren="停用"
          onChange={async (checked) => {
            try {
              await updatePrize(r.id, { isActive: checked });
              message.success(checked ? '已启用' : '已停用');
              actionRef.current?.reload();
            } catch {
              message.error('操作失败');
            }
          }}
        />
      ),
    },
    {
      title: '创建时间',
      dataIndex: 'createdAt',
      width: 160,
      search: false,
      render: (_: unknown, r: Prize) => dayjs(r.createdAt).format('YYYY-MM-DD HH:mm'),
    },
    {
      title: '操作',
      width: 140,
      search: false,
      render: (_: unknown, r: Prize) => (
        <Space>
          <PermissionGate permission={PERMISSIONS.LOTTERY_UPDATE}>
            <Button
              type="link"
              size="small"
              icon={<EditOutlined />}
              onClick={() => {
                setSubmitError(null);
                setEditModal({ visible: true, prize: r });
              }}
            >
              编辑
            </Button>
          </PermissionGate>
          <PermissionGate permission={PERMISSIONS.LOTTERY_DELETE}>
            <Popconfirm title="确认停用该奖品？" onConfirm={() => handleDelete(r.id)}>
              <Button type="link" size="small" danger icon={<DeleteOutlined />}>
                停用
              </Button>
            </Popconfirm>
          </PermissionGate>
        </Space>
      ),
    },
  ];

  return (
    <>
      <ProTable<Prize>
        headerTitle="奖池管理"
        actionRef={actionRef}
        columns={columns}
        rowKey="id"
        scroll={{ x: 1200 }}
        request={async (params) => {
          const res = await getPrizes({
            page: params.current || 1,
            pageSize: params.pageSize || 20,
            type: params.type || undefined,
          });
          return { data: res.items, total: res.total, success: true };
        }}
        pagination={{ defaultPageSize: 20 }}
        search={{ labelWidth: 'auto' }}
        toolBarRender={() => [
          <PermissionGate key="batch" permission={PERMISSIONS.LOTTERY_UPDATE}>
            <Button onClick={handleOpenBatchModal}>批量编辑概率</Button>
          </PermissionGate>,
          <PermissionGate key="add" permission={PERMISSIONS.LOTTERY_CREATE}>
            <Button
              type="primary"
              icon={<PlusOutlined />}
              onClick={() => {
                setSubmitError(null);
                setEditModal({ visible: true, prize: null });
              }}
            >
              新增奖品
            </Button>
          </PermissionGate>,
        ]}
      />

      <PrizeDrawerForm
        visible={editModal.visible}
        prize={editModal.prize}
        submitError={submitError}
        setSubmitError={setSubmitError}
        onClose={() => {
          setSubmitError(null);
          setEditModal({ visible: false, prize: null });
        }}
        onSuccess={() => {
          setEditModal({ visible: false, prize: null });
          actionRef.current?.reload();
        }}
      />

      <Modal
        title={
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingRight: 24 }}>
            <span style={{ fontSize: 16 }}>智能概率编辑</span>
            <span style={{ fontSize: 13, fontWeight: 400 }}>
              总和：
              <span
                style={{
                  color: Math.abs(batchData.reduce((s, d) => s + d.probability, 0) - 100) < 0.01 ? '#52c41a' : '#ff4d4f',
                  fontWeight: 600,
                }}
              >
                {batchData.reduce((s, d) => s + d.probability, 0).toFixed(2)}%
                {Math.abs(batchData.reduce((s, d) => s + d.probability, 0) - 100) < 0.01 ? ' ✓' : ' ✗'}
              </span>
            </span>
          </div>
        }
        open={batchModal}
        width={960}
        style={{ maxWidth: '95vw' }}
        onCancel={() => setBatchModal(false)}
        onOk={handleBatchSave}
        confirmLoading={batchLoading}
        okText="保存"
        okButtonProps={{
          disabled: Math.abs(batchData.reduce((s, d) => s + d.probability, 0) - 100) >= 0.01,
        }}
      >
        <SmartProbabilityEditor items={batchData} onChange={setBatchData} />
      </Modal>
    </>
  );
}

function DrawRecordsTab() {
  const columns: ProColumns<DrawRecord>[] = [
    { title: '记录ID', dataIndex: 'id', ellipsis: true, width: 180, copyable: true },
    {
      title: '用户',
      width: 120,
      search: false,
      render: (_: unknown, r: DrawRecord) => r.user?.profile?.nickname || r.userId,
    },
    { title: '用户ID', dataIndex: 'userId', width: 180, ellipsis: true },
    {
      title: '奖品',
      width: 220,
      search: false,
      render: (_: unknown, r: DrawRecord) => {
        if (!r.prize) return '-';
        const t = prizeTypeMap[r.prize.type];
        const imageUrl = r.prize.product?.media?.[0]?.url;
        return (
          <Space>
            {imageUrl ? (
              <Image
                src={imageUrl}
                width={36}
                height={36}
                style={{ objectFit: 'cover', borderRadius: 4 }}
                fallback="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="
              />
            ) : null}
            <Tag color={t?.color}>{t?.text}</Tag>
            {r.prize.name}
          </Space>
        );
      },
    },
    {
      title: '结果',
      dataIndex: 'result',
      width: 100,
      valueEnum: Object.fromEntries(
        Object.entries(drawResultMap).map(([k, v]) => [k, { text: v.text }]),
      ),
      render: (_: unknown, r: DrawRecord) => {
        const d = drawResultMap[r.result];
        return <Tag color={d?.color}>{d?.text || r.result}</Tag>;
      },
    },
    {
      title: '时间',
      dataIndex: 'createdAt',
      width: 180,
      search: false,
      render: (_: unknown, r: DrawRecord) => dayjs(r.createdAt).format('YYYY-MM-DD HH:mm:ss'),
    },
  ];

  return (
    <ProTable<DrawRecord>
      headerTitle="抽奖记录"
      columns={columns}
      rowKey="id"
      scroll={{ x: 940 }}
      request={async (params) => {
        const res = await getDrawRecords({
          page: params.current || 1,
          pageSize: params.pageSize || 20,
          userId: params.userId || undefined,
          result: params.result || undefined,
        });
        return { data: res.items, total: res.total, success: true };
      }}
      pagination={{ defaultPageSize: 20 }}
      search={{ labelWidth: 'auto' }}
    />
  );
}

function StatsTab() {
  const { data: stats, isLoading } = useQuery<LotteryStats>({
    queryKey: ['lottery-stats'],
    queryFn: getLotteryStats,
  });

  const consumptionColumns = [
    { title: '奖品名称', dataIndex: 'name', key: 'name' },
    {
      title: '类型',
      key: 'type',
      render: (_: unknown, r: { type: string }) => {
        const t = prizeTypeMap[r.type];
        return <Tag color={t?.color}>{t?.text || r.type}</Tag>;
      },
    },
    { title: '今日中奖', dataIndex: 'todayWon', key: 'todayWon' },
    { title: '累计中奖', dataIndex: 'totalWon', key: 'totalWon' },
    {
      title: '每日上限',
      key: 'dailyLimit',
      render: (_: unknown, r: { dailyLimit: number | null }) => r.dailyLimit ?? '-',
    },
    {
      title: '总上限',
      key: 'totalLimit',
      render: (_: unknown, r: { totalLimit: number | null }) => r.totalLimit ?? '-',
    },
  ];

  return (
    <div>
      <div style={{ marginBottom: 20 }}>
        <h4 style={{ fontSize: 15, fontWeight: 600, color: '#262626', marginBottom: 16 }}>今日概览</h4>
        <Row gutter={[16, 16]}>
          <Col xs={24} sm={8}>
            <Card loading={isLoading} style={{ borderRadius: 8 }}>
              <Statistic title="今日抽奖次数" value={stats?.today.totalDraws ?? 0} />
            </Card>
          </Col>
          <Col xs={24} sm={8}>
            <Card loading={isLoading} style={{ borderRadius: 8 }}>
              <Statistic
                title="今日中奖次数"
                value={stats?.today.totalWon ?? 0}
                valueStyle={{ color: '#faad14' }}
              />
            </Card>
          </Col>
          <Col xs={24} sm={8}>
            <Card loading={isLoading} style={{ borderRadius: 8 }}>
              <Statistic
                title="活跃奖品数"
                value={stats?.prizes.length ?? 0}
                valueStyle={{ color: '#52c41a' }}
              />
            </Card>
          </Col>
        </Row>
      </div>

      <Card
        title={<span style={{ fontSize: 15, fontWeight: 600 }}>奖品消耗情况</span>}
        loading={isLoading}
        style={{ borderRadius: 8 }}
      >
        <Table
          dataSource={stats?.prizes || []}
          columns={consumptionColumns}
          rowKey="id"
          pagination={false}
          size="small"
          scroll={{ x: 500 }}
        />
      </Card>
    </div>
  );
}

export default function LotteryPage() {
  return (
    <div style={{ padding: 24 }}>
      <Tabs
        defaultActiveKey="prizes"
        type="card"
        size="large"
        items={[
          {
            key: 'prizes',
            label: (
              <span><TrophyOutlined style={{ marginRight: 6 }} />奖池管理</span>
            ),
            children: <div style={{ paddingTop: 16 }}><PrizeManagementTab /></div>,
          },
          {
            key: 'records',
            label: (
              <span><UnorderedListOutlined style={{ marginRight: 6 }} />抽奖记录</span>
            ),
            children: <div style={{ paddingTop: 16 }}><DrawRecordsTab /></div>,
          },
          {
            key: 'stats',
            label: (
              <span><BarChartOutlined style={{ marginRight: 6 }} />数据统计</span>
            ),
            children: <div style={{ paddingTop: 16 }}><StatsTab /></div>,
          },
        ]}
      />
    </div>
  );
}
