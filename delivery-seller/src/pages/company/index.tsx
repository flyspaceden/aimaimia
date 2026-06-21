import { App, Button, Col, Descriptions, Form, Input, Row, Space, Spin, Statistic, Tag, Typography } from 'antd';
import {
  CheckCircleOutlined,
  LockOutlined,
  PhoneOutlined,
  SaveOutlined,
  ShopOutlined,
  UserOutlined,
} from '@ant-design/icons';
import { ProCard } from '@ant-design/pro-components';
import { useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import dayjs from 'dayjs';
import { getCompany, updateCompany } from '@/api/company';
import useAuthStore from '@/store/useAuthStore';
import { getStatusDisplay } from '@/constants/statusMaps';
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

  const statusDisplay = getStatusDisplay(companyStatusMap, company.status);

  return (
    <Space direction="vertical" size={16} style={{ display: 'flex' }}>
      <Row gutter={[16, 16]}>
        <Col xs={24} md={8}>
          <ProCard title="当前状态" headerBordered style={{ borderTop: '3px solid #EA580C' }}>
            <Space direction="vertical" size={12} style={{ width: '100%' }}>
              <Tag color={statusDisplay.color}>{statusDisplay.text}</Tag>
              <Statistic title="配送中心编号" value={company.id} valueStyle={{ fontSize: 18 }} />
              <Typography.Text type="secondary">
                更新时间 {dayjs(company.updatedAt).format('YYYY-MM-DD HH:mm')}
              </Typography.Text>
            </Space>
          </ProCard>
        </Col>
        <Col xs={24} md={8}>
          <ProCard title="基础资料" headerBordered style={{ borderTop: '3px solid #f59e0b' }}>
            <Descriptions column={1} size="small" labelStyle={{ width: 96 }}>
              <Descriptions.Item label="配送中心">{company.name}</Descriptions.Item>
              <Descriptions.Item label="创建时间">
                {dayjs(company.createdAt).format('YYYY-MM-DD HH:mm')}
              </Descriptions.Item>
            </Descriptions>
          </ProCard>
        </Col>
        <Col xs={24} md={8}>
          <ProCard title="操作权限" headerBordered style={{ borderTop: '3px solid #fb923c' }}>
            <Space direction="vertical" size={8}>
              <Tag icon={canEdit ? <CheckCircleOutlined /> : <LockOutlined />} color={canEdit ? 'green' : 'default'}>
                {canEdit ? '当前账号可以维护资料' : '当前账号只能查看资料'}
              </Tag>
              <Typography.Text type="secondary">
                资质资料、搜索资料和企业亮点由配送管理后台维护。
              </Typography.Text>
            </Space>
          </ProCard>
        </Col>
      </Row>

      <Row gutter={[16, 16]}>
        <Col xs={24} lg={16}>
          <ProCard title="资料维护" headerBordered style={{ borderTop: '3px solid #EA580C' }}>
            <Form<UpdateCompanyPayload>
              form={form}
              layout="vertical"
              onFinish={handleSubmit}
              disabled={!canEdit}
            >
              <Typography.Title level={5}>基础资料</Typography.Title>
              <Form.Item
                name="name"
                label="配送中心名称"
                rules={[{ required: true, message: '请输入配送中心名称' }]}
              >
                <Input prefix={<ShopOutlined />} placeholder="填写对外显示的配送中心名称" />
              </Form.Item>

              <Typography.Title level={5}>联系方式</Typography.Title>
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
              ) : null}
            </Form>
          </ProCard>
        </Col>

        <Col xs={24} lg={8}>
          <ProCard title="当前联系方式" headerBordered style={{ borderTop: '3px solid #ffa940' }}>
            <Descriptions column={1} size="small" labelStyle={{ width: 112 }}>
              <Descriptions.Item label="联系人">{company.contactName}</Descriptions.Item>
              <Descriptions.Item label="联系手机">{company.contactPhone}</Descriptions.Item>
              <Descriptions.Item label="值班电话">{company.servicePhone || '-'}</Descriptions.Item>
            </Descriptions>
          </ProCard>
        </Col>
      </Row>
    </Space>
  );
}
