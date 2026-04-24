import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { App, Card, Form, Input, Button, Typography, Space, List, Tag, Alert, Tabs } from 'antd';
import { MobileOutlined, SafetyCertificateOutlined, ShopOutlined, ClockCircleOutlined, LockOutlined, SafetyOutlined, ReloadOutlined } from '@ant-design/icons';
import { sendSmsCode, login, loginByPassword, selectCompany, getMe, getCaptcha } from '@/api/auth';
import useAuthStore from '@/store/useAuthStore';
import { queryClient } from '@/queryClient';
import type { LoginResponse, SelectCompanyResponse } from '@/types';

const { Title, Text } = Typography;

/** 将 SVG 字符串转为可直接用于 <img> 的 data URL（base64 编码，规避中文等 Unicode 字符） */
const svgToDataUrl = (svg: string): string => {
  try {
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
  const [codeSending, setCodeSending] = useState(false);
  const [countdown, setCountdown] = useState(0);

  // 图形验证码状态
  const [captchaId, setCaptchaId] = useState('');
  const [captchaSvg, setCaptchaSvg] = useState('');
  const [captchaLoading, setCaptchaLoading] = useState(false);

  const refreshCaptcha = useCallback(async () => {
    setCaptchaLoading(true);
    try {
      const res = await getCaptcha();
      setCaptchaId(res.captchaId);
      setCaptchaSvg(res.svg);
    } catch {
      message.error('验证码加载失败，请刷新重试');
    } finally {
      setCaptchaLoading(false);
    }
  }, []);

  // 首次加载
  useEffect(() => {
    void refreshCaptcha();
  }, [refreshCaptcha]);

  // 多企业选择状态
  const [selectMode, setSelectMode] = useState(false);
  const [tempToken, setTempToken] = useState('');
  const [companies, setCompanies] = useState<SelectCompanyResponse['companies']>([]);

  // M15修复：临时凭证倒计时（5分钟 = 300秒）
  const TEMP_TOKEN_TTL = 300;
  const [tempTokenCountdown, setTempTokenCountdown] = useState(0);
  const [tempTokenExpired, setTempTokenExpired] = useState(false);
  const tempTokenTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // 清理倒计时定时器
  const clearTempTokenTimer = useCallback(() => {
    if (tempTokenTimerRef.current) {
      clearInterval(tempTokenTimerRef.current);
      tempTokenTimerRef.current = null;
    }
  }, []);

  // 启动临时凭证倒计时
  const startTempTokenCountdown = useCallback(() => {
    clearTempTokenTimer();
    setTempTokenExpired(false);
    setTempTokenCountdown(TEMP_TOKEN_TTL);

    tempTokenTimerRef.current = setInterval(() => {
      setTempTokenCountdown((prev) => {
        if (prev <= 1) {
          clearTempTokenTimer();
          setTempTokenExpired(true);
          message.warning('临时凭证已超时，请重新登录');
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
  }, [clearTempTokenTimer]);

  // 组件卸载时清理定时器
  useEffect(() => {
    return () => clearTempTokenTimer();
  }, [clearTempTokenTimer]);

  // 发送验证码（方案 A：只需手机号，后端速率限制保护）
  const handleSendCode = async () => {
    const phone = form.getFieldValue('phone');
    if (!phone || !/^1\d{10}$/.test(phone)) {
      message.warning('请输入正确的手机号');
      return;
    }
    setCodeSending(true);
    try {
      await sendSmsCode(phone);
      message.success('验证码已发送（开发模式请查看后端控制台）');
      setCountdown(60);
      const timer = setInterval(() => {
        setCountdown((prev) => {
          if (prev <= 1) { clearInterval(timer); return 0; }
          return prev - 1;
        });
      }, 1000);
    } catch (err) {
      message.error(err instanceof Error ? err.message : '发送失败');
    } finally {
      setCodeSending(false);
    }
  };

  // 登录
  const [form] = Form.useForm();
  const [passwordForm] = Form.useForm();
  const [loginTab, setLoginTab] = useState<'sms' | 'password'>('sms');

  const handleLoginResult = async (result: LoginResponse | SelectCompanyResponse) => {
    // 多企业选择模式
    if ('needSelectCompany' in result && result.needSelectCompany) {
      setTempToken(result.tempToken);
      setCompanies(result.companies);
      setSelectMode(true);
      // M15修复：进入企业选择界面时启动倒计时
      startTempTokenCountdown();
      return;
    }
    await completeLogin(result as LoginResponse);
  };

  const handleLogin = async (values: { phone: string; code: string }) => {
    setLoading(true);
    try {
      const result = await login(values.phone, values.code);
      await handleLoginResult(result);
    } catch (err) {
      message.error(err instanceof Error ? err.message : '登录失败');
    } finally {
      setLoading(false);
    }
  };

  const handlePasswordLogin = async (values: { phone: string; password: string; captchaCode: string }) => {
    if (!captchaId) {
      message.error('请先获取图形验证码');
      void refreshCaptcha();
      return;
    }
    setLoading(true);
    try {
      const result = await loginByPassword(values.phone, values.password, captchaId, values.captchaCode);
      await handleLoginResult(result);
    } catch (err) {
      message.error(err instanceof Error ? err.message : '登录失败');
      // 图形验证码只能用一次，失败后刷新
      void refreshCaptcha();
      passwordForm.setFieldValue('captchaCode', '');
    } finally {
      setLoading(false);
    }
  };

  // 选择企业后完成登录
  const handleSelectCompany = async (companyId: string) => {
    // M15修复：如果临时凭证已过期，阻止选择并提示重新登录
    if (tempTokenExpired) {
      message.error('临时凭证已超时，请重新登录');
      handleBackToLogin();
      return;
    }

    setLoading(true);
    try {
      const result = await selectCompany(tempToken, companyId);
      clearTempTokenTimer(); // 登录成功后清理倒计时
      await completeLogin(result);
    } catch (err: any) {
      // M15修复：捕获 401 错误，给出明确的临时凭证过期提示
      const status = err?.response?.status || err?.status;
      if (status === 401) {
        setTempTokenExpired(true);
        clearTempTokenTimer();
        message.error('临时凭证已超时，请重新登录');
      } else {
        message.error(err instanceof Error ? err.message : '登录失败');
      }
    } finally {
      setLoading(false);
    }
  };

  // 返回登录界面（清理多企业选择状态）
  const handleBackToLogin = () => {
    clearTempTokenTimer();
    setSelectMode(false);
    setTempToken('');
    setCompanies([]);
    setTempTokenExpired(false);
    setTempTokenCountdown(0);
  };

  const completeLogin = async (result: LoginResponse) => {
    // 通过 setAuth 统一设置 token（内部写 localStorage + zustand 状态）
    // 先用 null profile 设置 token，以便 getMe 请求能携带认证头
    setAuth(result.accessToken, result.refreshToken, null as unknown as import('@/types').SellerProfile);
    try {
      const profile = await getMe();
      // 用完整 profile 再次更新状态
      setAuth(result.accessToken, result.refreshToken, profile);
    } catch (e) {
      // I17修复：getMe 失败时清理脏状态，避免残留 token + null profile
      useAuthStore.getState().clearAuth();
      throw e; // 重新抛出，让外层 catch 处理错误提示
    }
    // 切换企业时清理旧的查询缓存，避免数据串企业
    queryClient.clear();
    message.success('登录成功');
    navigate('/', { replace: true });
  };

  // 多企业选择界面
  if (selectMode) {
    return (
      <div style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'linear-gradient(135deg, #e8f5e9 0%, #c8e6c9 50%, #a5d6a7 100%)',
      }}>
        <Card style={{ width: 440, boxShadow: '0 8px 24px rgba(0,0,0,0.12)', borderRadius: 12 }}
              styles={{ body: { padding: 32 } }}>
          <div style={{ textAlign: 'center', marginBottom: 24 }}>
            <Title level={4} style={{ color: '#2E7D32' }}>选择企业</Title>
            <Text type="secondary">您关联了多个企业，请选择要进入的企业</Text>
          </div>
          {/* M15修复：临时凭证倒计时/过期提示 */}
          {tempTokenExpired ? (
            <Alert
              type="error"
              showIcon
              icon={<ClockCircleOutlined />}
              message="临时凭证已超时，请重新登录"
              style={{ marginBottom: 16 }}
            />
          ) : (
            <div style={{ textAlign: 'center', marginBottom: 16, color: tempTokenCountdown <= 60 ? '#ff4d4f' : '#999' }}>
              <ClockCircleOutlined style={{ marginRight: 4 }} />
              <Text type={tempTokenCountdown <= 60 ? 'danger' : 'secondary'}>
                请在 {Math.floor(tempTokenCountdown / 60)}:{String(tempTokenCountdown % 60).padStart(2, '0')} 内选择企业
              </Text>
            </div>
          )}
          <List
            dataSource={companies}
            renderItem={(item) => {
              const isFrozen = item.status === 'FROZEN';
              const isSuspended = item.status === 'SUSPENDED';
              // M15修复：临时凭证过期时也禁用企业选择
              const isDisabled = isFrozen || isSuspended || tempTokenExpired;
              return (
                <List.Item
                  style={{
                    cursor: isDisabled ? 'not-allowed' : 'pointer',
                    padding: '12px 16px',
                    borderRadius: 8,
                    opacity: isDisabled ? 0.5 : 1,
                  }}
                  onClick={() => !isDisabled && handleSelectCompany(item.companyId)}
                >
                  <List.Item.Meta
                    avatar={<ShopOutlined style={{ fontSize: 24, color: isDisabled ? '#999' : '#2E7D32' }} />}
                    title={
                      <span>
                        {item.companyName}
                        {isFrozen && <Tag color="red" style={{ marginLeft: 8 }}>已冻结</Tag>}
                        {isSuspended && <Tag color="orange" style={{ marginLeft: 8 }}>已暂停</Tag>}
                      </span>
                    }
                    description={`角色：${item.role === 'OWNER' ? '企业主' : item.role === 'MANAGER' ? '经理' : '运营'}`}
                  />
                </List.Item>
              );
            }}
          />
          <Button block style={{ marginTop: 16 }} onClick={handleBackToLogin}>
            {tempTokenExpired ? '重新登录' : '返回登录'}
          </Button>
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

  // 图形验证码输入框（短信/密码 tab 复用）
  const captchaField = (
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
              style={{ height: '100%', width: '100%', objectFit: 'contain' }}
            />
          ) : (
            <ReloadOutlined spin={captchaLoading} />
          )}
        </div>
      </Space.Compact>
    </Form.Item>
  );

  return (
    <div style={{
      minHeight: '100vh',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      background: 'linear-gradient(135deg, #e8f5e9 0%, #c8e6c9 50%, #a5d6a7 100%)',
    }}>
      <Card style={{ width: 400, boxShadow: '0 8px 24px rgba(0,0,0,0.12)', borderRadius: 12 }}
            styles={{ body: { padding: 32 } }}>
        <div style={{ textAlign: 'center', marginBottom: 32 }}>
          <Title level={3} style={{ marginBottom: 4, color: '#2E7D32' }}>
            爱买买卖家中心
          </Title>
          <Text type="secondary">企业商家管理后台</Text>
        </div>

        <Tabs
          activeKey={loginTab}
          onChange={(key) => setLoginTab(key as 'sms' | 'password')}
          centered
          items={[
            {
              key: 'sms',
              label: '短信登录',
              children: (
                <Form form={form} onFinish={handleLogin} size="large" autoComplete="off">
                  <Form.Item
                    name="phone"
                    rules={[
                      { required: true, message: '请输入手机号' },
                      { pattern: /^1\d{10}$/, message: '请输入正确的手机号' },
                    ]}
                  >
                    <Input prefix={<MobileOutlined />} placeholder="手机号" />
                  </Form.Item>

                  <Form.Item>
                    <Space.Compact style={{ width: '100%' }}>
                      <Form.Item
                        name="code"
                        noStyle
                        rules={[{ required: true, message: '请输入验证码' }]}
                      >
                        <Input
                          prefix={<SafetyCertificateOutlined />}
                          placeholder="验证码"
                          style={{ flex: 1 }}
                        />
                      </Form.Item>
                      <Button
                        onClick={handleSendCode}
                        loading={codeSending}
                        disabled={countdown > 0}
                        style={{ width: 120 }}
                      >
                        {countdown > 0 ? `${countdown}s` : '获取验证码'}
                      </Button>
                    </Space.Compact>
                  </Form.Item>

                  <Form.Item>
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
              key: 'password',
              label: '密码登录',
              children: (
                <Form form={passwordForm} onFinish={handlePasswordLogin} size="large" autoComplete="off">
                  <Form.Item
                    name="phone"
                    rules={[
                      { required: true, message: '请输入手机号' },
                      { pattern: /^1\d{10}$/, message: '请输入正确的手机号' },
                    ]}
                  >
                    <Input prefix={<MobileOutlined />} placeholder="手机号" />
                  </Form.Item>

                  {captchaField}

                  <Form.Item
                    name="password"
                    rules={[
                      { required: true, message: '请输入密码' },
                      { min: 6, max: 128, message: '密码长度 6-128 位' },
                    ]}
                  >
                    <Input.Password prefix={<LockOutlined />} placeholder="密码" />
                  </Form.Item>

                  <div style={{ textAlign: 'right', marginTop: -12, marginBottom: 12 }}>
                    <Button
                      type="link"
                      size="small"
                      style={{ padding: 0, height: 'auto' }}
                      onClick={() => navigate('/forgot-password')}
                    >
                      忘记密码？
                    </Button>
                  </div>

                  <Form.Item>
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
          ]}
        />

        <div style={{ textAlign: 'center' }}>
          <Text type="secondary" style={{ fontSize: 12 }}>
            测试手机号：13800001001（陈澄源/澄源生态）、13800001002（李青禾/青禾智慧）
          </Text>
        </div>
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
