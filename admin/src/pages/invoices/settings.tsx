import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ProForm,
  ProFormDigit,
  ProFormSelect,
  ProFormSwitch,
  ProFormText,
  ProFormTextArea,
} from '@ant-design/pro-components';
import { App, Button, Card, Col, Row, Skeleton, Space, Typography } from 'antd';
import { ArrowLeftOutlined, SettingOutlined } from '@ant-design/icons';
import {
  getInvoiceSettings,
  updateInvoiceSettings,
} from '@/api/invoices';
import type { InvoiceSettings } from '@/api/invoices';

const { Text } = Typography;

export default function InvoiceSettingsPage() {
  const { message } = App.useApp();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ['admin', 'invoice-settings'],
    queryFn: getInvoiceSettings,
  });

  const [form] = ProForm.useForm<InvoiceSettings>();

  useEffect(() => {
    if (data) form.setFieldsValue(data);
  }, [data, form]);

  const handleSave = async (values: InvoiceSettings) => {
    await updateInvoiceSettings(values);
    message.success('发票设置已保存');
    queryClient.invalidateQueries({ queryKey: ['admin', 'invoice-settings'] });
    return true;
  };

  return (
    <div style={{ padding: 24 }}>
      <Space style={{ marginBottom: 16 }}>
        <Button icon={<ArrowLeftOutlined />} onClick={() => navigate('/invoices')}>
          返回发票管理
        </Button>
        <Text type="secondary">发票内容、税率、开票主体和 Provider 均从这里配置</Text>
      </Space>

      <Card
        title={
          <Space>
            <SettingOutlined />
            <span>发票设置</span>
          </Space>
        }
      >
        {isLoading ? (
          <Skeleton active paragraph={{ rows: 10 }} />
        ) : (
          <ProForm<InvoiceSettings>
            form={form}
            layout="vertical"
            initialValues={data}
            onFinish={handleSave}
            submitter={{
              searchConfig: { submitText: '保存设置' },
              resetButtonProps: false,
            }}
          >
            <Card size="small" title="平台开票主体" style={{ marginBottom: 16 }}>
              <Row gutter={16}>
                <Col xs={24} md={12}>
                  <ProFormText
                    name={['issuerProfile', 'companyName']}
                    label="公司名称"
                    rules={[{ required: true, message: '请输入公司名称' }]}
                  />
                </Col>
                <Col xs={24} md={12}>
                  <ProFormText
                    name={['issuerProfile', 'taxNo']}
                    label="纳税人识别号"
                    rules={[{ required: true, message: '请输入纳税人识别号' }]}
                  />
                </Col>
                <Col xs={24} md={12}>
                  <ProFormText name={['issuerProfile', 'registeredAddress']} label="注册地址" />
                </Col>
                <Col xs={24} md={12}>
                  <ProFormText name={['issuerProfile', 'registeredPhone']} label="注册电话" />
                </Col>
                <Col xs={24} md={12}>
                  <ProFormText name={['issuerProfile', 'bankName']} label="开户银行" />
                </Col>
                <Col xs={24} md={12}>
                  <ProFormText name={['issuerProfile', 'bankAccount']} label="银行账号" />
                </Col>
                <Col xs={24} md={8}>
                  <ProFormText name={['issuerProfile', 'drawer']} label="开票人" />
                </Col>
                <Col xs={24} md={8}>
                  <ProFormText name={['issuerProfile', 'reviewer']} label="复核人" />
                </Col>
                <Col xs={24} md={8}>
                  <ProFormText name={['issuerProfile', 'payee']} label="收款人" />
                </Col>
              </Row>
            </Card>

            <Card size="small" title="内容与税务规则" style={{ marginBottom: 16 }}>
              <Row gutter={16}>
                <Col xs={24} md={8}>
                  <ProFormSelect
                    name="lineMode"
                    label="商品行模式"
                    rules={[{ required: true, message: '请选择商品行模式' }]}
                    options={[
                      { label: '按订单商品明细', value: 'ORDER_ITEMS' },
                      { label: '合并为一个商品行', value: 'MERGED_CATEGORY' },
                    ]}
                  />
                </Col>
                <Col xs={24} md={8}>
                  <ProFormDigit
                    name="defaultTaxRate"
                    label="默认税率"
                    min={0}
                    max={0.13}
                    fieldProps={{ precision: 4, step: 0.01 }}
                    rules={[{ required: true, message: '请输入默认税率' }]}
                  />
                </Col>
                <Col xs={24} md={8}>
                  <ProFormText
                    name="defaultTaxClassificationCode"
                    label="税收分类编码"
                    placeholder="可为空"
                  />
                </Col>
                <Col xs={24} md={8}>
                  <ProFormText
                    name="defaultGoodsName"
                    label="合并商品名称"
                    rules={[{ required: true, message: '请输入合并商品名称' }]}
                  />
                </Col>
                <Col xs={24} md={8}>
                  <ProFormSelect
                    name="providerMode"
                    label="Provider"
                    rules={[{ required: true, message: '请选择 Provider' }]}
                    options={[{ label: 'Mock 开票', value: 'MOCK' }]}
                  />
                </Col>
                <Col xs={24} md={8}>
                  <ProFormSwitch
                    name="allowVipPackage"
                    label="VIP 礼包允许申请发票"
                  />
                </Col>
                <Col span={24}>
                  <ProFormTextArea
                    name="remarkTemplate"
                    label="备注模板"
                    fieldProps={{ rows: 3, maxLength: 500, showCount: true }}
                    extra="可用变量：{{orderId}}、{{paidAt}}、{{buyerTitle}}、{{totalAmount}}"
                  />
                </Col>
              </Row>
            </Card>
          </ProForm>
        )}
      </Card>
    </div>
  );
}
