import { useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ProForm,
  ProFormDigit,
  ProFormSelect,
  ProFormSwitch,
  ProFormText,
} from '@ant-design/pro-components';
import { App, Button, Card, Col, Form, Input, Row, Skeleton, Space, Typography } from 'antd';
import type { TextAreaRef } from 'antd/es/input/TextArea';
import { ArrowLeftOutlined, SettingOutlined } from '@ant-design/icons';
import {
  getInvoiceSettings,
  updateInvoiceSettings,
} from '@/api/invoices';
import type { InvoiceSettings } from '@/api/invoices';

const { Text } = Typography;

const REMARK_TEMPLATE_TOKENS = ['订单号', '支付时间', '发票抬头', '订单金额'] as const;

type RemarkTemplateInputProps = {
  value?: string;
  onChange?: (value: string) => void;
};

// 受控备注模板输入：textarea 上方挂 4 个 chip 按钮，点击在光标处插入【中文】token
function RemarkTemplateInput({ value = '', onChange }: RemarkTemplateInputProps) {
  const textareaRef = useRef<TextAreaRef>(null);

  const insertToken = (token: string) => {
    const inserted = `【${token}】`;
    const inner: any = textareaRef.current?.resizableTextArea;
    const textArea: HTMLTextAreaElement | undefined = inner?.textArea;
    if (!textArea) {
      onChange?.(value + inserted);
      return;
    }
    const start = textArea.selectionStart ?? value.length;
    const end = textArea.selectionEnd ?? value.length;
    const next = value.slice(0, start) + inserted + value.slice(end);
    onChange?.(next);
    requestAnimationFrame(() => {
      const cursor = start + inserted.length;
      textArea.focus();
      textArea.setSelectionRange(cursor, cursor);
    });
  };

  return (
    <div>
      <Space size={8} wrap style={{ marginBottom: 8 }}>
        <Text type="secondary">点击按钮在光标处插入变量：</Text>
        {REMARK_TEMPLATE_TOKENS.map((token) => (
          <Button key={token} size="small" onClick={() => insertToken(token)}>
            + {token}
          </Button>
        ))}
      </Space>
      <Input.TextArea
        ref={textareaRef}
        value={value}
        onChange={(e) => onChange?.(e.target.value)}
        autoSize={{ minRows: 3, maxRows: 6 }}
        showCount
        maxLength={500}
        placeholder="例：订单号：【订单号】，金额 ¥【订单金额】"
      />
    </div>
  );
}

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
        <Text type="secondary">发票内容、税率、开票主体和开票通道均从这里配置</Text>
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
                    label="开票通道"
                    rules={[{ required: true, message: '请选择开票通道' }]}
                    options={[{ label: '沙箱开票（Mock）', value: 'MOCK' }]}
                  />
                </Col>
                <Col xs={24} md={8}>
                  <ProFormSwitch
                    name="allowVipPackage"
                    label="VIP 礼包允许申请发票"
                  />
                </Col>
                <Col span={24}>
                  <Form.Item
                    name="remarkTemplate"
                    label="备注模板"
                    extra="电子发票备注栏文字，可点击上方按钮插入变量"
                  >
                    <RemarkTemplateInput />
                  </Form.Item>
                </Col>
              </Row>
            </Card>
          </ProForm>
        )}
      </Card>
    </div>
  );
}
