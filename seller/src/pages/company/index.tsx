import { useState, useEffect, useRef, useCallback } from 'react';
import { App, Card, Descriptions, Image, Spin, List, Tag, Form, Input, Button, Modal, Select, Upload } from 'antd';
import { UploadOutlined, HolderOutlined, DownloadOutlined, EyeOutlined, FileOutlined } from '@ant-design/icons';
import { ProForm, ProFormText, ProFormTextArea } from '@ant-design/pro-components';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  DndContext, closestCenter, KeyboardSensor, PointerSensor,
  useSensor, useSensors, type DragEndEvent,
} from '@dnd-kit/core';
import {
  arrayMove, SortableContext, sortableKeyboardCoordinates,
  useSortable, verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { getCompany, updateCompany, getDocuments, addDocument, getAiSearchProfile, updateAiSearchProfile } from '@/api/company';
import { getTagCategories, getCompanyTags, updateCompanyTags } from '@/api/tags';
import useAuthStore from '@/store/useAuthStore';
import { buildUploadDownloadRequest, triggerBrowserDownload } from '@/utils/uploadDownload';
import dayjs from 'dayjs';
import { COMPANY_TYPE_OPTIONS } from '@/types';

const API_BASE = import.meta.env.VITE_API_BASE_URL || '/api/v1';

// 文件类型判断（基于 URL 扩展名，忽略 query string）
function getFileExt(url: string): string {
  const cleanUrl = url.split('?')[0].toLowerCase();
  const match = cleanUrl.match(/\.([a-z0-9]+)$/);
  return match ? match[1] : '';
}
const IMAGE_EXTS = ['jpg', 'jpeg', 'png', 'webp', 'gif', 'bmp', 'svg'];
const isImageFile = (url: string) => IMAGE_EXTS.includes(getFileExt(url));
const isPdfFile = (url: string) => getFileExt(url) === 'pdf';

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

// 可拖拽排序的认证标签项
function SortableTagItem({ id, name, onRemove }: { id: string; name: string; onRemove: (id: string) => void }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };
  return (
    <div
      ref={setNodeRef}
      style={{
        ...style,
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        padding: '4px 8px',
        marginBottom: 2,
        background: '#fafafa',
        borderRadius: 4,
        border: '1px solid #f0f0f0',
      }}
    >
      <HolderOutlined {...attributes} {...listeners} style={{ cursor: 'grab', color: '#999' }} />
      <span style={{ flex: 1, fontSize: 13 }}>{name}</span>
      <span onClick={() => onRemove(id)} style={{ cursor: 'pointer', color: '#999', fontSize: 12 }}>✕</span>
    </div>
  );
}

export default function CompanySettingsPage() {
  const { message } = App.useApp();
  const queryClient = useQueryClient();
  const hasRole = useAuthStore((s) => s.hasRole);
  const isOwner = useAuthStore((s) => s.isOwner);
  const canEdit = hasRole('OWNER', 'MANAGER');
  const [docModal, setDocModal] = useState(false);
  const [docForm] = Form.useForm();
  const [docLoading, setDocLoading] = useState(false);
  const [uploadedFileUrl, setUploadedFileUrl] = useState<string | null>(null);
  const [previewFile, setPreviewFile] = useState<{ url: string; title: string } | null>(null);
  const [downloadingPreview, setDownloadingPreview] = useState(false);

  // 企业认证标签有序列表（单独维护，支持拖拽排序）
  const [certTagOrder, setCertTagOrder] = useState<string[]>([]);

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

  // 动态标签分类和企业已选标签
  const { data: tagCategories = [] } = useQuery({
    queryKey: ['tag-categories-company'],
    queryFn: () => getTagCategories('COMPANY'),
  });

  const { data: companyTagGroups = [] } = useQuery({
    queryKey: ['seller-company-tags'],
    queryFn: getCompanyTags,
  });

  const handleDownloadPreviewFile = () => {
    if (!previewFile) return;
    setDownloadingPreview(true);
    try {
      const request = buildUploadDownloadRequest(previewFile.url, previewFile.title, API_BASE);
      triggerBrowserDownload(request.href, request.filename);
    } catch (err) {
      message.warning('自动下载失败，已为你打开文件地址，可右键另存为');
      window.open(previewFile.url, '_blank', 'noopener');
      // eslint-disable-next-line no-console
      console.error('文件下载失败', err);
    } finally {
      setTimeout(() => setDownloadingPreview(false), 500);
    }
  };

  const [aiForm] = Form.useForm();

  // 当企业标签数据加载后，填充标签表单字段，并初始化认证标签顺序
  useEffect(() => {
    for (const group of companyTagGroups) {
      const ids = group.tags.map(t => t.id);
      aiForm.setFieldValue(`tag_${group.categoryCode}`, ids);
      // 保留认证标签的排序（后端返回时已按 sortOrder 排序）
      if (group.categoryCode === 'company_cert') {
        setCertTagOrder(ids);
      }
    }
  }, [companyTagGroups, aiForm]);

  // dnd-kit sensors
  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  // 拖拽结束：更新认证标签顺序，同步到表单，自动保存
  const handleCertDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = certTagOrder.indexOf(active.id as string);
    const newIndex = certTagOrder.indexOf(over.id as string);
    const newOrder = arrayMove(certTagOrder, oldIndex, newIndex);
    setCertTagOrder(newOrder);
    aiForm.setFieldValue('tag_company_cert', newOrder);
    autoSave();
  };

  // 认证标签下拉选择变更：保留顺序，新增追加到末尾，自动保存
  const handleCertSelectChange = (selectedIds: string[]) => {
    const kept = certTagOrder.filter(id => selectedIds.includes(id));
    const added = selectedIds.filter(id => !certTagOrder.includes(id));
    const newOrder = [...kept, ...added];
    setCertTagOrder(newOrder);
    aiForm.setFieldValue('tag_company_cert', newOrder);
    autoSave();
  };

  // 从认证列表中移除某个标签，自动保存
  const handleCertRemove = (id: string) => {
    const newOrder = certTagOrder.filter(tagId => tagId !== id);
    setCertTagOrder(newOrder);
    aiForm.setFieldValue('tag_company_cert', newOrder);
    autoSave();
  };

  // 防抖自动保存
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const debouncedAutoSave = useCallback(() => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => autoSave(), 800);
  }, [tagCategories, certTagOrder]);

  // 自动保存：收集当前所有字段并提交
  const autoSave = async () => {
    try {
      const values = aiForm.getFieldsValue();
      await updateAiSearchProfile({
        companyType: values.companyType,
      });

      // 提交动态标签：认证标签放在最前，确保 sortOrder 保留排序
      const certIds = aiForm.getFieldValue('tag_company_cert') || certTagOrder;
      const otherIds: string[] = [];
      for (const cat of tagCategories) {
        if (cat.code === 'company_cert') continue;
        const fieldValue = aiForm.getFieldValue(`tag_${cat.code}`) || [];
        otherIds.push(...fieldValue);
      }
      await updateCompanyTags([...certIds, ...otherIds]);

      message.success('已自动保存');
      queryClient.invalidateQueries({ queryKey: ['seller-ai-search-profile'] });
      queryClient.invalidateQueries({ queryKey: ['seller-company'] });
      queryClient.invalidateQueries({ queryKey: ['seller-company-tags'] });
    } catch (err) {
      message.error(err instanceof Error ? err.message : '保存失败');
    }
  };

  const handleUpdate = async (values: Record<string, unknown>) => {
    try {
      const { addressProvince, addressCity, addressDistrict, addressDetail, ...rest } = values;
      // 构建结构化地址对象
      const hasAddress = addressProvince || addressCity || addressDistrict || addressDetail;
      const data = {
        ...rest,
        address: hasAddress
          ? {
              province: addressProvince || '',
              city: addressCity || '',
              district: addressDistrict || '',
              detail: addressDetail || '',
            }
          : undefined,
      };
      await updateCompany(data);
      message.success('企业信息已更新');
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

  // 根据标签 ID 查找标签名称（用于拖拽列表显示）
  const getCertTagName = (id: string): string => {
    const certCat = tagCategories.find(c => c.code === 'company_cert');
    const tag = certCat?.tags.find(t => t.id === id);
    return tag?.name ?? id;
  };

  if (isLoading || !company) {
    return <Spin size="large" style={{ display: 'block', margin: '100px auto' }} />;
  }

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
              addressProvince: (company.address as Record<string, string> | undefined)?.province || '',
              addressCity: (company.address as Record<string, string> | undefined)?.city || '',
              addressDistrict: (company.address as Record<string, string> | undefined)?.district || '',
              addressDetail: (company.address as Record<string, string> | undefined)?.detail || '',
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
            {/* 结构化发货地址（省/市/区/详细），顺丰快递 API 必需 */}
            <ProForm.Group title="发货地址" titleStyle={{ marginBottom: 8 }}>
              <ProFormText
                name="addressProvince"
                label="省份"
                width="sm"
                placeholder="如：云南省"
                rules={[{ required: true, message: '请填写省份' }]}
              />
              <ProFormText
                name="addressCity"
                label="城市"
                width="sm"
                placeholder="如：玉溪市"
                rules={[{ required: true, message: '请填写城市' }]}
              />
              <ProFormText
                name="addressDistrict"
                label="区/县"
                width="sm"
                placeholder="如：红塔区"
              />
            </ProForm.Group>
            <ProFormText
              name="addressDetail"
              label="详细地址"
              placeholder="如：xxx路xxx号，方便快递员取件"
            />
            <ProFormText name="servicePhone" label="客服电话" />
            <ProFormText name="serviceWeChat" label="客服微信" />
          </ProForm>
        ) : (
          <Descriptions column={1}>
            <Descriptions.Item label="企业名称">{company.name}</Descriptions.Item>
            <Descriptions.Item label="简称">{company.shortName || '-'}</Descriptions.Item>
            <Descriptions.Item label="简介">{company.description || '-'}</Descriptions.Item>
            <Descriptions.Item label="经营地址">
              {(() => {
                const addr = company.address as Record<string, string> | undefined;
                if (!addr) return '-';
                // 优先显示结构化字段，回退到 text
                if (addr.province || addr.city || addr.district || addr.detail) {
                  return [addr.province, addr.city, addr.district, addr.detail].filter(Boolean).join(' ');
                }
                return addr.text || '-';
              })()}
            </Descriptions.Item>
            <Descriptions.Item label="客服电话">{company.servicePhone || '-'}</Descriptions.Item>
            <Descriptions.Item label="客服微信">{company.serviceWeChat || '-'}</Descriptions.Item>
            <Descriptions.Item label="状态">
              <Tag color={company.status === 'ACTIVE' ? 'green' : 'warning'}>{company.status}</Tag>
            </Descriptions.Item>
          </Descriptions>
        )}
      </Card>

      {/* AI 搜索资料 - 结构化搜索字段 */}
      {canEdit && (
        <Card title="企业 AI 搜索资料" style={{ marginBottom: 16 }}>
          <div style={{ marginBottom: 12, color: '#666' }}>
            这些信息帮助买家通过搜索和 AI 更精准地找到您的企业，请认真填写
          </div>
          <ProForm
            form={aiForm}
            onFinish={autoSave}
            initialValues={aiProfile || {}}
            layout="vertical"
            style={{ maxWidth: 600 }}
            key={JSON.stringify(aiProfile)}
            submitter={false}
            onValuesChange={() => debouncedAutoSave()}
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

            {/* 动态标签分类（从后端加载，替代硬编码的主营品类/产品特征/认证资质） */}
            {tagCategories
              .filter(cat => cat.code !== 'product_tag')
              .map(cat => {
                // 企业认证分类：Select + 可拖拽排序列表
                if (cat.code === 'company_cert') {
                  return (
                    <ProForm.Item
                      key={cat.code}
                      name={`tag_${cat.code}`}
                      label={cat.name}
                    >
                      <div>
                        {/* 下拉选择（添加/移除认证） */}
                        <Select
                          mode="multiple"
                          placeholder={`请选择${cat.name}`}
                          options={cat.tags.map(t => ({ value: t.id, label: t.name }))}
                          showSearch
                          optionFilterProp="label"
                          value={certTagOrder}
                          onChange={handleCertSelectChange}
                          style={{ width: '100%', marginBottom: 8 }}
                        />
                        {/* 可拖拽排序列表 */}
                        {certTagOrder.length > 0 && (
                          <>
                            <DndContext
                              sensors={sensors}
                              collisionDetection={closestCenter}
                              onDragEnd={handleCertDragEnd}
                            >
                              <SortableContext
                                items={certTagOrder}
                                strategy={verticalListSortingStrategy}
                              >
                                {certTagOrder.map(id => (
                                  <SortableTagItem
                                    key={id}
                                    id={id}
                                    name={getCertTagName(id)}
                                    onRemove={handleCertRemove}
                                  />
                                ))}
                              </SortableContext>
                            </DndContext>
                            <div style={{ fontSize: 12, color: '#999', marginTop: 4 }}>
                              拖拽调整顺序，前 2 个将显示在企业卡片上
                            </div>
                          </>
                        )}
                      </div>
                    </ProForm.Item>
                  );
                }

                // 其他标签分类：普通多选
                return (
                  <ProForm.Item
                    key={cat.code}
                    name={`tag_${cat.code}`}
                    label={cat.name}
                  >
                    <Select
                      mode="multiple"
                      placeholder={`请选择${cat.name}`}
                      options={cat.tags.map(t => ({ value: t.id, label: t.name }))}
                      showSearch
                      optionFilterProp="label"
                    />
                  </ProForm.Item>
                );
              })}
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
                    <Button
                      type="link"
                      icon={<EyeOutlined />}
                      onClick={() => setPreviewFile({ url: doc.fileUrl, title: doc.title })}
                    >
                      预览 / 下载
                    </Button>
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

      {/* 文件预览 / 下载弹窗 */}
      <Modal
        title={previewFile ? `预览：${previewFile.title}` : '预览'}
        open={!!previewFile}
        onCancel={() => setPreviewFile(null)}
        footer={null}
        width={900}
        destroyOnClose
      >
        {previewFile && (
          <>
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 12 }}>
              <Button
                type="primary"
                icon={<DownloadOutlined />}
                loading={downloadingPreview}
                onClick={handleDownloadPreviewFile}
              >
                下载到本地
              </Button>
            </div>
            <div style={{ textAlign: 'center', background: '#fafafa', borderRadius: 4, minHeight: 400, padding: 16 }}>
              {isImageFile(previewFile.url) ? (
                <Image
                  src={previewFile.url}
                  alt={previewFile.title}
                  style={{ maxWidth: '100%', maxHeight: '70vh', objectFit: 'contain' }}
                />
              ) : isPdfFile(previewFile.url) ? (
                <>
                  <iframe
                    src={previewFile.url}
                    title={previewFile.title}
                    style={{ width: '100%', height: '70vh', border: 0, background: '#fff' }}
                  />
                  <div style={{ marginTop: 8, color: '#8c8c8c', fontSize: 12 }}>
                    若 PDF 无法显示，请点击上方「下载到本地」查看
                  </div>
                </>
              ) : (
                <div style={{ padding: '80px 0', color: '#8c8c8c' }}>
                  <FileOutlined style={{ fontSize: 48, marginBottom: 16 }} />
                  <div>该格式不支持在线预览，请点击上方「下载到本地」查看</div>
                </div>
              )}
            </div>
          </>
        )}
      </Modal>
    </div>
  );
}
