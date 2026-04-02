import { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Tag, Image, Space, message, Modal, Input } from 'antd';
import { ProTable } from '@ant-design/pro-components';
import type { ActionType, ProColumns } from '@ant-design/pro-components';
import { getReplacements, reviewReplacement, approveReplacement, rejectReplacement, type Replacement } from '@/api/replacements';
import { replacementReasonMap } from '@/constants/statusMaps';
import dayjs from 'dayjs';

const statusMap: Record<string, { text: string; color: string }> = {
  REQUESTED: { text: '待审核', color: 'orange' },
  UNDER_REVIEW: { text: '审核中', color: 'purple' },
  APPROVED: { text: '已通过', color: 'blue' },
  REJECTED: { text: '已驳回', color: 'red' },
  SHIPPED: { text: '已发货', color: 'cyan' },
  COMPLETED: { text: '已完成', color: 'green' },
};

export default function ReplacementListPage() {
  const actionRef = useRef<ActionType | null>(null);
  const navigate = useNavigate();
  const [rejectModal, setRejectModal] = useState<{ open: boolean; id: string }>({ open: false, id: '' });
  const [rejectReason, setRejectReason] = useState('');

  const handleApprove = async (id: string) => {
    Modal.confirm({
      title: '确认通过换货申请？',
      onOk: async () => {
        await approveReplacement(id);
        message.success('已通过');
        actionRef.current?.reload();
      },
    });
  };

  const handleReview = async (id: string) => {
    Modal.confirm({
      title: '确认开始审核该换货申请？',
      onOk: async () => {
        await reviewReplacement(id);
        message.success('已进入审核中');
        actionRef.current?.reload();
      },
    });
  };

  const handleReject = async () => {
    if (!rejectReason.trim()) {
      message.warning('请填写驳回原因');
      return;
    }
    await rejectReplacement(rejectModal.id, rejectReason);
    message.success('已驳回');
    setRejectModal({ open: false, id: '' });
    setRejectReason('');
    actionRef.current?.reload();
  };

  const columns: ProColumns<Replacement>[] = [
    {
      title: 'ID',
      dataIndex: 'id',
      width: 80,
      ellipsis: true,
      search: false,
    },
    {
      title: '订单号',
      dataIndex: 'orderId',
      width: 120,
      ellipsis: true,
    },
    {
      title: '买家',
      dataIndex: 'buyerAlias',
      width: 100,
      search: false,
    },
    {
      title: '原因',
      dataIndex: 'reasonType',
      width: 200,
      ellipsis: true,
      search: false,
      render: (_, record) => {
        if (record.reasonType && replacementReasonMap[record.reasonType]) {
          const entry = replacementReasonMap[record.reasonType];
          return <Tag color={entry.color}>{entry.text}</Tag>;
        }
        return record.reason || '-';
      },
    },
    {
      title: '照片',
      dataIndex: 'photos',
      width: 120,
      search: false,
      render: (_, record) =>
        record.photos?.length > 0 ? (
          <Image.PreviewGroup>
            <Space>
              {record.photos.slice(0, 3).map((url, i) => (
                <Image key={i} src={url} width={40} height={40} style={{ objectFit: 'cover', borderRadius: 4 }} />
              ))}
              {record.photos.length > 3 && <span>+{record.photos.length - 3}</span>}
            </Space>
          </Image.PreviewGroup>
        ) : '-',
    },
    {
      title: '状态',
      dataIndex: 'status',
      width: 100,
      valueType: 'select',
      valueEnum: {
        REQUESTED: { text: '待审核' },
        UNDER_REVIEW: { text: '审核中' },
        APPROVED: { text: '已通过' },
        REJECTED: { text: '已驳回' },
        SHIPPED: { text: '已发货' },
        COMPLETED: { text: '已完成' },
      },
      render: (_, record) => {
        const s = statusMap[record.status] || { text: record.status, color: 'default' };
        return <Tag color={s.color}>{s.text}</Tag>;
      },
    },
    {
      title: '申请时间',
      dataIndex: 'createdAt',
      width: 160,
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
          <a onClick={() => navigate(`/replacements/${record.id}`)}>详情</a>
          {record.status === 'REQUESTED' && (
            <a onClick={() => handleReview(record.id)}>开始审核</a>
          )}
          {record.status === 'UNDER_REVIEW' && (
            <>
              <a onClick={() => handleApprove(record.id)} style={{ color: '#52c41a' }}>通过</a>
              <a onClick={() => { setRejectModal({ open: true, id: record.id }); setRejectReason(''); }} style={{ color: '#ff4d4f' }}>驳回</a>
            </>
          )}
          {record.status === 'APPROVED' && (
            <a onClick={() => navigate(`/replacements/${record.id}`)}>去发货</a>
          )}
        </Space>
      ),
    },
  ];

  return (
    <>
      <ProTable<Replacement>
        headerTitle="换货处理"
        actionRef={actionRef}
        columns={columns}
        rowKey="id"
        scroll={{ x: 'max-content' }}
        search={{ labelWidth: 'auto' }}
        request={async (params) => {
          const res = await getReplacements({
            page: params.current,
            pageSize: params.pageSize,
            status: params.status,
          });
          return { data: res.items, total: res.total, success: true };
        }}
        pagination={{ defaultPageSize: 20 }}
      />

      {/* 驳回 Modal */}
      <Modal
        title="驳回换货申请"
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
    </>
  );
}
