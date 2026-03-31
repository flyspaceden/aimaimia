import { useRef, useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { ProTable } from '@ant-design/pro-components';
import type { ActionType, ProColumns } from '@ant-design/pro-components';
import {
  Button, Tag, message, Modal, Space, Switch, Input, Badge,
  Descriptions, Card, Row, Col, Select, Statistic, Typography, Image,
} from 'antd';
import {
  CheckCircleOutlined,
  CloseCircleOutlined,
  EditOutlined,
  ShopOutlined,
  InboxOutlined,
  StopOutlined,
  ClockCircleOutlined,
  AppstoreOutlined,
} from '@ant-design/icons';
import { getProducts, getProductStats, auditProduct } from '@/api/products';
import { getCompanies } from '@/api/companies';
import PermissionGate from '@/components/PermissionGate';
import type { Product } from '@/types';
import {
  productStatusMap as statusMap,
  auditStatusMap,
  companyStatusMap,
  returnPolicyMap,
} from '@/constants/statusMaps';
import { PERMISSIONS } from '@/constants/permissions';
import dayjs from 'dayjs';

const { Text } = Typography;

// 状态 Tab 配置
const STATUS_TABS = [
  { key: 'ALL', label: '全部' },
  { key: 'ACTIVE', label: '已上架' },
  { key: 'INACTIVE', label: '已下架' },
  { key: 'AUDIT_PENDING', label: '待审核' },
  { key: 'AUDIT_REJECTED', label: '已拒绝' },
];

// 统计卡片配置
const STAT_CARDS = [
  { key: 'ALL', label: '全部商品', icon: <AppstoreOutlined />, color: '#8c8c8c' },
  { key: 'ACTIVE', label: '已上架', icon: <ShopOutlined />, color: '#52c41a' },
  { key: 'INACTIVE', label: '已下架', icon: <StopOutlined />, color: '#d9d9d9' },
  { key: 'AUDIT_PENDING', label: '待审核', icon: <ClockCircleOutlined />, color: '#faad14' },
  { key: 'AUDIT_REJECTED', label: '已拒绝', icon: <CloseCircleOutlined />, color: '#ff4d4f' },
];

export default function ProductListPage() {
  const navigate = useNavigate();
  const actionRef = useRef<ActionType>(null);
  const [auditModalOpen, setAuditModalOpen] = useState(false);
  const [currentProduct, setCurrentProduct] = useState<Product | null>(null);
  const [auditNote, setAuditNote] = useState('');
  const [auditLoading, setAuditLoading] = useState(false);
  const [activeTab, setActiveTab] = useState('ALL');
  const [stats, setStats] = useState<Record<string, number>>({});
  const [companyOptions, setCompanyOptions] = useState<{ label: string; value: string }[]>([]);

  // 加载统计数据
  const loadStats = async () => {
    try {
      const data = await getProductStats();
      setStats(data);
    } catch {
      // 静默失败
    }
  };

  // 加载公司列表
  useEffect(() => {
    loadStats();
    getCompanies({ pageSize: 200 })
      .then((res) => {
        setCompanyOptions(
          res.items.map((c) => ({ label: c.name, value: c.id })),
        );
      })
      .catch(() => {});
  }, []);

  const handleToggleStatus = async (record: Product) => {
    const { toggleProductStatus } = await import('@/api/products');
    const newStatus = record.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE';
    await toggleProductStatus(record.id, newStatus);
    message.success(`已${newStatus === 'ACTIVE' ? '上架' : '下架'}`);
    actionRef.current?.reload();
    loadStats();
  };

  const handleAudit = async (auditStatus: 'APPROVED' | 'REJECTED') => {
    if (!currentProduct) return;
    setAuditLoading(true);
    try {
      await auditProduct(currentProduct.id, { auditStatus, auditNote: auditNote || undefined });
      message.success(auditStatus === 'APPROVED' ? '审核通过' : '审核拒绝');
      setAuditModalOpen(false);
      setAuditNote('');
      actionRef.current?.reload();
      loadStats();
    } catch (err) {
      message.error(err instanceof Error ? err.message : '审核操作失败');
    } finally {
      setAuditLoading(false);
    }
  };

  // 待审核行高亮
  const rowClassName = (record: Product) => {
    if (record.auditStatus === 'PENDING') return 'product-row-pending-audit';
    if (record.auditStatus === 'REJECTED') return 'product-row-rejected';
    return '';
  };

  const columns: ProColumns<Product>[] = [
    {
      title: '图片',
      dataIndex: 'images',
      width: 72,
      search: false,
      render: (_: unknown, r: Product) => {
        const url = r.media?.[0]?.url || r.images?.[0]?.url;
        return url ? (
          <Image
            src={url}
            width={48}
            height={48}
            style={{ objectFit: 'cover', borderRadius: 4 }}
            preview={{ mask: '预览' }}
            fallback="data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNDgiIGhlaWdodD0iNDgiIHZpZXdCb3g9IjAgMCA0OCA0OCIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48cmVjdCB3aWR0aD0iNDgiIGhlaWdodD0iNDgiIGZpbGw9IiNmNWY1ZjUiLz48dGV4dCB4PSIyNCIgeT0iMjgiIHRleHQtYW5jaG9yPSJtaWRkbGUiIGZpbGw9IiNiZmJmYmYiIGZvbnQtc2l6ZT0iMTIiPuWbvjwvdGV4dD48L3N2Zz4="
          />
        ) : (
          <div style={{ width: 48, height: 48, background: '#f5f5f5', borderRadius: 4, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <InboxOutlined style={{ color: '#bfbfbf' }} />
          </div>
        );
      },
    },
    {
      title: '商品名称',
      dataIndex: 'title',
      ellipsis: true,
      width: 200,
    },
    {
      title: '价格',
      dataIndex: 'basePrice',
      width: 100,
      search: false,
      render: (_: unknown, r: Product) => (
        <Text strong style={{ color: '#059669' }}>¥{r.basePrice.toFixed(2)}</Text>
      ),
    },
    {
      title: '成本价',
      dataIndex: 'cost',
      width: 100,
      search: false,
      render: (_: unknown, r: Product) => {
        const costs = r.skus?.map((sku) => sku.cost).filter((c): c is number => c != null && c > 0) ?? [];
        if (costs.length === 0) return <Text type="secondary">-</Text>;
        const min = Math.min(...costs);
        const max = Math.max(...costs);
        return (
          <Text style={{ color: '#d48806' }}>
            {min === max ? `¥${min.toFixed(2)}` : `¥${min.toFixed(2)}~${max.toFixed(2)}`}
          </Text>
        );
      },
    },
    {
      title: '公司',
      dataIndex: 'companyId',
      width: 140,
      ellipsis: true,
      renderFormItem: () => (
        <Select
          placeholder="选择公司"
          allowClear
          showSearch
          optionFilterProp="label"
          options={companyOptions}
        />
      ),
      render: (_: unknown, r: Product) => {
        if (!r.company) return <Text type="secondary">-</Text>;
        const companyStatus = r.company.status;
        const isSuspended = companyStatus === 'SUSPENDED' || companyStatus === 'REJECTED';
        return (
          <Space size={4}>
            <Text
              style={{ cursor: 'pointer', color: isSuspended ? '#ff4d4f' : '#059669' }}
              onClick={() => navigate(`/companies/${r.company!.id}`)}
            >
              {r.company.name}
            </Text>
            {isSuspended && companyStatus && (
              <Tag color={companyStatusMap[companyStatus]?.color} style={{ marginLeft: 0 }}>
                {companyStatusMap[companyStatus]?.text}
              </Tag>
            )}
          </Space>
        );
      },
    },
    {
      title: '分类',
      dataIndex: ['category', 'name'],
      width: 100,
      ellipsis: true,
      search: false,
      render: (_: unknown, r: Product) => r.category?.name || <Text type="secondary">-</Text>,
    },
    {
      title: '退货政策',
      width: 100,
      search: false,
      render: (_: unknown, r: Product) => {
        const policy = r.category?.returnPolicy;
        if (!policy) return <Text type="secondary">-</Text>;
        const entry = returnPolicyMap[policy];
        return <Tag color={entry?.color || 'default'}>{entry?.text || policy}</Tag>;
      },
    },
    {
      title: '库存',
      dataIndex: 'skus',
      width: 80,
      search: false,
      render: (_: unknown, r: Product) => {
        const total = r.skus?.reduce((sum, sku) => sum + (sku.stock ?? 0), 0) ?? 0;
        return (
          <Text type={total <= 0 ? 'danger' : total < 10 ? 'warning' : undefined}>
            {total}
          </Text>
        );
      },
    },
    {
      title: '状态',
      dataIndex: 'status',
      width: 80,
      hideInSearch: true, // Tab 已做筛选
      render: (_: unknown, r: Product) => {
        const s = statusMap[r.status];
        return <Tag color={s?.color}>{s?.text}</Tag>;
      },
    },
    {
      title: '审核',
      dataIndex: 'auditStatus',
      width: 80,
      hideInSearch: true, // Tab 已做筛选
      render: (_: unknown, r: Product) => {
        const s = auditStatusMap[r.auditStatus];
        return <Tag color={s?.color}>{s?.text}</Tag>;
      },
    },
    {
      title: '审核备注',
      dataIndex: 'auditNote',
      width: 120,
      ellipsis: true,
      search: false,
      render: (_: unknown, r: Product) =>
        r.auditNote ? <Text type="secondary">{r.auditNote}</Text> : <Text type="secondary">-</Text>,
    },
    {
      title: '创建时间',
      dataIndex: 'createdAt',
      width: 160,
      valueType: 'dateRange',
      render: (_: unknown, r: Product) => dayjs(r.createdAt).format('YYYY-MM-DD HH:mm'),
      search: {
        transform: (value: [string, string]) => ({
          startDate: value[0],
          endDate: value[1],
        }),
      },
    },
    {
      title: '操作',
      key: 'action',
      width: 120,
      fixed: 'right',
      search: false,
      render: (_: unknown, record: Product) => (
        <Space size={0}>
          <PermissionGate permission={PERMISSIONS.PRODUCTS_UPDATE}>
            <Button
              type="link"
              size="small"
              icon={<EditOutlined />}
              onClick={() => navigate(`/products/${record.id}/edit`)}
            >
              编辑
            </Button>
          </PermissionGate>
          <PermissionGate permission={PERMISSIONS.PRODUCTS_UPDATE}>
            <Switch
              checked={record.status === 'ACTIVE'}
              checkedChildren="上"
              unCheckedChildren="下"
              onChange={() => handleToggleStatus(record)}
              size="small"
            />
          </PermissionGate>
          <PermissionGate permission={PERMISSIONS.PRODUCTS_AUDIT}>
            {record.auditStatus === 'PENDING' && (
              <Button
                type="link"
                size="small"
                onClick={() => {
                  setCurrentProduct(record);
                  setAuditModalOpen(true);
                }}
              >
                审核
              </Button>
            )}
          </PermissionGate>
        </Space>
      ),
    },
  ];

  // Tab items with badge counts
  const tabItems = useMemo(
    () =>
      STATUS_TABS.map((t) => ({
        key: t.key,
        label: (
          <span>
            {t.label}
            {stats[t.key] != null && stats[t.key] > 0 && (
              <Badge
                count={stats[t.key]}
                size="small"
                style={{ marginLeft: 6 }}
                overflowCount={999}
              />
            )}
          </span>
        ),
      })),
    [stats],
  );

  return (
    <div style={{ padding: 24 }}>
      {/* 统计卡片 */}
      <Row gutter={16} style={{ marginBottom: 16 }}>
        {STAT_CARDS.map((card) => (
          <Col key={card.key} xs={12} sm={8} md={4} lg={4}>
            <Card
              hoverable
              size="small"
              style={{
                borderLeft: `3px solid ${card.color}`,
                cursor: 'pointer',
                background: activeTab === card.key ? `${card.color}08` : undefined,
              }}
              onClick={() => {
                setActiveTab(card.key);
                actionRef.current?.reload();
              }}
            >
              <Statistic
                title={
                  <Space size={4}>
                    {card.icon}
                    <span>{card.label}</span>
                  </Space>
                }
                value={stats[card.key] ?? 0}
                valueStyle={{ color: card.color, fontSize: 24 }}
              />
            </Card>
          </Col>
        ))}
      </Row>

      {/* 商品表格 */}
      <ProTable<Product>
        headerTitle="商家商品管理"
        actionRef={actionRef}
        rowKey="id"
        columns={columns}
        toolbar={{
          menu: {
            type: 'tab',
            activeKey: activeTab,
            items: tabItems,
            onChange: (key) => {
              setActiveTab(key as string);
              actionRef.current?.reload();
            },
          },
        }}
        request={async (params) => {
          const {
            current,
            pageSize,
            title: keyword,
            companyId,
            startDate,
            endDate,
          } = params as any;

          // 根据 activeTab 映射 status 和 auditStatus
          let statusFilter: string | undefined;
          let auditStatusFilter: string | undefined;
          if (activeTab === 'ACTIVE' || activeTab === 'INACTIVE') {
            statusFilter = activeTab;
          } else if (activeTab === 'AUDIT_PENDING') {
            auditStatusFilter = 'PENDING';
          } else if (activeTab === 'AUDIT_REJECTED') {
            auditStatusFilter = 'REJECTED';
          }

          const res = await getProducts({
            page: current,
            pageSize,
            status: statusFilter,
            auditStatus: auditStatusFilter,
            keyword,
            companyId: companyId || undefined,
            startDate,
            endDate,
          });
          return { data: res.items, total: res.total, success: true };
        }}
        scroll={{ x: 1500 }}
        search={{ labelWidth: 'auto', defaultCollapsed: false }}
        pagination={{ defaultPageSize: 20, showSizeChanger: true, showQuickJumper: true }}
        rowClassName={rowClassName}
        dateFormatter="string"
      />

      {/* 审核弹窗 */}
      <Modal
        title="商品审核"
        open={auditModalOpen}
        width={560}
        onCancel={() => { setAuditModalOpen(false); setAuditNote(''); }}
        footer={[
          <Button key="reject" danger icon={<CloseCircleOutlined />} loading={auditLoading} onClick={() => handleAudit('REJECTED')}>
            拒绝
          </Button>,
          <Button key="approve" type="primary" icon={<CheckCircleOutlined />} loading={auditLoading} onClick={() => handleAudit('APPROVED')}>
            通过
          </Button>,
        ]}
      >
        {currentProduct && (
          <Descriptions column={2} size="small" style={{ marginBottom: 16 }}>
            <Descriptions.Item label="商品名称" span={2}>{currentProduct.title}</Descriptions.Item>
            <Descriptions.Item label="价格">¥{currentProduct.basePrice.toFixed(2)}</Descriptions.Item>
            <Descriptions.Item label="所属企业">
              {currentProduct.company ? (
                <Space size={4}>
                  <span>{currentProduct.company.name}</span>
                  {currentProduct.company.status && (
                    <Tag color={companyStatusMap[currentProduct.company.status]?.color} style={{ marginLeft: 0 }}>
                      {companyStatusMap[currentProduct.company.status]?.text}
                    </Tag>
                  )}
                </Space>
              ) : '-'}
            </Descriptions.Item>
            <Descriptions.Item label="分类">{currentProduct.category?.name || '-'}</Descriptions.Item>
            <Descriptions.Item label="提交时间">{dayjs(currentProduct.createdAt).format('YYYY-MM-DD HH:mm')}</Descriptions.Item>
            <Descriptions.Item label="当前状态">
              <Tag color={statusMap[currentProduct.status]?.color}>{statusMap[currentProduct.status]?.text}</Tag>
            </Descriptions.Item>
            {currentProduct.auditNote && (
              <Descriptions.Item label="上次审核备注" span={2}>
                <Text type="warning">{currentProduct.auditNote}</Text>
              </Descriptions.Item>
            )}
          </Descriptions>
        )}
        <Input.TextArea
          rows={3}
          placeholder="审核备注（可选）"
          value={auditNote}
          onChange={(e) => setAuditNote(e.target.value)}
        />
      </Modal>

      {/* 行高亮样式 */}
      <style>{`
        .product-row-pending-audit {
          background: #fff7e6 !important;
        }
        .product-row-pending-audit:hover > td {
          background: #ffe7ba !important;
        }
        .product-row-rejected {
          background: #fff2f0 !important;
        }
        .product-row-rejected:hover > td {
          background: #ffccc7 !important;
        }
      `}</style>
    </div>
  );
}
