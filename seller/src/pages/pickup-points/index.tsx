import { useRef, useState } from 'react';
import {
  Alert,
  App,
  Button,
  Form,
  Input,
  InputNumber,
  Modal,
  Space,
  Switch,
  Tag,
  Typography,
} from 'antd';
import { EnvironmentOutlined, PlusOutlined } from '@ant-design/icons';
import { ProTable } from '@ant-design/pro-components';
import type { ActionType, ProColumns } from '@ant-design/pro-components';
import {
  createPickupPoint,
  getPickupPoints,
  updatePickupPoint,
  type PickupPointPayload,
} from '@/api/pickup-points';
import type { PickupPoint } from '@/types';
import { formatPickupBusinessHours, pickupFullAddress } from '@/utils/pickup';

interface PickupPointFormValues {
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
}

export default function PickupPointListPage() {
  const { message, modal } = App.useApp();
  const actionRef = useRef<ActionType>(null);
  const [form] = Form.useForm<PickupPointFormValues>();
  const [editing, setEditing] = useState<PickupPoint | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  const openCreate = () => {
    setEditing(null);
    form.resetFields();
    setFormOpen(true);
  };

  const openEdit = (point: PickupPoint) => {
    setEditing(point);
    form.setFieldsValue({
      name: point.name,
      contactName: point.contactName,
      contactPhone: point.contactPhone,
      regionCode: point.regionCode,
      regionText: point.regionText,
      detail: point.detail,
      businessHoursSummary: formatPickupBusinessHours(point.businessHours),
      holidayNotice:
        typeof point.businessHours?.holidayNotice === 'string'
          ? point.businessHours.holidayNotice
          : undefined,
      pickupNotice: point.pickupNotice || undefined,
      lng: point.location?.lng,
      lat: point.location?.lat,
      poiName: point.location?.poiName,
    });
    setFormOpen(true);
  };

  const handleSave = async (values: PickupPointFormValues) => {
    const hasLng = typeof values.lng === 'number';
    const hasLat = typeof values.lat === 'number';
    if (hasLng !== hasLat) {
      message.error('地图经度和纬度需要同时填写');
      return;
    }

    const payload: PickupPointPayload = {
      name: values.name.trim(),
      contactName: values.contactName.trim(),
      contactPhone: values.contactPhone.trim(),
      regionCode: values.regionCode.trim(),
      regionText: values.regionText.trim(),
      detail: values.detail.trim(),
      businessHours: {
        summary: values.businessHoursSummary.trim(),
        ...(values.holidayNotice?.trim()
          ? { holidayNotice: values.holidayNotice.trim() }
          : {}),
      },
      pickupNotice: values.pickupNotice?.trim() || '',
      location: hasLng && hasLat
        ? {
            lng: values.lng!,
            lat: values.lat!,
            provider: 'TENCENT',
            ...(values.poiName?.trim() ? { poiName: values.poiName.trim() } : {}),
          }
        : editing ? null : undefined,
    };

    setSaving(true);
    try {
      if (editing) {
        await updatePickupPoint(editing.id, payload);
        message.success('自提点已更新');
      } else {
        await createPickupPoint(payload);
        message.success('自提点已创建');
      }
      setFormOpen(false);
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
      title: nextActive ? '重新启用这个自提点？' : '停用这个自提点？',
      content: nextActive
        ? '启用后，新的结算可以选择这个地点。'
        : '停用后新的结算不可选择；历史订单仍保留当时的地点快照。',
      okText: nextActive ? '启用' : '停用',
      okButtonProps: nextActive ? undefined : { danger: true },
      onOk: async () => {
        try {
          await updatePickupPoint(point.id, { isActive: nextActive });
          message.success(nextActive ? '自提点已启用' : '自提点已停用');
          actionRef.current?.reload();
        } catch (error) {
          message.error(error instanceof Error ? error.message : '更新营业状态失败');
        }
      },
    });
  };

  const columns: ProColumns<PickupPoint>[] = [
    {
      title: '自提点',
      dataIndex: 'name',
      width: 180,
      search: false,
      render: (_, point) => (
        <Space direction="vertical" size={0}>
          <Typography.Text strong>{point.name}</Typography.Text>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            {point.id}
          </Typography.Text>
        </Space>
      ),
    },
    {
      title: '地址',
      dataIndex: 'detail',
      width: 280,
      search: false,
      render: (_, point) => (
        <Space align="start">
          <EnvironmentOutlined style={{ color: '#2E7D32', marginTop: 4 }} />
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
      width: 110,
      valueType: 'select',
      valueEnum: {
        true: { text: '营业中' },
        false: { text: '已停用' },
      },
      render: (_, point) => (
        <Tag color={point.isActive ? 'success' : 'default'}>
          {point.isActive ? '营业中' : '已停用'}
        </Tag>
      ),
    },
    {
      title: '操作',
      valueType: 'option',
      width: 170,
      render: (_, point) => [
        <Button key="edit" type="link" size="small" onClick={() => openEdit(point)}>
          编辑
        </Button>,
        <Button
          key="active"
          type="link"
          size="small"
          danger={point.isActive}
          onClick={() => toggleActive(point)}
        >
          {point.isActive ? '停用' : '启用'}
        </Button>,
      ],
    },
  ];

  return (
    <div>
      <Alert
        showIcon
        type="info"
        message="自提点会在买家结算时按商家展示"
        description="停用只影响新的结算；已经付款的订单继续读取下单时冻结的地点、营业时间和取货须知。"
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
            ...(typeof isActive === 'boolean' ? { isActive } : {}),
          });
          return { data: response.items, total: response.total, success: true };
        }}
        pagination={{ defaultPageSize: 20, showSizeChanger: true }}
        search={{ labelWidth: 'auto' }}
        scroll={{ x: 1120 }}
        toolBarRender={() => [
          <Button key="create" type="primary" icon={<PlusOutlined />} onClick={openCreate}>
            新建自提点
          </Button>,
        ]}
      />

      <Modal
        title={editing ? '编辑自提点' : '新建自提点'}
        open={formOpen}
        width={720}
        onCancel={() => !saving && setFormOpen(false)}
        onOk={() => form.submit()}
        okText="保存"
        confirmLoading={saving}
        maskClosable={!saving}
        destroyOnHidden
      >
        <Form form={form} layout="vertical" onFinish={handleSave} requiredMark="optional">
          <Form.Item name="name" label="自提点名称" rules={[{ required: true, message: '请输入自提点名称' }, { max: 80 }]}>
            <Input placeholder="例如：爱买买南山自提点" maxLength={80} showCount />
          </Form.Item>
          <Space align="start" size={16} style={{ display: 'flex' }}>
            <Form.Item name="contactName" label="联系人" style={{ flex: 1 }} rules={[{ required: true, message: '请输入联系人' }, { max: 50 }]}>
              <Input maxLength={50} />
            </Form.Item>
            <Form.Item name="contactPhone" label="联系电话" style={{ flex: 1 }} rules={[{ required: true, message: '请输入联系电话' }, { pattern: /^1[3-9]\d{9}$/, message: '请输入正确的 11 位手机号' }]}>
              <Input maxLength={11} />
            </Form.Item>
          </Space>
          <Space align="start" size={16} style={{ display: 'flex' }}>
            <Form.Item name="regionText" label="省市区" style={{ flex: 2 }} rules={[{ required: true, message: '请输入省市区' }, { max: 120 }]}>
              <Input placeholder="广东省/深圳市/南山区" maxLength={120} />
            </Form.Item>
            <Form.Item name="regionCode" label="地区编码" style={{ flex: 1 }} rules={[{ required: true, message: '请输入地区编码' }, { max: 32 }]}>
              <Input placeholder="440305" maxLength={32} />
            </Form.Item>
          </Space>
          <Form.Item name="detail" label="详细地址" rules={[{ required: true, message: '请输入详细地址' }, { max: 200 }]}>
            <Input.TextArea rows={2} maxLength={200} showCount placeholder="街道、园区、楼层和门牌号" />
          </Form.Item>
          <Form.Item name="businessHoursSummary" label="营业时间" rules={[{ required: true, message: '请输入营业时间' }, { max: 200 }]}>
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
            <Form.Item name="poiName" label="地图地点名" style={{ flex: 1 }} rules={[{ max: 100 }]}>
              <Input maxLength={100} placeholder="园区/商场名称" />
            </Form.Item>
          </Space>
          {editing && (
            <Form.Item label="当前状态">
              <Switch checked={editing.isActive} disabled checkedChildren="营业中" unCheckedChildren="已停用" />
              <Typography.Text type="secondary" style={{ marginLeft: 12 }}>
                请在列表中启用或停用，以便再次确认影响范围。
              </Typography.Text>
            </Form.Item>
          )}
        </Form>
      </Modal>
    </div>
  );
}
