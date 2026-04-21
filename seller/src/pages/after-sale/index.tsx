import { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Tag, Image, Space, Modal, Input, Badge, Upload, App } from 'antd';
import { UploadOutlined } from '@ant-design/icons';
import { ProTable } from '@ant-design/pro-components';
import type { ActionType, ProColumns } from '@ant-design/pro-components';
import { useQuery } from '@tanstack/react-query';
import {
  getAfterSales,
  getAfterSaleStats,
  reviewAfterSale,
  approveAfterSale,
  rejectAfterSale,
  confirmReceiveReturn,
  rejectReturn,
  type AfterSale,
} from '@/api/after-sale';
import { afterSaleStatusMap, afterSaleTypeMap, afterSaleReasonMap } from '@/constants/statusMaps';
import dayjs from 'dayjs';

// 标签页配置
const TAB_ITEMS = [
  { key: '', label: '全部' },
  { key: 'REQUESTED', label: '待审核' },
  { key: 'RETURN_SHIPPING,RECEIVED_BY_SELLER', label: '待验收' },
  { key: 'APPROVED', label: '待发货' },
  { key: 'COMPLETED,REFUNDED', label: '已完成' },
];

export default function AfterSaleListPage() {
  const { message, modal } = App.useApp();
  const actionRef = useRef<ActionType | null>(null);
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState('');
  const [rejectModal, setRejectModal] = useState<{ open: boolean; id: string }>({ open: false, id: '' });
  const [rejectReason, setRejectReason] = useState('');
  const [rejectReturnModal, setRejectReturnModal] = useState<{ open: boolean; id: string }>({ open: false, id: '' });
  const [returnRejectReason, setReturnRejectReason] = useState('');
  const [returnRejectPhotos, setReturnRejectPhotos] = useState<string[]>([]);
  const [returnRejectWaybillNo, setReturnRejectWaybillNo] = useState('');

  // 按状态统计
  const { data: stats } = useQuery({
    queryKey: ['after-sale-stats'],
    queryFn: getAfterSaleStats,
    staleTime: 30_000,
  });

  const handleReview = async (id: string) => {
    modal.confirm({
      title: '确认开始审核该售后申请？',
      onOk: async () => {
        await reviewAfterSale(id);
        message.success('已进入审核中');
        actionRef.current?.reload();
      },
    });
  };

  const handleApprove = (id: string) => {
    modal.confirm({
      title: '确认通过售后申请？',
      onOk: async () => {
        await approveAfterSale(id);
        message.success('已通过');
        actionRef.current?.reload();
      },
    });
  };

  const handleReject = async () => {
    if (!rejectReason.trim()) {
      message.warning('请填写驳回原因');
      return;
    }
    try {
      await rejectAfterSale(rejectModal.id, rejectReason);
      message.success('已驳回');
      setRejectModal({ open: false, id: '' });
      setRejectReason('');
      actionRef.current?.reload();
    } catch (err) {
      message.error(err instanceof Error ? err.message : '操作失败');
    }
  };

  const handleConfirmReceive = (id: string) => {
    modal.confirm({
      title: '确认已收到买家退货？',
      content: '确认收到后将进入验收环节',
      onOk: async () => {
        await confirmReceiveReturn(id);
        message.success('已确认收到退货');
        actionRef.current?.reload();
      },
    });
  };

  const handleRejectReturn = async () => {
    if (!returnRejectReason.trim()) {
      message.warning('请填写拒收原因');
      return;
    }
    if (returnRejectPhotos.length === 0) {
      message.warning('请上传至少一张照片');
      return;
    }
    if (!returnRejectWaybillNo.trim()) {
      message.warning('请填写退回运单号');
      return;
    }
    try {
      await rejectReturn(rejectReturnModal.id, {
        reason: returnRejectReason,
        photos: returnRejectPhotos,
        returnWaybillNo: returnRejectWaybillNo,
      });
      message.success('已拒收退货');
      setRejectReturnModal({ open: false, id: '' });
      setReturnRejectReason('');
      setReturnRejectPhotos([]);
      setReturnRejectWaybillNo('');
      actionRef.current?.reload();
    } catch (err) {
      message.error(err instanceof Error ? err.message : '操作失败');
    }
  };

  // 从 productSnapshot 提取商品名和图片
  const getProductInfo = (record: AfterSale) => {
    const snapshot = record.orderItem?.productSnapshot;
    if (!snapshot) return { name: '-', image: undefined };
    const parsed = typeof snapshot === 'string' ? JSON.parse(snapshot) : snapshot;
    return {
      name: parsed?.title || parsed?.name || '-',
      image: parsed?.imageUrl || parsed?.media?.[0]?.url,
    };
  };

  const columns: ProColumns<AfterSale>[] = [
    {
      title: 'ID',
      dataIndex: 'id',
      width: 80,
      ellipsis: true,
      search: false,
    },
    {
      title: '售后类型',
      dataIndex: 'afterSaleType',
      width: 130,
      valueType: 'select',
      valueEnum: Object.fromEntries(
        Object.entries(afterSaleTypeMap).map(([k, v]) => [k, { text: v.text }]),
      ),
      render: (_, record) => {
        const t = afterSaleTypeMap[record.afterSaleType];
        return t ? <Tag color={t.color}>{t.text}</Tag> : record.afterSaleType;
      },
    },
    {
      title: '商品',
      width: 200,
      ellipsis: true,
      search: false,
      render: (_, record) => {
        const { name, image } = getProductInfo(record);
        return (
          <Space>
            {image && (
              <Image src={image} width={36} height={36} style={{ objectFit: 'cover', borderRadius: 4 }} />
            )}
            <div>
              <div style={{ fontWeight: 500 }}>{name}</div>
              {record.orderItem && (
                <div style={{ fontSize: 12, color: '#999' }}>
                  ¥{record.orderItem.unitPrice.toFixed(2)} x {record.orderItem.quantity}
                </div>
              )}
            </div>
          </Space>
        );
      },
    },
    {
      title: '买家',
      dataIndex: 'buyerAlias',
      width: 100,
      search: false,
    },
    {
      title: '金额',
      width: 100,
      search: false,
      render: (_, record) => {
        if (record.refundAmount != null) {
          return <span style={{ fontWeight: 500, color: '#ff4d4f' }}>¥{record.refundAmount.toFixed(2)}</span>;
        }
        if (record.orderItem) {
          return `¥${(record.orderItem.unitPrice * record.orderItem.quantity).toFixed(2)}`;
        }
        return record.order ? `¥${record.order.totalAmount.toFixed(2)}` : '-';
      },
    },
    {
      title: '原因',
      dataIndex: 'reasonType',
      width: 120,
      search: false,
      render: (_, record) => {
        if (record.reasonType && afterSaleReasonMap[record.reasonType]) {
          const entry = afterSaleReasonMap[record.reasonType];
          return <Tag color={entry.color}>{entry.text}</Tag>;
        }
        return record.reason || '-';
      },
    },
    {
      title: '状态',
      dataIndex: 'status',
      width: 120,
      hideInSearch: true,
      render: (_, record) => {
        const s = afterSaleStatusMap[record.status] || { text: record.status, color: 'default' };
        return <Tag color={s.color}>{s.text}</Tag>;
      },
    },
    {
      title: '申请时间',
      dataIndex: 'createdAt',
      width: 120,
      search: false,
      render: (_, record) => dayjs(record.createdAt).format('YYYY-MM-DD'),
    },
    {
      title: '操作',
      valueType: 'option',
      width: 200,
      fixed: 'right',
      render: (_, record) => (
        <Space>
          <a onClick={() => navigate(`/after-sale/${record.id}`)}>详情</a>
          {record.status === 'REQUESTED' && (
            <a onClick={() => handleReview(record.id)}>开始审核</a>
          )}
          {record.status === 'UNDER_REVIEW' && (
            <>
              <a onClick={() => handleApprove(record.id)} style={{ color: '#52c41a' }}>通过</a>
              <a
                onClick={() => { setRejectModal({ open: true, id: record.id }); setRejectReason(''); }}
                style={{ color: '#ff4d4f' }}
              >
                驳回
              </a>
            </>
          )}
          {record.status === 'RETURN_SHIPPING' && (
            <a onClick={() => handleConfirmReceive(record.id)} style={{ color: '#1677ff' }}>确认收到</a>
          )}
          {record.status === 'RECEIVED_BY_SELLER' && (
            <>
              <a onClick={() => handleApprove(record.id)} style={{ color: '#52c41a' }}>验收通过</a>
              <a
                onClick={() => {
                  setRejectReturnModal({ open: true, id: record.id });
                  setReturnRejectReason('');
                  setReturnRejectPhotos([]);
                  setReturnRejectWaybillNo('');
                }}
                style={{ color: '#ff4d4f' }}
              >
                验收不通过
              </a>
            </>
          )}
          {record.status === 'APPROVED' && record.afterSaleType === 'QUALITY_EXCHANGE' && (
            <a onClick={() => navigate(`/after-sale/${record.id}`)}>去发货</a>
          )}
        </Space>
      ),
    },
  ];

  // 为标签页标题添加计数徽章
  const getTabLabel = (key: string, label: string) => {
    if (!stats || !key) return label;
    const keys = key.split(',');
    const count = keys.reduce((sum, k) => sum + (stats[k] || 0), 0);
    return count > 0 ? <Badge count={count} offset={[10, 0]}>{label}</Badge> : label;
  };

  return (
    <>
      <ProTable<AfterSale>
        headerTitle="售后管理"
        actionRef={actionRef}
        columns={columns}
        rowKey="id"
        scroll={{ x: 'max-content' }}
        search={{ labelWidth: 'auto' }}
        toolbar={{
          menu: {
            type: 'tab',
            activeKey: activeTab,
            items: TAB_ITEMS.map((tab) => ({
              key: tab.key,
              label: getTabLabel(tab.key, tab.label),
            })),
            onChange: (key) => {
              setActiveTab(key as string);
              actionRef.current?.reload();
            },
          },
        }}
        request={async (params) => {
          const res = await getAfterSales({
            page: params.current,
            pageSize: params.pageSize,
            status: activeTab || params.status || undefined,
            afterSaleType: params.afterSaleType || undefined,
          });
          return { data: res.items, total: res.total, success: true };
        }}
        pagination={{ defaultPageSize: 20 }}
      />

      {/* 驳回 Modal */}
      <Modal
        title="驳回售后申请"
        open={rejectModal.open}
        onOk={handleReject}
        onCancel={() => setRejectModal({ open: false, id: '' })}
        okText="确认驳回"
        okButtonProps={{ danger: true }}
      >
        <Input.TextArea
          rows={3}
          placeholder="请输入驳回原因"
          value={rejectReason}
          onChange={(e) => setRejectReason(e.target.value)}
        />
      </Modal>

      {/* 拒收退货 Modal */}
      <Modal
        title="拒收退货（验收不合格）"
        open={rejectReturnModal.open}
        onOk={handleRejectReturn}
        onCancel={() => setRejectReturnModal({ open: false, id: '' })}
        okText="确认拒收"
        okButtonProps={{ danger: true }}
        width={520}
      >
        <Space direction="vertical" style={{ width: '100%' }} size="middle">
          <div>
            <div style={{ marginBottom: 4, fontWeight: 500 }}>拒收原因</div>
            <Input.TextArea
              rows={3}
              placeholder="请输入拒收原因（如商品与描述不符、有人为损坏等）"
              value={returnRejectReason}
              onChange={(e) => setReturnRejectReason(e.target.value)}
            />
          </div>
          <div>
            <div style={{ marginBottom: 4, fontWeight: 500 }}>照片凭证（至少1张）</div>
            <Upload
              listType="picture-card"
              fileList={returnRejectPhotos.map((url, i) => ({
                uid: String(i),
                name: `photo-${i}`,
                status: 'done' as const,
                url,
              }))}
              beforeUpload={(file) => {
                // 占位：实际应上传到 OSS 后获取 URL
                const reader = new FileReader();
                reader.onload = () => {
                  setReturnRejectPhotos((prev) => [...prev, reader.result as string]);
                };
                reader.readAsDataURL(file);
                return false;
              }}
              onRemove={(file) => {
                setReturnRejectPhotos((prev) => prev.filter((_, i) => String(i) !== file.uid));
              }}
            >
              {returnRejectPhotos.length < 5 && (
                <div>
                  <UploadOutlined />
                  <div style={{ marginTop: 4, fontSize: 12 }}>上传</div>
                </div>
              )}
            </Upload>
          </div>
          <div>
            <div style={{ marginBottom: 4, fontWeight: 500 }}>退回运单号</div>
            <Input
              placeholder="请输入将退货寄回买家的运单号"
              value={returnRejectWaybillNo}
              onChange={(e) => setReturnRejectWaybillNo(e.target.value)}
            />
          </div>
        </Space>
      </Modal>
    </>
  );
}
