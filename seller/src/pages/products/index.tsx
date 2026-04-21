import { useRef, useEffect } from 'react';
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
} from '@ant-design/icons';
import { ProTable } from '@ant-design/pro-components';
import type { ActionType, ProColumns } from '@ant-design/pro-components';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { getProducts, toggleProductStatus, deleteProduct } from '@/api/products';
import { getMarkupRate } from '@/api/config';
import { productStatusMap, auditStatusMap, returnPolicyMap } from '@/constants/statusMaps';
import type { Product, ProductSKU } from '@/types';
import { getOverview } from '@/api/analytics';

// 低库存阈值
const LOW_STOCK_THRESHOLD = 10;

// 计算 SKU 总库存
function getTotalStock(product: Product): number {
  return (product.skus ?? []).reduce((sum, s) => sum + s.stock, 0);
}

export default function ProductListPage() {
  const { message, modal } = App.useApp();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const actionRef = useRef<ActionType>(null);

  // 复用 analytics 接口获取统计数据
  const { data: overview } = useQuery({
    queryKey: ['seller-analytics-overview'],
    queryFn: getOverview,
    staleTime: 30_000,
    refetchOnWindowFocus: true,
  });

  // 使用少量请求获取统计计数（按状态各请求 1 条只取 total）
  const { data: statusCounts } = useQuery({
    queryKey: ['seller-product-status-counts'],
    staleTime: 15_000,
    refetchInterval: 15_000, // 轮询感知管理端审核结果
    refetchOnWindowFocus: true,
    queryFn: async () => {
      const [all, active, pending] = await Promise.all([
        getProducts({ page: 1, pageSize: 1 }),
        getProducts({ page: 1, pageSize: 1, status: 'ACTIVE' }),
        getProducts({ page: 1, pageSize: 1, auditStatus: 'PENDING' }),
      ]);
      return {
        total: all.total,
        active: active.total,
        pending: pending.total,
      };
    },
  });

  // 列表也做轮询 + 页面可见时刷新
  useEffect(() => {
    const pollTimer = setInterval(() => {
      if (document.visibilityState === 'visible') {
        actionRef.current?.reload();
      }
    }, 15_000);
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
        const stock = getTotalStock(r);
        const isLowStock = stock < LOW_STOCK_THRESHOLD && r.status === 'ACTIVE';
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
                {isLowStock && (
                  <span style={{ color: '#ff4d4f' }}>
                    <WarningOutlined style={{ marginRight: 2 }} />
                    库存 {stock}
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
        const prices = skus.map((s) => s.price).filter((v) => v > 0);
        const costs = skus.map((s) => s.cost).filter((v): v is number => typeof v === 'number' && v > 0);
        const minPrice = prices.length > 0 ? Math.min(...prices) : r.basePrice;
        const maxPrice = prices.length > 0 ? Math.max(...prices) : r.basePrice;
        const hasPriceRange = prices.length > 1 && minPrice !== maxPrice;
        return (
          <div>
            <div style={{ fontWeight: 500, fontFamily: 'monospace' }}>
              {hasPriceRange
                ? `¥${minPrice.toFixed(2)} ~ ${maxPrice.toFixed(2)}`
                : `¥${r.basePrice.toFixed(2)}`}
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
        const stock = getTotalStock(r);
        const isLow = stock < LOW_STOCK_THRESHOLD && r.status === 'ACTIVE';
        return (
          <span
            style={{
              fontWeight: isLow ? 600 : 400,
              color: isLow ? '#ff4d4f' : undefined,
              fontFamily: 'monospace',
            }}
          >
            {stock}
          </span>
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
      valueEnum: Object.fromEntries(
        Object.entries(productStatusMap).map(([k, v]) => [
          k,
          { text: v.text },
        ]),
      ),
      render: (_, r) => {
        // 仅审核通过的商品可切换上/下架；未审核 / 被驳回时显示只读 Tag
        if (r.auditStatus !== 'APPROVED') {
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
      valueEnum: Object.fromEntries(
        Object.entries(auditStatusMap).map(([k, v]) => [k, { text: v.text }]),
      ),
      render: (_, r) => {
        const s = auditStatusMap[r.auditStatus];
        return <Tag color={s?.color}>{s?.text || r.auditStatus}</Tag>;
      },
    },
    {
      title: '操作',
      width: 140,
      fixed: 'right',
      search: false,
      render: (_, r) => (
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
              description="删除后不可恢复，关联的 SKU、图片将一并移除。"
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
      ),
    },
  ];

  return (
    <div>
      {/* 统计概览卡片 */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(4, 1fr)',
          gap: 16,
          marginBottom: 16,
        }}
      >
        <Card size="small">
          <Statistic
            title="全部商品"
            value={statusCounts?.total ?? overview?.total.productCount ?? 0}
            prefix={<ShoppingOutlined style={{ color: '#1677ff' }} />}
            valueStyle={{ color: '#1677ff', fontSize: 28 }}
          />
        </Card>
        <Card size="small">
          <Statistic
            title="已上架"
            value={statusCounts?.active ?? 0}
            prefix={<CheckCircleOutlined style={{ color: '#2E7D32' }} />}
            valueStyle={{ color: '#2E7D32', fontSize: 28 }}
          />
        </Card>
        <Card size="small">
          <Statistic
            title="待审核"
            value={statusCounts?.pending ?? 0}
            prefix={<ClockCircleOutlined style={{ color: '#fa8c16' }} />}
            valueStyle={{ color: '#fa8c16', fontSize: 28 }}
          />
        </Card>
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
                    const isLow = v < LOW_STOCK_THRESHOLD && r.status === 'ACTIVE';
                    return (
                      <span
                        style={{
                          fontFamily: 'monospace',
                          fontWeight: isLow ? 600 : 400,
                          color: isLow ? '#ff4d4f' : undefined,
                        }}
                      >
                        {isLow && <WarningOutlined style={{ marginRight: 4 }} />}
                        {v}
                      </span>
                    );
                  },
                },
                {
                  title: '重量',
                  dataIndex: 'weightGram',
                  width: 80,
                  render: (v) => (typeof v === 'number' ? `${v}g` : '-'),
                },
              ]}
            />
          ),
        }}
        request={async (params) => {
          const res = await getProducts({
            page: params.current || 1,
            pageSize: params.pageSize || 20,
            keyword: params.keyword || '',
            status: params.status || '',
            auditStatus: params.auditStatus || '',
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
