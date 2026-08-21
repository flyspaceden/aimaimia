import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { BrowserQRCodeReader, type IScannerControls } from '@zxing/browser';
import {
  Alert,
  App,
  Button,
  Card,
  Col,
  Descriptions,
  Divider,
  Input,
  List,
  Row,
  Segmented,
  Space,
  Steps,
  Tag,
  Typography,
} from 'antd';
import {
  CameraOutlined,
  CheckCircleFilled,
  FileSearchOutlined,
  QrcodeOutlined,
  SafetyCertificateOutlined,
  ScanOutlined,
  StopOutlined,
} from '@ant-design/icons';
import {
  getOrder,
  resolvePickupCredential,
  verifyPickupCredential,
  type PickupCredentialPayload,
  type PickupCredentialPreview,
} from '@/api/orders';
import { PERMISSIONS } from '@/constants/permissions';
import useAuthStore from '@/store/useAuthStore';
import type { Order } from '@/types';
import { getAdminErrorMessage } from '@/utils/adminErrorMessage';
import { pickupFullAddress } from '@/utils/pickup';

type StationMode = 'scanner' | 'camera' | 'code';

const stationModes: Array<{ label: string; value: StationMode }> = [
  { label: '扫码枪 / 读码器', value: 'scanner' },
  { label: '电脑摄像头', value: 'camera' },
  { label: '输入 8 位取货码', value: 'code' },
];

function toCredential(mode: StationMode, raw: string): PickupCredentialPayload | null {
  const value = raw.trim();
  if (!value) return null;
  return mode === 'code' ? { pickupCode: value } : { qrPayload: value };
}

export default function PickupVerificationPage() {
  const { message, modal } = App.useApp();
  const navigate = useNavigate();
  const canReadOrders = useAuthStore((state) => state.hasPermission(PERMISSIONS.ORDERS_READ));
  const [mode, setMode] = useState<StationMode>('scanner');
  const [credentialInput, setCredentialInput] = useState('');
  const [preview, setPreview] = useState<PickupCredentialPreview | null>(null);
  const [orderMeta, setOrderMeta] = useState<Order | null>(null);
  const [resolving, setResolving] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [cameraStarting, setCameraStarting] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [goodsCode, setGoodsCode] = useState('');
  const [matchedGoodsCodes, setMatchedGoodsCodes] = useState<string[]>([]);
  const videoRef = useRef<HTMLVideoElement>(null);
  const qrReaderRef = useRef<BrowserQRCodeReader | null>(null);
  const scannerControlsRef = useRef<IScannerControls | null>(null);
  const cameraSessionRef = useRef(0);
  const resolveSessionRef = useRef(0);
  const activeResolveSessionRef = useRef<number | null>(null);
  const resolvingRef = useRef(false);
  const confirmationOpenRef = useRef(false);
  const resolvedCredentialRef = useRef<PickupCredentialPayload | null>(null);

  const stopCamera = useCallback(() => {
    cameraSessionRef.current += 1;
    scannerControlsRef.current?.stop();
    scannerControlsRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    setCameraOpen(false);
  }, []);

  const clearResolvedOrder = useCallback(() => {
    resolveSessionRef.current += 1;
    activeResolveSessionRef.current = null;
    resolvingRef.current = false;
    resolvedCredentialRef.current = null;
    setResolving(false);
    setCredentialInput('');
    setPreview(null);
    setOrderMeta(null);
    setGoodsCode('');
    setMatchedGoodsCodes([]);
  }, []);

  const resetStation = useCallback(() => {
    stopCamera();
    clearResolvedOrder();
    setCameraError(null);
  }, [clearResolvedOrder, stopCamera]);

  const resolveCredential = useCallback(async (raw: string, inputMode: StationMode) => {
    const credential = toCredential(inputMode, raw);
    if (!credential) {
      message.warning(inputMode === 'code' ? '请输入 8 位取货码' : '请扫描或粘贴买家取货二维码完整内容');
      return;
    }
    if (resolvingRef.current) return;
    const resolveSession = resolveSessionRef.current + 1;
    resolveSessionRef.current = resolveSession;
    activeResolveSessionRef.current = resolveSession;
    resolvingRef.current = true;
    setResolving(true);
    setPreview(null);
    setOrderMeta(null);
    resolvedCredentialRef.current = null;
    setGoodsCode('');
    setMatchedGoodsCodes([]);
    try {
      const data = await resolvePickupCredential(credential);
      if (resolveSessionRef.current !== resolveSession) return;
      setCredentialInput('');
      resolvedCredentialRef.current = credential;
      setPreview(data);
      if (canReadOrders) {
        void getOrder(data.orderId)
          .then((order) => {
            if (resolveSessionRef.current === resolveSession) setOrderMeta(order);
          })
          .catch(() => {
            if (resolveSessionRef.current === resolveSession) setOrderMeta(null);
          });
      }
      message[data.alreadyPickedUp ? 'info' : 'success'](
        data.alreadyPickedUp ? '该凭证已核销，未重复改变订单' : '已识别订单，请核对企业、取货人和商品',
      );
    } catch (error: unknown) {
      if (resolveSessionRef.current === resolveSession) {
        message.error(getAdminErrorMessage(error, '无法识别取货凭证'));
      }
    } finally {
      if (activeResolveSessionRef.current === resolveSession) {
        activeResolveSessionRef.current = null;
        resolvingRef.current = false;
        if (resolveSessionRef.current === resolveSession) setResolving(false);
      }
    }
  }, [canReadOrders, message]);

  const handleScannedCredential = useCallback((raw: string) => {
    stopCamera();
    void resolveCredential(raw, 'scanner');
  }, [resolveCredential, stopCamera]);

  const startCamera = useCallback(async () => {
    if (!navigator.mediaDevices?.getUserMedia || !videoRef.current) {
      setCameraError('当前浏览器不支持摄像头扫码。请使用扫码枪，或输入 8 位取货码。');
      return;
    }
    stopCamera();
    const currentSession = cameraSessionRef.current + 1;
    cameraSessionRef.current = currentSession;
    setCameraError(null);
    setCameraStarting(true);
    setCameraOpen(true);
    try {
      const reader = qrReaderRef.current ?? new BrowserQRCodeReader();
      qrReaderRef.current = reader;
      const controls = await reader.decodeFromConstraints(
        {
          audio: false,
          video: {
            facingMode: { ideal: 'environment' },
            width: { ideal: 1280 },
            height: { ideal: 720 },
          },
        },
        videoRef.current,
        (result) => {
          if (!result || resolvingRef.current || cameraSessionRef.current !== currentSession) return;
          handleScannedCredential(result.getText());
        },
      );
      if (cameraSessionRef.current !== currentSession) {
        controls.stop();
        return;
      }
      scannerControlsRef.current = controls;
    } catch (error: unknown) {
      if (cameraSessionRef.current === currentSession) {
        setCameraError(getAdminErrorMessage(error, '无法打开摄像头，请检查浏览器权限'));
        setCameraOpen(false);
      }
    } finally {
      if (cameraSessionRef.current === currentSession) setCameraStarting(false);
    }
  }, [handleScannedCredential, stopCamera]);

  useEffect(() => () => {
    resolveSessionRef.current += 1;
    stopCamera();
  }, [stopCamera]);

  const configuredGoodsCodes = useMemo(() => {
    const codes = preview?.items.flatMap((item) => [item.barcode, item.skuCode]) ?? [];
    return new Set(codes.filter((value): value is string => Boolean(value)).map((value) => value.trim()));
  }, [preview]);

  const verifyGoodsCode = () => {
    const value = goodsCode.trim();
    if (!value) return;
    if (configuredGoodsCodes.has(value)) {
      setMatchedGoodsCodes((current) => current.includes(value) ? current : [...current, value]);
      message.success('商品条码已与当前订单匹配');
    } else {
      message.warning('该条码不属于当前订单；请重新核对实物');
    }
    setGoodsCode('');
  };

  const verifyPickup = () => {
    const credential = resolvedCredentialRef.current;
    if (!preview || !credential || confirmationOpenRef.current) return;
    confirmationOpenRef.current = true;
    modal.confirm({
      title: '确认平台交付并核销？',
      width: 520,
      content: (
        <Space direction="vertical" size={8}>
          <Typography.Text>核销后订单将变为“已收货”，并触发售后、奖励和数字资产时间点。</Typography.Text>
          <Typography.Text strong>{preview.companies.map((company) => company.name).join('、')}</Typography.Text>
          <Typography.Text>{preview.recipient.name} · {preview.recipient.phoneMasked}</Typography.Text>
          <Typography.Text type="secondary">
            {preview.items.map((item) => `${item.title}${item.skuTitle ? `（${item.skuTitle}）` : ''} × ${item.quantity}`).join('；')}
          </Typography.Text>
        </Space>
      ),
      okText: '确认核销',
      okButtonProps: { danger: true },
      cancelText: '返回核对',
      afterClose: () => {
        confirmationOpenRef.current = false;
      },
      onOk: async () => {
        setVerifying(true);
        try {
          const result = await verifyPickupCredential(credential);
          message.success(result.alreadyPickedUp ? '该订单此前已核销' : '核销成功，订单已更新为已收货');
          resetStation();
        } catch (error: unknown) {
          message.error(getAdminErrorMessage(error, '核销失败，请重新识别凭证并查询订单状态'));
          throw error;
        } finally {
          setVerifying(false);
        }
      },
    });
  };

  const inputPlaceholder = mode === 'code'
    ? '请输入买家出示的 8 位数字取货码'
    : '请用二维扫码枪扫描，或粘贴二维码完整内容';

  return (
    <div style={{ maxWidth: 1180, margin: '0 auto', paddingBottom: 36 }}>
      <Space direction="vertical" size={6} style={{ marginBottom: 20 }}>
        <Space wrap>
          <Typography.Title level={2} style={{ margin: 0 }}>平台到店核销台</Typography.Title>
          <Tag color="blue">跨企业履约</Tag>
        </Space>
        <Typography.Text type="secondary">用买家取货凭证自动定位订单，先核对企业和商品，再显式确认交付。</Typography.Text>
      </Space>

      <Alert
        type="warning"
        showIcon
        message="平台核销权限可处理平台中心仓和企业自提点订单"
        description="每次扫码只识别订单，不会直接改变状态。核销不可逆，必须由具备平台自提履约权限的管理员当面复核。"
        style={{ marginBottom: 18 }}
      />

      <Card style={{ borderColor: '#91caff', boxShadow: '0 14px 36px rgba(22,119,255,.08)' }}>
        <Steps
          size="small"
          current={preview ? 1 : 0}
          items={[
            { title: '识别买家凭证', icon: <QrcodeOutlined /> },
            { title: '核对企业与商品', icon: <FileSearchOutlined /> },
            { title: '确认交付', icon: <CheckCircleFilled /> },
          ]}
        />
        <Divider />
        <Segmented<StationMode>
          block
          options={stationModes}
          value={mode}
          onChange={(nextMode) => {
            stopCamera();
            clearResolvedOrder();
            setMode(nextMode);
            setCameraError(null);
          }}
        />

        <div style={{ marginTop: 20 }}>
          {mode === 'camera' ? (
            <Space direction="vertical" size={14} style={{ width: '100%' }}>
              <Alert
                type="info"
                showIcon
                message="摄像头只读取买家的取货二维码"
                description="首次使用请允许浏览器访问摄像头。平台仓高频作业建议使用 USB/蓝牙二维扫码枪。"
              />
              <div style={{ overflow: 'hidden', maxWidth: 720, borderRadius: 12, background: '#071a2b', border: '1px solid #1d4d73' }}>
                <video ref={videoRef} muted playsInline style={{ display: cameraOpen ? 'block' : 'none', width: '100%', minHeight: 300, objectFit: 'cover' }} />
                {!cameraOpen ? (
                  <div style={{ minHeight: 300, display: 'grid', placeItems: 'center', color: '#d6e4ff' }}>
                    <Space direction="vertical" align="center">
                      <CameraOutlined style={{ fontSize: 34 }} />
                      <span>摄像头待开启</span>
                    </Space>
                  </div>
                ) : null}
              </div>
              {cameraError ? <Alert type="warning" showIcon message={cameraError} /> : null}
              <Space wrap>
                <Button type="primary" icon={<CameraOutlined />} onClick={() => void startCamera()} loading={cameraStarting} disabled={cameraOpen}>打开摄像头扫码</Button>
                <Button icon={<StopOutlined />} onClick={stopCamera} disabled={!cameraOpen}>停止摄像头</Button>
              </Space>
            </Space>
          ) : (
            <Space direction="vertical" size={12} style={{ width: '100%' }}>
              <Alert
                type="info"
                showIcon
                message={mode === 'code' ? '人工短码兜底' : '支持 USB/蓝牙二维扫码枪'}
                description={mode === 'code'
                  ? '请让买家出示取货凭证页下方的 8 位数字。'
                  : '将光标留在输入框，扫码枪会像键盘一样写入完整凭证；也可手动粘贴。'}
              />
              <Input.Search
                size="large"
                maxLength={mode === 'code' ? 8 : 1000}
                value={credentialInput}
                onChange={(event) => setCredentialInput(event.target.value)}
                onSearch={() => void resolveCredential(credentialInput, mode)}
                enterButton={resolving ? '识别中…' : '识别订单'}
                loading={resolving}
                prefix={mode === 'code' ? <SafetyCertificateOutlined /> : <ScanOutlined />}
                placeholder={inputPlaceholder}
                inputMode={mode === 'code' ? 'numeric' : 'text'}
                aria-label="平台取货凭证输入"
              />
            </Space>
          )}
        </div>
      </Card>

      {preview ? (
        <Card
          title="交付前复核"
          style={{ marginTop: 18 }}
          extra={<Space wrap>
            <Tag color={preview.pickupPoint.isPlatformHub ? 'blue' : 'green'}>{preview.pickupPoint.isPlatformHub ? '平台中心仓' : '企业自提点'}</Tag>
            <Tag color={preview.alreadyPickedUp ? 'default' : 'processing'}>{preview.alreadyPickedUp ? '已核销' : '待确认交付'}</Tag>
          </Space>}
        >
          {preview.alreadyPickedUp ? (
            <Alert type="info" showIcon message="该凭证已核销" description="本次不会重复改变订单状态。" style={{ marginBottom: 16 }} />
          ) : null}
          <Row gutter={[24, 18]}>
            <Col xs={24} lg={10}>
              <Descriptions column={1} bordered size="small">
                <Descriptions.Item label="订单号">
                  <Space wrap>
                    <Typography.Text copyable>{orderMeta?.orderNo || preview.orderId}</Typography.Text>
                    {canReadOrders ? <Button type="link" size="small" onClick={() => navigate(`/orders/${preview.orderId}`)}>查看订单</Button> : null}
                  </Space>
                </Descriptions.Item>
                <Descriptions.Item label="所属企业">{preview.companies.map((company) => company.name).join('、')}</Descriptions.Item>
                <Descriptions.Item label="自提人">{preview.recipient.name} · {preview.recipient.phoneMasked}</Descriptions.Item>
                <Descriptions.Item label="自提点">{preview.pickupPoint.name}</Descriptions.Item>
                <Descriptions.Item label="地址">{pickupFullAddress(preview.pickupPoint)}</Descriptions.Item>
              </Descriptions>
            </Col>
            <Col xs={24} lg={14}>
              <Typography.Text strong>订单商品</Typography.Text>
              <List
                size="small"
                dataSource={preview.items}
                renderItem={(item) => (
                  <List.Item>
                    <Space direction="vertical" size={0}>
                      <Typography.Text>{item.title}{item.skuTitle ? ` · ${item.skuTitle}` : ''} × {item.quantity}</Typography.Text>
                      {item.barcode || item.skuCode
                        ? <Typography.Text type="secondary" style={{ fontSize: 12 }}>商品条码：{item.barcode ?? item.skuCode}</Typography.Text>
                        : <Typography.Text type="secondary" style={{ fontSize: 12 }}>未配置商品条码，请人工核对名称、规格和数量</Typography.Text>}
                    </Space>
                  </List.Item>
                )}
              />
              <div style={{ marginTop: 10 }}>
                <Typography.Text strong>商品/SKU 条码复核（可选）</Typography.Text>
                <Input.Search
                  style={{ marginTop: 8 }}
                  value={goodsCode}
                  onChange={(event) => setGoodsCode(event.target.value)}
                  onSearch={verifyGoodsCode}
                  enterButton="核对商品"
                  placeholder="用扫码枪扫描商品/SKU 条码"
                />
                {matchedGoodsCodes.length > 0 ? <Typography.Text type="success" style={{ display: 'block', marginTop: 8 }}>已匹配 {matchedGoodsCodes.length} 个商品条码；仍请核对实际数量。</Typography.Text> : null}
              </div>
            </Col>
          </Row>
          <Divider />
          <Space wrap>
            <Button onClick={resetStation}>取消并重新扫描</Button>
            <Button type="primary" danger icon={<CheckCircleFilled />} loading={verifying} disabled={preview.alreadyPickedUp} onClick={verifyPickup}>确认交付并核销</Button>
          </Space>
        </Card>
      ) : null}

      <Alert
        style={{ marginTop: 18 }}
        type="info"
        showIcon
        message="买家凭证与商品条码的职责不同"
        description="买家二维码或 8 位取货码用于定位和核销订单；商品/SKU 条码只用于确认拿对实物，不能单独完成核销。"
      />
    </div>
  );
}
