import { useRef, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  App,
  Avatar,
  Button,
  Card,
  Image,
  Popconfirm,
  Space,
  Statistic,
  Switch,
  Table,
  Tag,
  Tooltip,
  Typography,
} from 'antd';
import {
  PlusOutlined,
  ShoppingOutlined,
  CheckCircleOutlined,
  ClockCircleOutlined,
  WarningOutlined,
  EditOutlined,
  FileImageOutlined,
  DollarOutlined,
  FileTextOutlined,
} from '@ant-design/icons';
import { ProTable } from '@ant-design/pro-components';
import type { ActionType, ProColumns } from '@ant-design/pro-components';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { getProducts, toggleProductStatus, deleteProduct } from '@/api/products';
import { getMarkupRate, getPublicAppConfig } from '@/api/config';
import { productStatusMap, auditStatusMap, returnPolicyMap } from '@/constants/statusMaps';
import type { Product, ProductSKU } from '@/types';
import { getOverview } from '@/api/analytics';

const { Text } = Typography;

function getStockSummary(product: Product, threshold: number) {
  const skus = product.skus ?? [];
  const total = skus.reduce((sum, sku) => sum + (sku.stock ?? 0), 0);
  const minSku = skus.reduce<ProductSKU | undefined>((min, sku) => {
    if (!min) return sku;
    return (sku.stock ?? 0) < (min.stock ?? 0) ? sku : min;
  }, undefined);
  const owedSkus = skus.filter((sku) => (sku.stock ?? 0) < 0);
  const zeroCount = skus.filter((sku) => (sku.stock ?? 0) === 0).length;
  const lowCount = threshold > 0
    ? skus.filter((sku) => (sku.stock ?? 0) > 0 && (sku.stock ?? 0) <= threshold).length
    : 0;
  return { total, minSku, owedSkus, zeroCount, lowCount };
}

export default function ProductListPage() {
  const { message, modal } = App.useApp();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const actionRef = useRef<ActionType>(null);
  // 顶部统计卡作为快捷筛选 tab
  type StatusTabKey = 'ALL' | 'ACTIVE' | 'PENDING' | 'DRAFT';
  const [activeTab, setActiveTab] = useState<StatusTabKey>('ALL');

  // 复用 analytics 接口获取统计数据
  const { data: overview } = useQuery({
    queryKey: ['seller-analytics-overview'],
    queryFn: getOverview,
    staleTime: 30_000,
    refetchOnWindowFocus: true,
  });

  const { data: appConfig } = useQuery({
    queryKey: ['app-config'],
    queryFn: getPublicAppConfig,
    staleTime: 1000 * 60 * 60,
  });
  const lowStockThreshold = appConfig?.lowStockDisplayThreshold ?? 10;

  // 使用少量请求获取统计计数（按状态各请求 1 条只取 total）
  const { data: statusCounts } = useQuery({
    queryKey: ['seller-product-status-counts'],
    staleTime: 30_000,
    refetchInterval: 30_000, // 轮询感知管理端审核结果
    refetchOnWindowFocus: true,
    queryFn: async () => {
      const [all, active, pending, draft] = await Promise.all([
        getProducts({ page: 1, pageSize: 1 }),
        getProducts({ page: 1, pageSize: 1, status: 'ACTIVE' }),
        getProducts({ page: 1, pageSize: 1, auditStatus: 'PENDING' }),
        getProducts({ page: 1, pageSize: 1, status: 'DRAFT' }),
      ]);
      return {
        total: all.total,  // 后端 list 已默认排除 DRAFT
        active: active.total,
        pending: pending.total,
        draft: draft.total,
      };
    },
  });

  // 列表也做轮询 + 页面可见时刷新
  useEffect(() => {
    const pollTimer = setInterval(() => {
      if (document.visibilityState === 'visible') {
        actionRef.current?.reload();
      }
    }, 30_000);
    const onVisibility = () => {
      if (document.visibilityState === 'visible') {
        actionRef.current?.reload();
      }
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      clearInterval(pollTimer);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, []);

  // 切换 tab 立即刷新表格
  useEffect(() => {
    actionRef.current?.reload();
  }, [activeTab]);

  // 加价率（用于展开行计算售价）
  const { data: configData } = useQuery({
    queryKey: ['seller-markup-rate'],
    queryFn: getMarkupRate,
    staleTime: 300_000,
  });
  const markupRate = configData?.markupRate ?? 1.3;

  const handleToggle = async (id: string, newStatus: 'ACTIVE' | 'INACTIVE') => {
    try {
      await toggleProductStatus(id, newStatus);
      message.success(newStatus === 'ACTIVE' ? '已上架' : '已下架');
      queryClient.invalidateQueries({ queryKey: ['seller-product-status-counts'] });
      queryClient.invalidateQueries({ queryKey: ['seller-analytics-overview'] });
      actionRef.current?.reload();
    } catch (err) {
      message.error(err instanceof Error ? err.message : '操作失败');
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await deleteProduct(id);
      message.success('删除成功');
      queryClient.invalidateQueries({ queryKey: ['seller-product-status-counts'] });
      queryClient.invalidateQueries({ queryKey: ['seller-analytics-overview'] });
      actionRef.current?.reload();
    } catch (err) {
      modal.error({
        title: '无法删除',
        content: (
          <div style={{ fontSize: 16, lineHeight: 1.7, paddingTop: 8 }}>
            {err instanceof Error ? err.message : '删除失败'}
          </div>
        ),
        width: 520,
        centered: true,
        okText: '知道了',
      });
    }
  };

  const columns: ProColumns<Product>[] = [
    {
      title: '商品信息',
      width: 320,
      ellipsis: true,
      render: (_, r) => {
        const cover = r.media?.[0]?.url;
        const { total, minSku, owedSkus, zeroCount, lowCount } = getStockSummary(r, lowStockThreshold);
        const hasOwed = (minSku?.stock ?? 0) < 0;
        const hasStockWarning = zeroCount > 0 || lowCount > 0;
        return (
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            {cover ? (
              <Image
                src={cover}
                width={48}
                height={48}
                style={{ objectFit: 'cover', borderRadius: 6, flexShrink: 0 }}
                preview={{ mask: '预览' }}
              />
            ) : (
              <Avatar
                shape="square"
                size={48}
                icon={<FileImageOutlined />}
                style={{ flexShrink: 0, backgroundColor: '#f5f5f5', color: '#bbb' }}
              />
            )}
            <div style={{ minWidth: 0, flex: 1 }}>
              <div
                style={{
                  fontWeight: 500,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                  lineHeight: '20px',
                  cursor: 'pointer',
                }}
                onClick={() => navigate(`/products/${r.id}/edit`)}
              >
                {r.title}
              </div>
              <div style={{ fontSize: 12, color: '#999', marginTop: 2, display: 'flex', alignItems: 'center', gap: 4 }}>
                {r.category?.name && (
                  <Tag style={{ fontSize: 11, lineHeight: '16px', padding: '0 4px', margin: 0 }}>
                    {r.category.path
                      ? r.category.path.replace(/^\//, '').replace(/\//g, ' / ')
                      : r.category.name}
                  </Tag>
                )}
                {r.skus?.length > 1 && (
                  <span>{r.skus.length} 规格</span>
                )}
                {(hasOwed || hasStockWarning) && (
                  <span style={{ color: '#ff4d4f' }}>
                    <WarningOutlined style={{ marginRight: 2 }} />
                    {[
                      hasOwed ? `${owedSkus.length} 规格欠货` : null,
                      zeroCount > 0 ? `${zeroCount} 规格无库存` : null,
                      lowCount > 0 ? `${lowCount} 规格低库存` : null,
                    ].filter(Boolean).join(' / ')}
                    <span style={{ marginLeft: 4 }}>库存 {total}</span>
                  </span>
                )}
              </div>
            </div>
          </div>
        );
      },
      // 搜索用商品名称
      dataIndex: 'keyword',
      formItemProps: { label: '商品名称' },
      fieldProps: { placeholder: '搜索商品名称' },
    },
    {
      title: '价格',
      width: 150,
      search: false,
      render: (_, r) => {
        const skus = r.skus ?? [];
        const costs = skus.map((s) => s.cost).filter((v): v is number => typeof v === 'number' && v > 0);
        // 草稿 SKU 后端 price 占位为 0（提交审核时统一按成本×加价率重算），
        // 这里若 sku.price 为 0 就用 cost × markupRate 实时算估价显示。
        const effectivePrices = skus
          .map((s) => {
            if (s.price > 0) return s.price;
            if (typeof s.cost === 'number' && s.cost > 0) return +(s.cost * markupRate).toFixed(2);
            return 0;
          })
          .filter((v) => v > 0);
        const fallbackBase = r.basePrice > 0
          ? r.basePrice
          : (costs.length > 0 ? +(Math.min(...costs) * markupRate).toFixed(2) : 0);
        const minPrice = effectivePrices.length > 0 ? Math.min(...effectivePrices) : fallbackBase;
        const maxPrice = effectivePrices.length > 0 ? Math.max(...effectivePrices) : fallbackBase;
        const hasPriceRange = effectivePrices.length > 1 && minPrice !== maxPrice;
        const isDraft = r.status === 'DRAFT';
        return (
          <div>
            <div style={{ fontWeight: 500, fontFamily: 'monospace' }}>
              {minPrice > 0 ? (
                hasPriceRange
                  ? `¥${minPrice.toFixed(2)} ~ ${maxPrice.toFixed(2)}`
                  : `¥${minPrice.toFixed(2)}`
              ) : (
                <span style={{ color: '#bbb' }}>-</span>
              )}
              {isDraft && minPrice > 0 && (
                <span style={{ fontSize: 11, color: '#bbb', marginLeft: 4 }}>估价</span>
              )}
            </div>
            {costs.length > 0 && (
              <div style={{ fontSize: 12, color: '#999', fontFamily: 'monospace' }}>
                成本 ¥{Math.min(...costs).toFixed(2)}
                {costs.length > 1 && Math.min(...costs) !== Math.max(...costs)
                  ? ` ~ ${Math.max(...costs).toFixed(2)}`
                  : ''}
              </div>
            )}
          </div>
        );
      },
    },
    {
      title: '库存',
      width: 80,
      search: false,
      sorter: true,
      render: (_, r) => {
        const { total, minSku, owedSkus, zeroCount, lowCount } = getStockSummary(r, lowStockThreshold);
        const hasOwed = (minSku?.stock ?? 0) < 0;
        const owedText = owedSkus
          .map((sku) => `${sku.title || sku.id}: 欠货 ${Math.abs(sku.stock ?? 0)} 件`)
          .join('\n');
        return (
          <Space direction="vertical" size={0}>
            <Text type={hasOwed || zeroCount > 0 ? 'danger' : lowCount > 0 ? 'warning' : undefined}>
              {total}
            </Text>
            {hasOwed && (
              <Tooltip title={<pre style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{owedText}</pre>}>
                <Text type="danger" style={{ fontSize: 12 }}>
                  {owedSkus.length} 个规格欠货
                </Text>
              </Tooltip>
            )}
            {zeroCount > 0 && <Text type="danger" style={{ fontSize: 12 }}>{zeroCount} 个规格无库存</Text>}
            {lowCount > 0 && <Text type="warning" style={{ fontSize: 12 }}>{lowCount} 个规格低库存</Text>}
          </Space>
        );
      },
    },
    {
      title: '单笔限购',
      width: 80,
      search: false,
      render: (_, r) => {
        const limits = (r.skus ?? []).map((s: any) => s.maxPerOrder).filter((v: any) => v != null);
        if (limits.length === 0) return <span style={{ color: '#999' }}>不限</span>;
        const min = Math.min(...limits);
        const max = Math.max(...limits);
        return min === max ? `${min} 件` : `${min}~${max} 件`;
      },
    },
    {
      title: '退货政策',
      width: 110,
      search: false,
      render: (_, r) => {
        const policy = (r as any).effectiveReturnPolicy;
        if (!policy) return '-';
        const entry = returnPolicyMap[policy];
        return <Tag color={entry?.color || 'default'}>{entry?.text || policy}</Tag>;
      },
    },
    {
      title: '状态',
      dataIndex: 'status',
      width: 110,
      search: false, // 改用顶部 tab 筛选
      valueEnum: Object.fromEntries(
        Object.entries(productStatusMap).map(([k, v]) => [
          k,
          { text: v.text },
        ]),
      ),
      render: (_, r) => {
        // 草稿 / 未审核 / 被驳回：只读 Tag，不能上下架
        if (r.status === 'DRAFT' || r.auditStatus !== 'APPROVED') {
          const s = productStatusMap[r.status];
          return <Tag color={s?.color}>{s?.text || r.status}</Tag>;
        }
        return (
          <Popconfirm
            title={r.status === 'ACTIVE' ? '确认下架？' : '确认上架？'}
            onConfirm={() =>
              handleToggle(r.id, r.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE')
            }
          >
            <Switch
              checked={r.status === 'ACTIVE'}
              checkedChildren="上架"
              unCheckedChildren="下架"
              size="small"
              // 阻止 switch 直接切换，由 Popconfirm 控制
              onClick={(_, e) => e.stopPropagation()}
            />
          </Popconfirm>
        );
      },
    },
    {
      title: '审核',
      dataIndex: 'auditStatus',
      width: 90,
      search: false, // 改用顶部 tab 筛选
      valueEnum: Object.fromEntries(
        Object.entries(auditStatusMap).map(([k, v]) => [k, { text: v.text }]),
      ),
      render: (_, r) => {
        // 草稿尚未提交，不显示审核状态
        if (r.status === 'DRAFT') return <span style={{ color: '#bbb' }}>-</span>;
        const s = auditStatusMap[r.auditStatus];
        return <Tag color={s?.color}>{s?.text || r.auditStatus}</Tag>;
      },
    },
    {
      title: '操作',
      width: 140,
      fixed: 'right',
      search: false,
      render: (_, r) => {
        // 草稿行：仅展示"继续编辑"+"删除"
        if (r.status === 'DRAFT') {
          return (
            <Space size={4}>
              <Button
                type="link"
                size="small"
                icon={<EditOutlined />}
                onClick={() => navigate(`/products/${r.id}/edit`)}
              >
                继续编辑
              </Button>
              <Popconfirm
                title="删除草稿？"
                description="删除后不可恢复。"
                okText="确认删除"
                cancelText="取消"
                okButtonProps={{ danger: true }}
                onConfirm={() => handleDelete(r.id)}
              >
                <Button type="link" size="small" danger>
                  删除
                </Button>
              </Popconfirm>
            </Space>
          );
        }
        return (
          <Space size={4}>
            <Button
              type="link"
              size="small"
              icon={<EditOutlined />}
              onClick={() => navigate(`/products/${r.id}/edit`)}
            >
              编辑
            </Button>
            {r.auditStatus === 'REJECTED' && (
              <Button
                type="link"
                size="small"
                style={{ color: '#fa8c16' }}
                onClick={() => navigate(`/products/${r.id}/edit`)}
              >
                重新提交
                {(r.submissionCount ?? 1) > 1 && (
                  <span style={{ marginLeft: 4, color: '#8c8c8c' }}>
                    (已提交 {r.submissionCount} 次)
                  </span>
                )}
              </Button>
            )}
            {r.status === 'INACTIVE' && (
              <Popconfirm
                title="确认删除该商品？"
                description="删除后不可恢复，关联的规格、图片将一并移除。"
                okText="确认删除"
                cancelText="取消"
                okButtonProps={{ danger: true }}
                onConfirm={() => handleDelete(r.id)}
              >
                <Button type="link" size="small" danger>
                  删除
                </Button>
              </Popconfirm>
            )}
          </Space>
        );
      },
    },
  ];

  return (
    <div>
      {/* 统计概览卡片（前 4 个为可点击的快捷筛选 tab，最后一个为只读营收） */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(5, 1fr)',
          gap: 16,
          marginBottom: 16,
        }}
      >
        {([
          { key: 'ALL', title: '全部商品', value: statusCounts?.total ?? overview?.total.productCount ?? 0, icon: <ShoppingOutlined />, color: '#1677ff' },
          { key: 'ACTIVE', title: '已上架', value: statusCounts?.active ?? 0, icon: <CheckCircleOutlined />, color: '#2E7D32' },
          { key: 'PENDING', title: '待审核', value: statusCounts?.pending ?? 0, icon: <ClockCircleOutlined />, color: '#fa8c16' },
          {
            key: 'DRAFT',
            title: (
              <span>
                草稿
                {(statusCounts?.draft ?? 0) >= 5 && (
                  <Tag color="warning" style={{ marginLeft: 6, fontSize: 10, lineHeight: '16px', padding: '0 4px' }}>
                    已达上限
                  </Tag>
                )}
              </span>
            ),
            value: statusCounts?.draft ?? 0,
            icon: <FileTextOutlined />,
            color: '#8c8c8c',
            suffix: <span style={{ fontSize: 14, color: '#bbb' }}>/5</span>,
          },
        ] as const).map((card) => {
          const isActive = activeTab === card.key;
          return (
            <Card
              key={card.key}
              size="small"
              hoverable
              onClick={() => setActiveTab(card.key as StatusTabKey)}
              style={{
                cursor: 'pointer',
                borderColor: isActive ? card.color : undefined,
                borderWidth: isActive ? 2 : 1,
                background: isActive ? `${card.color}0F` : undefined,
                transition: 'all 0.15s',
              }}
            >
              <Statistic
                title={card.title}
                value={card.value}
                prefix={<span style={{ color: card.color }}>{card.icon}</span>}
                valueStyle={{ color: card.color, fontSize: 28 }}
                suffix={'suffix' in card ? card.suffix : undefined}
              />
            </Card>
          );
        })}
        <Card size="small">
          <Statistic
            title="累计营收"
            value={overview?.total.totalRevenue ?? 0}
            precision={2}
            prefix={<DollarOutlined style={{ color: '#722ed1' }} />}
            valueStyle={{ color: '#722ed1', fontSize: 28 }}
            suffix="元"
          />
        </Card>
      </div>

      {/* 商品表格 */}
      <ProTable<Product>
        headerTitle={
          <Space>
            <ShoppingOutlined />
            <span>商品管理</span>
          </Space>
        }
        actionRef={actionRef}
        columns={columns}
        scroll={{ x: 920 }}
        rowKey="id"
        expandable={{
          // 仅多规格商品可展开
          rowExpandable: (r) => (r.skus?.length ?? 0) > 1,
          expandedRowRender: (r) => (
            <Table<ProductSKU>
              dataSource={r.skus}
              rowKey="id"
              size="small"
              pagination={false}
              style={{ margin: '4px 0' }}
              columns={[
                {
                  title: '规格',
                  dataIndex: 'title',
                  width: 160,
                  render: (v) => v || '默认',
                },
                {
                  title: '成本',
                  dataIndex: 'cost',
                  width: 100,
                  render: (v) =>
                    typeof v === 'number' ? (
                      <span style={{ fontFamily: 'monospace' }}>¥{v.toFixed(2)}</span>
                    ) : '-',
                },
                {
                  title: '售价',
                  dataIndex: 'price',
                  width: 100,
                  render: (v, sku) => {
                    const price = v > 0 ? v : (typeof sku.cost === 'number' ? sku.cost * markupRate : 0);
                    return price > 0 ? (
                      <span style={{ fontFamily: 'monospace', fontWeight: 500 }}>¥{price.toFixed(2)}</span>
                    ) : '-';
                  },
                },
                {
                  title: '库存',
                  dataIndex: 'stock',
                  width: 80,
                  render: (v: number) => {
                    const hasOwed = v < 0;
                    const isZero = v <= 0;
                    const isLow = lowStockThreshold > 0 && v > 0 && v <= lowStockThreshold;
                    return (
                      <Text type={hasOwed || isZero ? 'danger' : isLow ? 'warning' : undefined}>
                        {(hasOwed || isZero || isLow) && <WarningOutlined style={{ marginRight: 4 }} />}
                        {hasOwed ? `欠货 ${Math.abs(v)} 件` : v}
                      </Text>
                    );
                  },
                },
                {
                  title: '重量',
                  dataIndex: 'weightGram',
                  width: 80,
                  render: (v, sku) => {
                    const skuCode = (sku as { skuCode?: string | null }).skuCode;
                    const isDraftWeightPlaceholder =
                      skuCode === '__DRAFT_WEIGHT_PLACEHOLDER__' ||
                      skuCode?.startsWith('__DRAFT_WEIGHT_PLACEHOLDER__:');
                    if (isDraftWeightPlaceholder) return '未填写';
                    return typeof v === 'number' ? `${v}g` : '-';
                  },
                },
              ]}
            />
          ),
        }}
        request={async (params) => {
          // 顶部 tab 决定 status / auditStatus，搜索面板的 keyword 仍然生效
          const tabFilter: { status?: string; auditStatus?: string } =
            activeTab === 'ACTIVE' ? { status: 'ACTIVE' }
            : activeTab === 'PENDING' ? { auditStatus: 'PENDING' }
            : activeTab === 'DRAFT' ? { status: 'DRAFT' }
            : {}; // ALL：不传过滤，后端默认排除 DRAFT
          const res = await getProducts({
            page: params.current || 1,
            pageSize: params.pageSize || 20,
            keyword: params.keyword || '',
            ...tabFilter,
          });
          return { data: res.items, total: res.total, success: true };
        }}
        toolBarRender={() => [
          <Button
            key="create"
            type="primary"
            icon={<PlusOutlined />}
            onClick={() => navigate('/products/create')}
          >
            创建商品
          </Button>,
        ]}
        pagination={{ defaultPageSize: 20, showSizeChanger: true }}
        search={{ labelWidth: 'auto', collapsed: true, collapseRender: (collapsed) => collapsed ? '展开筛选' : '收起' }}
      />
    </div>
  );
}
