import { useRef, useState, useMemo, useCallback, useEffect } from 'react';
import { ProTable, ModalForm, ProFormText, ProFormDigit, ProFormSelect } from '@ant-design/pro-components';
import type { ActionType, ProColumns } from '@ant-design/pro-components';
import { App, Button, Tag, Space, Popconfirm, Card, InputNumber, Descriptions, Alert, Select, Badge, Row, Col, Spin, Tooltip, Typography } from 'antd';
import { PlusOutlined, EditOutlined, DeleteOutlined, SearchOutlined, WarningOutlined, SaveOutlined, InfoCircleOutlined } from '@ant-design/icons';
import {
  getShippingRules,
  createShippingRule,
  updateShippingRule,
  deleteShippingRule,
  previewShipping,
} from '@/api/shipping-rules';
import type { ShippingRule, ShippingPreview } from '@/api/shipping-rules';
import { getConfigs, updateConfig } from '@/api/config';
import { extractConfigValue } from '@/types';
import PermissionGate from '@/components/PermissionGate';
import { PERMISSIONS } from '@/constants/permissions';
import dayjs from 'dayjs';

const { Text } = Typography;

// 运费规则状态映射
const getRuleStatusMeta = (isActive: boolean) => (
  isActive
    ? { text: '启用', color: 'green' }
    : { text: '停用', color: 'default' }
);

// 中国省份/直辖市地区编码映射（用于预览区域选择器）
const REGION_OPTIONS: { label: string; value: string }[] = [
  { label: '北京', value: '11' },
  { label: '天津', value: '12' },
  { label: '河北', value: '13' },
  { label: '山西', value: '14' },
  { label: '内蒙古', value: '15' },
  { label: '辽宁', value: '21' },
  { label: '吉林', value: '22' },
  { label: '黑龙江', value: '23' },
  { label: '上海', value: '31' },
  { label: '江苏', value: '32' },
  { label: '浙江', value: '33' },
  { label: '安徽', value: '34' },
  { label: '福建', value: '35' },
  { label: '江西', value: '36' },
  { label: '山东', value: '37' },
  { label: '河南', value: '41' },
  { label: '湖北', value: '42' },
  { label: '湖南', value: '43' },
  { label: '广东', value: '44' },
  { label: '广西', value: '45' },
  { label: '海南', value: '46' },
  { label: '重庆', value: '50' },
  { label: '四川', value: '51' },
  { label: '贵州', value: '52' },
  { label: '云南', value: '53' },
  { label: '西藏', value: '54' },
  { label: '陕西', value: '61' },
  { label: '甘肃', value: '62' },
  { label: '青海', value: '63' },
  { label: '宁夏', value: '64' },
  { label: '新疆', value: '65' },
];

// 地区编码→名称映射
const REGION_NAME_MAP: Record<string, string> = {};
REGION_OPTIONS.forEach((r) => { REGION_NAME_MAP[r.value] = r.label; });

// 优先级等级颜色映射
const getPriorityStyle = (priority: number, maxPriority: number) => {
  if (maxPriority <= 0) return { color: '#999', bg: 'transparent' };
  const ratio = priority / maxPriority;
  if (ratio >= 0.8) return { color: '#f5222d', bg: '#fff1f0' };  // 高优先
  if (ratio >= 0.5) return { color: '#fa8c16', bg: '#fff7e6' };  // 中优先
  if (ratio > 0) return { color: '#1890ff', bg: '#e6f7ff' };     // 低优先
  return { color: '#999', bg: 'transparent' };                     // 默认
};

interface ShippingRuleFormValues {
  name: string;
  regionCodesText?: string;
  minAmount?: number;
  maxAmount?: number;
  minWeight?: number;
  maxWeight?: number;
  fee: number;
  priority?: number;
  isActive?: boolean;
}

const formatRange = (min?: number | null, max?: number | null, unit = '') => {
  const minText = typeof min === 'number' ? `${min}${unit}` : undefined;
  const maxText = typeof max === 'number' ? `${max}${unit}` : undefined;
  if (!minText && !maxText) return '不限';
  if (minText && maxText) return `[${minText}, ${maxText})`;
  if (minText) return `>= ${minText}`;
  return `< ${maxText}`;
};

/** 检测两个数值区间是否重叠（null/undefined 视为无限） */
const rangesOverlap = (
  aMin?: number | null,
  aMax?: number | null,
  bMin?: number | null,
  bMax?: number | null,
): boolean => {
  const aLo = aMin ?? -Infinity;
  const aHi = aMax ?? Infinity;
  const bLo = bMin ?? -Infinity;
  const bHi = bMax ?? Infinity;
  return aLo < bHi && bLo < aHi;
};

/** 检测两个地区列表是否有交集（空数组视为"全国"，与任何地区交叉） */
const regionsOverlap = (a: string[], b: string[]): boolean => {
  if (a.length === 0 || b.length === 0) return true; // 全国与任何地区交叉
  const setA = new Set(a);
  return b.some((code) => setA.has(code));
};

export default function ShippingRulesPage() {
  const { message } = App.useApp();
  const actionRef = useRef<ActionType>(null);
  const [editModal, setEditModal] = useState<{ visible: boolean; rule: ShippingRule | null }>({
    visible: false,
    rule: null,
  });

  // 免运费门槛配置
  const [thresholdLoading, setThresholdLoading] = useState(true);
  const [thresholdSaving, setThresholdSaving] = useState(false);
  const [vipThreshold, setVipThreshold] = useState<number>(49);
  const [normalThreshold, setNormalThreshold] = useState<number>(99);

  useEffect(() => {
    getConfigs().then((configs) => {
      for (const c of configs) {
        const val = extractConfigValue(c);
        if (c.key === 'VIP_FREE_SHIPPING_THRESHOLD' && typeof val === 'number') setVipThreshold(val);
        if (c.key === 'NORMAL_FREE_SHIPPING_THRESHOLD' && typeof val === 'number') setNormalThreshold(val);
      }
    }).catch(() => {}).finally(() => setThresholdLoading(false));
  }, []);

  const handleSaveThresholds = async () => {
    setThresholdSaving(true);
    try {
      await updateConfig('VIP_FREE_SHIPPING_THRESHOLD', {
        value: { value: vipThreshold, description: 'VIP用户免运费门槛（元）' },
        changeNote: '更新免运费门槛',
      });
      await updateConfig('NORMAL_FREE_SHIPPING_THRESHOLD', {
        value: { value: normalThreshold, description: '普通用户免运费门槛（元）' },
        changeNote: '更新免运费门槛',
      });
      message.success('免运费门槛保存成功');
    } catch (err: any) {
      message.error(err?.message || '保存失败');
    } finally {
      setThresholdSaving(false);
    }
  };

  // 缓存所有已加载规则，用于冲突检测
  const [allRules, setAllRules] = useState<ShippingRule[]>([]);

  // 运费预览状态
  const [previewGoodsAmount, setPreviewGoodsAmount] = useState<number>(100);
  const [previewRegionCode, setPreviewRegionCode] = useState<string>('');
  const [previewWeight, setPreviewWeight] = useState<number>(1);
  const [previewResult, setPreviewResult] = useState<ShippingPreview | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);

  // 计算当前规则列表中的最大优先级（用于优先级高亮）
  const maxPriority = useMemo(() => {
    if (allRules.length === 0) return 0;
    return Math.max(...allRules.map((r) => r.priority));
  }, [allRules]);

  // 冲突检测：给定当前编辑的规则，找到与之条件重叠的其他规则
  const detectConflicts = useCallback((formRule: {
    regionCodes: string[];
    minAmount?: number;
    maxAmount?: number;
    minWeight?: number;
    maxWeight?: number;
  }, editingId?: string): ShippingRule[] => {
    return allRules.filter((existing) => {
      // 排除自身
      if (editingId && existing.id === editingId) return false;
      // 排除停用规则
      if (!existing.isActive) return false;
      // 检测地区重叠
      if (!regionsOverlap(formRule.regionCodes, existing.regionCodes)) return false;
      // 检测金额区间重叠
      if (!rangesOverlap(formRule.minAmount, formRule.maxAmount, existing.minAmount, existing.maxAmount)) return false;
      // 检测重量区间重叠
      if (!rangesOverlap(formRule.minWeight, formRule.maxWeight, existing.minWeight, existing.maxWeight)) return false;
      return true;
    });
  }, [allRules]);

  // 编辑弹窗中的冲突状态
  const [formConflicts, setFormConflicts] = useState<ShippingRule[]>([]);

  // 表单值变化时重新检测冲突
  const handleFormValuesChange = useCallback((_: unknown, allValues: ShippingRuleFormValues) => {
    const regionCodes = (allValues.regionCodesText || '')
      .split(/[,\n，]/)
      .map((v) => v.trim())
      .filter(Boolean);
    const conflicts = detectConflicts(
      {
        regionCodes,
        minAmount: allValues.minAmount,
        maxAmount: allValues.maxAmount,
        minWeight: allValues.minWeight,
        maxWeight: allValues.maxWeight,
      },
      editModal.rule?.id,
    );
    setFormConflicts(conflicts);
  }, [detectConflicts, editModal.rule]);

  const handleDelete = async (id: string) => {
    try {
      await deleteShippingRule(id);
      message.success('删除成功');
      actionRef.current?.reload();
    } catch (err) {
      message.error(err instanceof Error ? err.message : '删除失败');
    }
  };

  const handlePreview = async () => {
    setPreviewLoading(true);
    try {
      const result = await previewShipping({
        goodsAmount: previewGoodsAmount,
        regionCode: previewRegionCode || undefined,
        totalWeight: previewWeight,
      });
      setPreviewResult(result);
    } catch (err) {
      message.error(err instanceof Error ? err.message : '预览失败');
      setPreviewResult(null);
    } finally {
      setPreviewLoading(false);
    }
  };

  // 将地区编码列表格式化为可读名称
  const formatRegionCodes = (codes: string[]): string => {
    if (codes.length === 0) return '全国';
    return codes.map((c) => REGION_NAME_MAP[c] || c).join(', ');
  };

  const columns: ProColumns<ShippingRule>[] = [
    {
      title: '#',
      dataIndex: 'priorityRank',
      width: 50,
      search: false,
      render: (_: unknown, _r: ShippingRule, index: number) => (
        <span style={{ color: '#999', fontSize: 12 }}>{index + 1}</span>
      ),
    },
    { title: '规则名称', dataIndex: 'name', width: 180 },
    {
      title: '地区范围',
      dataIndex: 'regionCodes',
      width: 200,
      search: false,
      render: (_: unknown, r: ShippingRule) => formatRegionCodes(r.regionCodes),
    },
    {
      title: '金额区间',
      dataIndex: 'amountRange',
      width: 180,
      search: false,
      render: (_: unknown, r: ShippingRule) => formatRange(r.minAmount, r.maxAmount, '元'),
    },
    {
      title: '重量区间',
      dataIndex: 'weightRange',
      width: 180,
      search: false,
      render: (_: unknown, r: ShippingRule) => formatRange(r.minWeight, r.maxWeight, 'kg'),
    },
    {
      title: '运费',
      dataIndex: 'fee',
      width: 100,
      search: false,
      render: (_: unknown, r: ShippingRule) => `¥${r.fee.toFixed(2)}`,
    },
    {
      title: '优先级',
      dataIndex: 'priority',
      width: 110,
      search: false,
      sorter: (a: ShippingRule, b: ShippingRule) => a.priority - b.priority,
      defaultSortOrder: 'descend',
      render: (_: unknown, r: ShippingRule) => {
        const style = getPriorityStyle(r.priority, maxPriority);
        return (
          <Badge
            count={r.priority}
            showZero
            style={{
              backgroundColor: style.bg,
              color: style.color,
              border: `1px solid ${style.color}`,
              fontWeight: 600,
              boxShadow: 'none',
            }}
          />
        );
      },
    },
    {
      title: '状态',
      dataIndex: 'isActive',
      width: 80,
      search: false,
      render: (_: unknown, r: ShippingRule) => {
        const s = getRuleStatusMeta(r.isActive);
        return <Tag color={s.color}>{s.text}</Tag>;
      },
    },
    {
      title: '创建时间',
      dataIndex: 'createdAt',
      width: 160,
      search: false,
      render: (_: unknown, r: ShippingRule) => dayjs(r.createdAt).format('YYYY-MM-DD HH:mm'),
    },
    {
      title: '操作',
      width: 140,
      search: false,
      render: (_: unknown, r: ShippingRule) => (
        <Space>
          <PermissionGate permission={PERMISSIONS.SHIPPING_UPDATE}>
            <Button
              type="link"
              size="small"
              icon={<EditOutlined />}
              onClick={() => {
                setFormConflicts([]);
                setEditModal({ visible: true, rule: r });
              }}
            >
              编辑
            </Button>
          </PermissionGate>
          <PermissionGate permission={PERMISSIONS.SHIPPING_DELETE}>
            <Popconfirm title="确认删除该规则？" onConfirm={() => handleDelete(r.id)}>
              <Button type="link" size="small" danger icon={<DeleteOutlined />}>
                删除
              </Button>
            </Popconfirm>
          </PermissionGate>
        </Space>
      ),
    },
  ];

  return (
    <div style={{ padding: 24 }}>
      {/* 免运费门槛配置 */}
      <Card
        bordered={false}
        style={{ marginBottom: 16, borderRadius: 12 }}
        title={
          <Space>
            <Text strong style={{ fontSize: 15 }}>免运费门槛</Text>
            <Tooltip title="订单商品金额达到门槛时免收运费。VIP用户享受更低门槛，设为0表示无条件免运费。">
              <InfoCircleOutlined style={{ color: '#bfbfbf', fontSize: 13 }} />
            </Tooltip>
          </Space>
        }
        extra={
          <PermissionGate permission={PERMISSIONS.SHIPPING_UPDATE}>
            <Button
              type="primary"
              size="small"
              icon={<SaveOutlined />}
              loading={thresholdSaving}
              onClick={handleSaveThresholds}
            >
              保存
            </Button>
          </PermissionGate>
        }
      >
        {thresholdLoading ? (
          <Spin size="small" />
        ) : (
          <Row gutter={24}>
            <Col span={12}>
              <div style={{ marginBottom: 4, fontSize: 13, color: '#666' }}>
                VIP用户免运费门槛
                <Tooltip title="VIP用户订单满此金额免运费（0=无条件免运费）">
                  <InfoCircleOutlined style={{ marginLeft: 4, color: '#bfbfbf', fontSize: 12 }} />
                </Tooltip>
              </div>
              <InputNumber
                value={vipThreshold}
                onChange={(v) => setVipThreshold(v ?? 0)}
                min={0}
                max={10000}
                step={1}
                precision={2}
                addonAfter="元"
                style={{ width: '100%' }}
              />
            </Col>
            <Col span={12}>
              <div style={{ marginBottom: 4, fontSize: 13, color: '#666' }}>
                普通用户免运费门槛
                <Tooltip title="普通用户订单满此金额免运费（0=无条件免运费）">
                  <InfoCircleOutlined style={{ marginLeft: 4, color: '#bfbfbf', fontSize: 12 }} />
                </Tooltip>
              </div>
              <InputNumber
                value={normalThreshold}
                onChange={(v) => setNormalThreshold(v ?? 0)}
                min={0}
                max={10000}
                step={1}
                precision={2}
                addonAfter="元"
                style={{ width: '100%' }}
              />
            </Col>
          </Row>
        )}
      </Card>

      <ProTable<ShippingRule>
        headerTitle="运费规则管理"
        actionRef={actionRef}
        columns={columns}
        rowKey="id"
        request={async (params) => {
          const res = await getShippingRules({
            page: params.current || 1,
            pageSize: params.pageSize || 100, // 加载更多规则用于冲突检测
          });
          setAllRules(res.items);
          return { data: res.items, total: res.total, success: true };
        }}
        pagination={{ defaultPageSize: 20 }}
        search={false}
        rowClassName={(record) => {
          if (!record.isActive) return 'shipping-rule-row-inactive';
          const style = getPriorityStyle(record.priority, maxPriority);
          if (style.color === '#f5222d') return 'shipping-rule-row-high';
          if (style.color === '#fa8c16') return 'shipping-rule-row-medium';
          return '';
        }}
        toolBarRender={() => [
          <PermissionGate key="add" permission={PERMISSIONS.SHIPPING_CREATE}>
            <Button
              type="primary"
              icon={<PlusOutlined />}
              onClick={() => {
                setFormConflicts([]);
                setEditModal({ visible: true, rule: null });
              }}
            >
              新增规则
            </Button>
          </PermissionGate>,
        ]}
      />

      {/* 运费预览测试 */}
      <Card title="运费预览测试" style={{ marginTop: 16 }}>
        <Space wrap style={{ marginBottom: 16 }}>
          <div>
            <div style={{ marginBottom: 4, fontSize: 12, color: '#666' }}>商品总金额（元）</div>
            <InputNumber
              value={previewGoodsAmount}
              onChange={(v) => setPreviewGoodsAmount(v ?? 0)}
              min={0}
              step={10}
              precision={2}
              style={{ width: 160 }}
            />
          </div>
          <div>
            <div style={{ marginBottom: 4, fontSize: 12, color: '#666' }}>省份/地区</div>
            <Select
              value={previewRegionCode || undefined}
              onChange={(v) => setPreviewRegionCode(v || '')}
              placeholder="选择省份"
              allowClear
              showSearch
              optionFilterProp="label"
              options={REGION_OPTIONS}
              style={{ width: 160 }}
            />
          </div>
          <div>
            <div style={{ marginBottom: 4, fontSize: 12, color: '#666' }}>总重量（kg）</div>
            <InputNumber
              value={previewWeight}
              onChange={(v) => setPreviewWeight(v ?? 0)}
              min={0}
              step={0.5}
              precision={2}
              style={{ width: 160 }}
            />
          </div>
          <div style={{ display: 'flex', alignItems: 'flex-end', height: '100%' }}>
            <Button
              type="primary"
              icon={<SearchOutlined />}
              loading={previewLoading}
              onClick={handlePreview}
              style={{ marginTop: 20 }}
            >
              测试
            </Button>
          </div>
        </Space>

        {previewResult && (
          <Descriptions bordered size="small" column={3}>
            <Descriptions.Item label="运费">
              <span style={{ fontSize: 18, fontWeight: 600, color: '#1890ff' }}>
                ¥{previewResult.fee.toFixed(2)}
              </span>
            </Descriptions.Item>
            <Descriptions.Item label="输入金额">
              ¥{previewResult.input.goodsAmount.toFixed(2)}
            </Descriptions.Item>
            <Descriptions.Item label="地区">
              {previewResult.input.regionCode
                ? `${REGION_NAME_MAP[previewResult.input.regionCode] || previewResult.input.regionCode}（${previewResult.input.regionCode}）`
                : '未指定'}
            </Descriptions.Item>
            <Descriptions.Item label="输入重量">
              {typeof previewResult.input.totalWeight === 'number'
                ? `${previewResult.input.totalWeight.toFixed(2)}kg`
                : '未指定'}
            </Descriptions.Item>
          </Descriptions>
        )}
      </Card>

      {/* 内联样式：优先级行高亮 */}
      <style>{`
        .shipping-rule-row-high {
          background-color: #fff1f0 !important;
        }
        .shipping-rule-row-high:hover > td {
          background-color: #ffccc7 !important;
        }
        .shipping-rule-row-medium {
          background-color: #fff7e6 !important;
        }
        .shipping-rule-row-medium:hover > td {
          background-color: #ffe7ba !important;
        }
        .shipping-rule-row-inactive {
          opacity: 0.5;
        }
      `}</style>

      {/* 新增/编辑弹窗 */}
      <ModalForm
        title={editModal.rule ? '编辑运费规则' : '新增运费规则'}
        open={editModal.visible}
        initialValues={editModal.rule ? {
          name: editModal.rule.name,
          regionCodesText: editModal.rule.regionCodes.join(','),
          minAmount: editModal.rule.minAmount ?? undefined,
          maxAmount: editModal.rule.maxAmount ?? undefined,
          minWeight: editModal.rule.minWeight ?? undefined,
          maxWeight: editModal.rule.maxWeight ?? undefined,
          fee: editModal.rule.fee,
          priority: editModal.rule.priority,
          isActive: editModal.rule.isActive,
        } : {
          priority: 0,
          isActive: true,
        }}
        modalProps={{
          destroyOnClose: true,
          onCancel: () => {
            setEditModal({ visible: false, rule: null });
            setFormConflicts([]);
          },
        }}
        onValuesChange={handleFormValuesChange}
        onFinish={async (values: ShippingRuleFormValues) => {
          if (values.minAmount != null && values.maxAmount != null && values.minAmount >= values.maxAmount) {
            message.error('金额下限必须小于上限');
            return false;
          }
          if (values.minWeight != null && values.maxWeight != null && values.minWeight >= values.maxWeight) {
            message.error('重量下限必须小于上限');
            return false;
          }

          const regionCodes = (values.regionCodesText || '')
            .split(/[,\n，]/)
            .map((v) => v.trim())
            .filter(Boolean);

          const payload = {
            name: values.name,
            regionCodes,
            minAmount: values.minAmount ?? undefined,
            maxAmount: values.maxAmount ?? undefined,
            minWeight: values.minWeight ?? undefined,
            maxWeight: values.maxWeight ?? undefined,
            fee: values.fee,
            priority: values.priority ?? 0,
          };

          try {
            if (editModal.rule) {
              await updateShippingRule(editModal.rule.id, {
                ...payload,
                isActive: values.isActive,
              });
              message.success('更新成功');
            } else {
              await createShippingRule(payload);
              message.success('创建成功');
            }
            setEditModal({ visible: false, rule: null });
            setFormConflicts([]);
            actionRef.current?.reload();
            return true;
          } catch (err) {
            message.error(err instanceof Error ? err.message : '操作失败');
            return false;
          }
        }}
      >
        {/* 规则冲突检测提示 */}
        {formConflicts.length > 0 && (
          <Alert
            type="warning"
            showIcon
            icon={<WarningOutlined />}
            style={{ marginBottom: 16 }}
            message={`检测到 ${formConflicts.length} 条可能冲突的规则`}
            description={
              <div style={{ maxHeight: 160, overflow: 'auto' }}>
                {formConflicts.map((c) => (
                  <div key={c.id} style={{ marginBottom: 4 }}>
                    <strong>{c.name}</strong>
                    {' — '}
                    地区: {formatRegionCodes(c.regionCodes)}，
                    金额: {formatRange(c.minAmount, c.maxAmount, '元')}，
                    重量: {formatRange(c.minWeight, c.maxWeight, 'kg')}，
                    优先级: {c.priority}
                  </div>
                ))}
                <div style={{ marginTop: 8, color: '#666', fontSize: 12 }}>
                  冲突规则将按优先级数值从高到低命中，请确认优先级设置正确。
                </div>
              </div>
            }
          />
        )}
        <ProFormText
          name="name"
          label="规则名称"
          rules={[{ required: true, message: '请输入规则名称' }]}
          placeholder="如：华南小件、全国默认运费"
        />
        <ProFormText
          name="regionCodesText"
          label="地区编码列表"
          placeholder="如：44,45,46（逗号分隔，留空=全国）"
        />
        <ProFormDigit
          name="minAmount"
          label="金额下限（元）"
          min={0}
          fieldProps={{ step: 1, precision: 2 }}
          extra="留空表示不限制"
        />
        <ProFormDigit
          name="maxAmount"
          label="金额上限（元）"
          min={0}
          fieldProps={{ step: 1, precision: 2 }}
          extra="开区间上限（留空表示不限制）"
        />
        <ProFormDigit
          name="minWeight"
          label="重量下限（kg）"
          min={0}
          fieldProps={{ step: 0.5, precision: 2 }}
          extra="留空表示不限制"
        />
        <ProFormDigit
          name="maxWeight"
          label="重量上限（kg）"
          min={0}
          fieldProps={{ step: 0.5, precision: 2 }}
          extra="开区间上限（留空表示不限制）"
        />
        <ProFormDigit
          name="fee"
          label="运费（元）"
          min={0}
          fieldProps={{ step: 0.5, precision: 2 }}
          rules={[{ required: true, message: '请输入运费' }]}
        />
        <ProFormDigit
          name="priority"
          label="优先级"
          fieldProps={{ precision: 0 }}
          extra="数值越大优先级越高"
        />
        <ProFormSelect
          name="isActive"
          label="状态"
          rules={[{ required: true }]}
          options={[
            { label: '启用', value: true },
            { label: '停用', value: false },
          ]}
        />
      </ModalForm>
    </div>
  );
}
