import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { App, Card, Form, Input, Button, Typography, Space, List, Tag, Alert, Tabs, Modal } from 'antd';
import { MobileOutlined, SafetyCertificateOutlined, ShopOutlined, ClockCircleOutlined, LockOutlined, SafetyOutlined, ReloadOutlined } from '@ant-design/icons';
import { sendSmsCode, login, loginByPassword, selectCompany, getMe, getCaptcha } from '@/api/auth';
import { createDeliveryMerchantApplication } from '@/api/merchant-applications';
import useAuthStore from '@/store/useAuthStore';
import { queryClient } from '@/queryClient';
import type { LoginResponse, SelectCompanyResponse } from '@/types';

const { Title, Text } = Typography;

const appEnv = import.meta.env.VITE_APP_ENV || import.meta.env.MODE;
const isProduction = appEnv === 'production';
const switchToSellerCenterUrl = isProduction
  ? 'https://seller.ai-maimai.com'
  : 'https://test-seller.ai-maimai.com';

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
  const [applyOpen, setApplyOpen] = useState(false);
  const [applySubmitting, setApplySubmitting] = useState(false);
  const [applyForm] = Form.useForm<{
    companyName: string;
    contactName: string;
    contactPhone: string;
    email?: string;
    note?: string;
  }>();

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
      message.success('验证码已发送，请以收到的短信或本地后端控制台为准');
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
  const handleSelectCompany = async (companyId: string, staffId: string) => {
    // M15修复：如果临时凭证已过期，阻止选择并提示重新登录
    if (tempTokenExpired) {
      message.error('临时凭证已超时，请重新登录');
      handleBackToLogin();
      return;
    }

    setLoading(true);
    try {
      const result = await selectCompany(tempToken, companyId, staffId);
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
    // getMe 依赖 axios 从 localStorage 读取 token；这里不能提前写入 zustand，
    // 否则登录页会先跳到首页并让菜单用空 profile 初始化。
    localStorage.setItem('delivery_seller_token', result.accessToken);
    localStorage.setItem('delivery_seller_refresh_token', result.refreshToken);
    try {
      const profile = await getMe();
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

  const handleSubmitApplication = async () => {
    try {
      const values = await applyForm.validateFields();
      setApplySubmitting(true);
      const payload = {
        companyName: values.companyName.trim(),
        contactName: values.contactName.trim(),
        contactPhone: values.contactPhone.trim(),
        email: values.email?.trim() || undefined,
        note: values.note?.trim() || undefined,
      };
      const res = await createDeliveryMerchantApplication(payload);
      message.success(res.message || '申请已提交，请等待审核');
      setApplyOpen(false);
      applyForm.resetFields();
    } catch (err) {
      if ((err as any)?.errorFields) {
        return;
      }
      message.error(err instanceof Error ? err.message : '提交申请失败');
    } finally {
      setApplySubmitting(false);
    }
  };

  // 多企业选择界面
  if (selectMode) {
    return (
      <div style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'linear-gradient(135deg, #fff7ed 0%, #fed7aa 50%, #fb923c 100%)',
      }}>
        <Card style={{ width: 440, boxShadow: '0 8px 24px rgba(0,0,0,0.12)', borderRadius: 12 }}
              styles={{ body: { padding: 32 } }}>
          <div style={{ textAlign: 'center', marginBottom: 24 }}>
            <Title level={4} style={{ color: '#EA580C' }}>选择企业</Title>
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
                  onClick={() => !isDisabled && handleSelectCompany(item.companyId, item.staffId)}
                >
                  <List.Item.Meta
                    avatar={<ShopOutlined style={{ fontSize: 24, color: isDisabled ? '#999' : '#EA580C' }} />}
                    title={
                      <span>
                        {item.companyName}
                        {isFrozen && <Tag color="red" style={{ marginLeft: 8 }}>已冻结</Tag>}
                        {isSuspended && <Tag color="orange" style={{ marginLeft: 8 }}>已暂停</Tag>}
                      </span>
                    }
                    description={[
                      `身份：${item.role === 'OWNER' ? '企业主' : item.role === 'MANAGER' ? '经理' : '运营'}`,
                      item.realName ? `姓名：${item.realName}` : null,
                    ].filter(Boolean).join(' · ')}
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
      background: 'linear-gradient(135deg, #fff7ed 0%, #fed7aa 50%, #fb923c 100%)',
    }}>
      <Card style={{ width: 400, boxShadow: '0 8px 24px rgba(0,0,0,0.12)', borderRadius: 12 }}
            styles={{ body: { padding: 32 } }}>
        <div style={{ textAlign: 'center', marginBottom: 32 }}>
          <Title level={3} style={{ marginBottom: 4, color: '#EA580C' }}>
            配送中心
          </Title>
          <Text type="secondary">配送商家管理后台</Text>
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

        {/* 测试手机号提示：仅非生产显示（本地 dev 或 test-api 测试环境），生产隐藏 */}
        {(import.meta.env.DEV || import.meta.env.VITE_API_BASE_URL?.includes('test-')) && (
          <div style={{ textAlign: 'center', marginTop: 4, lineHeight: 1.8 }}>
            <Text type="secondary" style={{ fontSize: 12, display: 'block' }}>
              登录账号是手机号，不要填写内部账号名。
            </Text>
            <Text type="secondary" style={{ fontSize: 12, display: 'block' }}>
              测试手机号：13800001001（配送中心 OWNER / 配送示范供应商）
            </Text>
            <Text type="secondary" style={{ fontSize: 12, display: 'block' }}>
              测试时建议使用密码登录，默认密码：123456。
            </Text>
            <Text type="secondary" style={{ fontSize: 12, display: 'block' }}>
              短信登录请先点击获取验证码；测试服务器以实际短信验证码为准，本地模拟环境可用 123456。
            </Text>
          </div>
        )}
        <Button
          block
          style={{ marginTop: 16, height: 44, borderRadius: 8 }}
          href={switchToSellerCenterUrl}
        >
          切换爱买买卖家中心
        </Button>
        <Button
          block
          style={{ marginTop: 12, height: 44, borderRadius: 8 }}
          onClick={() => setApplyOpen(true)}
        >
          申请入驻
        </Button>
      </Card>
      <Modal
        title="申请入驻配送中心"
        open={applyOpen}
        onCancel={() => {
          setApplyOpen(false);
          applyForm.resetFields();
        }}
        onOk={() => void handleSubmitApplication()}
        confirmLoading={applySubmitting}
        okText="提交申请"
        cancelText="取消"
        destroyOnClose
        okButtonProps={{ style: { background: '#EA580C', borderColor: '#EA580C' } }}
      >
        <Form
          form={applyForm}
          layout="vertical"
          preserve={false}
          initialValues={{ note: '申请入驻配送中心' }}
        >
          <Form.Item
            label="企业名称"
            name="companyName"
            rules={[
              { required: true, message: '请输入企业名称' },
              { max: 200, message: '企业名称不能超过 200 字' },
            ]}
          >
            <Input placeholder="例如：青禾智慧配送中心" />
          </Form.Item>
          <Form.Item
            label="联系人"
            name="contactName"
            rules={[
              { required: true, message: '请输入联系人姓名' },
              { max: 100, message: '联系人姓名不能超过 100 字' },
            ]}
          >
            <Input placeholder="请输入联系人姓名" />
          </Form.Item>
          <Form.Item
            label="联系电话"
            name="contactPhone"
            rules={[
              { required: true, message: '请输入联系电话' },
              { pattern: /^1\d{10}$/, message: '请输入正确的手机号' },
            ]}
          >
            <Input placeholder="请输入联系电话" />
          </Form.Item>
          <Form.Item
            label="邮箱"
            name="email"
            rules={[{ type: 'email', message: '请输入正确的邮箱地址' }]}
          >
            <Input placeholder="选填" />
          </Form.Item>
          <Form.Item
            label="备注"
            name="note"
            rules={[{ max: 500, message: '备注不能超过 500 字' }]}
          >
            <Input.TextArea rows={4} placeholder="选填，可补充经营范围或合作需求" />
          </Form.Item>
        </Form>
      </Modal>
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
