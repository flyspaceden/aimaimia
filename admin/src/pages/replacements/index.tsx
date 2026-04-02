import { useRef, useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { ProTable } from '@ant-design/pro-components';
import type { ActionType, ProColumns } from '@ant-design/pro-components';
import {
  Button, Tag, message, Modal, Input, Descriptions, Space, Radio,
  Image, Divider, Typography, Tooltip, Card, Row, Col, Statistic, Badge, Select,
} from 'antd';
import {
  CheckCircleOutlined, CloseCircleOutlined,
  ExclamationCircleOutlined, ClockCircleOutlined, SwapOutlined,
  InboxOutlined, SyncOutlined,
} from '@ant-design/icons';
import { getReplacements, getReplacementStats, arbitrateReplacement } from '@/api/replacements';
import type { AdminReplacement, ReplacementStatsMap } from '@/api/replacements';
import { getCompanies } from '@/api/companies';
import PermissionGate from '@/components/PermissionGate';
import { PERMISSIONS } from '@/constants/permissions';
import { replacementStatusMap } from '@/constants/statusMaps';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
import 'dayjs/locale/zh-cn';

dayjs.extend(relativeTime);
dayjs.locale('zh-cn');

const { Text } = Typography;

// 仲裁结果模板文案
const ARBITRATION_TEMPLATES = {
  APPROVED: [
    { label: '质量问题', value: '经平台核实，商品存在质量问题，支持买家换货申请。请卖家尽快安排换货发货。' },
    { label: '描述不符', value: '经平台核实，商品与描述不符，支持买家换货申请。请卖家尽快安排换货发货。' },
    { label: '发错货', value: '经平台核实，卖家发货商品与订单不一致，支持买家换货申请。请卖家尽快安排正确商品发出。' },
    { label: '运输损坏', value: '经平台核实，商品在运输过程中损坏，支持买家换货申请。请卖家安排补发。' },
  ],
  REJECTED: [
    { label: '理由不充分', value: '经平台核实，买家提供的换货理由及凭证不充分，不支持本次换货申请。' },
    { label: '超出时限', value: '该换货申请已超出平台规定的售后时限，不予支持。' },
    { label: '人为损坏', value: '经平台核实，商品损坏系人为因素导致，不属于换货范围，不予支持。' },
    { label: '不影响使用', value: '经平台核实，商品轻微瑕疵不影响正常使用，不支持换货。如有异议可联系客服协商。' },
  ],
};
const REPLACEMENT_REASON_MAP: Record<string, { text: string; color: string }> = {
  QUALITY_ISSUE: { text: '质量问题', color: 'red' },
  WRONG_ITEM: { text: '发错商品', color: 'orange' },
  DAMAGED: { text: '运输损坏', color: 'volcano' },
  NOT_AS_DESCRIBED: { text: '与描述不符', color: 'gold' },
  SIZE_ISSUE: { text: '规格不符', color: 'cyan' },
  EXPIRED: { text: '临期/过期', color: 'magenta' },
  OTHER: { text: '其他', color: 'default' },
};

// 状态 Tab 配置
const STATUS_TABS = [
  { key: 'ALL', label: '全部' },
  { key: 'REQUESTED', label: '待处理' },
  { key: 'UNDER_REVIEW', label: '审核中' },
  { key: 'APPROVED', label: '已同意' },
  { key: 'REJECTED', label: '已拒绝' },
  { key: 'SHIPPED', label: '换货中' },
  { key: 'COMPLETED', label: '已完成' },
];

// 统计卡片配置
const STAT_CARDS = [
  { key: 'ALL', label: '全部', icon: <InboxOutlined />, color: '#8c8c8c' },
  { key: 'REQUESTED', label: '待处理', icon: <ExclamationCircleOutlined />, color: '#fa8c16' },
  { key: 'UNDER_REVIEW', label: '审核中', icon: <SyncOutlined />, color: '#722ed1' },
  { key: 'APPROVED', label: '已同意', icon: <SwapOutlined />, color: '#1677ff' },
  { key: 'COMPLETED', label: '已完成', icon: <CheckCircleOutlined />, color: '#52c41a' },
];

/** 格式化地址快照为可读字符串 */
function formatAddress(addr?: Record<string, unknown> | null): string {
  if (!addr) return '-';
  const parts = [addr.province, addr.city, addr.district, addr.detail].filter(Boolean);
  return parts.length === 0 ? '-' : parts.join('');
}

function formatReplacementReasonTag(reasonType?: string, fallbackReason?: string) {
  if (reasonType && REPLACEMENT_REASON_MAP[reasonType]) {
    const entry = REPLACEMENT_REASON_MAP[reasonType];
    return <Tag color={entry.color}>{entry.text}</Tag>;
  }
  return fallbackReason || '-';
}

export default function ReplacementListPage() {
  const navigate = useNavigate();
  const actionRef = useRef<ActionType>(null);
  const [arbitrateModal, setArbitrateModal] = useState<{ visible: boolean; replacement: AdminReplacement | null }>({
    visible: false,
    replacement: null,
  });
  const [arbitrateAction, setArbitrateAction] = useState<'APPROVED' | 'REJECTED'>('APPROVED');
  const [arbitrateReason, setArbitrateReason] = useState('');
  const [arbitrateLoading, setArbitrateLoading] = useState(false);
  const [activeTab, setActiveTab] = useState('ALL');
  const [stats, setStats] = useState<ReplacementStatsMap>({});
  const [companyOptions, setCompanyOptions] = useState<{ label: string; value: string }[]>([]);

  // 加载统计和公司列表
  const loadStats = async () => {
    try {
      const data = await getReplacementStats();
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
    const replacement = arbitrateModal.replacement;
    if (!replacement) return;
    setArbitrateLoading(true);
    try {
      await arbitrateReplacement(replacement.id, {
        status: arbitrateAction,
        reason: arbitrateReason || undefined,
      });
      message.success(arbitrateAction === 'APPROVED' ? '仲裁通过 — 已批准换货' : '仲裁拒绝 — 维持卖家决定');
      setArbitrateModal({ visible: false, replacement: null });
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

  const applyTemplate = (text: string) => setArbitrateReason(text);

  // 待仲裁行高亮
  const rowClassName = (record: AdminReplacement) => {
    if (record.status === 'REQUESTED') return 'replacement-row-urgent';
    if (record.status === 'UNDER_REVIEW') return 'replacement-row-reviewing';
    return '';
  };

  const columns: ProColumns<AdminReplacement>[] = [
    { title: '换货单号', dataIndex: 'id', ellipsis: true, width: 180, copyable: true },
    {
      title: '关联订单',
      dataIndex: 'orderId',
      width: 180,
      ellipsis: true,
      render: (_: unknown, r: AdminReplacement) => (
        <a onClick={() => navigate(`/orders/${r.orderId}`)}>{r.orderId}</a>
      ),
    },
    {
      title: '公司',
      dataIndex: 'companyId',
      width: 130,
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
      render: (_: unknown, r: AdminReplacement) => {
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
      render: (_: unknown, r: AdminReplacement) => {
        const nickname = r.user?.profile?.nickname;
        const phone = r.user?.authIdentities?.[0]?.identifier;
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
      render: (_: unknown, r: AdminReplacement) => {
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
      render: (_: unknown, r: AdminReplacement) => {
        const amt = r.amount ?? 0;
        return amt > 0 ? <Text strong style={{ color: '#059669' }}>¥{amt.toFixed(2)}</Text> : '-';
      },
    },
    {
      title: '换货原因',
      dataIndex: 'reasonType',
      width: 160,
      ellipsis: true,
      search: false,
      render: (_: unknown, r: AdminReplacement) => formatReplacementReasonTag(r.reasonType, r.reason),
    },
    {
      title: '凭证',
      width: 70,
      search: false,
      render: (_: unknown, r: AdminReplacement) => {
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
      render: (_: unknown, r: AdminReplacement) => {
        if (r.reviewNote || r.reviewedAt) {
          // 卖家拒绝的用红色标记
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
      width: 90,
      hideInSearch: true,
      render: (_: unknown, r: AdminReplacement) => {
        const s = replacementStatusMap[r.status];
        return <Tag color={s?.color}>{s?.text || r.status}</Tag>;
      },
    },
    {
      title: '申请时间',
      dataIndex: 'createdAt',
      width: 140,
      search: false,
      render: (_: unknown, r: AdminReplacement) => {
        const created = dayjs(r.createdAt);
        const hoursAgo = dayjs().diff(created, 'hour');
        const isOverdue = ['REQUESTED', 'UNDER_REVIEW'].includes(r.status) && hoursAgo > 48;
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
      width: 80,
      fixed: 'right',
      search: false,
      render: (_: unknown, r: AdminReplacement) => {
        const canArbitrate = ['REQUESTED', 'UNDER_REVIEW', 'REJECTED'].includes(r.status);
        if (!canArbitrate) return null;
        return (
          <PermissionGate permission={PERMISSIONS.REPLACEMENTS_ARBITRATE}>
            <Button
              type="link"
              size="small"
              onClick={() => setArbitrateModal({ visible: true, replacement: r })}
            >
              仲裁
            </Button>
          </PermissionGate>
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
            {stats[t.key] != null && stats[t.key] > 0 && (
              <Badge count={stats[t.key]} size="small" style={{ marginLeft: 6 }} overflowCount={999} />
            )}
          </span>
        ),
      })),
    [stats],
  );

  const modalReplacement = arbitrateModal.replacement;
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
                value={stats[card.key] ?? 0}
                valueStyle={{ color: card.color, fontSize: 24 }}
              />
            </Card>
          </Col>
        ))}
      </Row>

      {/* 换货表格 */}
      <ProTable<AdminReplacement>
        headerTitle="换货仲裁"
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
          const { current, pageSize, id: keyword, companyId } = params as any;
          const statusFilter = activeTab !== 'ALL' ? activeTab : undefined;
          const res = await getReplacements({
            page: current,
            pageSize,
            status: statusFilter,
            keyword: keyword || undefined,
            companyId: companyId || undefined,
          });
          return { data: res.items, total: res.total, success: true };
        }}
        scroll={{ x: 1500 }}
        search={{ labelWidth: 'auto', defaultCollapsed: false }}
        pagination={{ defaultPageSize: 20, showSizeChanger: true, showQuickJumper: true }}
        rowClassName={rowClassName}
        dateFormatter="string"
      />

      {/* 仲裁弹窗 */}
      <Modal
        title="换货仲裁"
        open={arbitrateModal.visible}
        width={680}
        onCancel={() => {
          setArbitrateModal({ visible: false, replacement: null });
          setArbitrateAction('APPROVED');
          setArbitrateReason('');
        }}
        onOk={handleArbitrate}
        confirmLoading={arbitrateLoading}
        okText="确认提交"
        destroyOnClose
      >
        {modalReplacement && (
          <>
            {/* 基本信息 */}
            <Descriptions column={2} size="small" style={{ marginBottom: 12 }} title="申请信息">
              <Descriptions.Item label="换货单号">{modalReplacement.id}</Descriptions.Item>
              <Descriptions.Item label="关联订单">
                <a onClick={() => navigate(`/orders/${modalReplacement.orderId}`)}>
                  {modalReplacement.orderId}
                </a>
              </Descriptions.Item>
              <Descriptions.Item label="买家昵称">{modalReplacement.user?.profile?.nickname || '-'}</Descriptions.Item>
              <Descriptions.Item label="买家手机">
                {modalReplacement.user?.authIdentities?.[0]?.identifier || '-'}
              </Descriptions.Item>
              <Descriptions.Item label="公司/卖家">
                {modalReplacement.company ? (
                  <Text style={{ color: '#059669' }}>{modalReplacement.company.name}</Text>
                ) : '-'}
              </Descriptions.Item>
              <Descriptions.Item label="当前状态">
                <Tag color={replacementStatusMap[modalReplacement.status]?.color}>
                  {replacementStatusMap[modalReplacement.status]?.text}
                </Tag>
              </Descriptions.Item>
              <Descriptions.Item label="申请时间">{dayjs(modalReplacement.createdAt).format('YYYY-MM-DD HH:mm')}</Descriptions.Item>
              <Descriptions.Item label="换货金额">
                {modalReplacement.amount ? (
                  <Text strong style={{ color: '#059669' }}>¥{modalReplacement.amount.toFixed(2)}</Text>
                ) : '-'}
              </Descriptions.Item>
              <Descriptions.Item label="换货原因" span={2}>
                <Space>
                  {formatReplacementReasonTag(modalReplacement.reasonType, modalReplacement.reason)}
                  {modalReplacement.reasonType === 'OTHER' && modalReplacement.reason ? (
                    <Text type="secondary">{modalReplacement.reason}</Text>
                  ) : null}
                </Space>
              </Descriptions.Item>
            </Descriptions>

            {/* 换货目标信息 */}
            <Descriptions column={2} size="small" style={{ marginBottom: 12 }} title="换货目标商品">
              <Descriptions.Item label="商品名称" span={2}>{
                (() => {
                  const snapshot = modalReplacement.orderItem?.productSnapshot as Record<string, unknown> | undefined;
                  return (snapshot?.title as string) || '-';
                })()
              }</Descriptions.Item>
              <Descriptions.Item label="单价">
                {modalReplacement.orderItem?.unitPrice != null
                  ? `¥${modalReplacement.orderItem.unitPrice}`
                  : '-'}
              </Descriptions.Item>
              <Descriptions.Item label="数量">
                {modalReplacement.orderItem?.quantity ?? '-'}
              </Descriptions.Item>
              {modalReplacement.replacementShipmentId && (
                <Descriptions.Item label="换货物流单号" span={2}>
                  {modalReplacement.replacementShipmentId}
                </Descriptions.Item>
              )}
            </Descriptions>

            {/* 申请人收货地址 */}
            {modalReplacement.order?.addressSnapshot && (
              <Descriptions column={2} size="small" style={{ marginBottom: 12 }} title="申请人收货地址">
                <Descriptions.Item label="收件人">
                  {(modalReplacement.order.addressSnapshot.receiverName as string) || '-'}
                </Descriptions.Item>
                <Descriptions.Item label="联系电话">
                  {(modalReplacement.order.addressSnapshot.receiverPhone as string) || '-'}
                </Descriptions.Item>
                <Descriptions.Item label="详细地址" span={2}>
                  {formatAddress(modalReplacement.order.addressSnapshot)}
                </Descriptions.Item>
              </Descriptions>
            )}

            {/* 卖家处理记录 */}
            <Descriptions column={2} size="small" style={{ marginBottom: 12 }} title="卖家处理记录">
              <Descriptions.Item label="处理状态">
                {modalReplacement.reviewedAt ? (
                  <Tag color="blue">已处理</Tag>
                ) : (
                  <Tag color="default">未处理</Tag>
                )}
              </Descriptions.Item>
              <Descriptions.Item label="处理时间">
                {modalReplacement.reviewedAt
                  ? dayjs(modalReplacement.reviewedAt).format('YYYY-MM-DD HH:mm')
                  : '-'}
              </Descriptions.Item>
              <Descriptions.Item label="处理意见" span={2}>
                {modalReplacement.reviewNote ? (
                  <Text style={{ color: modalReplacement.status === 'REJECTED' ? '#ff4d4f' : undefined }}>
                    {modalReplacement.reviewNote}
                  </Text>
                ) : '-'}
              </Descriptions.Item>
            </Descriptions>

            {/* 凭证图片预览 */}
            {modalReplacement.photos && modalReplacement.photos.length > 0 && (
              <div style={{ marginBottom: 16 }}>
                <div style={{ marginBottom: 8, fontWeight: 500 }}>凭证图片：</div>
                <Image.PreviewGroup>
                  <Space>
                    {modalReplacement.photos.map((url, i) => (
                      <Image key={i} src={url} width={80} height={80} style={{ objectFit: 'cover', borderRadius: 4 }} />
                    ))}
                  </Space>
                </Image.PreviewGroup>
              </div>
            )}

            <Divider style={{ margin: '12px 0' }} />

            {/* 仲裁决定 */}
            <div style={{ marginBottom: 12 }}>
              <div style={{ marginBottom: 8, fontWeight: 500 }}>仲裁决定：</div>
              <Radio.Group
                value={arbitrateAction}
                onChange={(e) => { setArbitrateAction(e.target.value); setArbitrateReason(''); }}
              >
                <Radio value="APPROVED">
                  <Space><CheckCircleOutlined style={{ color: '#52c41a' }} />同意换货</Space>
                </Radio>
                <Radio value="REJECTED">
                  <Space><CloseCircleOutlined style={{ color: '#ff4d4f' }} />拒绝换货</Space>
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
      </Modal>

      {/* 行高亮样式 */}
      <style>{`
        .replacement-row-urgent {
          background: #fff7e6 !important;
        }
        .replacement-row-urgent:hover > td {
          background: #ffe7ba !important;
        }
        .replacement-row-reviewing {
          background: #f9f0ff !important;
        }
        .replacement-row-reviewing:hover > td {
          background: #efdbff !important;
        }
      `}</style>
    </div>
  );
}
