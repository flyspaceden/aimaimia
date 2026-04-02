import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Card, Descriptions, Tag, Image, Button, Space, message, Modal, Input, Spin, Tooltip } from 'antd';
import { ArrowLeftOutlined, PhoneOutlined, PrinterOutlined } from '@ant-design/icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { getReplacement, reviewReplacement, approveReplacement, rejectReplacement, shipReplacement, bindVirtualCallForReplacement, generateReplacementWaybill, cancelReplacementWaybill } from '@/api/replacements';
import { replacementReasonMap } from '@/constants/statusMaps';
import useAuthStore from '@/store/useAuthStore';
import dayjs from 'dayjs';

const statusMap: Record<string, { text: string; color: string }> = {
  REQUESTED: { text: '待审核', color: 'orange' },
  UNDER_REVIEW: { text: '审核中', color: 'purple' },
  APPROVED: { text: '已通过', color: 'blue' },
  REJECTED: { text: '已驳回', color: 'red' },
  SHIPPED: { text: '已发货', color: 'cyan' },
  COMPLETED: { text: '已完成', color: 'green' },
};

export default function ReplacementDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [rejectModal, setRejectModal] = useState(false);
  const [rejectReason, setRejectReason] = useState('');
  const [callingBuyer, setCallingBuyer] = useState(false);
  const [shipping, setShipping] = useState(false);
  const [generatingWaybill, setGeneratingWaybill] = useState(false);
  const { hasRole } = useAuthStore();

  const { data: replacement, isLoading } = useQuery({
    queryKey: ['replacement', id],
    queryFn: () => getReplacement(id!),
    enabled: !!id,
  });

  const reload = () => queryClient.invalidateQueries({ queryKey: ['replacement', id] });

  const handleApprove = () => {
    Modal.confirm({
      title: '确认通过换货申请？',
      onOk: async () => {
        await approveReplacement(id!);
        message.success('已通过');
        reload();
      },
    });
  };

  const handleReview = () => {
    Modal.confirm({
      title: '确认开始审核该换货申请？',
      onOk: async () => {
        await reviewReplacement(id!);
        message.success('已进入审核中');
        reload();
      },
    });
  };

  const handleReject = async () => {
    if (!rejectReason.trim()) {
      message.warning('请填写驳回原因');
      return;
    }
    try {
      await rejectReplacement(id!, rejectReason);
      message.success('已驳回');
      setRejectModal(false);
      setRejectReason('');
      reload();
    } catch (err) {
      message.error(err instanceof Error ? err.message : '操作失败');
    }
  };

  const handleShip = async () => {
    setShipping(true);
    try {
      await shipReplacement(id!);
      message.success('已发货');
      reload();
    } catch (err) {
      message.error(err instanceof Error ? err.message : '操作失败');
    } finally {
      setShipping(false);
    }
  };

  const handleGenerateWaybill = async (carrierCode: string) => {
    setGeneratingWaybill(true);
    try {
      const result = await generateReplacementWaybill(id!, carrierCode);
      message.success(`面单生成成功：${result.waybillNo}`);
      reload();
    } catch (err) {
      message.error(err instanceof Error ? err.message : '生成面单失败');
    } finally {
      setGeneratingWaybill(false);
    }
  };

  const handleCancelWaybill = () => {
    Modal.confirm({
      title: '确认取消面单？',
      content: '取消后需重新生成面单',
      onOk: async () => {
        try {
          await cancelReplacementWaybill(id!);
          message.success('面单已取消');
          reload();
        } catch (err) {
          message.error(err instanceof Error ? err.message : '取消失败');
        }
      },
    });
  };

  // 联系买家（虚拟号）
  const handleCallBuyer = async () => {
    setCallingBuyer(true);
    try {
      const result = await bindVirtualCallForReplacement(id!);
      Modal.info({
        title: '联系买家',
        content: (
          <div>
            <p>虚拟号码：<strong>{result.virtualNumber}</strong></p>
            <p>有效期至：{dayjs(result.expireAt).format('YYYY-MM-DD HH:mm')}</p>
            <p>剩余通话次数：{result.remainingCalls}</p>
            <p style={{ color: '#999', fontSize: 12, marginTop: 8 }}>
              请使用此虚拟号码联系买家，通话结束后号码将在到期后自动解绑。
            </p>
          </div>
        ),
      });
    } catch (err) {
      message.error(err instanceof Error ? err.message : '获取虚拟号码失败');
    } finally {
      setCallingBuyer(false);
    }
  };

  if (isLoading) return <Spin style={{ display: 'block', margin: '100px auto' }} />;
  if (!replacement) return <div>未找到换货记录</div>;

  const s = statusMap[replacement.status] || { text: replacement.status, color: 'default' };
  const reasonInfo = replacement.reasonType ? replacementReasonMap[replacement.reasonType] : null;
  const canCallBuyer = ['REQUESTED', 'UNDER_REVIEW', 'APPROVED'].includes(replacement.status) && hasRole('OWNER', 'MANAGER');

  return (
    <Space direction="vertical" size="large" style={{ width: '100%' }}>
      <Space>
        <Button icon={<ArrowLeftOutlined />} onClick={() => navigate('/replacements')}>
          返回列表
        </Button>
        {canCallBuyer && (
          <Tooltip title="通过平台虚拟号联系买家，保护双方隐私">
            <Button icon={<PhoneOutlined />} loading={callingBuyer} onClick={handleCallBuyer}>
              联系买家
            </Button>
          </Tooltip>
        )}
      </Space>

      <Card title="换货详情">
        <Descriptions column={2} bordered>
          <Descriptions.Item label="换货ID">{replacement.id}</Descriptions.Item>
          <Descriptions.Item label="订单号">{replacement.orderId}</Descriptions.Item>
          <Descriptions.Item label="状态"><Tag color={s.color}>{s.text}</Tag></Descriptions.Item>
          <Descriptions.Item label="买家">{replacement.buyerAlias}</Descriptions.Item>
          <Descriptions.Item label="申请时间">{dayjs(replacement.createdAt).format('YYYY-MM-DD')}</Descriptions.Item>
          <Descriptions.Item label="换货理由">
            {reasonInfo ? <Tag color={reasonInfo.color}>{reasonInfo.text}</Tag> : (replacement.reason || '-')}
          </Descriptions.Item>
          {replacement.reason && (
            <Descriptions.Item label="补充说明" span={2}>{replacement.reason}</Descriptions.Item>
          )}
          {replacement.reviewNote && (
            <Descriptions.Item label={replacement.status === 'REJECTED' ? '驳回原因' : '审核备注'} span={2}>
              {replacement.reviewNote}
            </Descriptions.Item>
          )}
          {replacement.replacementCarrierName && (
            <Descriptions.Item label="快递公司">{replacement.replacementCarrierName}</Descriptions.Item>
          )}
          {replacement.replacementWaybillNo && (
            <Descriptions.Item label="电子面单号">{replacement.replacementWaybillNo}</Descriptions.Item>
          )}
          {replacement.replacementShipmentId && (
            <Descriptions.Item label="换货物流单号">{replacement.replacementShipmentId}</Descriptions.Item>
          )}
          {replacement.orderItem && (
            <Descriptions.Item label="商品" span={2}>
              单价 ¥{replacement.orderItem.unitPrice.toFixed(2)} × {replacement.orderItem.quantity}
            </Descriptions.Item>
          )}
        </Descriptions>
      </Card>

      {/* 照片证据 */}
      {replacement.photos?.length > 0 && (
        <Card title="照片证据">
          <Image.PreviewGroup>
            <Space wrap>
              {replacement.photos.map((url, i) => (
                <Image key={i} src={url} width={120} height={120} style={{ objectFit: 'cover', borderRadius: 8 }} />
              ))}
            </Space>
          </Image.PreviewGroup>
        </Card>
      )}

      {/* 操作按钮 */}
      <Card>
        <Space>
          {replacement.status === 'REQUESTED' && (
            <Button onClick={handleReview}>开始审核</Button>
          )}
          {replacement.status === 'UNDER_REVIEW' && (
            <>
              <Button type="primary" onClick={handleApprove}>通过</Button>
              <Button danger onClick={() => { setRejectModal(true); setRejectReason(''); }}>驳回</Button>
            </>
          )}
          {replacement.status === 'APPROVED' && !replacement.replacementWaybillNo && (
            <Button type="primary" loading={generatingWaybill} onClick={() => handleGenerateWaybill('')}>生成面单</Button>
          )}
          {replacement.status === 'APPROVED' && replacement.replacementWaybillNo && (
            <>
              <Button
                icon={<PrinterOutlined />}
                onClick={() => replacement.replacementWaybillPrintUrl && window.open(replacement.replacementWaybillPrintUrl, '_blank', 'noopener,noreferrer')}
              >
                打印面单
              </Button>
              <Button danger onClick={handleCancelWaybill}>取消面单</Button>
              <Button type="primary" loading={shipping} onClick={handleShip}>确认发货</Button>
            </>
          )}
        </Space>
      </Card>

      <Modal
        title="驳回换货申请"
        open={rejectModal}
        onOk={handleReject}
        onCancel={() => setRejectModal(false)}
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
    </Space>
  );
}
