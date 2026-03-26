import { useState } from 'react';
import { Card, message, Descriptions, Spin, List, Tag, Form, Input, Space, Button, Modal, Select, Upload } from 'antd';
import { PlusOutlined, MinusCircleOutlined, UploadOutlined } from '@ant-design/icons';
import { ProForm, ProFormText, ProFormTextArea } from '@ant-design/pro-components';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { getCompany, updateCompany, updateHighlights, getDocuments, addDocument, getAiSearchProfile, updateAiSearchProfile } from '@/api/company';
import useAuthStore from '@/store/useAuthStore';
import dayjs from 'dayjs';
import {
  COMPANY_TYPE_OPTIONS, INDUSTRY_TAG_OPTIONS, PRODUCT_FEATURE_OPTIONS,
  SUPPLY_MODE_OPTIONS, CERTIFICATION_OPTIONS,
} from '@/types';
import type { AiSearchProfile } from '@/types';

const API_BASE = import.meta.env.VITE_API_BASE_URL || '/api/v1';

// 资质类型枚举
const DOC_TYPE_LABELS: Record<string, string> = {
  LICENSE: '营业执照',
  FOOD_PERMIT: '食品经营许可证',
  CERT: '认证证书',
  INSPECTION: '检验检测报告',
  OTHER: '其他',
};

const DOC_TYPES = [
  { value: 'LICENSE', label: DOC_TYPE_LABELS.LICENSE },
  { value: 'FOOD_PERMIT', label: DOC_TYPE_LABELS.FOOD_PERMIT },
  { value: 'CERT', label: DOC_TYPE_LABELS.CERT },
  { value: 'INSPECTION', label: DOC_TYPE_LABELS.INSPECTION },
  { value: 'OTHER', label: '其他' },
];

export default function CompanySettingsPage() {
  const queryClient = useQueryClient();
  const hasRole = useAuthStore((s) => s.hasRole);
  const isOwner = useAuthStore((s) => s.isOwner);
  const canEdit = hasRole('OWNER', 'MANAGER');
  const [docModal, setDocModal] = useState(false);
  const [docForm] = Form.useForm();
  const [docLoading, setDocLoading] = useState(false);
  const [uploadedFileUrl, setUploadedFileUrl] = useState<string | null>(null);

  const { data: company, isLoading } = useQuery({
    queryKey: ['seller-company'],
    queryFn: getCompany,
  });

  const { data: documents } = useQuery({
    queryKey: ['seller-company-docs'],
    queryFn: getDocuments,
  });

  // AI 搜索资料
  const { data: aiProfile } = useQuery({
    queryKey: ['seller-ai-search-profile'],
    queryFn: getAiSearchProfile,
    enabled: canEdit,
  });

  const [aiSaving, setAiSaving] = useState(false);

  const handleUpdateAiSearchProfile = async (values: Record<string, any>) => {
    setAiSaving(true);
    try {
      await updateAiSearchProfile({
        companyType: values.companyType,
        industryTags: values.industryTags || [],
        productKeywords: values.productKeywords || [],
        serviceAreas: values.serviceAreas || [],
        productFeatures: values.productFeatures || [],
        supplyModes: values.supplyModes || [],
        certifications: values.certifications || [],
      });
      message.success('AI 搜索资料已更新');
      queryClient.invalidateQueries({ queryKey: ['seller-ai-search-profile'] });
      queryClient.invalidateQueries({ queryKey: ['seller-company'] });
    } catch (err) {
      message.error(err instanceof Error ? err.message : '更新失败');
    } finally {
      setAiSaving(false);
    }
  };

  const handleUpdate = async (values: Record<string, unknown>) => {
    try {
      const { addressText, ...rest } = values;
      const data = {
        ...rest,
        address: addressText ? { text: addressText } : undefined,
      };
      await updateCompany(data);
      message.success('企业信息已更新');
      queryClient.invalidateQueries({ queryKey: ['seller-company'] });
    } catch (err) {
      message.error(err instanceof Error ? err.message : '更新失败');
    }
  };

  const handleUpdateHighlights = async (values: { highlights: Array<{ key: string; value: string }> }) => {
    try {
      const highlights = Object.fromEntries(
        (values.highlights || []).filter((p) => p.key && p.value).map((p) => [p.key, p.value]),
      );
      await updateHighlights(highlights);
      message.success('企业亮点已更新');
      queryClient.invalidateQueries({ queryKey: ['seller-company'] });
    } catch (err) {
      message.error(err instanceof Error ? err.message : '更新失败');
    }
  };

  const handleAddDocument = async (values: { type: string; title: string; issuer?: string }) => {
    if (!uploadedFileUrl) {
      message.error('请先上传文件');
      return;
    }
    setDocLoading(true);
    try {
      await addDocument({ ...values, fileUrl: uploadedFileUrl });
      message.success('资质文件已上传');
      setDocModal(false);
      docForm.resetFields();
      setUploadedFileUrl(null);
      queryClient.invalidateQueries({ queryKey: ['seller-company-docs'] });
    } catch (err) {
      message.error(err instanceof Error ? err.message : '上传失败');
    } finally {
      setDocLoading(false);
    }
  };

  if (isLoading || !company) {
    return <Spin size="large" style={{ display: 'block', margin: '100px auto' }} />;
  }

  // 从 company.profile.highlights 提取键值对
  const profileHighlights = (company.profile as { highlights?: Record<string, string> } | null)?.highlights;
  const highlightPairs = profileHighlights
    ? Object.entries(profileHighlights).map(([key, value]) => ({ key, value }))
    : [{ key: '主营产品', value: '' }, { key: '认证资质', value: '' }, { key: '特色优势', value: '' }];

  return (
    <div>
      <Card title="企业信息" style={{ marginBottom: 16 }}>
        {canEdit ? (
          <ProForm
            onFinish={handleUpdate}
            initialValues={{
              name: company.name,
              shortName: company.shortName,
              description: company.description,
              servicePhone: company.servicePhone,
              serviceWeChat: company.serviceWeChat,
              addressText: (company.address as { text?: string })?.text,
            }}
            layout="vertical"
            style={{ maxWidth: 600 }}
          >
            <ProFormText name="name" label="企业名称" rules={[{ required: true }]} />
            <ProFormText name="shortName" label="企业简称" />
            <ProFormTextArea
              name="description"
              label="企业简介"
              rules={[
                { required: true, message: '请填写企业简介' },
                { min: 20, message: '简介至少 20 字，让 AI 能更好地向买家介绍您的企业' },
              ]}
              placeholder="请详细描述企业经营范围、特色产品、种植理念等。AI 语音助手会根据描述向买家推荐您的企业"
              fieldProps={{ rows: 4 }}
            />
            <ProFormText
              name="addressText"
              label="经营地址"
              placeholder="如：黑龙江省五常市xxx路，方便买家了解您的位置"
            />
            <ProFormText name="servicePhone" label="客服电话" />
            <ProFormText name="serviceWeChat" label="客服微信" />
          </ProForm>
        ) : (
          <Descriptions column={1}>
            <Descriptions.Item label="企业名称">{company.name}</Descriptions.Item>
            <Descriptions.Item label="简称">{company.shortName || '-'}</Descriptions.Item>
            <Descriptions.Item label="简介">{company.description || '-'}</Descriptions.Item>
            <Descriptions.Item label="经营地址">{(company.address as { text?: string })?.text || '-'}</Descriptions.Item>
            <Descriptions.Item label="客服电话">{company.servicePhone || '-'}</Descriptions.Item>
            <Descriptions.Item label="客服微信">{company.serviceWeChat || '-'}</Descriptions.Item>
            <Descriptions.Item label="状态">
              <Tag color={company.status === 'ACTIVE' ? 'green' : 'warning'}>{company.status}</Tag>
            </Descriptions.Item>
          </Descriptions>
        )}
      </Card>

      {/* 企业亮点 - AI 搜索依赖 */}
      {canEdit && (
        <Card title="企业亮点" style={{ marginBottom: 16 }}>
          <div style={{ marginBottom: 12, color: '#666' }}>
            企业亮点会展示在企业主页，AI 也会根据这些信息向买家推荐您的企业
          </div>
          <Form
            onFinish={handleUpdateHighlights}
            initialValues={{ highlights: highlightPairs }}
            style={{ maxWidth: 600 }}
          >
            <Form.List name="highlights">
              {(fields, { add, remove }) => (
                <>
                  {fields.map((field) => (
                    <Space key={field.key} align="start" style={{ display: 'flex', marginBottom: 8 }}>
                      <Form.Item {...field} name={[field.name, 'key']} rules={[{ required: true, message: '项目' }]}>
                        <Input placeholder="如：主营产品" style={{ width: 140 }} />
                      </Form.Item>
                      <Form.Item {...field} name={[field.name, 'value']} rules={[{ required: true, message: '内容' }]}>
                        <Input placeholder="如：有机五常大米、东北黑木耳" style={{ width: 340 }} />
                      </Form.Item>
                      {fields.length > 1 && (
                        <MinusCircleOutlined style={{ marginTop: 8, color: '#999' }} onClick={() => remove(field.name)} />
                      )}
                    </Space>
                  ))}
                  <Button type="dashed" onClick={() => add()} icon={<PlusOutlined />} style={{ marginBottom: 16 }}>
                    添加亮点
                  </Button>
                </>
              )}
            </Form.List>
            <Form.Item>
              <Button type="primary" htmlType="submit">
                保存亮点
              </Button>
            </Form.Item>
          </Form>
        </Card>
      )}

      {/* AI 搜索资料 - 结构化搜索字段 */}
      {canEdit && (
        <Card title="企业 AI 搜索资料" style={{ marginBottom: 16 }}>
          <div style={{ marginBottom: 12, color: '#666' }}>
            这些信息帮助买家通过搜索和 AI 更精准地找到您的企业，请认真填写
          </div>
          <ProForm
            onFinish={handleUpdateAiSearchProfile}
            initialValues={aiProfile || {}}
            loading={aiSaving}
            layout="vertical"
            style={{ maxWidth: 600 }}
            key={JSON.stringify(aiProfile)}
            submitter={{ searchConfig: { submitText: '保存搜索资料' } }}
          >
            <ProForm.Item
              name="companyType"
              label="企业类型"
              rules={[{ required: true, message: '请选择企业类型' }]}
            >
              <Select
                options={COMPANY_TYPE_OPTIONS}
                placeholder="请选择企业类型"
              />
            </ProForm.Item>

            <ProForm.Item
              name="industryTags"
              label="主营品类"
              rules={[{ required: true, message: '请选择至少一个主营品类' }]}
            >
              <Select
                mode="multiple"
                options={INDUSTRY_TAG_OPTIONS}
                placeholder="请选择主营品类"
                showSearch
              />
            </ProForm.Item>

            <ProForm.Item
              name="productKeywords"
              label="主营产品关键词"
              tooltip='输入后回车添加，如"蓝莓""有机五常大米"'
            >
              <Select
                mode="tags"
                placeholder="输入关键词后回车添加"
                tokenSeparators={[',', '，']}
              />
            </ProForm.Item>

            <ProForm.Item
              name="serviceAreas"
              label="服务地区"
              rules={[{ required: true, message: '请输入至少一个服务地区' }]}
              tooltip="输入后回车添加，如"湖北""武汉""武昌区""
            >
              <Select
                mode="tags"
                placeholder="输入地区后回车添加"
                tokenSeparators={[',', '，']}
              />
            </ProForm.Item>

            <ProForm.Item
              name="productFeatures"
              label="产品特征"
              rules={[{ required: true, message: '请选择至少一个产品特征' }]}
            >
              <Select
                mode="multiple"
                options={PRODUCT_FEATURE_OPTIONS}
                placeholder="请选择产品特征"
              />
            </ProForm.Item>

            <ProForm.Item
              name="supplyModes"
              label="供给方式"
            >
              <Select
                mode="multiple"
                options={SUPPLY_MODE_OPTIONS}
                placeholder="请选择供给方式"
              />
            </ProForm.Item>

            <ProForm.Item
              name="certifications"
              label="认证资质"
            >
              <Select
                mode="multiple"
                options={CERTIFICATION_OPTIONS}
                placeholder="请选择认证资质"
              />
            </ProForm.Item>
          </ProForm>
        </Card>
      )}

      <Card
        title="资质文件"
        extra={
          isOwner() && (
            <Button type="primary" icon={<UploadOutlined />} onClick={() => setDocModal(true)}>
              上传资质
            </Button>
          )
        }
      >
        {documents && documents.length > 0 ? (
          <List
            dataSource={documents}
            renderItem={(doc) => (
              <List.Item
                extra={
                  doc.fileUrl && (
                    <a href={doc.fileUrl} target="_blank" rel="noopener noreferrer">查看文件</a>
                  )
                }
              >
                <List.Item.Meta
                  title={doc.title}
                  description={`类型：${DOC_TYPE_LABELS[doc.type] || doc.type} | 签发者：${doc.issuer || '-'} | 上传时间：${dayjs(doc.createdAt).format('YYYY-MM-DD')}`}
                />
                <Tag color={doc.verifyStatus === 'VERIFIED' ? 'green' : doc.verifyStatus === 'REJECTED' ? 'error' : 'processing'}>
                  {doc.verifyStatus === 'VERIFIED' ? '已验证' : doc.verifyStatus === 'REJECTED' ? '已驳回' : '待验证'}
                </Tag>
              </List.Item>
            )}
          />
        ) : (
          <div style={{ textAlign: 'center', padding: '24px 0', color: '#999' }}>暂无资质文件</div>
        )}
      </Card>

      {/* 上传资质弹窗 */}
      <Modal
        title="上传资质文件"
        open={docModal}
        onCancel={() => { setDocModal(false); docForm.resetFields(); setUploadedFileUrl(null); }}
        onOk={() => docForm.submit()}
        confirmLoading={docLoading}
      >
        <Form form={docForm} onFinish={handleAddDocument} layout="vertical">
          <Form.Item name="type" label="资质类型" rules={[{ required: true, message: '请选择类型' }]}>
            <Select options={DOC_TYPES} placeholder="请选择" />
          </Form.Item>
          <Form.Item name="title" label="文件名称" rules={[{ required: true, message: '请输入名称' }]}>
            <Input placeholder="如：营业执照副本" />
          </Form.Item>
          <Form.Item name="issuer" label="签发机构">
            <Input placeholder="如：市场监督管理局" />
          </Form.Item>
          <Form.Item label="上传文件" required>
            <Upload
              name="file"
              action={`${API_BASE}/upload?folder=documents`}
              headers={{ Authorization: `Bearer ${localStorage.getItem('seller_token') || ''}` }}
              accept="image/*,.pdf"
              maxCount={1}
              onChange={({ file }) => {
                if (file.status === 'done') {
                  const response = file.response as { url?: string; data?: { url?: string } } | undefined;
                  const url = response?.data?.url || response?.url;
                  setUploadedFileUrl(url || null);
                  message.success('文件上传成功');
                }
              }}
            >
              <Button icon={<UploadOutlined />}>选择文件（图片/PDF）</Button>
            </Upload>
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
