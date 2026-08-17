import { useEffect, useRef, useState } from 'react';
import {
  Alert,
  App,
  Button,
  Form,
  Input,
  InputNumber,
  Modal,
  Segmented,
  Select,
  Space,
  Switch,
  Tag,
  Typography,
} from 'antd';
import {
  DeleteOutlined,
  EditOutlined,
  EnvironmentOutlined,
  PlusOutlined,
  UndoOutlined,
} from '@ant-design/icons';
import { ProTable } from '@ant-design/pro-components';
import type { ActionType, ProColumns } from '@ant-design/pro-components';
import dayjs from 'dayjs';
import {
  createPickupPoint,
  deletePickupPoint,
  getPickupPointCompanyOptions,
  getPickupPoints,
  restorePickupPoint,
  updatePickupPoint,
  type PickupPointPayload,
} from '@/api/pickup-points';
import PermissionGate from '@/components/PermissionGate';
import { PERMISSIONS } from '@/constants/permissions';
import type { PickupPoint } from '@/types';
import { formatPickupBusinessHours, pickupFullAddress } from '@/utils/pickup';

interface PickupPointFormValues {
  companyId: string;
  kind: 'MERCHANT' | 'PLATFORM_HUB';
  coverage: 'OWNER_COMPANY' | 'ALL_ACTIVE_COMPANIES' | 'SELECTED_COMPANIES';
  serviceCompanyIds?: string[];
  name: string;
  contactName: string;
  contactPhone: string;
  regionCode: string;
  regionText: string;
  detail: string;
  businessHoursSummary: string;
  holidayNotice?: string;
  pickupNotice?: string;
  lng?: number;
  lat?: number;
  poiName?: string;
  isActive: boolean;
  reason?: string;
}

interface LifecycleReasonValues {
  reason: string;
}

type LifecycleAction = 'delete' | 'restore';

const optionalText = (value?: string) => value?.trim() || undefined;

const businessHoursField = (
  point: PickupPoint,
  field: 'summary' | 'holidayNotice',
) => {
  const value = point.businessHours?.[field];
  return typeof value === 'string' ? value : undefined;
};

export default function PickupPointListPage() {
  const { message, modal } = App.useApp();
  const actionRef = useRef<ActionType>(null);
  const companySearchTimerRef = useRef<number | undefined>(undefined);
  const [form] = Form.useForm<PickupPointFormValues>();
  const [reasonForm] = Form.useForm<LifecycleReasonValues>();
  const [companyOptions, setCompanyOptions] = useState<Array<{ label: string; value: string; isPlatform: boolean }>>([]);
  const [companyOptionsLoading, setCompanyOptionsLoading] = useState(false);
  const [editing, setEditing] = useState<PickupPoint | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deletedView, setDeletedView] = useState(false);
  const [lifecycleTarget, setLifecycleTarget] = useState<PickupPoint | null>(null);
  const [lifecycleAction, setLifecycleAction] = useState<LifecycleAction>('delete');
  const [reasonOpen, setReasonOpen] = useState(false);
  const [lifecycleLoading, setLifecycleLoading] = useState(false);

  useEffect(() => {
    setCompanyOptionsLoading(true);
    getPickupPointCompanyOptions()
      .then((response) => {
        setCompanyOptions(
          response.items.map((company) => ({ label: company.name, value: company.id, isPlatform: company.isPlatform })),
        );
      })
      .catch(() => {
        message.error('企业列表加载失败，请刷新后重试');
      })
      .finally(() => {
        setCompanyOptionsLoading(false);
      });

    return () => {
      if (companySearchTimerRef.current !== undefined) {
        window.clearTimeout(companySearchTimerRef.current);
      }
    };
  }, [message]);

  useEffect(() => {
    actionRef.current?.reset?.();
  }, [deletedView]);

  const openCreate = () => {
    setEditing(null);
    form.resetFields();
    form.setFieldsValue({ isActive: true, kind: 'MERCHANT', coverage: 'OWNER_COMPANY', serviceCompanyIds: [] });
    setFormOpen(true);
  };

  const searchCompanyOptions = (keyword: string) => {
    if (companySearchTimerRef.current !== undefined) {
      window.clearTimeout(companySearchTimerRef.current);
    }
    companySearchTimerRef.current = window.setTimeout(async () => {
      setCompanyOptionsLoading(true);
      try {
        const response = await getPickupPointCompanyOptions(keyword.trim() || undefined);
        setCompanyOptions((current) => {
          const merged = new Map(current.map((option) => [option.value, option]));
          response.items.forEach((company) => {
            merged.set(company.id, { label: company.name, value: company.id, isPlatform: company.isPlatform });
          });
          return Array.from(merged.values());
        });
      } catch {
        message.error('企业搜索失败，请稍后重试');
      } finally {
        setCompanyOptionsLoading(false);
      }
    }, 300);
  };

  const openEdit = (point: PickupPoint) => {
    setEditing(point);
    form.setFieldsValue({
      companyId: point.companyId,
      kind: point.kind || 'MERCHANT',
      coverage: point.coverage || 'OWNER_COMPANY',
      serviceCompanyIds: point.serviceCompanies?.map((company) => company.id) || [],
      name: point.name,
      contactName: point.contactName,
      contactPhone: point.contactPhone,
      regionCode: point.regionCode,
      regionText: point.regionText,
      detail: point.detail,
      businessHoursSummary:
        businessHoursField(point, 'summary') || formatPickupBusinessHours(point.businessHours),
      holidayNotice: businessHoursField(point, 'holidayNotice'),
      pickupNotice: point.pickupNotice || undefined,
      lng: point.location?.lng,
      lat: point.location?.lat,
      poiName: point.location?.poiName,
      isActive: point.isActive,
      reason: undefined,
    });
    setFormOpen(true);
  };

  const buildPayload = (values: PickupPointFormValues): PickupPointPayload => {
    const hasLocation = typeof values.lng === 'number' && typeof values.lat === 'number';
    return {
      name: values.name.trim(),
      contactName: values.contactName.trim(),
      contactPhone: values.contactPhone.trim(),
      regionCode: values.regionCode.trim(),
      regionText: values.regionText.trim(),
      detail: values.detail.trim(),
      businessHours: {
        summary: values.businessHoursSummary.trim(),
        ...(optionalText(values.holidayNotice)
          ? { holidayNotice: optionalText(values.holidayNotice) }
          : {}),
      },
      pickupNotice: values.pickupNotice?.trim() || '',
      ...(!editing
        ? {
            isActive: values.isActive,
            kind: values.kind,
            coverage: values.kind === 'PLATFORM_HUB' ? values.coverage : 'OWNER_COMPANY',
            serviceCompanyIds: values.kind === 'PLATFORM_HUB' && values.coverage === 'SELECTED_COMPANIES'
              ? values.serviceCompanyIds || []
              : [],
          }
        : values.kind === 'PLATFORM_HUB'
          ? {
              coverage: values.coverage,
              serviceCompanyIds: values.coverage === 'SELECTED_COMPANIES'
                ? values.serviceCompanyIds || []
                : [],
            }
          : {}),
      location: hasLocation
        ? {
            lng: values.lng!,
            lat: values.lat!,
            provider: 'TENCENT',
            ...(optionalText(values.poiName) ? { poiName: optionalText(values.poiName) } : {}),
          }
        : editing
          ? null
          : undefined,
    };
  };

  const handleSave = async (values: PickupPointFormValues) => {
    const hasLng = typeof values.lng === 'number';
    const hasLat = typeof values.lat === 'number';
    if (hasLng !== hasLat) {
      message.error('地图经度和纬度需要同时填写');
      return;
    }

    setSaving(true);
    try {
      const payload = buildPayload(values);
      if (editing) {
        await updatePickupPoint(editing.id, {
          ...payload,
          reason: optionalText(values.reason),
        });
        message.success('自提点已更新');
      } else {
        await createPickupPoint({ ...payload, companyId: values.companyId });
        message.success('自提点已创建');
      }
      setFormOpen(false);
      setEditing(null);
      form.resetFields();
      actionRef.current?.reload();
    } catch (error) {
      message.error(error instanceof Error ? error.message : '保存自提点失败');
    } finally {
      setSaving(false);
    }
  };

  const toggleActive = (point: PickupPoint) => {
    const nextActive = !point.isActive;
    modal.confirm({
      title: nextActive ? '重新启用这个自提点？' : '平台停用这个自提点？',
      content: nextActive
        ? '启用后，该商家的新结算可以再次选择这个地点。'
        : '停用后新的结算不可选择；历史订单继续读取下单时冻结的地点快照。',
      okText: nextActive ? '启用' : '停用',
      okButtonProps: nextActive ? undefined : { danger: true },
      onOk: async () => {
        try {
          await updatePickupPoint(point.id, {
            isActive: nextActive,
            reason: nextActive ? '平台管理员启用自提点' : '平台管理员停用自提点',
          });
          message.success(nextActive ? '自提点已启用' : '自提点已停用');
          actionRef.current?.reload();
        } catch (error) {
          message.error(error instanceof Error ? error.message : '更新自提点状态失败');
          throw error;
        }
      },
    });
  };

  const openLifecycleReason = (action: LifecycleAction, point: PickupPoint) => {
    setLifecycleAction(action);
    setLifecycleTarget(point);
    reasonForm.resetFields();
    setReasonOpen(true);
  };

  const runLifecycleAction = async (reason: string) => {
    if (!lifecycleTarget) return;
    setLifecycleLoading(true);
    try {
      if (lifecycleAction === 'delete') {
        await deletePickupPoint(lifecycleTarget.id, reason);
        message.success('自提点已删除');
      } else {
        await restorePickupPoint(lifecycleTarget.id, reason);
        message.success('自提点已恢复并保持停用');
      }
      setReasonOpen(false);
      setLifecycleTarget(null);
      reasonForm.resetFields();
      actionRef.current?.reload();
    } catch (error) {
      message.error(error instanceof Error ? error.message : '自提点状态变更失败');
      throw error;
    } finally {
      setLifecycleLoading(false);
    }
  };

  const handleLifecycleSubmit = async () => {
    const { reason } = await reasonForm.validateFields();
    const normalizedReason = reason.trim();
    if (lifecycleAction === 'restore') {
      await runLifecycleAction(normalizedReason);
      return;
    }

    modal.confirm({
      title: `再次确认删除“${lifecycleTarget?.name || '该自提点'}”？`,
      content: '删除后新结算不可选择该点位，历史订单快照不会改变。可在“已删除”列表中填写原因后恢复，恢复时仍保持停用。',
      okText: '确认删除',
      okButtonProps: { danger: true },
      onOk: () => runLifecycleAction(normalizedReason),
    });
  };

  const columns: ProColumns<PickupPoint>[] = [
    {
      title: '自提点',
      dataIndex: 'name',
      width: 190,
      search: false,
      render: (_, point) => (
        <Space direction="vertical" size={0}>
          <Space size={6}>
            <Typography.Text strong delete={Boolean(point.deletedAt)}>
              {point.name}
            </Typography.Text>
            {point.deletedAt && <Tag color="default">已删除</Tag>}
          </Space>
          <Typography.Text type="secondary" style={{ fontSize: 12 }} copyable>
            {point.id}
          </Typography.Text>
        </Space>
      ),
    },
    {
      title: '所属企业',
      dataIndex: 'companyId',
      width: 190,
      renderFormItem: () => (
        <Select
          allowClear
          showSearch
          filterOption={false}
          loading={companyOptionsLoading}
          placeholder="选择企业"
          options={companyOptions}
          onSearch={searchCompanyOptions}
        />
      ),
      render: (_, point) => (
        <Space direction="vertical" size={0}>
          <Typography.Text>{point.company?.name || point.companyId}</Typography.Text>
          {point.company?.name && (
            <Typography.Text type="secondary" style={{ fontSize: 12 }} copyable>
              {point.companyId}
            </Typography.Text>
          )}
        </Space>
      ),
    },
    {
      title: '点位类型',
      dataIndex: 'kind',
      width: 200,
      valueType: 'select',
      valueEnum: {
        MERCHANT: { text: '企业自有' },
        PLATFORM_HUB: { text: '平台中心仓' },
      },
      render: (_, point) => point.kind === 'PLATFORM_HUB' ? (
        <Space direction="vertical" size={2}>
          <Tag color="green">平台中心仓</Tag>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            {point.coverage === 'ALL_ACTIVE_COMPANIES'
              ? '全部正常企业可选'
              : `指定 ${point.serviceCompanies?.length || 0} 家企业`}
          </Typography.Text>
        </Space>
      ) : <Tag>企业自有</Tag>,
    },
    {
      title: '地址',
      dataIndex: 'detail',
      width: 300,
      search: false,
      render: (_, point) => (
        <Space align="start">
          <EnvironmentOutlined style={{ color: point.deletedAt ? '#94A3B8' : '#2563EB', marginTop: 4 }} />
          <span>{pickupFullAddress(point)}</span>
        </Space>
      ),
    },
    {
      title: '营业时间',
      dataIndex: 'businessHours',
      width: 180,
      search: false,
      render: (_, point) => formatPickupBusinessHours(point.businessHours),
    },
    {
      title: '联系人',
      dataIndex: 'contactName',
      width: 150,
      search: false,
      render: (_, point) => (
        <Space direction="vertical" size={0}>
          <span>{point.contactName}</span>
          <Typography.Text type="secondary">{point.contactPhone}</Typography.Text>
        </Space>
      ),
    },
    {
      title: '营业状态',
      dataIndex: 'isActive',
      width: 120,
      valueType: 'select',
      hideInSearch: deletedView,
      valueEnum: {
        true: { text: '营业中' },
        false: { text: '已停用' },
      },
      render: (_, point) => (
        <Tag color={point.deletedAt ? 'default' : point.isActive ? 'success' : 'warning'}>
          {point.deletedAt ? '已删除' : point.isActive ? '营业中' : '已停用'}
        </Tag>
      ),
    },
    {
      title: '删除审计',
      key: 'deleteAudit',
      width: 250,
      search: false,
      hideInTable: !deletedView,
      render: (_, point) => (
        <Space direction="vertical" size={0}>
          <Typography.Text>{point.deleteReason || '未记录原因'}</Typography.Text>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            {point.deletedAt ? dayjs(point.deletedAt).format('YYYY-MM-DD HH:mm') : '-'}
            {point.deletedByAdminId ? ` · 管理员 ${point.deletedByAdminId}` : ''}
          </Typography.Text>
        </Space>
      ),
    },
    {
      title: '平台操作',
      valueType: 'option',
      width: deletedView ? 110 : 260,
      render: (_, point) => {
        if (deletedView || point.deletedAt) {
          return [
            <PermissionGate key="restore" permission={PERMISSIONS.PICKUP_POINTS_DELETE}>
              <Button
                type="link"
                size="small"
                icon={<UndoOutlined />}
                onClick={() => openLifecycleReason('restore', point)}
              >
                恢复
              </Button>
            </PermissionGate>,
          ];
        }

        return [
          <PermissionGate key="edit" permission={PERMISSIONS.PICKUP_POINTS_UPDATE}>
            <Button
              type="link"
              size="small"
              icon={<EditOutlined />}
              onClick={() => openEdit(point)}
            >
              编辑
            </Button>
          </PermissionGate>,
          <PermissionGate key="active" permission={PERMISSIONS.PICKUP_POINTS_UPDATE}>
            <Button
              type="link"
              size="small"
              danger={point.isActive}
              onClick={() => toggleActive(point)}
            >
              {point.isActive ? '停用' : '启用'}
            </Button>
          </PermissionGate>,
          <PermissionGate key="delete" permission={PERMISSIONS.PICKUP_POINTS_DELETE}>
            <Button
              type="link"
              size="small"
              danger
              icon={<DeleteOutlined />}
              onClick={() => openLifecycleReason('delete', point)}
            >
              删除
            </Button>
          </PermissionGate>,
        ];
      },
    },
  ];

  return (
    <div style={{ padding: 24 }}>
      <Alert
        type="info"
        showIcon
        message="平台可跨企业管理自提点"
        description="企业自有点只服务所属企业。平台中心仓必须归属平台公司，可服务全部正常企业或指定企业；买家结算始终按服务端授权显示。编辑、启停、删除和恢复均受独立权限控制并由后台审计。"
        style={{ marginBottom: 16 }}
      />
      <ProTable<PickupPoint>
        actionRef={actionRef}
        rowKey="id"
        headerTitle="自提点管理"
        columns={columns}
        request={async (params) => {
          const rawActive = params.isActive;
          const isActive = rawActive === true || rawActive === 'true'
            ? true
            : rawActive === false || rawActive === 'false'
              ? false
              : undefined;
          const response = await getPickupPoints({
            page: params.current || 1,
            pageSize: params.pageSize || 20,
            companyId: params.companyId || undefined,
            isActive,
            isDeleted: deletedView,
          });
          return { data: response.items, total: response.total, success: true };
        }}
        search={{ labelWidth: 'auto', defaultCollapsed: false }}
        pagination={{ defaultPageSize: 20, showSizeChanger: true, showQuickJumper: true }}
        scroll={{ x: deletedView ? 1680 : 1500 }}
        toolBarRender={() => [
          <Segmented
            key="deleted-filter"
            value={deletedView ? 'deleted' : 'normal'}
            options={[
              { label: '正常点位', value: 'normal' },
              { label: '已删除', value: 'deleted' },
            ]}
            onChange={(value) => setDeletedView(value === 'deleted')}
          />,
          !deletedView && (
            <PermissionGate key="create" permission={PERMISSIONS.PICKUP_POINTS_CREATE}>
              <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
                新建自提点
              </Button>
            </PermissionGate>
          ),
        ]}
      />

      <Modal
        title={editing ? '编辑自提点' : '新建自提点'}
        open={formOpen}
        width={760}
        onCancel={() => {
          if (!saving) {
            setFormOpen(false);
            setEditing(null);
            form.resetFields();
          }
        }}
        onOk={() => form.submit()}
        okText="保存"
        confirmLoading={saving}
        maskClosable={!saving}
        destroyOnHidden
      >
        <Form form={form} layout="vertical" onFinish={handleSave} requiredMark="optional">
          <Form.Item
            name="companyId"
            label="所属企业"
            rules={[{ required: true, message: '请选择所属企业' }]}
            extra={editing ? '所属企业创建后不可更改。' : '该点位将归属所选企业。'}
          >
            <Select
              disabled={Boolean(editing)}
              showSearch
              filterOption={false}
              loading={companyOptionsLoading}
              placeholder="搜索并选择企业"
              options={companyOptions}
              onSearch={searchCompanyOptions}
            />
          </Form.Item>
          <Form.Item
            name="kind"
            label="点位类型"
            rules={[{ required: true, message: '请选择点位类型' }]}
            extra={editing ? '点位创建后不能在企业自有点和平台中心仓之间转换。' : '平台中心仓只能选择平台公司作为所属企业。'}
          >
            <Select
              disabled={Boolean(editing)}
              options={[
                { value: 'MERCHANT', label: '企业自有自提点' },
                { value: 'PLATFORM_HUB', label: '平台中心仓' },
              ]}
            />
          </Form.Item>
          <Form.Item shouldUpdate noStyle>
            {() => form.getFieldValue('kind') === 'PLATFORM_HUB' ? <>
              <Form.Item
                name="coverage"
                label="中心仓服务范围"
                rules={[{ required: true, message: '请选择中心仓服务范围' }]}
                extra="系统只向获授权企业的订单展示该中心仓；既有已付款订单继续读取下单时冻结的地点快照。"
              >
                <Select options={[
                  { value: 'ALL_ACTIVE_COMPANIES', label: '所有正常经营企业' },
                  { value: 'SELECTED_COMPANIES', label: '仅指定企业' },
                ]} />
              </Form.Item>
              <Form.Item shouldUpdate noStyle>
                {() => form.getFieldValue('coverage') === 'SELECTED_COMPANIES' ? <Form.Item
                  name="serviceCompanyIds"
                  label="获授权企业"
                  rules={[{ required: true, type: 'array', min: 1, message: '请至少选择一家企业' }]}
                >
                  <Select
                    mode="multiple"
                    showSearch
                    filterOption={false}
                    loading={companyOptionsLoading}
                    placeholder="搜索并选择可使用中心仓的企业"
                    options={companyOptions}
                    onSearch={searchCompanyOptions}
                  />
                </Form.Item> : null}
              </Form.Item>
            </> : null}
          </Form.Item>
          <Form.Item
            name="name"
            label="自提点名称"
            rules={[{ required: true, whitespace: true, message: '请输入自提点名称' }, { max: 100 }]}
          >
            <Input placeholder="例如：爱买买南山自提点" maxLength={100} showCount />
          </Form.Item>
          <Space align="start" size={16} style={{ display: 'flex' }}>
            <Form.Item
              name="contactName"
              label="联系人"
              style={{ flex: 1 }}
              rules={[{ required: true, whitespace: true, message: '请输入联系人' }, { max: 50 }]}
            >
              <Input maxLength={50} />
            </Form.Item>
            <Form.Item
              name="contactPhone"
              label="联系电话"
              style={{ flex: 1 }}
              rules={[
                { required: true, message: '请输入联系电话' },
                { pattern: /^1[3-9]\d{9}$/, message: '请输入正确的 11 位手机号' },
              ]}
            >
              <Input maxLength={11} />
            </Form.Item>
          </Space>
          <Space align="start" size={16} style={{ display: 'flex' }}>
            <Form.Item
              name="regionText"
              label="省市区"
              style={{ flex: 2 }}
              rules={[{ required: true, whitespace: true, message: '请输入省市区' }, { max: 120 }]}
            >
              <Input placeholder="广东省/深圳市/南山区" maxLength={120} />
            </Form.Item>
            <Form.Item
              name="regionCode"
              label="地区编码"
              style={{ flex: 1 }}
              rules={[{ required: true, whitespace: true, message: '请输入地区编码' }, { max: 32 }]}
            >
              <Input placeholder="440305" maxLength={32} />
            </Form.Item>
          </Space>
          <Form.Item
            name="detail"
            label="详细地址"
            rules={[{ required: true, whitespace: true, message: '请输入详细地址' }, { max: 200 }]}
          >
            <Input.TextArea rows={2} maxLength={200} showCount placeholder="街道、园区、楼层和门牌号" />
          </Form.Item>
          <Form.Item
            name="businessHoursSummary"
            label="营业时间"
            rules={[{ required: true, whitespace: true, message: '请输入营业时间' }, { max: 200 }]}
          >
            <Input placeholder="例如：周一至周日 09:00-18:00" maxLength={200} showCount />
          </Form.Item>
          <Form.Item name="holidayNotice" label="节假日说明" rules={[{ max: 200 }]}>
            <Input placeholder="可选，例如：法定节假日提前一天闭店" maxLength={200} showCount />
          </Form.Item>
          <Form.Item name="pickupNotice" label="取货须知" rules={[{ max: 500 }]}>
            <Input.TextArea rows={3} maxLength={500} showCount placeholder="例如：请从园区东门进入，出示取货码后领取" />
          </Form.Item>
          <Typography.Title level={5}>地图位置（可选）</Typography.Title>
          <Space align="start" size={16} style={{ display: 'flex' }}>
            <Form.Item name="lng" label="经度" style={{ flex: 1 }}>
              <InputNumber style={{ width: '100%' }} min={-180} max={180} precision={6} placeholder="113.930000" />
            </Form.Item>
            <Form.Item name="lat" label="纬度" style={{ flex: 1 }}>
              <InputNumber style={{ width: '100%' }} min={-90} max={90} precision={6} placeholder="22.540000" />
            </Form.Item>
            <Form.Item name="poiName" label="地图地点名" style={{ flex: 1 }} rules={[{ max: 120 }]}>
              <Input maxLength={120} placeholder="园区/商场名称" />
            </Form.Item>
          </Space>
          {editing ? (
            <Form.Item label="营业状态">
              <Switch
                checked={editing.isActive}
                disabled
                checkedChildren="营业中"
                unCheckedChildren="已停用"
              />
              <Typography.Text type="secondary" style={{ marginLeft: 12 }}>
                请在列表中单独启用或停用，以便再次确认影响范围。
              </Typography.Text>
            </Form.Item>
          ) : (
            <Form.Item name="isActive" label="营业状态" valuePropName="checked">
              <Switch checkedChildren="营业中" unCheckedChildren="已停用" />
            </Form.Item>
          )}
          {editing && (
            <Form.Item name="reason" label="修改原因" rules={[{ max: 500 }]}>
              <Input.TextArea rows={2} maxLength={500} showCount placeholder="选填，将随本次修改写入审计记录" />
            </Form.Item>
          )}
        </Form>
      </Modal>

      <Modal
        title={lifecycleAction === 'delete' ? '填写删除原因' : '填写恢复原因'}
        open={reasonOpen}
        onCancel={() => {
          if (!lifecycleLoading) {
            setReasonOpen(false);
            setLifecycleTarget(null);
            reasonForm.resetFields();
          }
        }}
        onOk={handleLifecycleSubmit}
        okText={lifecycleAction === 'delete' ? '下一步' : '确认恢复'}
        okButtonProps={lifecycleAction === 'delete' ? { danger: true } : undefined}
        confirmLoading={lifecycleLoading}
        maskClosable={!lifecycleLoading}
        destroyOnHidden
      >
        <Alert
          type={lifecycleAction === 'delete' ? 'warning' : 'info'}
          showIcon
          message={
            lifecycleAction === 'delete'
              ? '填写原因后还需再次确认删除'
              : '恢复后点位保持停用，不会立即对买家开放'
          }
          style={{ marginBottom: 16 }}
        />
        <Form form={reasonForm} layout="vertical" requiredMark={false}>
          <Form.Item
            name="reason"
            label={lifecycleAction === 'delete' ? '删除原因' : '恢复原因'}
            rules={[
              { required: true, message: '请填写原因' },
              { max: 500, message: '原因不能超过 500 个字符' },
              {
                validator: (_, value: string | undefined) =>
                  value?.trim() ? Promise.resolve() : Promise.reject(new Error('原因不能只包含空格')),
              },
            ]}
          >
            <Input.TextArea rows={4} maxLength={500} showCount autoFocus />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
