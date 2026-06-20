import { App, Alert, Button, Card, Col, Descriptions, Form, Input, Row, Space, Spin, Tag } from 'antd';
import { EnvironmentOutlined, PhoneOutlined, SaveOutlined, UserOutlined } from '@ant-design/icons';
import { useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { getCompany, updateCompany } from '@/api/company';
import useAuthStore from '@/store/useAuthStore';
import type { Company, UpdateCompanyPayload } from '@/types';

const companyStatusMap: Record<Company['status'], { text: string; color: string }> = {
  PENDING: { text: '待启用', color: 'gold' },
  ACTIVE: { text: '正常', color: 'green' },
  SUSPENDED: { text: '已暂停', color: 'red' },
};

export default function CompanySettingsPage() {
  const { message } = App.useApp();
  const queryClient = useQueryClient();
  const canEdit = useAuthStore((s) => s.hasPermission('company:write'));
  const [form] = Form.useForm<UpdateCompanyPayload>();

  const { data: company, isLoading } = useQuery({
    queryKey: ['seller-company'],
    queryFn: getCompany,
  });

  useEffect(() => {
    if (!company) return;
    form.setFieldsValue({
      name: company.name,
      contactName: company.contactName,
      contactPhone: company.contactPhone,
      servicePhone: company.servicePhone || '',
    });
  }, [company, form]);

  const handleSubmit = async (values: UpdateCompanyPayload) => {
    try {
      const payload: UpdateCompanyPayload = {
        name: values.name?.trim(),
        contactName: values.contactName?.trim(),
        contactPhone: values.contactPhone?.trim(),
        servicePhone: values.servicePhone?.trim() || undefined,
      };
      await updateCompany(payload);
      message.success('配送中心资料已更新');
      queryClient.invalidateQueries({ queryKey: ['seller-company'] });
    } catch (err) {
      message.error(err instanceof Error ? err.message : '保存失败');
    }
  };

  if (isLoading || !company) {
    return <Spin size="large" style={{ display: 'block', margin: '96px auto' }} />;
  }

  const statusDisplay = companyStatusMap[company.status] || { text: company.status, color: 'default' };

  return (
    <Space direction="vertical" size={16} style={{ display: 'flex' }}>
      <Alert
        type="warning"
        showIcon
        message="当前配送中心资料只支持维护基础联系人信息。资质文件、AI 搜索资料和企业亮点不在 delivery 合同里。"
      />

      <Row gutter={[16, 16]}>
        <Col xs={24} lg={16}>
          <Card
            title="配送中心设置"
            styles={{ header: { borderTop: '3px solid #fa8c16' } }}
          >
            <Form<UpdateCompanyPayload>
              form={form}
              layout="vertical"
              onFinish={handleSubmit}
              disabled={!canEdit}
            >
              <Form.Item
                name="name"
                label="配送中心名称"
                rules={[{ required: true, message: '请输入配送中心名称' }]}
              >
                <Input placeholder="填写对外显示的配送中心名称" />
              </Form.Item>
              <Row gutter={16}>
                <Col xs={24} md={12}>
                  <Form.Item
                    name="contactName"
                    label="联系人"
                    rules={[{ required: true, message: '请输入联系人姓名' }]}
                  >
                    <Input prefix={<UserOutlined />} placeholder="联系人姓名" />
                  </Form.Item>
                </Col>
                <Col xs={24} md={12}>
                  <Form.Item
                    name="contactPhone"
                    label="联系人手机号"
                    rules={[{ required: true, message: '请输入联系人手机号' }]}
                  >
                    <Input prefix={<PhoneOutlined />} placeholder="联系人手机号" />
                  </Form.Item>
                </Col>
              </Row>
              <Form.Item name="servicePhone" label="客服/值班电话">
                <Input prefix={<PhoneOutlined />} placeholder="可选，给买家或协作方使用" />
              </Form.Item>
              {canEdit ? (
                <Button type="primary" htmlType="submit" icon={<SaveOutlined />}>
                  保存设置
                </Button>
              ) : (
                <Alert
                  type="info"
                  showIcon
                  message="当前账号只有查看权限，如需修改请联系管理员开通公司资料维护权限。"
                />
              )}
            </Form>
          </Card>
        </Col>

        <Col xs={24} lg={8}>
          <Card
            title="当前资料"
            styles={{ header: { borderTop: '3px solid #ffa940' } }}
          >
            <Descriptions column={1} size="small" labelStyle={{ width: 112 }}>
              <Descriptions.Item label="状态">
                <Tag color={statusDisplay.color}>{statusDisplay.text}</Tag>
              </Descriptions.Item>
              <Descriptions.Item label="配送中心 ID">{company.id}</Descriptions.Item>
              <Descriptions.Item label="联系人">{company.contactName}</Descriptions.Item>
              <Descriptions.Item label="联系手机">{company.contactPhone}</Descriptions.Item>
              <Descriptions.Item label="值班电话">
                {company.servicePhone || '-'}
              </Descriptions.Item>
              <Descriptions.Item label="创建时间">{company.createdAt}</Descriptions.Item>
              <Descriptions.Item label="更新时间">{company.updatedAt}</Descriptions.Item>
            </Descriptions>

            <div
              style={{
                marginTop: 16,
                padding: 12,
                borderRadius: 8,
                background: '#fff7e6',
                color: '#ad6800',
              }}
            >
              <Space size={8}>
                <EnvironmentOutlined />
                <span>本页只维护 delivery backend 当前开放的四个字段。</span>
              </Space>
            </div>
          </Card>
        </Col>
      </Row>
    </Space>
  );
}
