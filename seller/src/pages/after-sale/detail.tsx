import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Card, Descriptions, Tag, Image, Button, Space, Modal, Input, Spin, Upload, App, Timeline, Typography } from 'antd';
import { ArrowLeftOutlined, PrinterOutlined, UploadOutlined } from '@ant-design/icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  getAfterSale,
  reviewAfterSale,
  approveAfterSale,
  rejectAfterSale,
  confirmReceiveReturn,
  rejectReturn,
  shipAfterSale,
  generateAfterSaleWaybill,
  generateSellerReturnWaybill,
  cancelAfterSaleWaybill,
} from '@/api/after-sale';
import { afterSaleStatusMap, afterSaleTypeMap, afterSaleReasonMap } from '@/constants/statusMaps';
import dayjs from 'dayjs';

const sellerAfterSaleTypeMap: Record<string, { text: string; color: string }> = {
  ...afterSaleTypeMap,
  NO_REASON_EXCHANGE: { text: '七天无理由换货', color: 'purple' },
};

const isExchangeType = (type: string) =>
  type === 'QUALITY_EXCHANGE' || type === 'NO_REASON_EXCHANGE';

const isReturnType = (type: string) =>
  type === 'QUALITY_RETURN' || type === 'NO_REASON_RETURN';

export default function AfterSaleDetailPage() {
  const { message, modal } = App.useApp();
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [rejectModal, setRejectModal] = useState(false);
  const [rejectReason, setRejectReason] = useState('');
  const [rejectReturnModal, setRejectReturnModal] = useState(false);
  const [returnRejectReason, setReturnRejectReason] = useState('');
  const [returnRejectPhotos, setReturnRejectPhotos] = useState<string[]>([]);
  const [shipping, setShipping] = useState(false);
  const [generatingWaybill, setGeneratingWaybill] = useState(false);
  const [generatingSellerReturnWaybill, setGeneratingSellerReturnWaybill] = useState(false);

  const { data: afterSale, isLoading } = useQuery({
    queryKey: ['after-sale', id],
    queryFn: () => getAfterSale(id!),
    enabled: !!id,
    // 详情页是焦点页：每 10s 拉一次拿到顺丰推送进来的新轨迹/状态变化
    refetchInterval: 10_000,
    refetchOnWindowFocus: true,
  });

  const reload = () => queryClient.invalidateQueries({ queryKey: ['after-sale', id] });

  const handleReview = () => {
    modal.confirm({
      title: '确认开始审核该售后申请？',
      onOk: async () => {
        await reviewAfterSale(id!);
        message.success('已进入审核中');
        reload();
      },
    });
  };

  const handleApprove = () => {
    modal.confirm({
      title: '确认通过售后申请？',
      onOk: async () => {
        await approveAfterSale(id!);
        message.success('已通过');
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
      await rejectAfterSale(id!, rejectReason);
      message.success('已驳回');
      setRejectModal(false);
      setRejectReason('');
      reload();
    } catch (err) {
      message.error(err instanceof Error ? err.message : '操作失败');
    }
  };

  const handleConfirmReceive = () => {
    modal.confirm({
      title: '确认已收到买家退货？',
      content: '确认收到后将进入验收环节',
      onOk: async () => {
        await confirmReceiveReturn(id!);
        message.success('已确认收到退货');
        reload();
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
    try {
      await rejectReturn(id!, {
        reason: returnRejectReason,
        photos: returnRejectPhotos,
      });
      message.success('已拒收退货');
      setRejectReturnModal(false);
      setReturnRejectReason('');
      setReturnRejectPhotos([]);
      reload();
    } catch (err) {
      message.error(err instanceof Error ? err.message : '操作失败');
    }
  };

  const handleShip = async () => {
    setShipping(true);
    try {
      await shipAfterSale(id!);
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
      const result = await generateAfterSaleWaybill(id!, carrierCode);
      message.success(`面单生成成功：${result.waybillNo}`);
      reload();
    } catch (err) {
      message.error(err instanceof Error ? err.message : '生成面单失败');
    } finally {
      setGeneratingWaybill(false);
    }
  };

  const handleGenerateSellerReturnWaybill = async () => {
    setGeneratingSellerReturnWaybill(true);
    try {
      const result = await generateSellerReturnWaybill(id!, 'SF');
      message.success(`回寄面单生成成功：${result.waybillNo}`);
      reload();
    } catch (err) {
      message.error(err instanceof Error ? err.message : '生成回寄面单失败');
    } finally {
      setGeneratingSellerReturnWaybill(false);
    }
  };

  const handleCancelWaybill = () => {
    modal.confirm({
      title: '确认取消面单？',
      content: '取消后需重新生成面单',
      onOk: async () => {
        try {
          await cancelAfterSaleWaybill(id!);
          message.success('面单已取消');
          reload();
        } catch (err) {
          message.error(err instanceof Error ? err.message : '取消失败');
        }
      },
    });
  };

  if (isLoading) return <Spin style={{ display: 'block', margin: '100px auto' }} />;
  if (!afterSale) return <div>未找到售后记录</div>;

  const statusInfo = afterSaleStatusMap[afterSale.status] || { text: afterSale.status, color: 'default' };
  const typeInfo = sellerAfterSaleTypeMap[afterSale.afterSaleType];
  const reasonInfo = afterSale.reasonType ? afterSaleReasonMap[afterSale.reasonType] : null;
  const isExchange = isExchangeType(afterSale.afterSaleType);
  const isReturn = isReturnType(afterSale.afterSaleType);
  const canShipReplacement =
    isExchange && ['APPROVED', 'RECEIVED_BY_SELLER'].includes(afterSale.status);

  // 从 productSnapshot 提取商品名和图片
  const snapshot = afterSale.orderItem?.productSnapshot;
  const parsedSnapshot = snapshot
    ? typeof snapshot === 'string' ? JSON.parse(snapshot) : snapshot
    : null;
  const productName = parsedSnapshot?.title || parsedSnapshot?.name || '-';
  const productImage = parsedSnapshot?.imageUrl || parsedSnapshot?.media?.[0]?.url;

  return (
    <Space direction="vertical" size="large" style={{ width: '100%' }}>
      <Button icon={<ArrowLeftOutlined />} onClick={() => navigate('/after-sale')}>
        返回列表
      </Button>

      {/* 基本信息 */}
      <Card title="售后详情">
        <Descriptions column={2} bordered>
          <Descriptions.Item label="售后单号">{afterSale.id}</Descriptions.Item>
          <Descriptions.Item label="订单号">{afterSale.orderId}</Descriptions.Item>
          <Descriptions.Item label="状态">
            <Tag color={statusInfo.color}>{statusInfo.text}</Tag>
          </Descriptions.Item>
          <Descriptions.Item label="售后类型">
            {typeInfo ? <Tag color={typeInfo.color}>{typeInfo.text}</Tag> : afterSale.afterSaleType}
          </Descriptions.Item>
          <Descriptions.Item label="买家">{afterSale.buyerAlias}</Descriptions.Item>
          <Descriptions.Item label="申请时间">
            {dayjs(afterSale.createdAt).format('YYYY-MM-DD HH:mm')}
          </Descriptions.Item>
          <Descriptions.Item label="售后原因">
            {reasonInfo ? <Tag color={reasonInfo.color}>{reasonInfo.text}</Tag> : (afterSale.reason || '-')}
          </Descriptions.Item>
          <Descriptions.Item label="需要退货">
            {afterSale.requiresReturn ? <Tag color="orange">需退货</Tag> : <Tag>无需退货</Tag>}
          </Descriptions.Item>
          {afterSale.reason && (
            <Descriptions.Item label="补充说明" span={2}>{afterSale.reason}</Descriptions.Item>
          )}
          {afterSale.refundAmount != null && (
            <Descriptions.Item label="退款金额">
              <span style={{ fontWeight: 600, color: '#ff4d4f' }}>¥{afterSale.refundAmount.toFixed(2)}</span>
            </Descriptions.Item>
          )}
          {afterSale.reviewNote && (
            <Descriptions.Item
              label={afterSale.status === 'REJECTED' ? '驳回原因' : '审核备注'}
              span={2}
            >
              {afterSale.reviewNote}
            </Descriptions.Item>
          )}
          {afterSale.reviewedAt && (
            <Descriptions.Item label="审核时间">
              {dayjs(afterSale.reviewedAt).format('YYYY-MM-DD HH:mm')}
            </Descriptions.Item>
          )}
          {afterSale.approvedAt && (
            <Descriptions.Item label="通过时间">
              {dayjs(afterSale.approvedAt).format('YYYY-MM-DD HH:mm')}
            </Descriptions.Item>
          )}
        </Descriptions>
      </Card>

      {/* 商品信息 */}
      {afterSale.orderItem && (
        <Card title="商品信息">
          <Space align="start" size="large">
            {productImage && (
              <Image
                src={productImage}
                width={100}
                height={100}
                style={{ objectFit: 'cover', borderRadius: 8 }}
              />
            )}
            <Descriptions column={1}>
              <Descriptions.Item label="商品名称">{productName}</Descriptions.Item>
              <Descriptions.Item label="单价">¥{afterSale.orderItem.unitPrice.toFixed(2)}</Descriptions.Item>
              <Descriptions.Item label="数量">{afterSale.orderItem.quantity}</Descriptions.Item>
              <Descriptions.Item label="小计">
                ¥{(afterSale.orderItem.unitPrice * afterSale.orderItem.quantity).toFixed(2)}
              </Descriptions.Item>
            </Descriptions>
          </Space>
        </Card>
      )}

      {/* 照片证据 */}
      {afterSale.photos?.length > 0 && (
        <Card title="买家照片证据">
          <Image.PreviewGroup>
            <Space wrap>
              {afterSale.photos.map((url, i) => (
                <Image key={i} src={url} width={120} height={120} style={{ objectFit: 'cover', borderRadius: 8 }} />
              ))}
            </Space>
          </Image.PreviewGroup>
        </Card>
      )}

      {/* 退货物流信息（仅在需要寄回时展示——免寄回的售后单整块隐藏）*/}
      {afterSale.requiresReturn && (afterSale.returnCarrierName || afterSale.returnWaybillNo) && (
        <Card title="退货物流">
          <Descriptions column={2} bordered>
            {afterSale.returnCarrierName && (
              <Descriptions.Item label="退货快递">{afterSale.returnCarrierName}</Descriptions.Item>
            )}
            {afterSale.returnWaybillNo && (
              <Descriptions.Item label="退货运单号">{afterSale.returnWaybillNo}</Descriptions.Item>
            )}
            {afterSale.returnShippedAt && (
              <Descriptions.Item label="退货发出时间">
                {dayjs(afterSale.returnShippedAt).format('YYYY-MM-DD HH:mm')}
              </Descriptions.Item>
            )}
            {afterSale.sellerReceivedAt && (
              <Descriptions.Item label="卖家签收时间">
                {dayjs(afterSale.sellerReceivedAt).format('YYYY-MM-DD HH:mm')}
              </Descriptions.Item>
            )}
          </Descriptions>

          {/* 顺丰物流轨迹（实时查询，已过滤沙箱旧路由）*/}
          {(afterSale.returnTracking?.events?.length ||
            afterSale.replacementTracking?.events?.length ||
            afterSale.sellerReturnTracking?.events?.length) ? (
            <div style={{ marginTop: 16 }}>
              <Typography.Text strong>顺丰物流轨迹（实时）</Typography.Text>
              {afterSale.returnTracking?.events?.length ? (
                <div style={{ marginTop: 8 }}>
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                    买家寄回（{afterSale.returnWaybillNo}）
                  </Typography.Text>
                  <Timeline
                    style={{ marginTop: 8 }}
                    items={afterSale.returnTracking.events.map((e: any) => ({
                      color: 'blue',
                      children: (
                        <Space direction="vertical" size={2}>
                          <Typography.Text>{e.message}</Typography.Text>
                          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                            {e.time}{e.location ? ` · ${e.location}` : ''}
                          </Typography.Text>
                        </Space>
                      ),
                    }))}
                  />
                </div>
              ) : null}
              {afterSale.replacementTracking?.events?.length ? (
                <div style={{ marginTop: 12 }}>
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                    卖家发换货（{afterSale.replacementWaybillNo}）
                  </Typography.Text>
                  <Timeline
                    style={{ marginTop: 8 }}
                    items={afterSale.replacementTracking.events.map((e: any) => ({
                      color: 'green',
                      children: (
                        <Space direction="vertical" size={2}>
                          <Typography.Text>{e.message}</Typography.Text>
                          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                            {e.time}{e.location ? ` · ${e.location}` : ''}
                          </Typography.Text>
                        </Space>
                      ),
                    }))}
                  />
                </div>
              ) : null}
              {afterSale.sellerReturnTracking?.events?.length ? (
                <div style={{ marginTop: 12 }}>
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                    卖家拒收回寄
                  </Typography.Text>
                  <Timeline
                    style={{ marginTop: 8 }}
                    items={afterSale.sellerReturnTracking.events.map((e: any) => ({
                      color: 'orange',
                      children: (
                        <Space direction="vertical" size={2}>
                          <Typography.Text>{e.message}</Typography.Text>
                          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                            {e.time}{e.location ? ` · ${e.location}` : ''}
                          </Typography.Text>
                        </Space>
                      ),
                    }))}
                  />
                </div>
              ) : null}
            </div>
          ) : afterSale.returnWaybillNo ? (
            <Typography.Text type="secondary" style={{ fontSize: 12, display: 'block', marginTop: 12 }}>
              顺丰物流轨迹：暂无路由信息（顺丰可能尚未揽收或推送延迟）
            </Typography.Text>
          ) : null}
        </Card>
      )}

      {/* 卖家拒收信息 */}
      {(afterSale.sellerRejectReason || afterSale.status === 'SELLER_REJECTED_RETURN') && (
        <Card title="拒收退货信息">
          <Descriptions column={2} bordered>
            <Descriptions.Item label="拒收原因" span={2}>{afterSale.sellerRejectReason || '-'}</Descriptions.Item>
            {afterSale.sellerReturnCarrierName && (
              <Descriptions.Item label="退回快递">{afterSale.sellerReturnCarrierName}</Descriptions.Item>
            )}
            {afterSale.sellerReturnWaybillNo && (
              <Descriptions.Item label="退回运单号">{afterSale.sellerReturnWaybillNo}</Descriptions.Item>
            )}
          </Descriptions>
          {afterSale.status === 'SELLER_REJECTED_RETURN' && (
            <Space style={{ marginTop: 12 }}>
              {!afterSale.sellerReturnWaybillNo && (
                <Button
                  type="primary"
                  loading={generatingSellerReturnWaybill}
                  onClick={handleGenerateSellerReturnWaybill}
                >
                  生成回寄面单
                </Button>
              )}
              {afterSale.sellerReturnWaybillNo && afterSale.sellerReturnWaybillUrl && (
                <Button
                  icon={<PrinterOutlined />}
                  onClick={() =>
                    afterSale.sellerReturnWaybillUrl &&
                    window.open(afterSale.sellerReturnWaybillUrl, '_blank', 'noopener,noreferrer')
                  }
                >
                  打印回寄面单
                </Button>
              )}
            </Space>
          )}
          {afterSale.sellerRejectPhotos && afterSale.sellerRejectPhotos.length > 0 && (
            <div style={{ marginTop: 12 }}>
              <div style={{ fontWeight: 500, marginBottom: 8 }}>拒收照片：</div>
              <Image.PreviewGroup>
                <Space wrap>
                  {afterSale.sellerRejectPhotos.map((url, i) => (
                    <Image key={i} src={url} width={100} height={100} style={{ objectFit: 'cover', borderRadius: 8 }} />
                  ))}
                </Space>
              </Image.PreviewGroup>
            </div>
          )}
        </Card>
      )}

      {/* 换货物流信息 */}
      {isExchange && (afterSale.replacementCarrierName || afterSale.replacementWaybillNo) && (
        <Card title="换货物流">
          <Descriptions column={2} bordered>
            {afterSale.replacementCarrierName && (
              <Descriptions.Item label="快递公司">{afterSale.replacementCarrierName}</Descriptions.Item>
            )}
            {afterSale.replacementWaybillNo && (
              <Descriptions.Item label="电子面单号">{afterSale.replacementWaybillNo}</Descriptions.Item>
            )}
            {afterSale.replacementShipmentId && (
              <Descriptions.Item label="物流单号">{afterSale.replacementShipmentId}</Descriptions.Item>
            )}
          </Descriptions>
        </Card>
      )}

      {/* 操作按钮 */}
      <Card>
        <Space>
          {afterSale.status === 'REQUESTED' && (
            <Button onClick={handleReview}>开始审核</Button>
          )}
          {afterSale.status === 'UNDER_REVIEW' && (
            <>
              <Button type="primary" onClick={handleApprove}>通过</Button>
              <Button danger onClick={() => { setRejectModal(true); setRejectReason(''); }}>驳回</Button>
            </>
          )}
          {afterSale.status === 'RETURN_SHIPPING' && (
            <Button type="primary" onClick={handleConfirmReceive}>确认收到退货</Button>
          )}
          {afterSale.status === 'RECEIVED_BY_SELLER' && isReturn && (
            <>
              <Tag color="processing">已签收，系统将进入退款处理</Tag>
              <Button
                danger
                onClick={() => {
                  setRejectReturnModal(true);
                  setReturnRejectReason('');
                  setReturnRejectPhotos([]);
                }}
              >
                验收不通过
              </Button>
            </>
          )}
          {/* 换货发货流程 */}
          {canShipReplacement && !afterSale.replacementWaybillNo && (
            <Button type="primary" loading={generatingWaybill} onClick={() => handleGenerateWaybill('SF')}>
              生成面单
            </Button>
          )}
          {canShipReplacement && afterSale.replacementWaybillNo && (
            <>
              <Button
                icon={<PrinterOutlined />}
                onClick={() =>
                  afterSale.replacementWaybillPrintUrl &&
                  window.open(afterSale.replacementWaybillPrintUrl, '_blank', 'noopener,noreferrer')
                }
              >
                打印面单
              </Button>
              <Button danger onClick={handleCancelWaybill}>取消面单</Button>
              <Button type="primary" loading={shipping} onClick={handleShip}>确认发货</Button>
            </>
          )}
        </Space>
      </Card>

      {/* 驳回 Modal */}
      <Modal
        title="驳回售后申请"
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

      {/* 拒收退货 Modal */}
      <Modal
        title="拒收退货（验收不合格）"
        open={rejectReturnModal}
        onOk={handleRejectReturn}
        onCancel={() => setRejectReturnModal(false)}
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
        </Space>
      </Modal>
    </Space>
  );
}
