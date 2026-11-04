import { useEffect, useState } from 'react';
import {
  Alert,
  Button,
  Card,
  Form,
  Input,
  InputNumber,
  Space,
  Switch,
  Typography,
  message,
} from 'antd';
import { adminApi, type CreditPolicy, type PolicyUpdate } from '@/api/admin';
import { formatTime } from '@/utils/format';

export default function PolicySettings() {
  const [policy, setPolicy] = useState<CreditPolicy | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [form] = Form.useForm<PolicyUpdate>();

  useEffect(() => {
    adminApi
      .policy()
      .then((result) => {
        setPolicy(result);
        form.setFieldsValue(result);
      })
      .catch(() => undefined)
      .finally(() => setLoading(false));
  }, [form]);

  const onFinish = async (values: PolicyUpdate) => {
    setSaving(true);
    try {
      const updated = await adminApi.updatePolicy(values);
      setPolicy(updated);
      form.setFieldsValue(updated);
      message.success('运营策略已保存');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      <Typography.Title level={3} className="page-title">
        运营策略
      </Typography.Title>
      <Typography.Paragraph className="page-desc">
        控制新用户注册赠送积分、聊天总开关与全局公告，保存后立即对插件生效。
      </Typography.Paragraph>

      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 20 }}
        message="免费积分只给邮箱验证注册成功的新用户"
        description="新设备匿名使用固定赠送 200 体验积分，登录或注册后并入用户账号；注册赠送只发一次，已有用户的余额请到「积分管理」里按用户调整。"
      />

      <Card
        loading={loading}
        title="基础策略"
        extra={
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            最近更新：{formatTime(policy?.updatedAt)}
          </Typography.Text>
        }
      >
        <Form
          form={form}
          layout="vertical"
          onFinish={onFinish}
          style={{ maxWidth: 540 }}
        >
          <Form.Item
            name="freeCredits"
            label="新用户注册赠送积分"
            rules={[{ required: true, message: '请输入赠送积分' }]}
            extra="邮箱验证通过并注册成功后发放一次，写入「注册赠送」流水；新设备匿名体验积分固定 200，登录后合并。"
          >
            <InputNumber min={0} max={1000000} precision={0} style={{ width: '100%' }} />
          </Form.Item>

          <Form.Item
            name="chatEnabled"
            label="聊天总开关"
            valuePropName="checked"
            extra="关闭后 /api/chat 返回 503，插件会提示服务暂停；语音输入不受影响。"
          >
            <Switch checkedChildren="开放" unCheckedChildren="暂停" />
          </Form.Item>

          <Form.Item name="notice" label="全局公告">
            <Input.TextArea
              rows={4}
              maxLength={200}
              showCount
              placeholder="会随 /api/config 下发给插件，例如维护通知、活动说明"
            />
          </Form.Item>

          <Form.Item style={{ marginBottom: 0 }}>
            <Space>
              <Button type="primary" htmlType="submit" loading={saving}>
                保存策略
              </Button>
              <Button
                onClick={() => {
                  if (policy) form.setFieldsValue(policy);
                }}
              >
                重置
              </Button>
            </Space>
          </Form.Item>
        </Form>
      </Card>
    </div>
  );
}
