import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Card,
  Button,
  Spin,
  Form,
  Input,
  InputNumber,
  Tag,
  Descriptions,
  Timeline,
  Empty,
  message,
  Space,
  TreeSelect,
  Select,
  Breadcrumb,
  Collapse,
  Typography,
} from 'antd';
import { ArrowLeftOutlined, SaveOutlined, PlusOutlined, MinusCircleOutlined, SyncOutlined } from '@ant-design/icons';
import { getProduct, updateProduct, updateProductSkus, refillSemanticTags, getCategories, type CategoryNode } from '@/api/products';
import { getPublicTagCategories } from '@/api/tags';

const { Text } = Typography;
import { getTargetAuditLogs } from '@/api/audit';
import { useUnsavedChanges } from '@/hooks/useUnsavedChanges';
import PermissionGate from '@/components/PermissionGate';
import { PERMISSIONS } from '@/constants/permissions';
import { productStatusMap as statusMap, auditStatusMap, auditActionColors } from '@/constants/statusMaps';
import type { AuditLog } from '@/types';
import dayjs from 'dayjs';

export default function ProductEditPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [form] = Form.useForm();
  const [skuForm] = Form.useForm();
  const queryClient = useQueryClient();

  // 监听表单变化以跟踪未保存更改
  Form.useWatch([], form);
  useUnsavedChanges(form.isFieldsTouched());

  const { data: product, isLoading } = useQuery({
    queryKey: ['admin', 'product', id],
    queryFn: () => getProduct(id!),
    enabled: !!id,
  });

  const { data: categories } = useQuery({
    queryKey: ['categories'],
    queryFn: getCategories,
  });

  const { data: productTagCategories = [] } = useQuery({
    queryKey: ['tag-categories-product'],
    queryFn: () => getPublicTagCategories('PRODUCT'),
  });
  const productTagOptions = productTagCategories
    .flatMap((cat: any) => (cat.tags || []).map((t: any) => ({ value: t.id, label: t.name })));

  // 获取该商品的审计日志
  const { data: auditLogs, isLoading: auditLoading } = useQuery({
    queryKey: ['admin', 'product-audit-logs', id],
    queryFn: () => getTargetAuditLogs('product', id!),
    enabled: !!id,
  });

  // 构建 TreeSelect 数据
  const buildTreeData = (nodes: CategoryNode[]): any[] =>
    nodes.map((n) => ({
      value: n.id,
      title: n.name,
      children: n.children ? buildTreeData(n.children) : [],
    }));

  const handleSave = async () => {
    try {
      // 同时校验基本信息表单和规格表单，任一失败不提交
      const [values, skuValues] = await Promise.all([
        form.validateFields(),
        skuForm.validateFields(),
      ]);

      const skus = (skuValues.skus as any[]) || [];
      if (skus.length === 0) {
        message.warning('至少保留一条规格');
        return;
      }

      // 转换产地为 Json 格式
      const { originText: ot, attributes: attrs, ...rest } = values;
      const data: Record<string, any> = { ...rest };
      if (ot !== undefined) {
        data.origin = ot ? { text: ot } : null;
        data.originRegion = ot || undefined;
      }
      // 转换属性键值对为对象
      if (attrs) {
        data.attributes = Object.fromEntries(
          (attrs as Array<{ key: string; value: string }>)
            .filter((p) => p.key && p.value)
            .map((p) => [p.key, p.value]),
        );
      }

      // 先保存基本信息，再保存规格
      await updateProduct(id!, data);
      await updateProductSkus(id!, skus);

      message.success('保存成功：基本信息与规格均已更新');
      queryClient.invalidateQueries({ queryKey: ['admin', 'product', id] });
      navigate('/products');
    } catch (err) {
      if (err instanceof Error) {
        message.error(err.message || '保存失败');
      }
    }
  };

  if (isLoading) {
    return (
      <div style={{ textAlign: 'center', padding: 60 }}>
        <Spin size="large" />
      </div>
    );
  }

  if (!product) return null;

  const status = statusMap[product.status];
  const auditStatus = auditStatusMap[product.auditStatus];

  // 解析产地
  const originText = typeof product.origin === 'object' && product.origin
    ? (product.origin as Record<string, any>).text || ''
    : (typeof product.origin === 'string'
      ? product.origin
      : ((product as unknown as Record<string, unknown>).originRegion as string | undefined) || '');

  // 解析属性为键值对
  const attrPairs = product.attributes && typeof product.attributes === 'object'
    ? Object.entries(product.attributes as Record<string, string>).map(([key, value]) => ({ key, value }))
    : [];

  const initialTagIds = (product as any).tags?.map((t: any) => t.tag?.id || t.tagId) || [];

  // 商品规格初始值（供 Form.List 使用）
  const skuList = (((product as unknown as Record<string, unknown>).skus as Array<Record<string, any>>) || []).map((s) => ({
    id: s.id,
    specText: s.title,
    price: s.price,
    cost: s.cost ?? 0,
    stock: s.stock ?? 0,
  }));

  // 保存 SKU
  const handleSaveSkus = async () => {
    try {
      const values = await skuForm.validateFields();
      const skus = (values.skus as any[]) || [];
      if (skus.length === 0) {
        message.warning('至少保留一条规格');
        return;
      }
      await updateProductSkus(id!, skus);
      message.success('规格已保存');
      queryClient.invalidateQueries({ queryKey: ['admin', 'product', id] });
    } catch (err) {
      if (err instanceof Error) {
        message.error(err.message || '规格保存失败');
      }
    }
  };

  // 图片列表
  const mediaList = (product as unknown as Record<string, unknown>).media as
    | { url: string; id: string }[]
    | undefined;

  // 审计日志操作类型中文映射
  const actionLabelMap: Record<string, string> = {
    CREATE: '创建',
    UPDATE: '更新',
    DELETE: '删除',
    STATUS_CHANGE: '状态变更',
    APPROVE: '审核通过',
    REJECT: '审核拒绝',
    ROLLBACK: '回滚',
  };

  return (
    <div style={{ padding: 24 }}>
      {/* 页头：面包屑 + 操作按钮（固定在顶部） */}
      <div
        style={{
          position: 'sticky',
          top: 0,
          zIndex: 10,
          background: '#f5f5f5',
          padding: '12px 0',
          marginBottom: 4,
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}
      >
        <div>
          <Breadcrumb
            style={{ marginBottom: 8 }}
            items={[
              { title: <a onClick={() => navigate('/')}>首页</a> },
              { title: <a onClick={() => navigate('/products')}>商品管理</a> },
              { title: '商品编辑' },
            ]}
          />
          <Button
            icon={<ArrowLeftOutlined />}
            onClick={() => navigate('/products')}
          >
            返回列表
          </Button>
        </div>
        <PermissionGate permission={PERMISSIONS.PRODUCTS_UPDATE}>
          <Button type="primary" icon={<SaveOutlined />} onClick={handleSave} size="large">
            保存
          </Button>
        </PermissionGate>
      </div>

      {/* 1. 状态信息 */}
      <Card title="商品状态" style={{ marginBottom: 16 }}>
        <Descriptions column={{ xs: 1, sm: 3 }}>
          <Descriptions.Item label="商品 ID">{product.id}</Descriptions.Item>
          <Descriptions.Item label="上架状态">
            <Tag color={status?.color}>{status?.text}</Tag>
          </Descriptions.Item>
          <Descriptions.Item label="审核状态">
            <Tag color={auditStatus?.color}>{auditStatus?.text}</Tag>
          </Descriptions.Item>
          <Descriptions.Item label="所属企业">
            {product.company?.name || '-'}
          </Descriptions.Item>
          <Descriptions.Item label="商品分类">
            {product.category?.name || '-'}
          </Descriptions.Item>
          <Descriptions.Item label="产地 / 产区">
            {originText || '-'}
          </Descriptions.Item>
          <Descriptions.Item label="创建时间">
            {dayjs(product.createdAt).format('YYYY-MM-DD HH:mm')}
          </Descriptions.Item>
          <Descriptions.Item label="更新时间">
            {dayjs(product.updatedAt).format('YYYY-MM-DD HH:mm')}
          </Descriptions.Item>
          {product.auditNote && (
            <Descriptions.Item label="审核备注" span={3}>
              {product.auditNote}
            </Descriptions.Item>
          )}
        </Descriptions>
      </Card>

      {/* 2. 基本信息编辑 */}
      <Card title="基本信息" style={{ marginBottom: 16 }}>
        <Form
          form={form}
          layout="vertical"
          initialValues={{
            title: product.title,
            subtitle: product.subtitle,
            description: product.description,
            basePrice: product.basePrice,
            categoryId: product.categoryId,
            originText,
            aiKeywords: product.aiKeywords || [],
            attributes: attrPairs,
            tagIds: initialTagIds,
            // 语义字段
            flavorTags: (product as unknown as Record<string, unknown>).flavorTags as string[] | undefined,
            seasonalMonths: (product as unknown as Record<string, unknown>).seasonalMonths as number[] | undefined,
            usageScenarios: (product as unknown as Record<string, unknown>).usageScenarios as string[] | undefined,
            dietaryTags: (product as unknown as Record<string, unknown>).dietaryTags as string[] | undefined,
            originRegion: (product as unknown as Record<string, unknown>).originRegion as string | undefined,
          }}
        >
          <Form.Item
            label="商品名称"
            name="title"
            rules={[{ required: true, message: '请输入商品名称' }]}
          >
            <Input placeholder="请输入商品名称" maxLength={100} />
          </Form.Item>
          <Form.Item label="副标题" name="subtitle">
            <Input placeholder="请输入副标题" maxLength={200} />
          </Form.Item>
          <Form.Item label="商品分类" name="categoryId">
            <TreeSelect
              treeData={categories ? buildTreeData(categories) : []}
              placeholder="选择分类"
              allowClear
              treeDefaultExpandAll
              style={{ width: 300 }}
            />
          </Form.Item>
          <Form.Item label="商品描述" name="description" rules={[{ required: true, message: '请输入描述' }]}>
            <Input.TextArea rows={4} placeholder="请输入商品描述" />
          </Form.Item>
          <Form.Item label="产地 / 产区" name="originText">
            <Input placeholder="如：黑龙江省五常市" style={{ width: 300 }} />
          </Form.Item>
          <Form.Item
            label="基础价格（元）"
            name="basePrice"
            rules={[{ required: true, message: '请输入价格' }]}
          >
            <InputNumber
              min={0}
              precision={2}
              style={{ width: 200 }}
              prefix="¥"
            />
          </Form.Item>
          <Form.Item style={{ marginBottom: 0 }}>
            <Collapse
              ghost
              defaultActiveKey={['search-optimization']}
              items={[
                {
                  key: 'search-optimization',
                  label: <Text strong>AI 搜索优化</Text>,
                  extra: (
                    <Button
                      size="small"
                      icon={<SyncOutlined />}
                      onClick={async (e) => {
                        e.stopPropagation();
                        try {
                          await refillSemanticTags(id!);
                          message.success('已触发 AI 重新生成，稍后刷新页面查看结果');
                        } catch (err) {
                          message.error(err instanceof Error ? err.message : '触发失败');
                        }
                      }}
                    >
                      重新 AI 生成
                    </Button>
                  ),
                  children: (
                    <>
                      <Text type="secondary" style={{ display: 'block', marginBottom: 16 }}>
                        后台优先维护买家真实会说的别名和搜索语义，不再重复录入产地/标签。
                      </Text>
                      <Form.Item label="别名 / 俗称 / 常见搜索词" name="aiKeywords">
                        <Select
                          mode="tags"
                          placeholder="输入后按回车添加，如：毛尖、绿茶、春茶"
                          style={{ width: '100%' }}
                          tokenSeparators={[',']}
                        />
                      </Form.Item>
                      <Form.Item name="flavorTags" label="口味标签">
                        <Select
                          mode="tags"
                          placeholder="如：甜、脆、鲜、香辣"
                          tokenSeparators={[',', '，']}
                          style={{ width: '100%' }}
                        />
                      </Form.Item>
                      <Form.Item name="seasonalMonths" label="应季月份">
                        <Select
                          mode="multiple"
                          placeholder="选择应季月份"
                          options={Array.from({ length: 12 }, (_, i) => ({
                            label: `${i + 1}月`,
                            value: i + 1,
                          }))}
                          style={{ width: '100%' }}
                        />
                      </Form.Item>
                      <Form.Item name="usageScenarios" label="适用场景">
                        <Select
                          mode="tags"
                          placeholder="如：做饭、送礼、火锅、沙拉"
                          tokenSeparators={[',', '，']}
                          style={{ width: '100%' }}
                        />
                      </Form.Item>
                      <Form.Item name="dietaryTags" label="饮食属性">
                        <Select
                          mode="tags"
                          placeholder="如：有机、低糖、高蛋白、素食"
                          tokenSeparators={[',', '，']}
                          style={{ width: '100%' }}
                        />
                      </Form.Item>
                    </>
                  ),
                },
                {
                  key: 'advanced',
                  label: <Text strong>高级设置</Text>,
                  children: (
                    <>
                      <Form.Item
                        label="运营标签（选填）"
                        name="tagIds"
                        tooltip="用于后台运营和展示管理，不是 AI 搜索主字段。"
                      >
                        <Select
                          mode="multiple"
                          placeholder="请选择运营标签"
                          options={productTagOptions}
                          showSearch
                          optionFilterProp="label"
                        />
                      </Form.Item>
                      <Form.Item label="商品属性">
                        <Form.List name="attributes">
                          {(fields, { add, remove }) => (
                            <>
                              {fields.map((field) => (
                                <Space key={field.key} align="start" style={{ display: 'flex', marginBottom: 8 }}>
                                  <Form.Item {...field} name={[field.name, 'key']} rules={[{ required: true, message: '属性名' }]}>
                                    <Input placeholder="属性名" style={{ width: 140 }} />
                                  </Form.Item>
                                  <Form.Item {...field} name={[field.name, 'value']} rules={[{ required: true, message: '属性值' }]}>
                                    <Input placeholder="属性值" style={{ width: 280 }} />
                                  </Form.Item>
                                  <MinusCircleOutlined style={{ marginTop: 8, color: '#999' }} onClick={() => remove(field.name)} />
                                </Space>
                              ))}
                              <Button type="dashed" onClick={() => add()} icon={<PlusOutlined />}>
                                添加属性
                              </Button>
                            </>
                          )}
                        </Form.List>
                      </Form.Item>
                    </>
                  ),
                },
              ]}
            />
          </Form.Item>
        </Form>
      </Card>

      {/* 3. 商品图片 */}
      {mediaList && mediaList.length > 0 && (
        <Card title="商品图片" style={{ marginBottom: 16 }}>
          <Space wrap>
            {mediaList.map((img, idx) => (
              <div
                key={img.id || idx}
                style={{
                  width: 120,
                  height: 120,
                  borderRadius: 8,
                  overflow: 'hidden',
                  border: '1px solid #e8e8e8',
                }}
              >
                <img
                  src={img.url}
                  alt={`商品图片 ${idx + 1}`}
                  style={{
                    width: '100%',
                    height: '100%',
                    objectFit: 'cover',
                  }}
                />
              </div>
            ))}
          </Space>
        </Card>
      )}

      {/* 4. 商品规格列表（可编辑） */}
      <Card
        title="商品规格（不同包装/重量/口味等销售单元）"
        style={{ marginBottom: 16 }}
        extra={
          <PermissionGate permission={PERMISSIONS.PRODUCTS_UPDATE}>
            <Button type="primary" icon={<SaveOutlined />} onClick={handleSaveSkus}>
              保存规格
            </Button>
          </PermissionGate>
        }
      >
        <Form form={skuForm} layout="vertical" initialValues={{ skus: skuList }}>
          <Form.List name="skus">
            {(fields, { add, remove }) => (
              <>
                {fields.map((field) => (
                  <Space
                    key={field.key}
                    align="start"
                    style={{ display: 'flex', marginBottom: 8, flexWrap: 'wrap' }}
                  >
                    {/* 隐藏 id 字段（已存在 SKU 保留 id，新增则无） */}
                    <Form.Item {...field} name={[field.name, 'id']} hidden>
                      <Input />
                    </Form.Item>
                    <Form.Item
                      {...field}
                      label="规格名称"
                      name={[field.name, 'specText']}
                      rules={[{ required: true, message: '请输入规格名称' }]}
                    >
                      <Input placeholder="如：500g 礼盒装" style={{ width: 200 }} />
                    </Form.Item>
                    <Form.Item
                      {...field}
                      label="成本价（元）"
                      name={[field.name, 'cost']}
                    >
                      <InputNumber min={0} precision={2} style={{ width: 140 }} prefix="¥" />
                    </Form.Item>
                    <Form.Item
                      {...field}
                      label="售价（元）"
                      name={[field.name, 'price']}
                      rules={[{ required: true, message: '请输入售价' }]}
                    >
                      <InputNumber min={0} precision={2} style={{ width: 140 }} prefix="¥" />
                    </Form.Item>
                    <Form.Item
                      {...field}
                      label="库存"
                      name={[field.name, 'stock']}
                      rules={[{ required: true, message: '请输入库存' }]}
                    >
                      <InputNumber style={{ width: 120 }} />
                    </Form.Item>
                    <MinusCircleOutlined
                      style={{ marginTop: 38, color: '#999' }}
                      onClick={() => remove(field.name)}
                    />
                  </Space>
                ))}
                <Button
                  type="dashed"
                  onClick={() => add({ price: 0, stock: 0, cost: 0 })}
                  icon={<PlusOutlined />}
                >
                  添加规格
                </Button>
                <Text type="secondary" style={{ display: 'block', marginTop: 8, fontSize: 12 }}>
                  注：UPSERT 模式，删除行仅从表单移除不会删除后端 SKU；如需停用请使用卖家后台的 SKU 状态切换。
                </Text>
              </>
            )}
          </Form.List>
        </Form>
      </Card>

      {/* 5. 审核记录 */}
      <Card title="审核记录">
        {auditLoading ? (
          <div style={{ textAlign: 'center', padding: 24 }}>
            <Spin />
          </div>
        ) : auditLogs && auditLogs.length > 0 ? (
          <Timeline
            items={auditLogs.map((log: AuditLog) => ({
              color: auditActionColors[log.action] || 'gray',
              children: (
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                    <Tag color={auditActionColors[log.action]}>
                      {actionLabelMap[log.action] || log.action}
                    </Tag>
                    <span style={{ color: '#999', fontSize: 12 }}>
                      {dayjs(log.createdAt).format('YYYY-MM-DD HH:mm:ss')}
                    </span>
                  </div>
                  <div style={{ fontSize: 13 }}>
                    <span style={{ color: '#666' }}>操作人：</span>
                    {log.adminUser?.realName || log.adminUser?.username || '-'}
                  </div>
                  {log.summary && (
                    <div style={{ fontSize: 13, marginTop: 2 }}>
                      <span style={{ color: '#666' }}>摘要：</span>
                      {log.summary}
                    </div>
                  )}
                </div>
              ),
            }))}
          />
        ) : (
          <Empty description="暂无审核记录" image={Empty.PRESENTED_IMAGE_SIMPLE} />
        )}
      </Card>
    </div>
  );
}
