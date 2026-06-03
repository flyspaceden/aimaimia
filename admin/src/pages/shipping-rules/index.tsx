import { useRef, useState, useCallback, useEffect } from 'react';
import { ProTable, ModalForm, ProFormText, ProFormDigit, ProFormSelect } from '@ant-design/pro-components';
import type { ActionType, ProColumns } from '@ant-design/pro-components';
import { App, Button, Tag, Space, Popconfirm, Card, InputNumber, Alert, Row, Col, Spin, Tooltip, Typography, Switch } from 'antd';
import { PlusOutlined, EditOutlined, DeleteOutlined, WarningOutlined, SaveOutlined, InfoCircleOutlined, UploadOutlined } from '@ant-design/icons';
import {
  listRules,
  createShippingRule,
  updateShippingRule,
  deleteShippingRule,
} from '@/api/shipping-rules';
import type { ShippingRule } from '@/api/shipping-rules';
import { getConfigs, updateConfig } from '@/api/config';
import { extractConfigValue } from '@/types';
import PermissionGate from '@/components/PermissionGate';
import { PERMISSIONS } from '@/constants/permissions';
import ImportDialog from './components/ImportDialog';
import PreviewPanel from './components/PreviewPanel';
import {
  SHIPPING_REGION_OPTIONS,
  formatRuleRegionCodes,
  normalizeRuleRegionCodesForForm,
  normalizeSelectedRegionCodes,
} from './regions';
import dayjs from 'dayjs';

const { Text } = Typography;

// 运费规则状态映射
const getRuleStatusMeta = (isActive: boolean) => (
  isActive
    ? { text: '启用', color: 'green' }
    : { text: '停用', color: 'default' }
);

interface ShippingRuleFormValues {
  name: string;
  regionCodes?: string[];
  firstWeightKg: number;
  firstFee: number;
  additionalWeightKg: number;
  additionalFee: number;
  minChargeWeightKg: number;
  isActive?: boolean;
}

/** 检测两个地区列表是否有交集（空数组视为"全国"，与任何地区交叉） */
const regionsOverlap = (a: string[], b: string[]): boolean => {
  if (a.length === 0 || b.length === 0) return true; // 全国与任何地区交叉
  const provincePrefixes = new Set(normalizeRuleRegionCodesForForm(a));
  return normalizeRuleRegionCodesForForm(b).some((prefix) => provincePrefixes.has(prefix));
};

export default function ShippingRulesPage() {
  const { message, modal } = App.useApp();
  const actionRef = useRef<ActionType>(null);
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [editModal, setEditModal] = useState<{ visible: boolean; rule: ShippingRule | null }>({
    visible: false,
    rule: null,
  });
  const [importOpen, setImportOpen] = useState(false);

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

  // 冲突检测：给定当前编辑的规则，找到与之条件重叠的其他规则
  const detectConflicts = useCallback((formRule: {
    regionCodes: string[];
  }, editingId?: string): ShippingRule[] => {
    return allRules.filter((existing) => {
      // 排除自身
      if (editingId && existing.id === editingId) return false;
      // 排除停用规则
      if (!existing.isActive) return false;
      // 检测地区重叠
      if (!regionsOverlap(formRule.regionCodes, existing.regionCodes)) return false;
      return true;
    });
  }, [allRules]);

  // 编辑弹窗中的冲突状态
  const [formConflicts, setFormConflicts] = useState<ShippingRule[]>([]);

  // 表单值变化时重新检测冲突
  const handleFormValuesChange = useCallback((_: unknown, allValues: ShippingRuleFormValues) => {
    const regionCodes = normalizeSelectedRegionCodes(allValues.regionCodes);
    const conflicts = detectConflicts(
      { regionCodes },
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
      modal.error({
        title: '无法删除',
        content: (
          <div style={{ fontSize: 16, lineHeight: 1.7, paddingTop: 8 }}>
            {err instanceof Error ? err.message : '删除失败'}
          </div>
        ),
        width: 520,
        centered: true,
        okText: '知道了',
      });
    }
  };

  const handleStatusToggle = async (id: string, checked: boolean) => {
    try {
      setTogglingId(id);
      await updateShippingRule(id, { isActive: checked });
      message.success(checked ? '已启用' : '已停用');
      actionRef.current?.reload();
    } catch (err) {
      modal.error({
        title: checked ? '无法启用' : '无法停用',
        content: (
          <div style={{ fontSize: 16, lineHeight: 1.7, paddingTop: 8 }}>
            {err instanceof Error ? err.message : '状态更新失败'}
          </div>
        ),
        width: 520,
        centered: true,
        okText: '知道了',
      });
    } finally {
      setTogglingId(null);
    }
  };

  const columns: ProColumns<ShippingRule>[] = [
    {
      title: '#',
      dataIndex: 'rowIndex',
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
      render: (_: unknown, r: ShippingRule) => formatRuleRegionCodes(r.regionCodes),
    },
    {
      title: '首重重量',
      dataIndex: 'firstWeightKg',
      width: 110,
      search: false,
      render: (_: unknown, r: ShippingRule) => `${r.firstWeightKg ?? 3}kg`,
    },
    {
      title: '首重价',
      dataIndex: 'firstFee',
      width: 110,
      search: false,
      render: (_: unknown, r: ShippingRule) => `¥${Number(r.firstFee ?? r.fee ?? 0).toFixed(2)}`,
    },
    {
      title: '续重单位',
      dataIndex: 'additionalWeightKg',
      width: 110,
      search: false,
      render: (_: unknown, r: ShippingRule) => `${r.additionalWeightKg ?? 1}kg`,
    },
    {
      title: '续重价',
      dataIndex: 'additionalFee',
      width: 110,
      search: false,
      render: (_: unknown, r: ShippingRule) => `¥${Number(r.additionalFee ?? 0).toFixed(2)}`,
    },
    {
      title: '状态',
      dataIndex: 'isActive',
      width: 110,
      search: false,
      render: (_: unknown, r: ShippingRule) => {
        const s = getRuleStatusMeta(r.isActive);
        return (
          <PermissionGate
            permission={PERMISSIONS.SHIPPING_UPDATE}
            fallback={<Tag color={s.color}>{s.text}</Tag>}
          >
            <Switch
              size="small"
              checkedChildren="启用"
              unCheckedChildren="停用"
              checked={r.isActive}
              loading={togglingId === r.id}
              onChange={(checked) => handleStatusToggle(r.id, checked)}
            />
          </PermissionGate>
        );
      },
    },
    {
      title: '更新时间',
      dataIndex: 'updatedAt',
      width: 160,
      search: false,
      render: (_: unknown, r: ShippingRule) => dayjs(r.updatedAt).format('YYYY-MM-DD HH:mm'),
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
          const res = await listRules({
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
          return '';
        }}
        toolBarRender={() => [
          <PermissionGate key="import" permission={PERMISSIONS.SHIPPING_UPDATE}>
            <Button icon={<UploadOutlined />} onClick={() => setImportOpen(true)}>
              批量导入
            </Button>
          </PermissionGate>,
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

      <PreviewPanel />
      <ImportDialog
        open={importOpen}
        onOpenChange={setImportOpen}
        onSuccess={() => actionRef.current?.reload()}
      />

      {/* 内联样式：停用规则弱化 */}
      <style>{`
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
          regionCodes: normalizeRuleRegionCodesForForm(editModal.rule.regionCodes),
          firstWeightKg: editModal.rule.firstWeightKg ?? 3,
          firstFee: editModal.rule.firstFee ?? editModal.rule.fee,
          additionalWeightKg: editModal.rule.additionalWeightKg ?? 1,
          additionalFee: editModal.rule.additionalFee ?? 0,
          minChargeWeightKg: editModal.rule.minChargeWeightKg ?? 1,
          isActive: editModal.rule.isActive,
        } : {
          firstWeightKg: 3,
          additionalWeightKg: 1,
          additionalFee: 0,
          minChargeWeightKg: 1,
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
          if (values.firstWeightKg <= 0) {
            message.error('首重重量必须大于 0');
            return false;
          }
          if (values.firstFee <= 0) {
            message.error('首重价必须大于 0');
            return false;
          }
          if (values.additionalWeightKg <= 0) {
            message.error('续重单位必须大于 0');
            return false;
          }
          if (values.additionalFee < 0 || values.minChargeWeightKg < 0) {
            message.error('续重价和最小计费重量不能小于 0');
            return false;
          }

          const regionCodes = normalizeSelectedRegionCodes(values.regionCodes);

          const payload = {
            name: values.name,
            regionCodes,
            fee: values.firstFee,
            firstWeightKg: values.firstWeightKg,
            firstFee: values.firstFee,
            additionalWeightKg: values.additionalWeightKg,
            additionalFee: values.additionalFee,
            minChargeWeightKg: values.minChargeWeightKg,
            isActive: values.isActive ?? true,
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
                    地区: {formatRuleRegionCodes(c.regionCodes)}，
                    首重: {c.firstWeightKg ?? 3}kg / ¥{Number(c.firstFee ?? c.fee ?? 0).toFixed(2)}，
                    续重: {c.additionalWeightKg ?? 1}kg / ¥{Number(c.additionalFee ?? 0).toFixed(2)}
                  </div>
                ))}
                <div style={{ marginTop: 8, color: '#666', fontSize: 12 }}>
                  地区范围重叠会影响最终命中规则；建议停用或删除重复地区规则。
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
        <ProFormSelect
          name="regionCodes"
          label="适用地区"
          extra="不选择表示全国规则。这里使用行政区划省级归属，不是邮政编码。"
          placeholder="选择省份/自治区/直辖市"
          options={SHIPPING_REGION_OPTIONS}
          fieldProps={{
            mode: 'multiple',
            allowClear: true,
            showSearch: true,
            optionFilterProp: 'label',
            maxTagCount: 'responsive',
          }}
        />
        <ProFormDigit
          name="firstWeightKg"
          label="首重重量（kg）"
          min={0.01}
          fieldProps={{ step: 0.5, precision: 2 }}
          rules={[{ required: true, message: '请输入首重重量' }]}
        />
        <ProFormDigit
          name="firstFee"
          label="首重价（元）"
          min={0.01}
          fieldProps={{ step: 0.5, precision: 2 }}
          rules={[{ required: true, message: '请输入首重价' }]}
          extra="将同步写入 fee 兼容字段"
        />
        <ProFormDigit
          name="additionalWeightKg"
          label="续重单位（kg）"
          min={0.01}
          fieldProps={{ step: 0.5, precision: 2 }}
          rules={[{ required: true, message: '请输入续重单位' }]}
        />
        <ProFormDigit
          name="additionalFee"
          label="续重价（元）"
          min={0}
          fieldProps={{ step: 0.5, precision: 2 }}
          rules={[{ required: true, message: '请输入续重价' }]}
        />
        <ProFormDigit
          name="minChargeWeightKg"
          label="最小计费重量（kg）"
          min={0}
          fieldProps={{ step: 0.5, precision: 2 }}
          rules={[{ required: true, message: '请输入最小计费重量' }]}
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
