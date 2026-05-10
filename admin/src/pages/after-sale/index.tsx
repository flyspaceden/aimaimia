import { useRef, useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { ProTable } from '@ant-design/pro-components';
import type { ActionType, ProColumns } from '@ant-design/pro-components';
import {
  App, Button, Tag, Modal, Input, Descriptions, Space, Radio,
  Image, Divider, Typography, Tooltip, Card, Row, Col, Statistic, Badge, Select, Spin, Timeline,
} from 'antd';
import {
  CheckCircleOutlined, CloseCircleOutlined,
  ExclamationCircleOutlined, ClockCircleOutlined,
  InboxOutlined, SyncOutlined, AuditOutlined,
  SafetyOutlined,
} from '@ant-design/icons';
import {
  getAfterSales,
  getAfterSale,
  getAfterSaleStats,
  arbitrateAfterSale,
  retryAfterSaleRefund,
} from '@/api/after-sale';
import type { AdminAfterSale, AfterSaleStatsResponse } from '@/api/after-sale';
import { getCompanies } from '@/api/companies';
import PermissionGate from '@/components/PermissionGate';
import { PERMISSIONS } from '@/constants/permissions';
import { afterSaleStatusMap, afterSaleTypeMap, refundStatusMap } from '@/constants/statusMaps';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
import 'dayjs/locale/zh-cn';

dayjs.extend(relativeTime);
dayjs.locale('zh-cn');

const { Text } = Typography;

// 仲裁结果模板文案
const ARBITRATION_TEMPLATES = {
  APPROVED: [
    { label: '质量问题', value: '经平台核实，商品存在质量问题，支持买家售后申请。请卖家按照售后协议处理。' },
    { label: '发错商品', value: '经平台核实，卖家发货商品与订单不一致，支持买家售后申请。请卖家尽快处理。' },
    { label: '运输损坏', value: '经平台核实，商品在运输过程中损坏，支持买家售后申请。请卖家安排补发或退款。' },
    { label: '描述不符', value: '经平台核实，商品与页面描述明显不符，支持买家售后申请。请卖家配合处理。' },
  ],
  REJECTED: [
    { label: '理由不充分', value: '经平台核实，买家提供的售后理由及凭证不充分，不支持本次售后申请。' },
    { label: '超出时限', value: '该售后申请已超出平台规定的售后时限，不予支持。' },
    { label: '人为损坏', value: '经平台核实，商品损坏系人为因素导致，不属于售后范围，不予支持。' },
    { label: '不影响使用', value: '经平台核实，商品轻微瑕疵不影响正常使用，不支持售后。如有异议可联系客服协商。' },
  ],
};

// 售后原因映射
const REASON_TYPE_MAP: Record<string, { text: string; color: string }> = {
  QUALITY_ISSUE: { text: '质量问题', color: 'red' },
  WRONG_ITEM: { text: '发错商品', color: 'orange' },
  DAMAGED: { text: '运输损坏', color: 'volcano' },
  NOT_AS_DESCRIBED: { text: '与描述不符', color: 'gold' },
  SIZE_ISSUE: { text: '规格不符', color: 'cyan' },
  EXPIRED: { text: '临期/过期', color: 'magenta' },
  OTHER: { text: '其他', color: 'default' },
};

const RETURN_SHIPPING_PAYER_MAP: Record<string, { text: string; color: string }> = {
  BUYER: { text: '买家承担', color: 'orange' },
  SELLER: { text: '卖家承担', color: 'blue' },
  PLATFORM: { text: '平台承担', color: 'green' },
};

// 状态 Tab 配置
const STATUS_TABS = [
  { key: 'ALL', label: '全部' },
  { key: 'REQUESTED', label: '待处理' },
  { key: 'PENDING_ARBITRATION', label: '等待仲裁' },
  { key: 'UNDER_REVIEW', label: '审核中' },
  { key: 'APPROVED', label: '已批准' },
  { key: 'RETURN_SHIPPING', label: '退货中' },
  { key: 'REFUNDING', label: '退款中' },
  { key: 'COMPLETED', label: '已完成' },
];

// 统计卡片配置
const STAT_CARDS = [
  { key: 'ALL', label: '全部', icon: <InboxOutlined />, color: '#8c8c8c' },
  { key: 'REQUESTED', label: '待处理', icon: <ExclamationCircleOutlined />, color: '#fa8c16' },
  { key: 'PENDING_ARBITRATION', label: '等待仲裁', icon: <AuditOutlined />, color: '#722ed1' },
  { key: 'UNDER_REVIEW', label: '审核中', icon: <SyncOutlined />, color: '#1677ff' },
  { key: 'APPROVED', label: '已批准', icon: <SafetyOutlined />, color: '#13c2c2' },
  { key: 'COMPLETED', label: '已完成', icon: <CheckCircleOutlined />, color: '#52c41a' },
];

/** 格式化地址快照为可读字符串 */
function formatAddress(addr?: Record<string, unknown> | null): string {
  if (!addr) return '-';
  const parts = [addr.province, addr.city, addr.district, addr.detail].filter(Boolean);
  return parts.length === 0 ? '-' : parts.join('');
}

function formatReasonTag(reasonType?: string, fallbackReason?: string) {
  if (reasonType && REASON_TYPE_MAP[reasonType]) {
    const entry = REASON_TYPE_MAP[reasonType];
    return <Tag color={entry.color}>{entry.text}</Tag>;
  }
  return fallbackReason || '-';
}

function formatCurrency(value?: number | null) {
  return value == null ? '-' : `¥${value.toFixed(2)}`;
}

function renderStatusTag(map: Record<string, { text: string; color: string }>, value?: string | null) {
  if (!value) return '-';
  const entry = map[value];
  return <Tag color={entry?.color || 'default'}>{entry?.text || value}</Tag>;
}

function renderReturnShippingPayer(value?: string | null) {
  if (!value) return '-';
  const entry = RETURN_SHIPPING_PAYER_MAP[value];
  return <Tag color={entry?.color || 'default'}>{entry?.text || value}</Tag>;
}

function formatDateTime(value?: string | null) {
  return value ? dayjs(value).format('YYYY-MM-DD HH:mm') : '-';
}

function renderRefundHistory(items?: AdminAfterSale['refundHistory']) {
  if (!items?.length) return <Text type="secondary">-</Text>;
  return (
    <Space direction="vertical" size={4}>
      {items.map((item) => (
        <Space key={item.id} wrap size={6}>
          {item.fromStatus ? renderStatusTag(refundStatusMap, item.fromStatus) : <Text type="secondary">创建</Text>}
          <Text type="secondary">→</Text>
          {renderStatusTag(refundStatusMap, item.toStatus)}
          {item.remark ? <Text type="secondary">{item.remark}</Text> : null}
          <Text type="secondary">{formatDateTime(item.createdAt)}</Text>
        </Space>
      ))}
    </Space>
  );
}

function renderAfterSaleHistory(items?: AdminAfterSale['statusHistory']) {
  if (!items?.length) return <Text type="secondary">-</Text>;
  return (
    <Space direction="vertical" size={4}>
      {items.map((item) => (
        <Space key={item.id} wrap size={6}>
          {item.fromStatus ? renderStatusTag(afterSaleStatusMap, item.fromStatus) : <Text type="secondary">创建</Text>}
          <Text type="secondary">→</Text>
          {renderStatusTag(afterSaleStatusMap, item.toStatus)}
          {item.operatorType ? <Tag>{item.operatorType}</Tag> : null}
          {item.reason ? <Text type="secondary">{item.reason}</Text> : null}
          <Text type="secondary">{formatDateTime(item.createdAt)}</Text>
        </Space>
      ))}
    </Space>
  );
}

export default function AfterSaleListPage() {
  const { message, modal } = App.useApp();
  const navigate = useNavigate();
  const actionRef = useRef<ActionType>(null);
  const detailRequestRef = useRef(0);
  const [arbitrateModal, setArbitrateModal] = useState<{ visible: boolean; record: AdminAfterSale | null }>({
    visible: false,
    record: null,
  });
  const [arbitrateAction, setArbitrateAction] = useState<'APPROVED' | 'REJECTED'>('APPROVED');
  const [arbitrateReason, setArbitrateReason] = useState('');
  const [arbitrateLoading, setArbitrateLoading] = useState(false);
  const [arbitrateDetailLoading, setArbitrateDetailLoading] = useState(false);
  const [activeTab, setActiveTab] = useState('ALL');
  const [stats, setStats] = useState<AfterSaleStatsResponse>({ byStatus: {}, byType: {} });
  const [companyOptions, setCompanyOptions] = useState<{ label: string; value: string }[]>([]);

  // 加载统计和公司列表
  const loadStats = async () => {
    try {
      const data = await getAfterSaleStats();
      setStats(data);
    } catch { /* 静默 */ }
  };

  useEffect(() => {
    loadStats();
    getCompanies({ pageSize: 200 })
      .then((res) => setCompanyOptions(res.items.map((c) => ({ label: c.name, value: c.id }))))
      .catch(() => {});
  }, []);

  const handleArbitrate = async () => {
    const record = arbitrateModal.record;
    if (!record) return;
    setArbitrateLoading(true);
    try {
      await arbitrateAfterSale(record.id, {
        status: arbitrateAction,
        reason: arbitrateReason || undefined,
      });
      message.success(
        arbitrateAction === 'APPROVED'
          ? '仲裁通过 — 已批准售后申请'
          : '仲裁拒绝 — 维持当前决定',
      );
      setArbitrateModal({ visible: false, record: null });
      detailRequestRef.current += 1;
      setArbitrateAction('APPROVED');
      setArbitrateReason('');
      actionRef.current?.reload();
      loadStats();
    } catch (err) {
      message.error(err instanceof Error ? err.message : '仲裁操作失败');
    } finally {
      setArbitrateLoading(false);
    }
  };

  const handleRetryRefund = (record: AdminAfterSale) => {
    if (!record.refund?.id) return;
    modal.confirm({
      title: '确认重试售后退款？',
      content: `退款单 ${record.refund.merchantRefundNo || record.refund.id} 将重新发起渠道退款，请确认当前状态无重复出款风险。`,
      okText: '重试退款',
      okButtonProps: { danger: true },
      cancelText: '取消',
      onOk: async () => {
        try {
          await retryAfterSaleRefund(record.id, record.refund!.id);
          message.success('退款重试已提交');
          actionRef.current?.reload();
          loadStats();
        } catch (err) {
          message.error(err instanceof Error ? err.message : '退款重试失败');
        }
      },
    });
  };

  const openArbitrateModal = async (record: AdminAfterSale) => {
    const requestId = detailRequestRef.current + 1;
    detailRequestRef.current = requestId;
    setArbitrateModal({ visible: true, record });
    setArbitrateDetailLoading(true);
    try {
      const detail = await getAfterSale(record.id);
      if (detailRequestRef.current === requestId) {
        setArbitrateModal({ visible: true, record: detail });
      }
    } catch (err) {
      if (detailRequestRef.current === requestId) {
        message.error(err instanceof Error ? err.message : '售后详情加载失败，已展示列表数据');
      }
    } finally {
      if (detailRequestRef.current === requestId) {
        setArbitrateDetailLoading(false);
      }
    }
  };

  const applyTemplate = (text: string) => setArbitrateReason(text);

  // 待仲裁行高亮
  const rowClassName = (record: AdminAfterSale) => {
    if (record.status === 'REQUESTED') return 'after-sale-row-urgent';
    if (record.status === 'PENDING_ARBITRATION') return 'after-sale-row-arbitration';
    return '';
  };

  const columns: ProColumns<AdminAfterSale>[] = [
    { title: '售后单号', dataIndex: 'id', ellipsis: true, width: 180, copyable: true },
    {
      title: '关联订单',
      dataIndex: 'orderId',
      width: 180,
      ellipsis: true,
      render: (_: unknown, r: AdminAfterSale) => (
        <a onClick={() => navigate(`/orders/${r.orderId}`)}>{r.orderId}</a>
      ),
    },
    {
      title: '商户',
      dataIndex: 'companyId',
      width: 130,
      ellipsis: true,
      renderFormItem: () => (
        <Select
          placeholder="选择商户"
          allowClear
          showSearch
          optionFilterProp="label"
          options={companyOptions}
        />
      ),
      render: (_: unknown, r: AdminAfterSale) => {
        if (!r.company) return <Text type="secondary">-</Text>;
        return (
          <Text
            style={{ cursor: 'pointer', color: '#059669' }}
            onClick={() => navigate(`/companies/${r.company!.id}`)}
          >
            {r.company.name}
          </Text>
        );
      },
    },
    {
      title: '买家',
      width: 120,
      search: false,
      render: (_: unknown, r: AdminAfterSale) => {
        const nickname = r.user?.nickname;
        const phone = r.user?.phone;
        return (
          <div>
            <div>{nickname || '-'}</div>
            {phone && <Text type="secondary" style={{ fontSize: 12 }}>{phone}</Text>}
          </div>
        );
      },
    },
    {
      title: '商品信息',
      width: 160,
      search: false,
      ellipsis: true,
      render: (_: unknown, r: AdminAfterSale) => {
        const snapshot = r.orderItem?.productSnapshot as Record<string, unknown> | undefined;
        if (!snapshot) return '-';
        const title = (snapshot.title as string) || '-';
        const qty = r.orderItem?.quantity;
        const price = r.orderItem?.unitPrice;
        return (
          <div>
            <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{title}</div>
            {(qty || price) && (
              <Text type="secondary" style={{ fontSize: 12 }}>
                {price != null ? `¥${price}` : ''}{qty ? ` x${qty}` : ''}
              </Text>
            )}
          </div>
        );
      },
    },
    {
      title: '金额',
      width: 90,
      search: false,
      render: (_: unknown, r: AdminAfterSale) => {
        const amt = r.refundAmount ?? 0;
        return amt > 0 ? <Text strong style={{ color: '#cf1322' }}>¥{amt.toFixed(2)}</Text> : '-';
      },
    },
    {
      title: '售后类型',
      dataIndex: 'afterSaleType',
      width: 120,
      renderFormItem: () => (
        <Select
          placeholder="售后类型"
          allowClear
          options={Object.entries(afterSaleTypeMap).map(([k, v]) => ({ label: v.text, value: k }))}
        />
      ),
      render: (_: unknown, r: AdminAfterSale) => {
        const entry = afterSaleTypeMap[r.afterSaleType];
        return entry ? <Tag color={entry.color}>{entry.text}</Tag> : r.afterSaleType;
      },
    },
    {
      title: '原因',
      width: 120,
      ellipsis: true,
      search: false,
      render: (_: unknown, r: AdminAfterSale) => formatReasonTag(r.reasonType, r.reason),
    },
    {
      title: '凭证',
      width: 70,
      search: false,
      render: (_: unknown, r: AdminAfterSale) => {
        if (!r.photos || r.photos.length === 0) return <Text type="secondary">-</Text>;
        return (
          <Image.PreviewGroup>
            <Image
              src={r.photos[0]}
              width={36}
              height={36}
              style={{ objectFit: 'cover', borderRadius: 4 }}
              preview={{ mask: `${r.photos.length}张` }}
            />
          </Image.PreviewGroup>
        );
      },
    },
    {
      title: '卖家处理',
      width: 130,
      search: false,
      render: (_: unknown, r: AdminAfterSale) => {
        if (r.reviewNote || r.reviewedAt) {
          const isRejected = r.status === 'REJECTED';
          return (
            <Tooltip title={r.reviewNote || '无备注'}>
              <div>
                <div style={{
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 110,
                  color: isRejected ? '#ff4d4f' : undefined,
                }}>
                  {r.reviewNote || '已处理'}
                </div>
                {r.reviewedAt && (
                  <Text type="secondary" style={{ fontSize: 12 }}>
                    {dayjs(r.reviewedAt).format('MM-DD HH:mm')}
                  </Text>
                )}
              </div>
            </Tooltip>
          );
        }
        return <Text type="secondary">未处理</Text>;
      },
    },
    {
      title: '状态',
      dataIndex: 'status',
      width: 100,
      hideInSearch: true,
      render: (_: unknown, r: AdminAfterSale) => {
        const s = afterSaleStatusMap[r.status];
        return <Tag color={s?.color}>{s?.text || r.status}</Tag>;
      },
    },
    {
      title: '人工复核',
      dataIndex: 'manualReviewReason',
      width: 110,
      valueType: 'select',
      valueEnum: {
        pending: { text: '待复核' },
      },
      search: {
        transform: (value: string) => (value ? { manualReview: value } : {}),
      },
      render: (_: unknown, r: AdminAfterSale) => {
        if (r.manualReviewReason && !r.manualReviewResolvedAt) {
          return (
            <Tooltip title={r.manualReviewReason}>
              <Tag color="volcano">待复核</Tag>
            </Tooltip>
          );
        }
        return <Text type="secondary">-</Text>;
      },
    },
    {
      title: '申请时间',
      dataIndex: 'createdAt',
      width: 140,
      search: false,
      render: (_: unknown, r: AdminAfterSale) => {
        const created = dayjs(r.createdAt);
        const hoursAgo = dayjs().diff(created, 'hour');
        const isOverdue = ['REQUESTED', 'PENDING_ARBITRATION', 'UNDER_REVIEW'].includes(r.status) && hoursAgo > 48;
        return (
          <div>
            <div>{created.format('MM-DD HH:mm')}</div>
            <Text type="secondary" style={{ fontSize: 12, color: isOverdue ? '#ff4d4f' : undefined }}>
              <ClockCircleOutlined style={{ marginRight: 2 }} />
              {created.fromNow()}
              {isOverdue && ' 超时'}
            </Text>
          </div>
        );
      },
    },
    {
      title: '操作',
      width: 150,
      fixed: 'right',
      search: false,
      render: (_: unknown, r: AdminAfterSale) => {
        const canArbitrate = ['REQUESTED', 'PENDING_ARBITRATION', 'UNDER_REVIEW'].includes(r.status);
        const canRetryRefund = Boolean(r.refund?.id && ['FAILED', 'REFUNDING'].includes(r.refund.status));
        return (
          <Space size={4}>
            {/* 详情按钮恒显——任何状态下管理员都能进 Modal 查完整信息 */}
            <Button
              type="link"
              size="small"
              onClick={() => openArbitrateModal(r)}
            >
              详情
            </Button>
            {canArbitrate && (
              <PermissionGate permission={PERMISSIONS.AFTER_SALE_ARBITRATE}>
                <Button
                  type="link"
                  size="small"
                  style={{ color: '#fa8c16' }}
                  onClick={() => openArbitrateModal(r)}
                >
                  仲裁
                </Button>
              </PermissionGate>
            )}
            {canRetryRefund && (
              <PermissionGate permission={PERMISSIONS.AFTER_SALE_ARBITRATE}>
                <Button
                  type="link"
                  size="small"
                  danger
                  icon={<SyncOutlined />}
                  onClick={() => handleRetryRefund(r)}
                >
                  重试
                </Button>
              </PermissionGate>
            )}
          </Space>
        );
      },
    },
  ];

  // Tab items（带数量）
  const tabItems = useMemo(
    () =>
      STATUS_TABS.map((t) => ({
        key: t.key,
        label: (
          <span>
            {t.label}
            {stats.byStatus[t.key] != null && stats.byStatus[t.key] > 0 && (
              <Badge count={stats.byStatus[t.key]} size="small" style={{ marginLeft: 6 }} overflowCount={999} />
            )}
          </span>
        ),
      })),
    [stats],
  );

  const modalRecord = arbitrateModal.record;
  const currentTemplates = ARBITRATION_TEMPLATES[arbitrateAction] || [];

  return (
    <div style={{ padding: 24 }}>
      {/* 统计卡片 */}
      <Row gutter={16} style={{ marginBottom: 16 }}>
        {STAT_CARDS.map((card) => (
          <Col key={card.key} xs={12} sm={8} md={4} lg={4} xl={4}>
            <Card
              hoverable
              size="small"
              style={{
                borderLeft: `3px solid ${card.color}`,
                cursor: 'pointer',
                background: activeTab === card.key ? `${card.color}08` : undefined,
              }}
              onClick={() => { setActiveTab(card.key); actionRef.current?.reload(); }}
            >
              <Statistic
                title={<Space size={4}>{card.icon}<span>{card.label}</span></Space>}
                value={stats.byStatus[card.key] ?? 0}
                valueStyle={{ color: card.color, fontSize: 24 }}
              />
            </Card>
          </Col>
        ))}
      </Row>

      {/* 售后类型分布（小标签） */}
      {Object.keys(stats.byType).length > 0 && (
        <div style={{ marginBottom: 12 }}>
          <Space size={12}>
            <Text type="secondary">按类型：</Text>
            {Object.entries(stats.byType).map(([type, count]) => {
              const entry = afterSaleTypeMap[type];
              return (
                <Tag key={type} color={entry?.color || 'default'}>
                  {entry?.text || type}: {count}
                </Tag>
              );
            })}
          </Space>
        </div>
      )}

      {/* 售后表格 */}
      <ProTable<AdminAfterSale>
        headerTitle="售后仲裁"
        actionRef={actionRef}
        columns={columns}
        rowKey="id"
        toolbar={{
          menu: {
            type: 'tab',
            activeKey: activeTab,
            items: tabItems,
            onChange: (key) => { setActiveTab(key as string); actionRef.current?.reload(); },
          },
        }}
        request={async (params) => {
          const { current, pageSize, id: keyword, companyId, afterSaleType, manualReview } = params as any;
          const statusFilter = activeTab !== 'ALL' ? activeTab : undefined;
          const res = await getAfterSales({
            page: current,
            pageSize,
            status: statusFilter,
            afterSaleType: afterSaleType || undefined,
            keyword: keyword || undefined,
            companyId: companyId || undefined,
            manualReview: manualReview || undefined,
          });
          return { data: res.items, total: res.total, success: true };
        }}
        scroll={{ x: 1700 }}
        search={{ labelWidth: 'auto', defaultCollapsed: false }}
        pagination={{ defaultPageSize: 20, showSizeChanger: true, showQuickJumper: true }}
        rowClassName={rowClassName}
        dateFormatter="string"
      />

      {/* 售后详情/仲裁弹窗（详情入口恒显，仲裁操作仅对可仲裁状态启用）*/}
      <Modal
        title={
          arbitrateModal.record &&
          ['REQUESTED', 'PENDING_ARBITRATION', 'UNDER_REVIEW'].includes(arbitrateModal.record.status)
            ? '售后仲裁'
            : '售后详情'
        }
        open={arbitrateModal.visible}
        width={680}
        onCancel={() => {
          setArbitrateModal({ visible: false, record: null });
          detailRequestRef.current += 1;
          setArbitrateDetailLoading(false);
          setArbitrateAction('APPROVED');
          setArbitrateReason('');
        }}
        onOk={handleArbitrate}
        confirmLoading={arbitrateLoading}
        okText="确认提交"
        cancelText="关闭"
        footer={
          arbitrateModal.record &&
          ['REQUESTED', 'PENDING_ARBITRATION', 'UNDER_REVIEW'].includes(arbitrateModal.record.status)
            ? undefined  // 可仲裁：用 antd 默认 footer（取消 + 确认提交）
            : null        // 非仲裁状态：纯查看，不显示 footer 按钮（用户点 X 关闭）
        }
        destroyOnClose
      >
        <Spin spinning={arbitrateDetailLoading}>
          {modalRecord && (
            <>
            {/* 基本信息 */}
            <Descriptions column={2} size="small" style={{ marginBottom: 12 }} title="申请信息">
              <Descriptions.Item label="售后单号">{modalRecord.id}</Descriptions.Item>
              <Descriptions.Item label="关联订单">
                <a onClick={() => navigate(`/orders/${modalRecord.orderId}`)}>
                  {modalRecord.orderId}
                </a>
              </Descriptions.Item>
              <Descriptions.Item label="买家昵称">{modalRecord.user?.nickname || '-'}</Descriptions.Item>
              <Descriptions.Item label="买家手机">
                {modalRecord.user?.phone || '-'}
              </Descriptions.Item>
              <Descriptions.Item label="商户">
                {modalRecord.company ? (
                  <Text style={{ color: '#059669' }}>{modalRecord.company.name}</Text>
                ) : '-'}
              </Descriptions.Item>
              <Descriptions.Item label="当前状态">
                <Tag color={afterSaleStatusMap[modalRecord.status]?.color}>
                  {afterSaleStatusMap[modalRecord.status]?.text}
                </Tag>
              </Descriptions.Item>
              <Descriptions.Item label="仲裁来源状态">
                {renderStatusTag(afterSaleStatusMap, modalRecord.arbitrationSourceStatus)}
              </Descriptions.Item>
              <Descriptions.Item label="售后类型">
                <Tag color={afterSaleTypeMap[modalRecord.afterSaleType]?.color}>
                  {afterSaleTypeMap[modalRecord.afterSaleType]?.text || modalRecord.afterSaleType}
                </Tag>
              </Descriptions.Item>
              <Descriptions.Item label="退款金额">
                {modalRecord.refundAmount ? (
                  <Text strong style={{ color: '#cf1322' }}>¥{modalRecord.refundAmount.toFixed(2)}</Text>
                ) : '-'}
              </Descriptions.Item>
              <Descriptions.Item label="退款状态">
                {modalRecord.refund ? renderStatusTag(refundStatusMap, modalRecord.refund.status) : '-'}
              </Descriptions.Item>
              <Descriptions.Item label="退货运费承担方">
                {renderReturnShippingPayer(modalRecord.returnShippingPayer)}
              </Descriptions.Item>
              <Descriptions.Item label="退货运费">
                {formatCurrency(modalRecord.returnShippingFee)}
              </Descriptions.Item>
              <Descriptions.Item label="申请时间">{dayjs(modalRecord.createdAt).format('YYYY-MM-DD HH:mm')}</Descriptions.Item>
              <Descriptions.Item label="需要退回">
                <Tag color={modalRecord.requiresReturn ? 'orange' : 'green'}>
                  {modalRecord.requiresReturn ? '需要退回' : '无需退回'}
                </Tag>
              </Descriptions.Item>
              <Descriptions.Item label="售后原因" span={2}>
                <Space>
                  {formatReasonTag(modalRecord.reasonType, modalRecord.reason)}
                  {modalRecord.reasonType === 'OTHER' && modalRecord.reason ? (
                    <Text type="secondary">{modalRecord.reason}</Text>
                  ) : null}
                </Space>
              </Descriptions.Item>
              <Descriptions.Item label="人工复核原因" span={2}>
                {modalRecord.manualReviewReason ? (
                  <Space direction="vertical" size={2}>
                    <Text type={modalRecord.manualReviewResolvedAt ? 'secondary' : 'danger'}>
                      {modalRecord.manualReviewReason}
                    </Text>
                    <Text type="secondary" style={{ fontSize: 12 }}>
                      发起：{modalRecord.manualReviewRequestedAt
                        ? dayjs(modalRecord.manualReviewRequestedAt).format('YYYY-MM-DD HH:mm')
                        : '-'}
                      {modalRecord.manualReviewResolvedAt
                        ? ` / 处理：${dayjs(modalRecord.manualReviewResolvedAt).format('YYYY-MM-DD HH:mm')}`
                        : ''}
                    </Text>
                  </Space>
                ) : '-'}
              </Descriptions.Item>
            </Descriptions>

            {/* 商品信息 */}
            <Descriptions column={2} size="small" style={{ marginBottom: 12 }} title="商品信息">
              <Descriptions.Item label="商品名称" span={2}>{
                (() => {
                  const snapshot = modalRecord.orderItem?.productSnapshot as Record<string, unknown> | undefined;
                  return (snapshot?.title as string) || '-';
                })()
              }</Descriptions.Item>
              <Descriptions.Item label="单价">
                {modalRecord.orderItem?.unitPrice != null
                  ? `¥${modalRecord.orderItem.unitPrice}`
                  : '-'}
              </Descriptions.Item>
              <Descriptions.Item label="数量">
                {modalRecord.orderItem?.quantity ?? '-'}
              </Descriptions.Item>
            </Descriptions>

            {/* 买家收货地址 */}
            {modalRecord.order?.addressSnapshot && (
              <Descriptions column={2} size="small" style={{ marginBottom: 12 }} title="买家收货地址">
                <Descriptions.Item label="收件人">
                  {(modalRecord.order.addressSnapshot.receiverName as string) || '-'}
                </Descriptions.Item>
                <Descriptions.Item label="联系电话">
                  {(modalRecord.order.addressSnapshot.receiverPhone as string) || '-'}
                </Descriptions.Item>
                <Descriptions.Item label="详细地址" span={2}>
                  {formatAddress(modalRecord.order.addressSnapshot)}
                </Descriptions.Item>
              </Descriptions>
            )}

            {/* 卖家处理记录 */}
            <Descriptions column={2} size="small" style={{ marginBottom: 12 }} title="卖家处理情况">
              <Descriptions.Item label="处理状态">
                {modalRecord.reviewedAt ? (
                  <Tag color="blue">已处理</Tag>
                ) : (
                  <Tag color="default">未处理</Tag>
                )}
              </Descriptions.Item>
              <Descriptions.Item label="处理时间">
                {modalRecord.reviewedAt
                  ? dayjs(modalRecord.reviewedAt).format('YYYY-MM-DD HH:mm')
                  : '-'}
              </Descriptions.Item>
              <Descriptions.Item label="处理意见" span={2}>
                {modalRecord.reviewNote ? (
                  <Text style={{ color: modalRecord.status === 'REJECTED' ? '#ff4d4f' : undefined }}>
                    {modalRecord.reviewNote}
                  </Text>
                ) : '-'}
              </Descriptions.Item>
              {modalRecord.returnWaybillNo && (
                <Descriptions.Item label="退货物流单号" span={2}>
                  {modalRecord.returnWaybillNo}
                </Descriptions.Item>
              )}
              {modalRecord.replacementWaybillNo && (
                <Descriptions.Item label="换货物流单号" span={2}>
                  {modalRecord.replacementWaybillNo}
                </Descriptions.Item>
              )}
            </Descriptions>

            {/* 顺丰物流轨迹（实时查询；推送通道无法路由到售后单，主动查询补充） */}
            {(modalRecord.returnTracking?.events?.length ||
              modalRecord.sellerReturnTracking?.events?.length ||
              modalRecord.replacementTracking?.events?.length) ? (
              <div style={{ marginBottom: 12 }}>
                <div style={{ marginBottom: 8, fontWeight: 500 }}>顺丰物流轨迹（实时）</div>
                {modalRecord.returnTracking?.events?.length ? (
                  <div style={{ marginBottom: 12 }}>
                    <Text type="secondary" style={{ fontSize: 12 }}>
                      买家寄回（{modalRecord.returnWaybillNo}）
                    </Text>
                    <Timeline
                      style={{ marginTop: 8 }}
                      items={modalRecord.returnTracking.events.map((e: any) => ({
                        color: 'blue',
                        children: (
                          <Space direction="vertical" size={2}>
                            <Text>{e.message}</Text>
                            <Text type="secondary" style={{ fontSize: 12 }}>
                              {e.time}{e.location ? ` · ${e.location}` : ''}
                            </Text>
                          </Space>
                        ),
                      }))}
                    />
                  </div>
                ) : null}
                {modalRecord.replacementTracking?.events?.length ? (
                  <div style={{ marginBottom: 12 }}>
                    <Text type="secondary" style={{ fontSize: 12 }}>
                      卖家发换货（{modalRecord.replacementWaybillNo}）
                    </Text>
                    <Timeline
                      style={{ marginTop: 8 }}
                      items={modalRecord.replacementTracking.events.map((e: any) => ({
                        color: 'green',
                        children: (
                          <Space direction="vertical" size={2}>
                            <Text>{e.message}</Text>
                            <Text type="secondary" style={{ fontSize: 12 }}>
                              {e.time}{e.location ? ` · ${e.location}` : ''}
                            </Text>
                          </Space>
                        ),
                      }))}
                    />
                  </div>
                ) : null}
                {modalRecord.sellerReturnTracking?.events?.length ? (
                  <div style={{ marginBottom: 12 }}>
                    <Text type="secondary" style={{ fontSize: 12 }}>
                      卖家拒收回寄
                    </Text>
                    <Timeline
                      style={{ marginTop: 8 }}
                      items={modalRecord.sellerReturnTracking.events.map((e: any) => ({
                        color: 'orange',
                        children: (
                          <Space direction="vertical" size={2}>
                            <Text>{e.message}</Text>
                            <Text type="secondary" style={{ fontSize: 12 }}>
                              {e.time}{e.location ? ` · ${e.location}` : ''}
                            </Text>
                          </Space>
                        ),
                      }))}
                    />
                  </div>
                ) : null}
              </div>
            ) : (modalRecord.returnWaybillNo || modalRecord.replacementWaybillNo) ? (
              <div style={{ marginBottom: 12 }}>
                <Text type="secondary" style={{ fontSize: 12 }}>
                  顺丰物流轨迹：暂无路由信息（顺丰可能尚未揽收或推送延迟）
                </Text>
              </div>
            ) : null}

            {/* 退款与售后历史 */}
            <Descriptions column={1} size="small" style={{ marginBottom: 12 }} title="退款与状态历史">
              <Descriptions.Item label="退款历史">
                {renderRefundHistory(modalRecord.refundHistory)}
              </Descriptions.Item>
              <Descriptions.Item label="售后状态历史">
                {renderAfterSaleHistory(modalRecord.statusHistory)}
              </Descriptions.Item>
            </Descriptions>

            {/* 凭证图片预览 */}
            {modalRecord.photos && modalRecord.photos.length > 0 && (
              <div style={{ marginBottom: 16 }}>
                <div style={{ marginBottom: 8, fontWeight: 500 }}>凭证图片：</div>
                <Image.PreviewGroup>
                  <Space>
                    {modalRecord.photos.map((url, i) => (
                      <Image key={i} src={url} width={80} height={80} style={{ objectFit: 'cover', borderRadius: 4 }} />
                    ))}
                  </Space>
                </Image.PreviewGroup>
              </div>
            )}

            {/* 仲裁决定区块仅在可仲裁状态展示——其他状态下 Modal 是纯查看 */}
            {['REQUESTED', 'PENDING_ARBITRATION', 'UNDER_REVIEW'].includes(modalRecord.status) && (
              <>
                <Divider style={{ margin: '12px 0' }} />

                {/* 仲裁决定 */}
                <div style={{ marginBottom: 12 }}>
                  <div style={{ marginBottom: 8, fontWeight: 500 }}>仲裁决定：</div>
                  <Radio.Group
                    value={arbitrateAction}
                    onChange={(e) => { setArbitrateAction(e.target.value); setArbitrateReason(''); }}
                  >
                    <Radio value="APPROVED">
                      <Space><CheckCircleOutlined style={{ color: '#52c41a' }} />同意售后</Space>
                    </Radio>
                    <Radio value="REJECTED">
                      <Space><CloseCircleOutlined style={{ color: '#ff4d4f' }} />拒绝售后</Space>
                    </Radio>
                  </Radio.Group>
                </div>

                {/* 模板文案 */}
                <div style={{ marginBottom: 8 }}>
                  <div style={{ marginBottom: 6, fontSize: 13, color: '#666' }}>快捷模板：</div>
                  <Space wrap size={[8, 6]}>
                    {currentTemplates.map((tpl, idx) => (
                      <Button
                        key={idx}
                        size="small"
                        type={arbitrateReason === tpl.value ? 'primary' : 'default'}
                        ghost={arbitrateReason === tpl.value}
                        onClick={() => applyTemplate(tpl.value)}
                      >
                        {tpl.label}
                      </Button>
                    ))}
                  </Space>
                </div>

                <Input.TextArea
                  rows={3}
                  placeholder="仲裁说明（可选，可点击上方模板快速填入）"
                  value={arbitrateReason}
                  onChange={(e) => setArbitrateReason(e.target.value)}
                />
              </>
            )}
            </>
          )}
        </Spin>
      </Modal>

      {/* 行高亮样式 */}
      <style>{`
        .after-sale-row-urgent {
          background: #fff7e6 !important;
        }
        .after-sale-row-urgent:hover > td {
          background: #ffe7ba !important;
        }
        .after-sale-row-arbitration {
          background: #f9f0ff !important;
        }
        .after-sale-row-arbitration:hover > td {
          background: #efdbff !important;
        }
      `}</style>
    </div>
  );
}
