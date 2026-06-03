import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  App,
  Card,
  Form,
  Input,
  Button,
  Typography,
  Steps,
  Radio,
  Space,
  Spin,
  Alert,
} from 'antd';
import {
  MobileOutlined,
  SafetyOutlined,
  ReloadOutlined,
  LockOutlined,
  BankOutlined,
} from '@ant-design/icons';
import {
  getCaptcha,
  sendForgotPasswordCode,
  listCompaniesForReset,
  resetForgotPassword,
} from '@/api/forgot-password';
import { ApiError } from '@/api/client';

const { Title, Text } = Typography;

/** SVG → data URL（base64 避免 Unicode 问题），与 login 页一致 */
const svgToDataUrl = (svg: string): string => {
  try {
    const base64 = btoa(unescape(encodeURIComponent(svg)));
    return `data:image/svg+xml;base64,${base64}`;
  } catch {
    return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
  }
};

type CompanyItem = {
  staffId: string;
  companyId: string;
  companyName: string;
  role: string;
};

type Step = 0 | 1 | 2 | 3; // 0: 手机号+图形码, 1: 短信码, 2: 选企业, 3: 新密码

export default function ForgotPasswordPage() {
  const { message } = App.useApp();
  const navigate = useNavigate();

  const [step, setStep] = useState<Step>(0);
  const [loading, setLoading] = useState(false);

  // Step 0
  const [step0Form] = Form.useForm<{ phone: string; captchaCode: string }>();
  const [captchaId, setCaptchaId] = useState('');
  const [captchaSvg, setCaptchaSvg] = useState('');
  const [captchaLoading, setCaptchaLoading] = useState(false);

  // Step 1
  const [step1Form] = Form.useForm<{ code: string }>();
  const [countdown, setCountdown] = useState(0);
  const cdRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Step 2
  const [companies, setCompanies] = useState<CompanyItem[]>([]);
  const [selectedStaffId, setSelectedStaffId] = useState<string>('');

  // Step 3
  const [step3Form] = Form.useForm<{ newPassword: string; confirmPassword: string }>();

  // 全流程共享：手机号 + 短信码（用于 step 2 & 3 的 API 调用）
  const [sharedPhone, setSharedPhone] = useState('');
  const [sharedCode, setSharedCode] = useState('');

  const refreshCaptcha = useCallback(async () => {
    setCaptchaLoading(true);
    try {
      const res = await getCaptcha();
      setCaptchaId(res.captchaId);
      setCaptchaSvg(res.svg);
    } catch {
      message.error('图形验证码加载失败，请刷新重试');
    } finally {
      setCaptchaLoading(false);
    }
  }, [message]);

  useEffect(() => {
    void refreshCaptcha();
    return () => {
      if (cdRef.current) clearInterval(cdRef.current);
    };
  }, [refreshCaptcha]);

  const startCountdown = useCallback(() => {
    setCountdown(60);
    cdRef.current = setInterval(() => {
      setCountdown((prev) => {
        if (prev <= 1) {
          if (cdRef.current) clearInterval(cdRef.current);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
  }, []);

  // ---- Step 0 提交：发送短信验证码 ----
  const handleStep0 = useCallback(async () => {
    const values = await step0Form.validateFields();
    setLoading(true);
    try {
      await sendForgotPasswordCode({
        phone: values.phone,
        captchaId,
        captchaCode: values.captchaCode,
      });
      setSharedPhone(values.phone);
      message.success('验证码已发送');
      startCountdown();
      setStep(1);
    } catch (err: unknown) {
      const bc = err instanceof ApiError ? err.businessCode : undefined;
      const msg = err instanceof Error ? err.message : '发送失败';
      message.error(msg);
      // 图形验证码错误时自动刷新新图形码（用户无需手动点刷新）
      if (bc === 'CAPTCHA_INVALID') {
        step0Form.setFieldValue('captchaCode', '');
        void refreshCaptcha();
      }
    } finally {
      setLoading(false);
    }
  }, [step0Form, captchaId, message, refreshCaptcha, startCountdown]);

  // ---- Step 1 提交：以短信码换取企业列表 ----
  const handleStep1 = useCallback(async () => {
    const values = await step1Form.validateFields();
    setLoading(true);
    try {
      const res = await listCompaniesForReset({ phone: sharedPhone, code: values.code });
      setSharedCode(values.code);
      setCompanies(res.companies || []);
      // 关键：每次刷新企业列表时清空旧的 selectedStaffId，避免用户之前选过的（可能已从列表中消失）
      // 的 staffId 被带到 reset 请求里触发 STAFF_NOT_FOUND
      setSelectedStaffId('');
      if (!res.companies || res.companies.length === 0) {
        message.warning('没有可重置密码的企业账号');
        return;
      }
      // 只有 1 家：默认选中，但仍让用户点"下一步"确认
      if (res.companies.length === 1) {
        setSelectedStaffId(res.companies[0].staffId);
      }
      setStep(2);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : '验证码错误';
      message.error(msg);
    } finally {
      setLoading(false);
    }
  }, [step1Form, sharedPhone, message]);

  // ---- Step 1 重新发送（倒计时结束后） ----
  const handleResendCode = useCallback(async () => {
    // 回到 step 0 重新走图形码（防短信炸弹）
    setStep(0);
    step1Form.setFieldValue('code', '');
    step0Form.setFieldValue('captchaCode', '');
    // 彻底清空后续步骤的脏数据，防止旧 staffId / 旧列表带入新流程
    setCompanies([]);
    setSelectedStaffId('');
    setSharedCode('');
    await refreshCaptcha();
  }, [step0Form, step1Form, refreshCaptcha]);

  // ---- Step 2 提交：确认选中的企业 ----
  const handleStep2 = useCallback(() => {
    if (!selectedStaffId) {
      message.warning('请选择要重置密码的企业');
      return;
    }
    // 越界防御：所选 staffId 必须存在于当前企业列表中（防止旧选择残留）
    if (!companies.some((c) => c.staffId === selectedStaffId)) {
      message.error('所选企业已失效，请重新选择');
      setSelectedStaffId('');
      return;
    }
    setStep(3);
  }, [selectedStaffId, companies, message]);

  // ---- Step 3 提交：设置新密码 ----
  const handleStep3 = useCallback(async () => {
    const values = await step3Form.validateFields();
    if (values.newPassword !== values.confirmPassword) {
      message.error('两次输入的密码不一致');
      return;
    }
    setLoading(true);
    try {
      const res = await resetForgotPassword({
        phone: sharedPhone,
        code: sharedCode,
        staffId: selectedStaffId,
        newPassword: values.newPassword,
      });
      message.success(`密码已重置，企业【${res.companyName}】可用新密码登录`);
      navigate('/login');
    } catch (err: unknown) {
      const bc = err instanceof ApiError ? err.businessCode : undefined;
      const msg = err instanceof Error ? err.message : '重置失败';
      message.error(msg);
      // 所选企业/员工突然不可用（状态变更） → 回到选企业步骤重选
      if (bc === 'STAFF_NOT_FOUND' || bc === 'STAFF_PHONE_MISMATCH') setStep(2);
      // 验证码问题：回到短信验证步骤重输
      if (bc === 'OTP_INVALID' || bc === 'OTP_EXPIRED' || bc === 'OTP_USED') setStep(1);
    } finally {
      setLoading(false);
    }
  }, [step3Form, sharedPhone, sharedCode, selectedStaffId, navigate, message]);

  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'linear-gradient(135deg, #f0f2f5 0%, #d9e8ff 100%)',
        padding: 20,
      }}
    >
      <Card style={{ width: 460, maxWidth: '100%', boxShadow: '0 4px 24px rgba(0,0,0,0.08)' }}>
        <div style={{ textAlign: 'center', marginBottom: 24 }}>
          <Title level={3} style={{ marginBottom: 4 }}>找回密码</Title>
          <Text type="secondary">通过手机号验证重置您的卖家账号密码</Text>
        </div>

        <Steps
          current={step}
          size="small"
          style={{ marginBottom: 24 }}
          items={[
            { title: '手机验证' },
            { title: '短信码' },
            { title: '选企业' },
            { title: '新密码' },
          ]}
        />

        {/* Step 0：手机号 + 图形验证码 */}
        {step === 0 && (
          <Form form={step0Form} layout="vertical" onFinish={handleStep0}>
            <Form.Item
              label="手机号"
              name="phone"
              rules={[
                { required: true, message: '请输入手机号' },
                { pattern: /^1[3-9]\d{9}$/, message: '手机号格式不正确' },
              ]}
            >
              <Input prefix={<MobileOutlined />} placeholder="请输入 11 位手机号" maxLength={11} />
            </Form.Item>

            <Form.Item
              label="图形验证码"
              name="captchaCode"
              rules={[
                { required: true, message: '请输入图形验证码' },
                { min: 4, max: 6, message: '验证码长度 4-6 位' },
              ]}
            >
              <Space.Compact style={{ width: '100%' }}>
                <Input prefix={<SafetyOutlined />} placeholder="点击右侧图片刷新" autoComplete="off" />
                <div
                  onClick={() => !captchaLoading && void refreshCaptcha()}
                  title="点击刷新验证码"
                  style={{
                    height: 40,
                    minWidth: 120,
                    border: '1px solid #d9d9d9',
                    borderLeft: 'none',
                    borderRadius: '0 6px 6px 0',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    background: '#fafafa',
                    cursor: captchaLoading ? 'wait' : 'pointer',
                    overflow: 'hidden',
                  }}
                >
                  {captchaSvg ? (
                    <img
                      src={svgToDataUrl(captchaSvg)}
                      alt="captcha"
                      style={{ height: '100%', width: '100%', objectFit: 'contain' }}
                    />
                  ) : (
                    <ReloadOutlined spin={captchaLoading} />
                  )}
                </div>
              </Space.Compact>
            </Form.Item>

            <Button type="primary" htmlType="submit" block loading={loading} size="large">
              下一步
            </Button>
          </Form>
        )}

        {/* Step 1：短信验证码 */}
        {step === 1 && (
          <Form form={step1Form} layout="vertical" onFinish={handleStep1}>
            <Alert
              type="info"
              showIcon
              message={`短信已发送至 ${sharedPhone.slice(0, 3)}****${sharedPhone.slice(-4)}`}
              style={{ marginBottom: 16 }}
            />
            <Form.Item
              label="短信验证码"
              name="code"
              rules={[
                { required: true, message: '请输入短信验证码' },
                { len: 6, message: '验证码为 6 位数字' },
              ]}
            >
              <Input placeholder="请输入 6 位短信验证码" maxLength={6} />
            </Form.Item>
            <Space style={{ width: '100%', justifyContent: 'space-between', marginBottom: 16 }}>
              <Button type="link" onClick={() => setStep(0)} style={{ padding: 0 }}>
                ← 上一步
              </Button>
              <Button
                type="link"
                onClick={handleResendCode}
                disabled={countdown > 0}
                style={{ padding: 0 }}
              >
                {countdown > 0 ? `${countdown}s 后重发` : '重新发送'}
              </Button>
            </Space>
            <Button type="primary" htmlType="submit" block loading={loading} size="large">
              下一步
            </Button>
          </Form>
        )}

        {/* Step 2：选择企业 */}
        {step === 2 && (
          <>
            <Alert
              type="warning"
              showIcon
              message="请选择要重置密码的企业账号"
              description="本次重置仅影响所选企业的密码，不会影响您在其他企业的 staff 密码"
              style={{ marginBottom: 16 }}
            />
            <Radio.Group
              value={selectedStaffId}
              onChange={(e) => setSelectedStaffId(e.target.value)}
              style={{ width: '100%' }}
            >
              <Space direction="vertical" style={{ width: '100%' }}>
                {companies.map((c) => (
                  <Radio
                    key={c.staffId}
                    value={c.staffId}
                    style={{
                      padding: 12,
                      border: '1px solid #f0f0f0',
                      borderRadius: 6,
                      width: '100%',
                      margin: 0,
                      background: selectedStaffId === c.staffId ? '#e6f4ff' : '#fff',
                    }}
                  >
                    <Space>
                      <BankOutlined style={{ color: '#1677ff' }} />
                      <span style={{ fontWeight: 500 }}>{c.companyName}</span>
                      <Text type="secondary" style={{ fontSize: 12 }}>{c.role}</Text>
                    </Space>
                  </Radio>
                ))}
              </Space>
            </Radio.Group>
            <Space style={{ width: '100%', justifyContent: 'space-between', marginTop: 16 }}>
              <Button type="link" onClick={() => setStep(1)} style={{ padding: 0 }}>
                ← 上一步
              </Button>
            </Space>
            <Button
              type="primary"
              block
              size="large"
              disabled={!selectedStaffId || !companies.some((c) => c.staffId === selectedStaffId)}
              onClick={handleStep2}
              style={{ marginTop: 8 }}
            >
              下一步
            </Button>
          </>
        )}

        {/* Step 3：新密码 */}
        {step === 3 && (
          <Form form={step3Form} layout="vertical" onFinish={handleStep3}>
            <Alert
              type="info"
              showIcon
              message={`即将为【${companies.find(c => c.staffId === selectedStaffId)?.companyName}】重置密码`}
              style={{ marginBottom: 16 }}
            />
            <Form.Item
              label="新密码"
              name="newPassword"
              rules={[
                { required: true, message: '请输入新密码' },
                { min: 6, message: '密码至少 6 位' },
                {
                  pattern: /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).{6,}$/,
                  message: '需包含大写、小写字母和数字',
                },
              ]}
            >
              <Input.Password prefix={<LockOutlined />} placeholder="至少 6 位，含大小写字母和数字" />
            </Form.Item>
            <Form.Item
              label="确认密码"
              name="confirmPassword"
              dependencies={['newPassword']}
              rules={[
                { required: true, message: '请再次输入新密码' },
                ({ getFieldValue }) => ({
                  validator(_, value) {
                    if (!value || getFieldValue('newPassword') === value) return Promise.resolve();
                    return Promise.reject(new Error('两次输入的密码不一致'));
                  },
                }),
              ]}
            >
              <Input.Password prefix={<LockOutlined />} placeholder="再次输入新密码" />
            </Form.Item>
            <Space style={{ width: '100%', justifyContent: 'space-between', marginBottom: 16 }}>
              <Button type="link" onClick={() => setStep(2)} style={{ padding: 0 }}>
                ← 上一步
              </Button>
            </Space>
            <Button type="primary" htmlType="submit" block loading={loading} size="large">
              重置密码
            </Button>
          </Form>
        )}

        <div style={{ textAlign: 'center', marginTop: 20, paddingTop: 16, borderTop: '1px solid #f0f0f0' }}>
          <Button type="link" onClick={() => navigate('/login')}>← 返回登录</Button>
        </div>

        {loading && step !== 0 && (
          <div style={{ position: 'absolute', inset: 0, background: 'rgba(255,255,255,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 10 }}>
            <Spin size="large" />
          </div>
        )}
      </Card>
    </div>
  );
}
