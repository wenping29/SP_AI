import { useState } from 'react';
import { Button, Card, Form, Input, Typography, message } from 'antd';
import { LockOutlined, SafetyCertificateOutlined, ThunderboltFilled } from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import { adminApi } from '@/api/admin';
import { ADMIN_KEY_STORAGE, useAuth } from '@/store/auth';

interface LoginForm {
  adminKey: string;
}

export default function Login() {
  const navigate = useNavigate();
  const setKey = useAuth((s) => s.setKey);
  const [loading, setLoading] = useState(false);

  const onFinish = async (values: LoginForm) => {
    const key = values.adminKey.trim();
    if (!key) return;

    sessionStorage.setItem(ADMIN_KEY_STORAGE, key);
    setLoading(true);
    try {
      await adminApi.stats();
      setKey(key);
      message.success('登录成功');
      navigate('/dashboard', { replace: true });
    } catch {
      sessionStorage.removeItem(ADMIN_KEY_STORAGE);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-bg">
      <Card style={{ width: 380, boxShadow: '0 12px 32px rgba(15, 23, 42, 0.08)' }}>
        <div style={{ textAlign: 'center', marginBottom: 28 }}>
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
          <Typography.Text type="secondary">改积分 · 模型开关 · 查设备</Typography.Text>
        </div>

        <Form<LoginForm> onFinish={onFinish} size="large">
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
              进入后台
            </Button>
          </Form.Item>
        </Form>

        <Typography.Paragraph type="secondary" style={{ fontSize: 12, marginBottom: 0 }}>
          <SafetyCertificateOutlined /> 密钥由服务端环境变量 Admin__Key 配置，仅保存在当前浏览器会话。
        </Typography.Paragraph>
      </Card>
    </div>
  );
}
