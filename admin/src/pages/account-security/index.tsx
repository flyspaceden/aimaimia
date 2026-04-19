import { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, Tabs, Form, Input, Button, message, Typography, Space, Alert } from 'antd';
import { LockOutlined, MobileOutlined, MessageOutlined } from '@ant-design/icons';
import {
  changePassword,
  sendSmsCode,
  sendBindPhoneSmsCode,
  changePhone,
} from '@/api/auth';
import useAuthStore from '@/store/useAuthStore';

const { Text } = Typography;

interface ChangePasswordForm {
  oldPassword: string;
  newPassword: string;
  confirmPassword: string;
}

interface ChangePhoneForm {
  oldPhoneCode: string;
  newPhone: string;
  newPhoneCode: string;
}

// 手机号脱敏：138****5005
function maskPhone(phone?: string | null): string {
  if (!phone || phone.length < 7) return phone || '';
  return phone.slice(0, 3) + '****' + phone.slice(-4);
}

export default function AccountSecurityPage() {
  const navigate = useNavigate();
  const admin = useAuthStore((s) => s.admin);
  const clearAuth = useAuthStore((s) => s.clearAuth);

  const [pwdForm] = Form.useForm<ChangePasswordForm>();
  const [phoneForm] = Form.useForm<ChangePhoneForm>();

  const [pwdSaving, setPwdSaving] = useState(false);
  const [phoneSaving, setPhoneSaving] = useState(false);

  const [oldCountdown, setOldCountdown] = useState(0);
  const [newCountdown, setNewCountdown] = useState(0);
  const [oldSending, setOldSending] = useState(false);
  const [newSending, setNewSending] = useState(false);
  const oldTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const newTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const startCountdown = (
    setter: React.Dispatch<React.SetStateAction<number>>,
    timerRef: React.MutableRefObject<ReturnType<typeof setInterval> | null>,
  ) => {
    setter(60);
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = setInterval(() => {
      setter((prev) => {
        if (prev <= 1) {
          if (timerRef.current) {
            clearInterval(timerRef.current);
            timerRef.current = null;
          }
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
  };

  const forceRelogin = (msg: string) => {
    message.success(msg);
    clearAuth();
    localStorage.removeItem('admin_token');
    setTimeout(() => navigate('/login', { replace: true }), 800);
  };

  // 修改密码
  const handleChangePassword = async (values: ChangePasswordForm) => {
    if (values.newPassword !== values.confirmPassword) {
      message.warning('两次新密码输入不一致');
      return;
    }
    setPwdSaving(true);
    try {
      await changePassword({
        oldPassword: values.oldPassword,
        newPassword: values.newPassword,
      });
      forceRelogin('密码已修改，请用新密码重新登录');
    } catch (err: any) {
      message.error(err?.response?.data?.message || err?.message || '修改失败');
    } finally {
      setPwdSaving(false);
    }
  };

  // 发送原手机验证码
  const handleSendOldCode = async () => {
    if (!admin?.phone) {
      message.warning('当前账号未绑定手机号，无法通过短信改手机。请联系超管处理');
      return;
    }
    setOldSending(true);
    try {
      await sendSmsCode(admin.phone);
      message.success(`验证码已发送到原手机 ${maskPhone(admin.phone)}`);
      startCountdown(setOldCountdown, oldTimerRef);
    } catch (err: any) {
      message.error(err?.response?.data?.message || err?.message || '发送失败');
    } finally {
      setOldSending(false);
    }
  };

  // 发送新手机验证码
  const handleSendNewCode = async () => {
    try {
      const values = await phoneForm.validateFields(['newPhone']);
      setNewSending(true);
      await sendBindPhoneSmsCode(values.newPhone);
      message.success('验证码已发送到新手机');
      startCountdown(setNewCountdown, newTimerRef);
    } catch (err: any) {
      if (err?.errorFields) {
        message.warning(err.errorFields?.[0]?.errors?.[0] || '请填写新手机号');
        return;
      }
      message.error(err?.response?.data?.message || err?.message || '发送失败');
    } finally {
      setNewSending(false);
    }
  };

  // 提交修改手机号
  const handleChangePhone = async (values: ChangePhoneForm) => {
    setPhoneSaving(true);
    try {
      await changePhone(values);
      forceRelogin('手机号已修改，请重新登录');
    } catch (err: any) {
      message.error(err?.response?.data?.message || err?.message || '修改失败');
    } finally {
      setPhoneSaving(false);
    }
  };

  return (
    <div style={{ padding: 24, maxWidth: 640, margin: '0 auto' }}>
      <Card title="账号安全">
        <Tabs
          defaultActiveKey="password"
          items={[
            {
              key: 'password',
              label: '修改密码',
              children: (
                <>
                  <Alert
                    type="info"
                    showIcon
                    message="修改密码后所有设备会被强制登出，需用新密码重新登录"
                    style={{ marginBottom: 16 }}
                  />
                  <Form<ChangePasswordForm>
                    form={pwdForm}
                    layout="vertical"
                    size="large"
                    autoComplete="off"
                    onFinish={handleChangePassword}
                  >
                    <Form.Item
                      name="oldPassword"
                      label="原密码"
                      rules={[{ required: true, message: '请输入原密码' }]}
                    >
                      <Input.Password prefix={<LockOutlined />} placeholder="原密码" />
                    </Form.Item>
                    <Form.Item
                      name="newPassword"
                      label="新密码"
                      rules={[
                        { required: true, message: '请输入新密码' },
                        { min: 6, max: 128, message: '密码长度 6-128 位' },
                      ]}
                    >
                      <Input.Password prefix={<LockOutlined />} placeholder="至少 6 位" />
                    </Form.Item>
                    <Form.Item
                      name="confirmPassword"
                      label="确认新密码"
                      dependencies={['newPassword']}
                      rules={[
                        { required: true, message: '请再次输入新密码' },
                        ({ getFieldValue }) => ({
                          validator(_, value) {
                            if (!value || getFieldValue('newPassword') === value) {
                              return Promise.resolve();
                            }
                            return Promise.reject(new Error('两次输入的密码不一致'));
                          },
                        }),
                      ]}
                    >
                      <Input.Password prefix={<LockOutlined />} placeholder="再次输入新密码" />
                    </Form.Item>
                    <Form.Item>
                      <Button type="primary" htmlType="submit" loading={pwdSaving} block>
                        确认修改
                      </Button>
                    </Form.Item>
                  </Form>
                </>
              ),
            },
            {
              key: 'phone',
              label: '修改手机号',
              children: (
                <>
                  <Alert
                    type="info"
                    showIcon
                    message="修改手机号需要原手机和新手机都收到短信验证。修改后所有设备会被强制登出"
                    style={{ marginBottom: 16 }}
                  />
                  <div style={{ marginBottom: 16 }}>
                    <Text type="secondary">当前手机号：</Text>
                    <Text strong>{admin?.phone ? maskPhone(admin.phone) : '未绑定'}</Text>
                  </div>
                  <Form<ChangePhoneForm>
                    form={phoneForm}
                    layout="vertical"
                    size="large"
                    autoComplete="off"
                    onFinish={handleChangePhone}
                  >
                    <Form.Item
                      name="oldPhoneCode"
                      label="原手机验证码"
                      rules={[
                        { required: true, message: '请输入原手机验证码' },
                        { min: 4, max: 6, message: '验证码长度 4-6 位' },
                      ]}
                    >
                      <Space.Compact style={{ width: '100%' }}>
                        <Input
                          prefix={<MessageOutlined />}
                          placeholder="原手机验证码"
                          autoComplete="off"
                          style={{ flex: 1 }}
                        />
                        <Button
                          onClick={handleSendOldCode}
                          loading={oldSending}
                          disabled={oldCountdown > 0 || !admin?.phone}
                          style={{ minWidth: 140 }}
                        >
                          {oldCountdown > 0 ? `${oldCountdown}s 后重试` : '发送到原手机'}
                        </Button>
                      </Space.Compact>
                    </Form.Item>
                    <Form.Item
                      name="newPhone"
                      label="新手机号"
                      rules={[
                        { required: true, message: '请输入新手机号' },
                        { pattern: /^1\d{10}$/, message: '请输入正确的 11 位手机号' },
                      ]}
                    >
                      <Input prefix={<MobileOutlined />} placeholder="新手机号" maxLength={11} />
                    </Form.Item>
                    <Form.Item
                      name="newPhoneCode"
                      label="新手机验证码"
                      rules={[
                        { required: true, message: '请输入新手机验证码' },
                        { min: 4, max: 6, message: '验证码长度 4-6 位' },
                      ]}
                    >
                      <Space.Compact style={{ width: '100%' }}>
                        <Input
                          prefix={<MessageOutlined />}
                          placeholder="新手机验证码"
                          autoComplete="off"
                          style={{ flex: 1 }}
                        />
                        <Button
                          onClick={handleSendNewCode}
                          loading={newSending}
                          disabled={newCountdown > 0}
                          style={{ minWidth: 140 }}
                        >
                          {newCountdown > 0 ? `${newCountdown}s 后重试` : '发送到新手机'}
                        </Button>
                      </Space.Compact>
                    </Form.Item>
                    <Form.Item>
                      <Button type="primary" htmlType="submit" loading={phoneSaving} block>
                        确认修改
                      </Button>
                    </Form.Item>
                  </Form>
                </>
              ),
            },
          ]}
        />
      </Card>
    </div>
  );
}
