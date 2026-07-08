import { useRef, useState } from 'react';
import { ProTable } from '@ant-design/pro-components';
import type { ActionType, ProColumns } from '@ant-design/pro-components';
import { App, Button, Descriptions, Drawer, Form, Input, Modal, Space, Tag, Typography } from 'antd';
import dayjs from 'dayjs';
import {
  approveCaptainApplication,
  getCaptainApplications,
  rejectCaptainApplication,
} from '@/api/captain';
import PermissionGate from '@/components/PermissionGate';
import { PERMISSIONS } from '@/constants/permissions';
import type { CaptainApplication, CaptainApplicationStatus } from '@/types';
import {
  CaptainUser,
  StatusTag,
  captainApplicationStatusMap,
  money,
  percent,
} from './common';

const communityScaleMap: Record<string, string> = {
  NONE: '暂无社群',
  UNDER_50: '50 人以下',
  BETWEEN_50_200: '50-200 人',
  BETWEEN_200_500: '200-500 人',
  OVER_500: '500 人以上',
};

const expectedGmvMap: Record<string, string> = {
  UNDER_3000: '3000 以下',
  BETWEEN_3000_10000: '3000-1 万',
  BETWEEN_10000_30000: '1 万-3 万',
  OVER_30000: '3 万以上',
};

const resourceTypeMap: Record<string, string> = {
  MOMENTS: '朋友圈',
  WECHAT_GROUP: '微信群',
  VIDEO_ACCOUNT: '视频号',
  COMMUNITY: '线下社区',
  RESTAURANT: '餐饮店',
  COMPANY_GROUP_BUY: '企业团购',
  FRIENDS_FAMILY: '亲友圈',
  OTHER: '其他',
};

const seafoodExperienceMap: Record<string, string> = {
  NONE: '无经验',
  BUYER: '买过预包装海鲜',
  SOLD_BEFORE: '卖过相关商品',
  SUPPLY_CHAIN_OR_GROUP_BUY: '有供应链或团购经验',
};

function label(map: Record<string, string>, value?: string | null) {
  if (!value) return '-';
  return map[value] || value;
}

function resourceTags(values?: string[]) {
  if (!values?.length) return <Typography.Text type="secondary">-</Typography.Text>;
  return (
    <Space size={[0, 4]} wrap>
      {values.map((item) => (
        <Tag key={item}>{label(resourceTypeMap, item)}</Tag>
      ))}
    </Space>
  );
}

export default function CaptainApplicationsPage() {
  const actionRef = useRef<ActionType | undefined>(undefined);
  const { message } = App.useApp();
  const [detail, setDetail] = useState<CaptainApplication | null>(null);
  const [approveTarget, setApproveTarget] = useState<CaptainApplication | null>(null);
  const [rejectTarget, setRejectTarget] = useState<CaptainApplication | null>(null);
  const [approveForm] = Form.useForm();
  const [rejectForm] = Form.useForm();

  const reload = () => {
    actionRef.current?.reload();
  };

  const openApprove = (record: CaptainApplication) => {
    setApproveTarget(record);
    approveForm.setFieldsValue({ displayName: record.realName });
  };

  const openReject = (record: CaptainApplication) => {
    setRejectTarget(record);
    rejectForm.resetFields();
  };

  const closeReviewModals = () => {
    setApproveTarget(null);
    setRejectTarget(null);
    approveForm.resetFields();
    rejectForm.resetFields();
  };

  const columns: ProColumns<CaptainApplication>[] = [
    { title: '关键词', dataIndex: 'keyword', hideInTable: true },
    {
      title: '状态',
      dataIndex: 'status',
      valueType: 'select',
      width: 110,
      valueEnum: Object.fromEntries(
        Object.entries(captainApplicationStatusMap).map(([key, value]) => [key, { text: value.text }]),
      ),
      render: (_, record) => <StatusTag value={record.status as CaptainApplicationStatus} map={captainApplicationStatusMap} />,
    },
    {
      title: '申请人',
      search: false,
      width: 240,
      render: (_, record) => (
        <Space direction="vertical" size={0}>
          <CaptainUser user={record.user} />
          <Typography.Text type="secondary">{record.realName} · {record.contact}</Typography.Text>
        </Space>
      ),
    },
    { title: '城市', dataIndex: 'city', search: false, width: 110 },
    {
      title: '社群规模',
      search: false,
      width: 120,
      render: (_, record) => label(communityScaleMap, record.communityScale),
    },
    {
      title: '预计月 GMV',
      search: false,
      width: 130,
      render: (_, record) => label(expectedGmvMap, record.expectedMonthlyGmv),
    },
    {
      title: '资源',
      search: false,
      width: 220,
      render: (_, record) => resourceTags(record.resourceTypes),
    },
    {
      title: '历史消费',
      search: false,
      width: 170,
      render: (_, record) => (
        <Space direction="vertical" size={0}>
          <Typography.Text>{money(record.systemSnapshot?.paidAmount)}</Typography.Text>
          <Typography.Text type="secondary">{record.systemSnapshot?.orderCount ?? 0} 单</Typography.Text>
        </Space>
      ),
    },
    {
      title: '退款率',
      search: false,
      width: 110,
      render: (_, record) => percent(record.systemSnapshot?.refundRate),
    },
    {
      title: '申请时间',
      dataIndex: 'createdAt',
      search: false,
      width: 170,
      render: (_, record) => dayjs(record.createdAt).format('YYYY-MM-DD HH:mm'),
    },
    {
      title: '操作',
      valueType: 'option',
      width: 210,
      render: (_, record) => (
        <Space>
          <a onClick={() => setDetail(record)}>详情</a>
          <PermissionGate permission={PERMISSIONS.CAPTAIN_MANAGE}>
            <Button
              type="link"
              size="small"
              disabled={record.status !== 'PENDING'}
              onClick={() => openApprove(record)}
            >
              通过
            </Button>
            <Button
              type="link"
              size="small"
              danger
              disabled={record.status !== 'PENDING'}
              onClick={() => openReject(record)}
            >
              驳回
            </Button>
          </PermissionGate>
        </Space>
      ),
    },
  ];

  return (
    <div style={{ padding: 24 }}>
      <ProTable<CaptainApplication>
        actionRef={actionRef}
        columns={columns}
        rowKey="id"
        request={async (params) => {
          const res = await getCaptainApplications({
            page: params.current,
            pageSize: params.pageSize,
            keyword: params.keyword as string | undefined,
            status: params.status as string | undefined,
          });
          return { data: res.items, total: res.total, success: true };
        }}
        pagination={{ defaultPageSize: 20 }}
        options={false}
        headerTitle="团长申请"
      />

      <Drawer
        title="团长申请详情"
        width={720}
        open={!!detail}
        onClose={() => setDetail(null)}
        extra={detail?.status === 'PENDING' ? (
          <PermissionGate permission={PERMISSIONS.CAPTAIN_MANAGE}>
            <Space>
              <Button onClick={() => detail && openReject(detail)} danger>驳回</Button>
              <Button onClick={() => detail && openApprove(detail)} type="primary">通过</Button>
            </Space>
          </PermissionGate>
        ) : null}
      >
        {detail ? (
          <Space direction="vertical" size={16} style={{ width: '100%' }}>
            <Descriptions column={2} bordered size="small">
              <Descriptions.Item label="申请人" span={2}>
                <CaptainUser user={detail.user} />
              </Descriptions.Item>
              <Descriptions.Item label="真实姓名">{detail.realName}</Descriptions.Item>
              <Descriptions.Item label="联系方式">{detail.contact}</Descriptions.Item>
              <Descriptions.Item label="城市">{detail.city}</Descriptions.Item>
              <Descriptions.Item label="状态">
                <StatusTag value={detail.status} map={captainApplicationStatusMap} />
              </Descriptions.Item>
              <Descriptions.Item label="社群规模">{label(communityScaleMap, detail.communityScale)}</Descriptions.Item>
              <Descriptions.Item label="预计月 GMV">{label(expectedGmvMap, detail.expectedMonthlyGmv)}</Descriptions.Item>
              <Descriptions.Item label="资源类型" span={2}>{resourceTags(detail.resourceTypes)}</Descriptions.Item>
              <Descriptions.Item label="海鲜经验" span={2}>
                {label(seafoodExperienceMap, detail.seafoodExperience)}
              </Descriptions.Item>
              <Descriptions.Item label="推广计划" span={2}>
                <Typography.Paragraph style={{ marginBottom: 0 }}>
                  {detail.promotionPlan}
                </Typography.Paragraph>
              </Descriptions.Item>
              <Descriptions.Item label="合规承诺">
                {detail.complianceAccepted ? '已确认' : '未确认'}
              </Descriptions.Item>
              <Descriptions.Item label="申请时间">
                {dayjs(detail.createdAt).format('YYYY-MM-DD HH:mm')}
              </Descriptions.Item>
              {detail.reviewedAt ? (
                <Descriptions.Item label="审核时间">
                  {dayjs(detail.reviewedAt).format('YYYY-MM-DD HH:mm')}
                </Descriptions.Item>
              ) : null}
              {detail.rejectReason ? (
                <Descriptions.Item label="驳回原因" span={2}>
                  {detail.rejectReason}
                </Descriptions.Item>
              ) : null}
            </Descriptions>

            <Descriptions title="系统快照" column={2} bordered size="small">
              <Descriptions.Item label="买家编号">{detail.systemSnapshot?.buyerNo || '-'}</Descriptions.Item>
              <Descriptions.Item label="手机号">
                {detail.systemSnapshot?.phone || detail.user?.authIdentities?.[0]?.identifier || '-'}
              </Descriptions.Item>
              <Descriptions.Item label="会员等级">
                {detail.systemSnapshot?.isVip ? 'VIP' : detail.systemSnapshot?.memberTier || '普通'}
              </Descriptions.Item>
              <Descriptions.Item label="绑定团长">
                {detail.systemSnapshot?.boundCaptain?.buyerNo || detail.systemSnapshot?.boundCaptain?.nickname || '-'}
              </Descriptions.Item>
              <Descriptions.Item label="历史订单">{detail.systemSnapshot?.orderCount ?? 0} 单</Descriptions.Item>
              <Descriptions.Item label="历史消费">{money(detail.systemSnapshot?.paidAmount)}</Descriptions.Item>
              <Descriptions.Item label="退款次数">{detail.systemSnapshot?.refundCount ?? 0} 次</Descriptions.Item>
              <Descriptions.Item label="退款金额">{money(detail.systemSnapshot?.refundAmount)}</Descriptions.Item>
              <Descriptions.Item label="退款率">{percent(detail.systemSnapshot?.refundRate)}</Descriptions.Item>
              <Descriptions.Item label="快照时间">
                {detail.systemSnapshot?.capturedAt ? dayjs(detail.systemSnapshot.capturedAt).format('YYYY-MM-DD HH:mm') : '-'}
              </Descriptions.Item>
            </Descriptions>
          </Space>
        ) : null}
      </Drawer>

      <Modal
        title="通过团长申请"
        open={!!approveTarget}
        onCancel={closeReviewModals}
        onOk={() => approveForm.submit()}
        destroyOnClose
      >
        <Form
          form={approveForm}
          layout="vertical"
          onFinish={async (values) => {
            if (!approveTarget) return;
            await approveCaptainApplication(approveTarget.id, {
              captainCode: values.captainCode?.trim() || undefined,
              displayName: values.displayName?.trim() || undefined,
            });
            message.success('团长申请已通过');
            closeReviewModals();
            setDetail(null);
            reload();
          }}
        >
          <Form.Item name="captainCode" label="团长码">
            <Input placeholder="留空由系统自动生成" />
          </Form.Item>
          <Form.Item name="displayName" label="展示名称">
            <Input placeholder="默认可使用申请人姓名" />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title="驳回团长申请"
        open={!!rejectTarget}
        onCancel={closeReviewModals}
        onOk={() => rejectForm.submit()}
        destroyOnClose
      >
        <Form
          form={rejectForm}
          layout="vertical"
          onFinish={async (values) => {
            if (!rejectTarget) return;
            await rejectCaptainApplication(rejectTarget.id, { reason: values.reason.trim() });
            message.success('团长申请已驳回');
            closeReviewModals();
            setDetail(null);
            reload();
          }}
        >
          <Form.Item
            name="reason"
            label="驳回原因"
            rules={[{ required: true, message: '请填写驳回原因' }]}
          >
            <Input.TextArea rows={4} maxLength={300} showCount />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
