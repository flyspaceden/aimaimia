import { useEffect } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { App, Button, Card, Form, InputNumber, Space, Typography } from 'antd';
import { SettingOutlined } from '@ant-design/icons';
import { getGroupBuySettings, updateGroupBuySettings } from '@/api/group-buy';
import PermissionGate from '@/components/PermissionGate';
import { PERMISSIONS } from '@/constants/permissions';
import type { UpdateGroupBuySettingsInput } from '@/types';

export default function GroupBuySettingsPage() {
  const { message } = App.useApp();
  const queryClient = useQueryClient();
  const [form] = Form.useForm<UpdateGroupBuySettingsInput>();

  const { data, isLoading } = useQuery({
    queryKey: ['admin', 'group-buy', 'settings'],
    queryFn: getGroupBuySettings,
  });

  useEffect(() => {
    if (data) {
      form.setFieldsValue(data);
    }
  }, [data, form]);

  const mutation = useMutation({
    mutationFn: updateGroupBuySettings,
    onSuccess: (next) => {
      message.success('设置已保存');
      form.setFieldsValue(next);
      queryClient.invalidateQueries({ queryKey: ['admin', 'group-buy', 'settings'] });
    },
    onError: (err: Error) => message.error(err.message || '保存失败'),
  });

  const handleSubmit = async () => {
    const values = await form.validateFields();
    mutation.mutate({
      maxMonthlyLaunches: Number(values.maxMonthlyLaunches),
    });
  };

  return (
    <div style={{ padding: 24 }}>
      <Card
        title={<Space><SettingOutlined />团购设置</Space>}
        loading={isLoading}
        style={{ maxWidth: 720 }}
      >
        <Form form={form} layout="vertical" initialValues={{ maxMonthlyLaunches: 4 }}>
          <Form.Item
            name="maxMonthlyLaunches"
            label="每月最多发起次数"
            extra="同一用户每月可发起团购的次数上限；同一时间仍最多只能有一个进行中的分享。"
            rules={[
              { required: true, message: '请输入每月最多发起次数' },
              { type: 'number', min: 1, max: 100, message: '请输入 1 到 100 之间的整数' },
            ]}
          >
            <InputNumber min={1} max={100} precision={0} addonAfter="次 / 月" style={{ width: 220 }} />
          </Form.Item>
          <Typography.Paragraph type="secondary">
            该设置只影响新创建的团购支付会话，不改变用户已经发起的团购记录。
          </Typography.Paragraph>
          <PermissionGate permission={PERMISSIONS.GROUP_BUY_SETTINGS}>
            <Button type="primary" loading={mutation.isPending} onClick={handleSubmit}>
              保存设置
            </Button>
          </PermissionGate>
        </Form>
      </Card>
    </div>
  );
}
