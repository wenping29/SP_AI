import { useState } from 'react';
import { Button, Card, Form, Input, Tabs, Typography, message } from 'antd';
import { LockOutlined, SafetyCertificateOutlined, ThunderboltFilled, UserOutlined } from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import { adminApi } from '@/api/admin';
import { useAuth } from '@/store/auth';
import { firstAllowedRoute } from '@/utils/permissions';

interface AccountForm {
  username: string;
  password: string;
}

interface KeyForm {
  adminKey: string;
}

export default function Login() {
  const navigate = useNavigate();
  const setToken = useAuth((s) => s.setToken);
  const setKey = useAuth((s) => s.setKey);
  const setIdentity = useAuth((s) => s.setIdentity);
  const logout = useAuth((s) => s.logout);
  const [mode, setMode] = useState<'account' | 'key'>('account');
  const [loading, setLoading] = useState(false);

  const onAccountLogin = async (values: AccountForm) => {
    setLoading(true);
    try {
      const result = await adminApi.login(values.username.trim(), values.password);
      setToken(result.token);
      setIdentity(result.user);
      message.success(`欢迎回来，${result.user.displayName}`);
      navigate(firstAllowedRoute(result.user.permissions), { replace: true });
    } catch {
      // 错误提示由请求拦截器处理
    } finally {
      setLoading(false);
    }
  };

  const onKeyLogin = async (values: KeyForm) => {
    const key = values.adminKey.trim();
    if (!key) return;

    setKey(key);
    setLoading(true);
    try {
      const identity = await adminApi.me();
      setIdentity(identity);
      message.success('登录成功');
      navigate(firstAllowedRoute(identity.permissions), { replace: true });
    } catch {
      logout();
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-bg">
      <Card style={{ width: 400, boxShadow: '0 12px 32px rgba(15, 23, 42, 0.08)' }}>
        <div style={{ textAlign: 'center', marginBottom: 20 }}>
          <div
            style={{
              width: 52,
              height: 52,
              margin: '0 auto 12px',
              borderRadius: 14,
              background: '#eff6ff',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <ThunderboltFilled style={{ fontSize: 26, color: '#2563eb' }} />
          </div>
          <Typography.Title level={3} style={{ marginBottom: 4 }}>
            SP 管理后台
          </Typography.Title>
          <Typography.Text type="secondary">账号角色登录 · 模块权限隔离</Typography.Text>
        </div>

        <Tabs
          activeKey={mode}
          onChange={(key) => setMode(key as 'account' | 'key')}
          items={[
            {
              key: 'account',
              label: '账号登录',
              children: (
                <Form<AccountForm> onFinish={onAccountLogin} size="large">
                  <Form.Item name="username" rules={[{ required: true, message: '请输入用户名' }]}>
                    <Input prefix={<UserOutlined />} placeholder="用户名" autoComplete="username" />
                  </Form.Item>
                  <Form.Item name="password" rules={[{ required: true, message: '请输入密码' }]}>
                    <Input.Password
                      prefix={<LockOutlined />}
                      placeholder="密码"
                      autoComplete="current-password"
                    />
                  </Form.Item>
                  <Form.Item style={{ marginBottom: 12 }}>
                    <Button type="primary" htmlType="submit" block loading={loading}>
                      登录
                    </Button>
                  </Form.Item>
                </Form>
              ),
            },
            {
              key: 'key',
              label: '应急密钥',
              children: (
                <Form<KeyForm> onFinish={onKeyLogin} size="large">
                  <Form.Item
                    name="adminKey"
                    rules={[{ required: true, message: '请输入管理密钥' }]}
                  >
                    <Input.Password
                      prefix={<LockOutlined />}
                      placeholder="管理密钥 Admin__Key"
                      autoComplete="current-password"
                    />
                  </Form.Item>
                  <Form.Item style={{ marginBottom: 12 }}>
                    <Button type="primary" htmlType="submit" block loading={loading}>
                      使用应急密钥进入
                    </Button>
                  </Form.Item>
                </Form>
              ),
            },
          ]}
        />

        <Typography.Paragraph type="secondary" style={{ fontSize: 12, marginBottom: 0 }}>
          <SafetyCertificateOutlined /> 账号登录 12 小时后过期；应急密钥由服务端 Admin__Key
          配置，仅保存在当前浏览器会话。
        </Typography.Paragraph>
      </Card>
    </div>
  );
}
