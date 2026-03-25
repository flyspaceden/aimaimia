import { useRef, useState, useEffect } from 'react';
import { ProTable } from '@ant-design/pro-components';
import type { ActionType, ProColumns } from '@ant-design/pro-components';
import {
  Tag,
  Button,
  Space,
  Modal,
  Drawer,
  Descriptions,
  Image,
  Input,
  message,
  Timeline,
} from 'antd';
import {
  CheckCircleOutlined,
  CloseCircleOutlined,
  EyeOutlined,
  DownloadOutlined,
} from '@ant-design/icons';
import {
  getMerchantApplications,
  getMerchantApplication,
  approveMerchantApplication,
  rejectMerchantApplication,
  getMerchantApplicationPendingCount,
} from '@/api/merchant-applications';
import type { MerchantApplication, MerchantApplicationDetail } from '@/api/merchant-applications';
import PermissionGate from '@/components/PermissionGate';
import { PERMISSIONS } from '@/constants/permissions';
import dayjs from 'dayjs';

// 手机号脱敏：138****5005
function maskPhone(phone: string): string {
  if (!phone || phone.length < 7) return phone;
  return phone.slice(0, 3) + '****' + phone.slice(-4);
}

// 判断 URL 是否为图片
function isImageUrl(url: string): boolean {
  return /\.(jpg|jpeg|png|gif|webp)(\?.*)?$/i.test(url);
}

// 将相对路径的文件 URL 转为后端完整 URL
function resolveFileUrl(url: string): string {
  if (!url) return url;
  if (url.startsWith('http')) return url;
  // API base 是 /api/v1，文件在 /uploads/，需要用后端 origin
  const apiBase = import.meta.env.VITE_API_BASE_URL || '';
  // 从 http://localhost:3000/api/v1 提取 http://localhost:3000
  const origin = apiBase.replace(/\/api\/v\d+$/, '');
  return origin ? `${origin}${url}` : url;
}

// 状态标签颜色映射
const statusColorMap: Record<string, string> = {
  PENDING: 'orange',
  APPROVED: 'green',
  REJECTED: 'red',
};

const statusTextMap: Record<string, string> = {
  PENDING: '待审核',
  APPROVED: '已通过',
  REJECTED: '已拒绝',
};

interface ApplicationsTabProps {
  onPendingCountChange?: (count: number) => void;
}

export default function ApplicationsTab({ onPendingCountChange }: ApplicationsTabProps) {
  const actionRef = useRef<ActionType>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [detail, setDetail] = useState<MerchantApplicationDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [rejectModalOpen, setRejectModalOpen] = useState(false);
  const [rejectTarget, setRejectTarget] = useState<MerchantApplication | null>(null);
  const [rejectReason, setRejectReason] = useState('');

  // 刷新待审核计数
  const refreshPendingCount = () => {
    getMerchantApplicationPendingCount().then((count) => {
      onPendingCountChange?.(count);
    });
  };

  useEffect(() => {
    refreshPendingCount();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 查看详情
  const handleViewDetail = async (record: MerchantApplication) => {
    setDrawerOpen(true);
    setDetailLoading(true);
    try {
      const data = await getMerchantApplication(record.id);
      setDetail(data);
    } catch {
      message.error('获取详情失败');
    } finally {
      setDetailLoading(false);
    }
  };

  // 审核通过
  const handleApprove = (record: MerchantApplication) => {
    Modal.confirm({
      title: '确认通过入驻申请',
      content: `确认通过「${record.companyName}」的入驻申请？通过后将自动创建企业和管理员账号。`,
      okText: '确认通过',
      cancelText: '取消',
      okType: 'primary',
      zIndex: 1100,
      icon: <CheckCircleOutlined style={{ color: '#52c41a' }} />,
      onOk: async () => {
        try {
          await approveMerchantApplication(record.id);
          message.success('入驻申请已通过');
          actionRef.current?.reload();
          refreshPendingCount();
          // 如果详情抽屉打开，也刷新详情
          if (drawerOpen && detail?.id === record.id) {
            const data = await getMerchantApplication(record.id);
            setDetail(data);
          }
        } catch {
          message.error('操作失败');
        }
      },
    });
  };

  // 审核拒绝
  const handleRejectOpen = (record: MerchantApplication) => {
    setRejectTarget(record);
    setRejectReason('');
    setRejectModalOpen(true);
  };

  const handleRejectSubmit = async () => {
    if (!rejectTarget) return;
    if (!rejectReason.trim()) {
      message.warning('请填写拒绝原因');
      return;
    }
    try {
      await rejectMerchantApplication(rejectTarget.id, rejectReason.trim());
      message.success('已拒绝入驻申请');
      setRejectModalOpen(false);
      setRejectReason('');
      setRejectTarget(null);
      actionRef.current?.reload();
      refreshPendingCount();
      // 如果详情抽屉打开，也刷新详情
      if (drawerOpen && detail?.id === rejectTarget.id) {
        const data = await getMerchantApplication(rejectTarget.id);
        setDetail(data);
      }
    } catch {
      message.error('操作失败');
    }
  };

  const columns: ProColumns<MerchantApplication>[] = [
    {
      title: '公司名称',
      dataIndex: 'companyName',
      width: 200,
      ellipsis: true,
    },
    {
      title: '联系人',
      dataIndex: 'contactName',
      width: 100,
      search: false,
    },
    {
      title: '手机号',
      dataIndex: 'phone',
      width: 130,
      search: false,
      render: (_: unknown, r: MerchantApplication) => maskPhone(r.phone),
    },
    {
      title: '经营品类',
      dataIndex: 'category',
      width: 120,
      search: false,
      ellipsis: true,
    },
    {
      title: '申请时间',
      dataIndex: 'createdAt',
      width: 160,
      search: false,
      render: (_: unknown, r: MerchantApplication) => dayjs(r.createdAt).format('YYYY-MM-DD HH:mm'),
    },
    {
      title: '状态',
      dataIndex: 'status',
      width: 100,
      valueType: 'select',
      valueEnum: {
        PENDING: { text: '待审核' },
        APPROVED: { text: '已通过' },
        REJECTED: { text: '已拒绝' },
      },
      render: (_: unknown, r: MerchantApplication) => (
        <Tag color={statusColorMap[r.status]}>{statusTextMap[r.status]}</Tag>
      ),
    },
    {
      title: '操作',
      key: 'action',
      width: 200,
      search: false,
      render: (_: unknown, record: MerchantApplication) => (
        <Space>
          <Button
            type="link"
            size="small"
            icon={<EyeOutlined />}
            onClick={() => handleViewDetail(record)}
          >
            详情
          </Button>
          <PermissionGate permission={PERMISSIONS.COMPANIES_AUDIT}>
            {record.status === 'PENDING' && (
              <>
                <Button
                  type="link"
                  size="small"
                  icon={<CheckCircleOutlined />}
                  style={{ color: '#52c41a' }}
                  onClick={() => handleApprove(record)}
                >
                  通过
                </Button>
                <Button
                  type="link"
                  size="small"
                  danger
                  icon={<CloseCircleOutlined />}
                  onClick={() => handleRejectOpen(record)}
                >
                  拒绝
                </Button>
              </>
            )}
          </PermissionGate>
        </Space>
      ),
    },
  ];

  return (
    <>
      <ProTable<MerchantApplication>
        actionRef={actionRef}
        rowKey="id"
        columns={columns}
        request={async (params) => {
          const { current, pageSize, status, companyName: keyword } = params;
          const res = await getMerchantApplications({
            page: current,
            pageSize,
            status,
            keyword,
          });
          // 同步更新待审核计数
          refreshPendingCount();
          return { data: res.items, total: res.total, success: true };
        }}
        search={{ labelWidth: 'auto' }}
        pagination={{ defaultPageSize: 20 }}
        scroll={{ x: 900 }}
      />

      {/* 详情抽屉 */}
      <Drawer
        title="入驻申请详情"
        width={640}
        open={drawerOpen}
        onClose={() => { setDrawerOpen(false); setDetail(null); }}
        loading={detailLoading}
        extra={
          detail?.status === 'PENDING' && (
            <PermissionGate permission={PERMISSIONS.COMPANIES_AUDIT}>
              <Space>
                <Button
                  type="primary"
                  icon={<CheckCircleOutlined />}
                  onClick={() => handleApprove(detail)}
                >
                  通过
                </Button>
                <Button
                  danger
                  icon={<CloseCircleOutlined />}
                  onClick={() => handleRejectOpen(detail)}
                >
                  拒绝
                </Button>
              </Space>
            </PermissionGate>
          )
        }
      >
        {detail && (
          <>
            <Descriptions column={2} bordered size="small">
              <Descriptions.Item label="公司名称" span={2}>
                {detail.companyName}
              </Descriptions.Item>
              <Descriptions.Item label="联系人">
                {detail.contactName}
              </Descriptions.Item>
              <Descriptions.Item label="手机号">
                {detail.phone}
              </Descriptions.Item>
              <Descriptions.Item label="邮箱" span={2}>
                {detail.email || '-'}
              </Descriptions.Item>
              <Descriptions.Item label="经营品类" span={2}>
                {detail.category}
              </Descriptions.Item>
              <Descriptions.Item label="状态">
                <Tag color={statusColorMap[detail.status]}>{statusTextMap[detail.status]}</Tag>
              </Descriptions.Item>
              <Descriptions.Item label="申请时间">
                {dayjs(detail.createdAt).format('YYYY-MM-DD HH:mm')}
              </Descriptions.Item>
              {detail.reviewedAt && (
                <Descriptions.Item label="审核时间" span={2}>
                  {dayjs(detail.reviewedAt).format('YYYY-MM-DD HH:mm')}
                </Descriptions.Item>
              )}
              {detail.rejectReason && (
                <Descriptions.Item label="拒绝原因" span={2}>
                  <span style={{ color: '#ff4d4f' }}>{detail.rejectReason}</span>
                </Descriptions.Item>
              )}
              {detail.companyId && (
                <Descriptions.Item label="关联企业ID" span={2}>
                  {detail.companyId}
                </Descriptions.Item>
              )}
            </Descriptions>

            {/* 营业执照预览 */}
            <div style={{ marginTop: 24 }}>
              <h4>营业执照</h4>
              {detail.licenseFileUrl ? (
                isImageUrl(detail.licenseFileUrl) ? (
                  <Image
                    src={resolveFileUrl(detail.licenseFileUrl)}
                    alt="营业执照"
                    width={300}
                    style={{ borderRadius: 8 }}
                  />
                ) : (
                  <Button
                    type="link"
                    icon={<DownloadOutlined />}
                    href={resolveFileUrl(detail.licenseFileUrl)}
                    target="_blank"
                  >
                    下载营业执照文件
                  </Button>
                )
              ) : (
                <span style={{ color: '#999' }}>未上传</span>
              )}
            </div>

            {/* 申请历史 */}
            {detail.history && detail.history.length > 0 && (
              <div style={{ marginTop: 24 }}>
                <h4>申请历史</h4>
                <Timeline
                  items={detail.history.map((h) => ({
                    color: statusColorMap[h.status] || 'gray',
                    children: (
                      <div>
                        <div>
                          <Tag color={statusColorMap[h.status]}>{statusTextMap[h.status]}</Tag>
                          <span style={{ color: '#999', marginLeft: 8 }}>
                            {dayjs(h.createdAt).format('YYYY-MM-DD HH:mm')}
                          </span>
                        </div>
                        {h.rejectReason && (
                          <div style={{ color: '#ff4d4f', marginTop: 4 }}>
                            拒绝原因：{h.rejectReason}
                          </div>
                        )}
                      </div>
                    ),
                  }))}
                />
              </div>
            )}
          </>
        )}
      </Drawer>

      {/* 拒绝原因弹窗 */}
      <Modal
        title={`拒绝入驻申请: ${rejectTarget?.companyName}`}
        open={rejectModalOpen}
        zIndex={1100}
        onCancel={() => {
          setRejectModalOpen(false);
          setRejectReason('');
          setRejectTarget(null);
        }}
        onOk={handleRejectSubmit}
        okText="确认拒绝"
        okButtonProps={{ danger: true }}
        cancelText="取消"
      >
        <Input.TextArea
          rows={4}
          placeholder="请填写拒绝原因（必填）"
          value={rejectReason}
          onChange={(e) => setRejectReason(e.target.value)}
          maxLength={500}
          showCount
        />
      </Modal>
    </>
  );
}
