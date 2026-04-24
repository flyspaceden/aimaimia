import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  App,
  Card,
  Form,
  Input,
  Button,
  Typography,
  Tag,
  Tabs,
  Space,
} from 'antd';
import {
  UserOutlined,
  LockOutlined,
  SafetyOutlined,
  MobileOutlined,
  MessageOutlined,
  ReloadOutlined,
} from '@ant-design/icons';
import axios from 'axios';
import {
  login,
  loginByPhoneCode,
  getProfile,
  getCaptcha,
  sendSmsCode,
} from '@/api/auth';
import useAuthStore from '@/store/useAuthStore';

const { Title, Text } = Typography;

interface PasswordLoginForm {
  username: string;
  password: string;
  captchaCode: string;
}

interface PhoneLoginForm {
  phone: string;
  code: string;
}

// 环境标识：根据 VITE_APP_ENV 或 Vite 内置 MODE 判断
const appEnv = import.meta.env.VITE_APP_ENV || import.meta.env.MODE;
const isProduction = appEnv === 'production';

/**
 * 将登录/获取权限过程中的异常转为用户友好的错误提示
 */
const getLoginErrorMessage = (err: unknown): string => {
  if (axios.isAxiosError(err)) {
    const status = err.response?.status;
    const serverMsg =
      err.response?.data?.error ||
      err.response?.data?.message ||
      (typeof err.response?.data === 'string' ? err.response.data : '');

    switch (status) {
      case 400:
        return serverMsg || '请求参数错误';
      case 401:
        return serverMsg || '用户名或密码错误，请检查后重试';
      case 403:
        return serverMsg || '该账号已被禁用或无管理后台权限';
      case 429:
        return '登录请求过于频繁，请稍后再试';
      case 500:
      case 502:
      case 503:
        return '服务器暂时不可用，请稍后再试';
      default:
        if (!err.response) {
          return '网络连接失败，请检查网络设置';
        }
        return serverMsg || '登录失败，请稍后重试';
    }
  }

  if (err instanceof Error && err.message) {
    return err.message;
  }

  return '登录失败，请稍后重试';
};

/** 将 SVG 字符串转为可直接用于 <img> 的 data URL（base64 编码，规避中文等 Unicode 字符） */
const svgToDataUrl = (svg: string): string => {
  try {
    // unescape(encodeURIComponent) 处理 UTF-8 后再 btoa
    const base64 = btoa(unescape(encodeURIComponent(svg)));
    return `data:image/svg+xml;base64,${base64}`;
  } catch {
    return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
  }
};

export default function LoginPage() {
  const { message } = App.useApp();
  const navigate = useNavigate();
  const setAuth = useAuthStore((s) => s.setAuth);
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<'password' | 'phone'>('password');

  // 图形验证码状态
  const [captchaId, setCaptchaId] = useState('');
  const [captchaSvg, setCaptchaSvg] = useState('');
  const [captchaLoading, setCaptchaLoading] = useState(false);

  // 短信验证码倒计时
  const [smsCountdown, setSmsCountdown] = useState(0);
  const [smsSending, setSmsSending] = useState(false);
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const [passwordForm] = Form.useForm<PasswordLoginForm>();
  const [phoneForm] = Form.useForm<PhoneLoginForm>();

  /** 刷新图形验证码 */
  const refreshCaptcha = useCallback(async () => {
    setCaptchaLoading(true);
    try {
      const res = await getCaptcha();
      setCaptchaId(res.captchaId);
      setCaptchaSvg(res.svg);
    } catch (err) {
      message.error('验证码加载失败，请刷新重试');
    } finally {
      setCaptchaLoading(false);
    }
  }, []);

  // 初始化/切换 tab 时拉取验证码（账号登录 + 手机登录都需要）
  useEffect(() => {
    if (!captchaSvg) {
      void refreshCaptcha();
    }
  }, [activeTab, captchaSvg, refreshCaptcha]);

  // 清理倒计时
  useEffect(() => {
    return () => {
      if (countdownRef.current) clearInterval(countdownRef.current);
    };
  }, []);

  const startCountdown = () => {
    setSmsCountdown(60);
    if (countdownRef.current) clearInterval(countdownRef.current);
    countdownRef.current = setInterval(() => {
      setSmsCountdown((prev) => {
        if (prev <= 1) {
          if (countdownRef.current) {
            clearInterval(countdownRef.current);
            countdownRef.current = null;
          }
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
  };

  /** 处理账号密码 + 验证码登录 */
  const handlePasswordLogin = async (values: PasswordLoginForm) => {
    if (!captchaId) {
      message.error('请先获取图形验证码');
      return;
    }
    setLoading(true);
    try {
      const result = await login({
        username: values.username,
        password: values.password,
        captchaId,
        captchaCode: values.captchaCode,
      });
      localStorage.setItem('admin_token', result.accessToken);
      const profile = await getProfile();
      setAuth(result.accessToken, result.refreshToken, profile);
      message.success('登录成功');
      navigate('/', { replace: true });
    } catch (err) {
      localStorage.removeItem('admin_token');
      message.error(getLoginErrorMessage(err));
      // 登录失败时刷新验证码（每个 captcha 只能使用一次）
      void refreshCaptcha();
      passwordForm.setFieldValue('captchaCode', '');
    } finally {
      setLoading(false);
    }
  };

  /** 发送短信验证码（方案 A：只需手机号，后端速率限制保护） */
  const handleSendSms = async () => {
    try {
      const values = await phoneForm.validateFields(['phone']);
      setSmsSending(true);
      await sendSmsCode(values.phone);
      message.success('验证码已发送');
      startCountdown();
    } catch (err: any) {
      if (err?.errorFields) {
        // 表单校验错误：显式 toast 提示（仅靠字段下方小红字容易被忽略）
        const firstMsg = err.errorFields?.[0]?.errors?.[0] || '请填写完整信息';
        message.warning(firstMsg);
        return;
      }
      message.error(getLoginErrorMessage(err));
    } finally {
      setSmsSending(false);
    }
  };

  /** 处理手机号 + 短信验证码登录 */
  const handlePhoneLogin = async (values: PhoneLoginForm) => {
    setLoading(true);
    try {
      const result = await loginByPhoneCode({
        phone: values.phone,
        code: values.code,
      });
      localStorage.setItem('admin_token', result.accessToken);
      const profile = await getProfile();
      setAuth(result.accessToken, result.refreshToken, profile);
      message.success('登录成功');
      navigate('/', { replace: true });
    } catch (err) {
      localStorage.removeItem('admin_token');
      message.error(getLoginErrorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background:
          'linear-gradient(135deg, #e8eaf6 0%, #c5cae9 50%, #9fa8da 100%)',
      }}
    >
      <Card
        style={{
          width: 420,
          boxShadow: '0 8px 24px rgba(0,0,0,0.12)',
          borderRadius: 12,
        }}
        styles={{ body: { padding: 32 } }}
      >
        <div style={{ textAlign: 'center', marginBottom: 24 }}>
          <div style={{ marginBottom: 8 }}>
            <Tag color={isProduction ? 'green' : 'orange'}>
              {isProduction ? '正式环境' : '测试环境'}
            </Tag>
          </div>
          <Title level={3} style={{ marginBottom: 4, color: '#1E40AF' }}>
            爱买买管理后台
          </Title>
          <Text type="secondary">AI 赋能农业电商平台</Text>
        </div>

        <Tabs
          activeKey={activeTab}
          onChange={(k) => setActiveTab(k as 'password' | 'phone')}
          centered
          items={[
            {
              key: 'password',
              label: '账号登录',
              children: (
                <Form<PasswordLoginForm>
                  form={passwordForm}
                  onFinish={handlePasswordLogin}
                  size="large"
                  autoComplete="off"
                >
                  <Form.Item
                    name="username"
                    rules={[{ required: true, message: '请输入用户名' }]}
                  >
                    <Input prefix={<UserOutlined />} placeholder="用户名" />
                  </Form.Item>

                  <Form.Item
                    name="password"
                    rules={[
                      { required: true, message: '请输入密码' },
                      { min: 6, message: '密码至少 6 位' },
                    ]}
                  >
                    <Input.Password
                      prefix={<LockOutlined />}
                      placeholder="密码"
                    />
                  </Form.Item>

                  <Form.Item>
                    <Space.Compact style={{ width: '100%' }}>
                      <Form.Item
                        name="captchaCode"
                        noStyle
                        rules={[
                          { required: true, message: '请输入图形验证码' },
                          { min: 4, max: 6, message: '验证码长度 4-6 位' },
                        ]}
                      >
                        <Input
                          prefix={<SafetyOutlined />}
                          placeholder="图形验证码"
                          autoComplete="off"
                        />
                      </Form.Item>
                      <div
                        onClick={() => !captchaLoading && refreshCaptcha()}
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
                            style={{
                              height: '100%',
                              width: '100%',
                              objectFit: 'contain',
                            }}
                          />
                        ) : (
                          <ReloadOutlined spin={captchaLoading} />
                        )}
                      </div>
                    </Space.Compact>
                  </Form.Item>

                  <Form.Item style={{ marginBottom: 0 }}>
                    <Button
                      type="primary"
                      htmlType="submit"
                      loading={loading}
                      block
                      style={{ height: 44, borderRadius: 8 }}
                    >
                      登录
                    </Button>
                  </Form.Item>
                </Form>
              ),
            },
            {
              key: 'phone',
              label: '手机登录',
              children: (
                <Form<PhoneLoginForm>
                  form={phoneForm}
                  onFinish={handlePhoneLogin}
                  size="large"
                  autoComplete="off"
                >
                  <Form.Item
                    name="phone"
                    rules={[
                      { required: true, message: '请输入手机号' },
                      {
                        pattern: /^1\d{10}$/,
                        message: '请输入正确的 11 位手机号',
                      },
                    ]}
                  >
                    <Input
                      prefix={<MobileOutlined />}
                      placeholder="手机号"
                      maxLength={11}
                    />
                  </Form.Item>

                  <Form.Item
                    name="code"
                    rules={[
                      { required: true, message: '请输入验证码' },
                      { min: 4, max: 6, message: '验证码长度 4-6 位' },
                    ]}
                  >
                    <Space.Compact style={{ width: '100%' }}>
                      <Input
                        prefix={<MessageOutlined />}
                        placeholder="短信验证码"
                        autoComplete="off"
                      />
                      <Button
                        style={{ minWidth: 120 }}
                        onClick={handleSendSms}
                        loading={smsSending}
                        disabled={smsCountdown > 0}
                      >
                        {smsCountdown > 0
                          ? `${smsCountdown}s 后重试`
                          : '获取验证码'}
                      </Button>
                    </Space.Compact>
                  </Form.Item>

                  <Form.Item style={{ marginBottom: 0 }}>
                    <Button
                      type="primary"
                      htmlType="submit"
                      loading={loading}
                      block
                      style={{ height: 44, borderRadius: 8 }}
                    >
                      登录
                    </Button>
                  </Form.Item>

                  <div
                    style={{
                      textAlign: 'center',
                      color: '#999',
                      fontSize: 12,
                      marginTop: 12,
                    }}
                  >
                    忘记密码请联系超级管理员重置
                  </div>
                </Form>
              ),
            },
          ]}
        />
      </Card>
      <div style={{ position: 'absolute', bottom: 16, left: 0, right: 0, textAlign: 'center', color: '#666', fontSize: 12, lineHeight: 1.8 }}>
        <div>&copy; 2026 深圳华海农业科技集团有限公司</div>
        <div>
          <a
            href="https://beian.miit.gov.cn/"
            target="_blank"
            rel="noopener noreferrer"
            style={{ color: '#666' }}
          >
            粤ICP备2023047684号-5
          </a>
        </div>
      </div>
    </div>
  );
}
