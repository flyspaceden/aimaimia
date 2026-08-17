import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
  QrcodeOutlined,
  SafetyCertificateOutlined,
  ScanOutlined,
  StopOutlined,
} from '@ant-design/icons';
import {
  resolvePickupCredential,
  verifyPickupCredential,
  type PickupCredentialPreview,
  type VerifyPickupPayload,
} from '@/api/orders';

type StationMode = 'scanner' | 'camera' | 'code';

const stationModes: Array<{ label: string; value: StationMode }> = [
  { label: '扫码枪 / 读码器', value: 'scanner' },
  { label: '电脑摄像头', value: 'camera' },
  { label: '输入 8 位取货码', value: 'code' },
];

function toCredential(mode: StationMode, raw: string): VerifyPickupPayload | null {
  const value = raw.trim();
  if (!value) return null;
  return mode === 'code' ? { pickupCode: value } : { qrPayload: value };
}

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error && error.message ? error.message : fallback;
}

/**
 * 卖家现场核销台。
 *
 * 买家凭证必须先解析、显示最小订单摘要，再由员工明确确认。商品/SKU 条码只做
 * “拿对货”的第二道核对，绝不可以替代一次性取货凭证来改变订单状态。
 */
export default function PickupVerificationPage() {
  const { message, modal } = App.useApp();
  const [mode, setMode] = useState<StationMode>('scanner');
  const [credentialInput, setCredentialInput] = useState('');
  const [preview, setPreview] = useState<PickupCredentialPreview | null>(null);
  const [resolving, setResolving] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [cameraStarting, setCameraStarting] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [goodsCode, setGoodsCode] = useState('');
  const [matchedGoodsCodes, setMatchedGoodsCodes] = useState<string[]>([]);
  const videoRef = useRef<HTMLVideoElement>(null);
  const scannerRef = useRef<BrowserQRCodeReader | null>(null);
  const scannerControlsRef = useRef<IScannerControls | null>(null);
  const cameraSessionRef = useRef(0);
  const resolvingRef = useRef(false);

  const stopCamera = useCallback(() => {
    cameraSessionRef.current += 1;
    scannerControlsRef.current?.stop();
    scannerControlsRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    setCameraOpen(false);
  }, []);

  const resetStation = useCallback(() => {
    stopCamera();
    setCredentialInput('');
    setPreview(null);
    setGoodsCode('');
    setMatchedGoodsCodes([]);
    setCameraError(null);
  }, [stopCamera]);

  const resolveCredential = useCallback(async (raw: string, inputMode: StationMode) => {
    const credential = toCredential(inputMode, raw);
    if (!credential) {
      message.warning(inputMode === 'code' ? '请输入 8 位取货码' : '请扫描或粘贴买家的取货二维码内容');
      return;
    }
    if (resolvingRef.current) return;
    resolvingRef.current = true;
    setResolving(true);
    setPreview(null);
    setGoodsCode('');
    setMatchedGoodsCodes([]);
    try {
      const data = await resolvePickupCredential(credential);
      setCredentialInput(raw.trim());
      setPreview(data);
      if (data.alreadyPickedUp) {
        message.info('该凭证已经核销过，未重复改变订单状态');
      } else {
        message.success('已识别订单，请核对商品后确认交付');
      }
    } catch (error) {
      message.error(errorMessage(error, '无法识别取货凭证'));
    } finally {
      resolvingRef.current = false;
      setResolving(false);
    }
  }, [message]);

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
      const reader = scannerRef.current ?? new BrowserQRCodeReader();
      scannerRef.current = reader;
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
    } catch (error) {
      if (cameraSessionRef.current === currentSession) {
        setCameraError(errorMessage(error, '无法打开摄像头，请检查浏览器权限'));
        setCameraOpen(false);
      }
    } finally {
      if (cameraSessionRef.current === currentSession) setCameraStarting(false);
    }
  }, [handleScannedCredential, stopCamera]);

  useEffect(() => () => stopCamera(), [stopCamera]);

  const configuredGoodsCodes = useMemo(() => {
    const values = preview?.items.flatMap((item) => [item.barcode, item.skuCode]) ?? [];
    return new Set(values.filter((value): value is string => Boolean(value)).map((value) => value.trim()));
  }, [preview]);

  const verifyGoodsCode = () => {
    const value = goodsCode.trim();
    if (!value) return;
    if (configuredGoodsCodes.has(value)) {
      setMatchedGoodsCodes((current) => current.includes(value) ? current : [...current, value]);
      message.success('商品条码已与订单商品匹配');
    } else {
      message.warning('该条码不属于当前订单。请重新核对商品；它不会影响取货凭证状态。');
    }
    setGoodsCode('');
  };

  const verifyPickup = () => {
    const credential = toCredential(mode, credentialInput);
    if (!preview || !credential) return;
    modal.confirm({
      title: '确认交付并核销？',
      width: 480,
      content: (
        <Space direction="vertical" size={8}>
          <Typography.Text>请当面确认取货人和商品后再操作。核销后订单将变为“已收货”，并触发售后与收益计算时间点。</Typography.Text>
          <Typography.Text strong>{preview.recipient.name} · {preview.recipient.phoneMasked}</Typography.Text>
          <Typography.Text type="secondary">{preview.items.map((item) => `${item.title}${item.skuTitle ? `（${item.skuTitle}）` : ''} × ${item.quantity}`).join('；')}</Typography.Text>
        </Space>
      ),
      okText: '确认核销',
      okButtonProps: { danger: true, loading: verifying },
      cancelText: '返回核对',
      onOk: async () => {
        setVerifying(true);
        try {
          const result = await verifyPickupCredential(credential);
          message.success(result.alreadyPickedUp ? '该订单此前已核销，无重复操作' : '核销成功，订单已更新为已收货');
          resetStation();
        } catch (error) {
          message.error(errorMessage(error, '核销失败，请重新查询订单状态'));
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
    <div style={{ maxWidth: 1120, margin: '0 auto', paddingBottom: 32 }}>
      <Space direction="vertical" size={6} style={{ marginBottom: 22 }}>
        <Typography.Title level={2} style={{ margin: 0 }}>到店自提核销台</Typography.Title>
        <Typography.Text type="secondary">先识别凭证，再当面核对商品并确认核销。不会因为一次扫描直接把订单改为已收货。</Typography.Text>
      </Space>

      <Card style={{ borderColor: '#b7dfbd', boxShadow: '0 12px 30px rgba(46,125,50,.08)' }}>
        <Steps
          size="small"
          current={preview ? 1 : 0}
          items={[
            { title: '识别买家取货凭证', icon: <QrcodeOutlined /> },
            { title: '核对人和商品', icon: <SafetyCertificateOutlined /> },
            { title: '确认交付', icon: <CheckCircleFilled /> },
          ]}
        />
        <Divider />
        <Segmented<StationMode>
          block
          options={stationModes}
          value={mode}
          onChange={(value) => {
            stopCamera();
            setMode(value);
            setPreview(null);
            setCredentialInput('');
            setCameraError(null);
          }}
        />

        <div style={{ marginTop: 20 }}>
          {mode === 'camera' ? (
            <Space direction="vertical" size={14} style={{ width: '100%' }}>
              <Alert
                type="info"
                showIcon
                message="摄像头只扫描买家的取货二维码"
                description="首次使用请允许浏览器访问摄像头。若门店使用 USB/蓝牙二维扫码枪，切换到“扫码枪/读码器”会更快。"
              />
              <div style={{ position: 'relative', overflow: 'hidden', maxWidth: 680, borderRadius: 12, background: '#102018' }}>
                <video ref={videoRef} muted playsInline style={{ display: cameraOpen ? 'block' : 'none', width: '100%', minHeight: 260, objectFit: 'cover' }} />
                {!cameraOpen ? <div style={{ minHeight: 260, display: 'grid', placeItems: 'center', color: '#dceade' }}><Space direction="vertical" align="center"><CameraOutlined style={{ fontSize: 30 }} /><span>尚未打开摄像头</span></Space></div> : null}
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
                  ? '请让买家在取货凭证页出示 8 位数字。短码只在本订单的一次取货中有效。'
                  : '将光标停在输入框，扫码枪会像键盘一样输入二维码内容并通常自动回车；也可手动粘贴。'}
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
                aria-label="取货凭证输入"
              />
            </Space>
          )}
        </div>
      </Card>

      {preview ? <Card title="交付前核对" style={{ marginTop: 18 }} extra={<Tag color={preview.alreadyPickedUp ? 'default' : 'processing'}>{preview.alreadyPickedUp ? '已核销' : '待确认交付'}</Tag>}>
        {preview.alreadyPickedUp ? <Alert type="info" showIcon message="该取货凭证已核销过" description="为了避免重复收货，本次不可再次核销。请按订单记录处理后续问题。" style={{ marginBottom: 16 }} /> : null}
        <Row gutter={[24, 18]}>
          <Col xs={24} md={10}>
            <Descriptions column={1} size="small" bordered>
              <Descriptions.Item label="自提人">{preview.recipient.name} · {preview.recipient.phoneMasked}</Descriptions.Item>
              <Descriptions.Item label="自提点">{preview.pickupPoint.name}</Descriptions.Item>
              <Descriptions.Item label="地址">{preview.pickupPoint.regionText} {preview.pickupPoint.detail}</Descriptions.Item>
            </Descriptions>
          </Col>
          <Col xs={24} md={14}>
            <Typography.Text strong>订单商品</Typography.Text>
            <List
              size="small"
              dataSource={preview.items}
              renderItem={(item) => <List.Item>
                <Space direction="vertical" size={0}>
                  <Typography.Text>{item.title}{item.skuTitle ? ` · ${item.skuTitle}` : ''} × {item.quantity}</Typography.Text>
                  {item.barcode || item.skuCode ? <Typography.Text type="secondary" style={{ fontSize: 12 }}>商品条码：{item.barcode ?? item.skuCode}</Typography.Text> : <Typography.Text type="secondary" style={{ fontSize: 12 }}>未配置商品条码，请人工核对名称、规格和数量</Typography.Text>}
                </Space>
              </List.Item>}
            />
            <div style={{ marginTop: 10 }}>
              <Typography.Text strong>商品条码核对（可选，不影响取货凭证）</Typography.Text>
              <Input.Search
                style={{ marginTop: 8 }}
                value={goodsCode}
                onChange={(event) => setGoodsCode(event.target.value)}
                onSearch={verifyGoodsCode}
                enterButton="核对商品"
                placeholder="用扫码枪扫描商品/SKU 条码，或输入 SKU 编码"
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
      </Card> : null}

      <Alert
        style={{ marginTop: 18 }}
        type="warning"
        showIcon
        message="两种码的职责不同"
        description="买家二维码或 8 位取货码用于确认“交给谁”，且只能核销一次；商品/SKU 条码用于确认“拿的是哪件货”。商品条码不能单独完成核销，也不会泄露买家取货凭证。"
      />
    </div>
  );
}
