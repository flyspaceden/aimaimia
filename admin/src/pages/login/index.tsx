import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, Form, Input, Button, message, Typography, Tag } from 'antd';
import { UserOutlined, LockOutlined } from '@ant-design/icons';
import axios from 'axios';
import { login, getProfile } from '@/api/auth';
import useAuthStore from '@/store/useAuthStore';

const { Title, Text } = Typography;

interface LoginForm {
  username: string;
  password: string;
}

// 环境标识：根据 VITE_APP_ENV 或 Vite 内置 MODE 判断
const appEnv = import.meta.env.VITE_APP_ENV || import.meta.env.MODE;
const isProduction = appEnv === 'production';

/**
 * 将登录/获取权限过程中的异常转为用户友好的错误提示
 * - 401: 用户名或密码错误
 * - 403: 账号被禁用/权限不足
 * - 429: 请求过于频繁
 * - 网络异常: 提示检查网络
 */
const getLoginErrorMessage = (err: unknown): string => {
  // 先检查是否 axios 错误，可以拿到 HTTP 状态码
  if (axios.isAxiosError(err)) {
    const status = err.response?.status;
    // 优先取后端返回的业务错误信息
    const serverMsg =
      err.response?.data?.error ||
      err.response?.data?.message ||
      (typeof err.response?.data === 'string' ? err.response.data : '');

    switch (status) {
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

  // 已经被拦截器包装成 Error 的场景
  if (err instanceof Error && err.message) {
    return err.message;
  }

  return '登录失败，请稍后重试';
};

export default function LoginPage() {
  const navigate = useNavigate();
  const setAuth = useAuthStore((s) => s.setAuth);
  const [loading, setLoading] = useState(false);

  const handleLogin = async (values: LoginForm) => {
    setLoading(true);
    try {
      // 1. 登录获取 token
      const result = await login(values);
      // 2. 临时存储 token 以便 getProfile 请求使用
      localStorage.setItem('admin_token', result.accessToken);
      // 3. 获取完整权限信息
      const profile = await getProfile();
      // 4. 写入 store
      setAuth(result.accessToken, result.refreshToken, profile);
      message.success('登录成功');
      navigate('/', { replace: true });
    } catch (err) {
      // getProfile 失败时清除残留 token，避免后续请求循环 401
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
        background: 'linear-gradient(135deg, #e8eaf6 0%, #c5cae9 50%, #9fa8da 100%)',
      }}
    >
      <Card
        style={{
          width: 400,
          boxShadow: '0 8px 24px rgba(0,0,0,0.12)',
          borderRadius: 12,
        }}
        styles={{ body: { padding: 32 } }}
      >
        <div style={{ textAlign: 'center', marginBottom: 32 }}>
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

        <Form<LoginForm>
          onFinish={handleLogin}
          size="large"
          autoComplete="off"
        >
          <Form.Item
            name="username"
            rules={[{ required: true, message: '请输入用户名' }]}
          >
            <Input
              prefix={<UserOutlined />}
              placeholder="用户名"
            />
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
      </Card>
    </div>
  );
}
