import { useRef, useState } from 'react';
import { ProTable } from '@ant-design/pro-components';
import type { ActionType, ProColumns } from '@ant-design/pro-components';
import { App, Button, Tag, Progress, Space, Modal, Descriptions, Card, Statistic, Divider, Typography } from 'antd';
import {
  PlusOutlined,
  EyeOutlined,
  EditOutlined,
  PlayCircleOutlined,
  PauseCircleOutlined,
  StopOutlined,
  CalendarOutlined,
  ClockCircleOutlined,
} from '@ant-design/icons';
import { getCampaigns, updateCampaignStatus } from '@/api/coupon';
import type { CouponCampaign, CouponCampaignStatus } from '@/api/coupon';
import {
  couponCampaignStatusMap,
  couponTriggerTypeMap,
  couponDistributionModeMap,
} from '@/constants/statusMaps';
import PermissionGate from '@/components/PermissionGate';
import { PERMISSIONS } from '@/constants/permissions';
import CampaignFormDrawer from './campaign-form';
import dayjs from 'dayjs';

/** 格式化抵扣规则显示 */
function formatDiscountRule(record: CouponCampaign): string {
  const { discountType, discountValue, maxDiscountAmount, minOrderAmount } = record;
  let rule = '';
  if (discountType === 'FIXED') {
    rule = minOrderAmount > 0
      ? `满${minOrderAmount}减${discountValue}`
      : `立减${discountValue}元`;
  } else {
    const discount = (100 - discountValue) / 10;
    rule = `${discount}折`;
    if (maxDiscountAmount) {
      rule += `（最高减${maxDiscountAmount}）`;
    }
    if (minOrderAmount > 0) {
      rule = `满${minOrderAmount} ${rule}`;
    }
  }
  return rule;
}

export default function CampaignListPage() {
  const { message, modal } = App.useApp();
  const actionRef = useRef<ActionType>(null);
  const [drawerState, setDrawerState] = useState<{
    open: boolean;
    campaign: CouponCampaign | null;
  }>({ open: false, campaign: null });
  const [detailCampaign, setDetailCampaign] = useState<CouponCampaign | null>(null);

  // 状态变更操作
  const handleStatusChange = (record: CouponCampaign, newStatus: CouponCampaignStatus) => {
    const statusLabels: Record<string, string> = {
      ACTIVE: '上架',
      PAUSED: '暂停',
      ENDED: '结束',
    };
    modal.confirm({
      title: `确认${statusLabels[newStatus] || '变更'}活动？`,
      content: `活动名称：${record.name}`,
      onOk: async () => {
        try {
          await updateCampaignStatus(record.id, newStatus);
          message.success(`已${statusLabels[newStatus]}活动`);
          actionRef.current?.reload();
        } catch (err) {
          message.error(err instanceof Error ? err.message : '操作失败');
        }
      },
    });
  };

  const columns: ProColumns<CouponCampaign>[] = [
    {
      title: '活动名称',
      dataIndex: 'name',
      width: 180,
      ellipsis: true,
      render: (_: unknown, r: CouponCampaign) => (
        <a onClick={() => setDetailCampaign(r)}>{r.name}</a>
      ),
    },
    {
      title: '触发类型',
      dataIndex: 'triggerType',
      width: 120,
      valueType: 'select',
      valueEnum: Object.fromEntries(
        Object.entries(couponTriggerTypeMap).map(([k, v]) => [k, { text: v.text }]),
      ),
      render: (_: unknown, r: CouponCampaign) => {
        const t = couponTriggerTypeMap[r.triggerType];
        return <Tag color={t?.color}>{t?.text || r.triggerType}</Tag>;
      },
    },
    {
      title: '发放方式',
      dataIndex: 'distributionMode',
      width: 110,
      search: false,
      render: (_: unknown, r: CouponCampaign) => {
        const d = couponDistributionModeMap[r.distributionMode];
        return <Tag color={d?.color}>{d?.text || r.distributionMode}</Tag>;
      },
    },
    {
      title: '抵扣规则',
      width: 180,
      search: false,
      render: (_: unknown, r: CouponCampaign) => formatDiscountRule(r),
    },
    {
      title: '发放进度',
      width: 160,
      search: false,
      render: (_: unknown, r: CouponCampaign) => {
        const percent = r.totalQuota > 0 ? Math.round((r.issuedCount / r.totalQuota) * 100) : 0;
        return (
          <div>
            <Progress percent={percent} size="small" status={percent >= 100 ? 'exception' : 'active'} />
            <span style={{ fontSize: 12, color: '#999' }}>
              {r.issuedCount}/{r.totalQuota}
            </span>
          </div>
        );
      },
    },
    {
      title: '活动时间',
      width: 200,
      search: false,
      render: (_: unknown, r: CouponCampaign) => (
        <span style={{ fontSize: 12 }}>
          {dayjs(r.startAt).format('YYYY-MM-DD HH:mm')}
          <br />
          ~ {dayjs(r.endAt).format('YYYY-MM-DD HH:mm')}
        </span>
      ),
    },
    {
      title: '状态',
      dataIndex: 'status',
      width: 100,
      valueType: 'select',
      valueEnum: Object.fromEntries(
        Object.entries(couponCampaignStatusMap).map(([k, v]) => [k, { text: v.text }]),
      ),
      render: (_: unknown, r: CouponCampaign) => {
        const s = couponCampaignStatusMap[r.status];
        return <Tag color={s?.color}>{s?.text || r.status}</Tag>;
      },
    },
    {
      title: '操作',
      key: 'action',
      width: 240,
      search: false,
      render: (_: unknown, record: CouponCampaign) => (
        <Space size={0}>
          <Button
            type="link"
            size="small"
            icon={<EyeOutlined />}
            onClick={() => setDetailCampaign(record)}
          >
            详情
          </Button>
          <PermissionGate permission={PERMISSIONS.COUPON_MANAGE}>
            {(record.status === 'DRAFT' || record.status === 'PAUSED') && (
              <Button
                type="link"
                size="small"
                icon={<EditOutlined />}
                onClick={() => setDrawerState({ open: true, campaign: record })}
              >
                编辑
              </Button>
            )}
            {record.status === 'DRAFT' && (
              <Button
                type="link"
                size="small"
                icon={<PlayCircleOutlined />}
                style={{ color: '#52c41a' }}
                onClick={() => handleStatusChange(record, 'ACTIVE')}
              >
                上架
              </Button>
            )}
            {record.status === 'ACTIVE' && (
              <Button
                type="link"
                size="small"
                icon={<PauseCircleOutlined />}
                style={{ color: '#faad14' }}
                onClick={() => handleStatusChange(record, 'PAUSED')}
              >
                暂停
              </Button>
            )}
            {record.status === 'PAUSED' && (
              <Button
                type="link"
                size="small"
                icon={<PlayCircleOutlined />}
                style={{ color: '#52c41a' }}
                onClick={() => handleStatusChange(record, 'ACTIVE')}
              >
                恢复
              </Button>
            )}
            {(record.status === 'ACTIVE' || record.status === 'PAUSED') && (
              <Button
                type="link"
                size="small"
                danger
                icon={<StopOutlined />}
                onClick={() => handleStatusChange(record, 'ENDED')}
              >
                结束
              </Button>
            )}
          </PermissionGate>
        </Space>
      ),
    },
  ];

  return (
    <div>
      <ProTable<CouponCampaign>
        headerTitle="红包活动管理"
        actionRef={actionRef}
        rowKey="id"
        columns={columns}
        scroll={{ x: 1200 }}
        request={async (params) => {
          const { current, pageSize, status, triggerType, name: keyword } = params;
          const res = await getCampaigns({
            page: current,
            pageSize,
            status: status || undefined,
            triggerType: triggerType || undefined,
            keyword: keyword || undefined,
          });
          return { data: res.items, total: res.total, success: true };
        }}
        search={{ labelWidth: 'auto' }}
        pagination={{ defaultPageSize: 20 }}
        toolBarRender={() => [
          <PermissionGate key="add" permission={PERMISSIONS.COUPON_MANAGE}>
            <Button
              type="primary"
              icon={<PlusOutlined />}
              onClick={() => setDrawerState({ open: true, campaign: null })}
            >
              新建活动
            </Button>
          </PermissionGate>,
        ]}
      />

      {/* 新建/编辑活动抽屉 */}
      <CampaignFormDrawer
        open={drawerState.open}
        campaign={drawerState.campaign}
        onClose={() => setDrawerState({ open: false, campaign: null })}
        onSuccess={() => {
          setDrawerState({ open: false, campaign: null });
          actionRef.current?.reload();
        }}
      />

      {/* 活动详情弹窗 */}
      <Modal
        title={null}
        open={!!detailCampaign}
        onCancel={() => setDetailCampaign(null)}
        footer={null}
        width={680}
        styles={{ body: { padding: 0 } }}
      >
        {detailCampaign && (() => {
          const statusInfo = couponCampaignStatusMap[detailCampaign.status];
          const triggerInfo = couponTriggerTypeMap[detailCampaign.triggerType];
          const distInfo = couponDistributionModeMap[detailCampaign.distributionMode];
          const issuedPercent = detailCampaign.totalQuota > 0
            ? Math.round((detailCampaign.issuedCount / detailCampaign.totalQuota) * 100)
            : 0;
          const isActive = detailCampaign.status === 'ACTIVE';
          const isEnded = detailCampaign.status === 'ENDED';
          const now = dayjs();
          const endTime = dayjs(detailCampaign.endAt);
          const startTime = dayjs(detailCampaign.startAt);
          const daysLeft = isActive ? endTime.diff(now, 'day') : null;

          return (
            <div>
              {/* 顶部 Banner */}
              <div style={{
                background: isEnded
                  ? 'linear-gradient(135deg, #8c8c8c 0%, #595959 100%)'
                  : isActive
                    ? 'linear-gradient(135deg, #f5222d 0%, #fa541c 100%)'
                    : 'linear-gradient(135deg, #1E40AF 0%, #3b82f6 100%)',
                padding: '24px 28px',
                color: '#fff',
                borderRadius: '8px 8px 0 0',
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 20, fontWeight: 600, marginBottom: 6 }}>
                      {detailCampaign.name}
                    </div>
                    <Typography.Text style={{ color: 'rgba(255,255,255,0.85)', fontSize: 13 }}>
                      {detailCampaign.description || '暂无描述'}
                    </Typography.Text>
                  </div>
                  <Tag
                    style={{
                      fontSize: 13,
                      padding: '2px 12px',
                      borderRadius: 12,
                      border: '1px solid rgba(255,255,255,0.4)',
                      color: '#fff',
                      background: 'rgba(255,255,255,0.18)',
                      flexShrink: 0,
                    }}
                  >
                    {statusInfo?.text || detailCampaign.status}
                  </Tag>
                </div>

                {/* 抵扣规则高亮 */}
                <div style={{
                  marginTop: 16,
                  padding: '10px 16px',
                  background: 'rgba(255,255,255,0.15)',
                  borderRadius: 8,
                  fontSize: 18,
                  fontWeight: 600,
                  letterSpacing: 1,
                }}>
                  {formatDiscountRule(detailCampaign)}
                </div>
              </div>

              {/* 核心数据统计 */}
              <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(4, 1fr)',
                gap: 1,
                background: '#f0f0f0',
                borderBottom: '1px solid #f0f0f0',
              }}>
                {[
                  { title: '已发放', value: detailCampaign.issuedCount, suffix: `/ ${detailCampaign.totalQuota}` },
                  { title: '每人限领', value: detailCampaign.maxPerUser, suffix: '张' },
                  { title: '有效天数', value: detailCampaign.validDays, suffix: '天' },
                  { title: daysLeft !== null ? '剩余天数' : '发放进度', value: daysLeft !== null ? daysLeft : issuedPercent, suffix: daysLeft !== null ? '天' : '%' },
                ].map((item) => (
                  <div key={item.title} style={{ background: '#fff', padding: '16px 20px', textAlign: 'center' }}>
                    <Statistic
                      title={item.title}
                      value={item.value}
                      suffix={<span style={{ fontSize: 13, color: '#999' }}>{item.suffix}</span>}
                      valueStyle={{ fontSize: 24, fontWeight: 600, color: '#1E40AF' }}
                    />
                  </div>
                ))}
              </div>

              {/* 发放进度条 */}
              <div style={{ padding: '16px 28px 0' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                  <span style={{ fontSize: 13, color: '#666' }}>发放进度</span>
                  <span style={{ fontSize: 13, color: '#666' }}>{issuedPercent}%</span>
                </div>
                <Progress
                  percent={issuedPercent}
                  strokeColor={issuedPercent >= 90 ? '#f5222d' : '#1E40AF'}
                  showInfo={false}
                  size="small"
                />
              </div>

              {/* 详细信息 */}
              <div style={{ padding: '20px 28px 24px' }}>
                <Descriptions
                  column={2}
                  size="small"
                  labelStyle={{ color: '#999', width: 90 }}
                  contentStyle={{ fontWeight: 500 }}
                >
                  <Descriptions.Item label="触发类型">
                    <Tag color={triggerInfo?.color}>{triggerInfo?.text || detailCampaign.triggerType}</Tag>
                  </Descriptions.Item>
                  <Descriptions.Item label="发放方式">
                    <Tag color={distInfo?.color}>{distInfo?.text || detailCampaign.distributionMode}</Tag>
                  </Descriptions.Item>
                  <Descriptions.Item label="叠加规则">
                    {detailCampaign.stackable ? '可叠加' : '不可叠加'}
                    {detailCampaign.stackGroup ? <Tag style={{ marginLeft: 6 }}>{detailCampaign.stackGroup}</Tag> : ''}
                  </Descriptions.Item>
                  <Descriptions.Item label="抵扣类型">
                    {detailCampaign.discountType === 'FIXED' ? '固定金额' : '百分比折扣'}
                  </Descriptions.Item>
                  {detailCampaign.minOrderAmount > 0 && (
                    <Descriptions.Item label="消费门槛">
                      ¥{detailCampaign.minOrderAmount}
                    </Descriptions.Item>
                  )}
                  {detailCampaign.discountType === 'PERCENT' && detailCampaign.maxDiscountAmount && (
                    <Descriptions.Item label="最高抵扣">
                      ¥{detailCampaign.maxDiscountAmount}
                    </Descriptions.Item>
                  )}
                </Descriptions>

                <Divider style={{ margin: '16px 0' }} />

                {/* 时间信息 */}
                <div style={{
                  display: 'grid',
                  gridTemplateColumns: '1fr 1fr',
                  gap: 12,
                }}>
                  <Card size="small" style={{ background: '#fafafa', border: 'none' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <CalendarOutlined style={{ color: '#1E40AF', fontSize: 16 }} />
                      <div>
                        <div style={{ fontSize: 12, color: '#999' }}>活动时间</div>
                        <div style={{ fontSize: 13, fontWeight: 500 }}>
                          {startTime.format('YYYY-MM-DD HH:mm')}
                        </div>
                        <div style={{ fontSize: 13, fontWeight: 500 }}>
                          ~ {endTime.format('YYYY-MM-DD HH:mm')}
                        </div>
                      </div>
                    </div>
                  </Card>
                  <Card size="small" style={{ background: '#fafafa', border: 'none' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <ClockCircleOutlined style={{ color: '#1E40AF', fontSize: 16 }} />
                      <div>
                        <div style={{ fontSize: 12, color: '#999' }}>创建时间</div>
                        <div style={{ fontSize: 13, fontWeight: 500 }}>
                          {dayjs(detailCampaign.createdAt).format('YYYY-MM-DD HH:mm')}
                        </div>
                      </div>
                    </div>
                  </Card>
                </div>
              </div>
            </div>
          );
        })()}
      </Modal>
    </div>
  );
}
