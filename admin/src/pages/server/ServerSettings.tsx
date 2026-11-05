import { useEffect, useState } from 'react';
import {
  Alert,
  Button,
  Card,
  Descriptions,
  Form,
  Input,
  InputNumber,
  Space,
  Switch,
  Tag,
  Typography,
  message,
} from 'antd';
import { adminApi, type ServerConfigView } from '@/api/admin';
import { useAuth } from '@/store/auth';
import { formatTime } from '@/utils/format';

interface ServerFormValues {
  smtpEnabled: boolean;
  smtpHost: string;
  smtpPort: number;
  smtpImplicitTls: boolean;
  smtpUser: string;
  smtpPassword?: string;
  clearSmtpPassword: boolean;
  smtpFrom: string;
  smtpFromName: string;
  codeMinutes: number;
  exposeDevCode: boolean;
  allowedOriginsText: string;
}

const splitOrigins = (text: string) =>
  text
    .split(/[\n,;]/)
    .map((line) => line.trim().replace(/\/+$/, ''))
    .filter((line) => line.length > 0);

function formatUptime(seconds: number) {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (days > 0) return `${days} 天 ${hours} 小时`;
  if (hours > 0) return `${hours} 小时 ${minutes} 分`;
  return `${minutes} 分`;
}

export default function ServerSettings() {
  const can = useAuth((s) => s.can);
  const canManage = can('server.manage');
  const [config, setConfig] = useState<ServerConfigView | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testTo, setTestTo] = useState('');
  const [testing, setTesting] = useState(false);
  const [form] = Form.useForm<ServerFormValues>();

  const applyView = (view: ServerConfigView) => {
    setConfig(view);
    form.setFieldsValue({
      smtpEnabled: view.email.enabled,
      smtpHost: view.email.host,
      smtpPort: view.email.port,
      smtpImplicitTls: view.email.implicitTls,
      smtpUser: view.email.user,
      smtpPassword: undefined,
      clearSmtpPassword: false,
      smtpFrom: view.email.from,
      smtpFromName: view.email.fromName,
      codeMinutes: view.email.codeMinutes,
      exposeDevCode: view.email.exposeDevCode,
      allowedOriginsText: view.allowedOrigins.join('\n'),
    });
  };

  useEffect(() => {
    adminApi
      .serverConfig()
      .then(applyView)
      .catch(() => undefined)
      .finally(() => setLoading(false));
  }, []);

  const onFinish = async (values: ServerFormValues) => {
    setSaving(true);
    try {
      const updated = await adminApi.updateServerConfig({
        smtpEnabled: values.smtpEnabled,
        smtpHost: values.smtpHost,
        smtpPort: values.smtpPort,
        smtpImplicitTls: values.smtpImplicitTls,
        smtpUser: values.smtpUser,
        smtpPassword: values.smtpPassword?.trim() || undefined,
        clearSmtpPassword: values.clearSmtpPassword,
        smtpFrom: values.smtpFrom,
        smtpFromName: values.smtpFromName,
        codeMinutes: values.codeMinutes,
        exposeDevCode: values.exposeDevCode,
        allowedOrigins: splitOrigins(values.allowedOriginsText),
      });
      applyView(updated);
      message.success('服务器配置已保存，邮件与来源立即生效');
    } finally {
      setSaving(false);
    }
  };

  const onTest = async () => {
    const to = testTo.trim();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to)) {
      message.warning('请先填写收件邮箱');
      return;
    }
    setTesting(true);
    try {
      await adminApi.testServerEmail(to);
      message.success(`测试邮件已发送到 ${to}`);
    } finally {
      setTesting(false);
    }
  };

  const passwordHint = config?.email.passwordSet
    ? `已保存（${config.email.passwordSource === 'env' ? '来自环境变量' : '加密存储在数据库'}），留空表示不修改`
    : '尚未保存密码；SMTP 服务器不需要认证时可留空';

  return (
    <div>
      <Typography.Title level={3} className="page-title">
        服务器配置
      </Typography.Title>
      <Typography.Paragraph className="page-desc">
        在这里配置邮件服务与插件跨域来源，保存后立即生效，不需要改配置文件或重启。
      </Typography.Paragraph>

      {config?.email.source === 'env' && (
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 16 }}
          message="邮件设置有环境变量覆盖"
          description="服务器上设置了 Email__* 环境变量，环境变量优先于后台保存值；要以后台为准请先移除这些变量。"
        />
      )}

      <Card title="运行信息" style={{ marginBottom: 20 }} loading={loading}>
        {config && (
          <Descriptions column={2} size="small" bordered>
            <Descriptions.Item label="运行环境">{config.runtime.environment}</Descriptions.Item>
            <Descriptions.Item label="监听地址">{config.runtime.urls}</Descriptions.Item>
            <Descriptions.Item label="程序版本">{config.runtime.version || '-'}</Descriptions.Item>
            <Descriptions.Item label=".NET 版本">{config.runtime.framework}</Descriptions.Item>
            <Descriptions.Item label="数据库文件" span={2}>
              <Typography.Text copyable>{config.runtime.databaseFile}</Typography.Text>
            </Descriptions.Item>
            <Descriptions.Item label="密钥环目录" span={2}>
              <Typography.Text copyable>{config.runtime.keysPath}</Typography.Text>
            </Descriptions.Item>
            <Descriptions.Item label="启动时间">{formatTime(config.runtime.startedAt)}</Descriptions.Item>
            <Descriptions.Item label="已运行">
              {formatUptime(config.runtime.uptimeSeconds)}
            </Descriptions.Item>
          </Descriptions>
        )}
      </Card>

      <Form
        form={form}
        layout="vertical"
        onFinish={onFinish}
        disabled={!canManage}
        initialValues={{ smtpPort: 465, codeMinutes: 10, smtpImplicitTls: true }}
      >
        <Card
          title={
            <Space>
              邮件服务（SMTP）
              {config &&
                (config.email.configured ? (
                  <Tag color="green">已配置</Tag>
                ) : (
                  <Tag color="orange">未配置，注册验证码不可用</Tag>
                ))}
            </Space>
          }
          style={{ marginBottom: 20 }}
          loading={loading}
        >
          <Alert
            type="info"
            showIcon
            style={{ marginBottom: 16 }}
            message="注册需要邮箱验证码"
            description="填写 SMTP 后，新用户才能收到验证码完成注册；改动即时生效，可用下方「发送测试邮件」验证连通性。"
          />
          {config?.email.warning && (
            <Alert
              type="warning"
              showIcon
              style={{ marginBottom: 16 }}
              message="邮件配置不完整"
              description={config.email.warning}
            />
          )}

          <Space size={24} wrap align="start" style={{ display: 'flex' }}>
            <Form.Item label="启用邮件服务" name="smtpEnabled" valuePropName="checked">
              <Switch />
            </Form.Item>
            <Form.Item
              label="隐式 TLS（465 端口）"
              name="smtpImplicitTls"
              valuePropName="checked"
              extra="465 用隐式 TLS；587/25 关闭后走 STARTTLS。端口与开关不匹配会导致 TLS 握手失败"
            >
              <Switch />
            </Form.Item>
            <Form.Item
              label="验证码回显（仅调试）"
              name="exposeDevCode"
              valuePropName="checked"
              extra="未配置 SMTP 时把验证码直接返回接口，生产环境务必关闭"
            >
              <Switch />
            </Form.Item>
          </Space>

          <Space size={16} style={{ display: 'flex' }} align="start">
            <Form.Item
              label="SMTP 服务器"
              name="smtpHost"
              rules={[{ required: true, message: '请填写 SMTP 服务器' }]}
              style={{ flex: 1, minWidth: 260 }}
            >
              <Input placeholder="smtp.qq.com" autoComplete="off" />
            </Form.Item>
            <Form.Item
              label="端口"
              name="smtpPort"
              dependencies={['smtpImplicitTls']}
              rules={[
                { required: true, message: '请填写端口' },
                ({ getFieldValue }) => ({
                  validator(_rule, value: number | undefined) {
                    if (value === undefined || value === null) return Promise.resolve();
                    const implicitTls = getFieldValue('smtpImplicitTls') as boolean;
                    if (implicitTls && (value === 25 || value === 587)) {
                      return Promise.reject(
                        new Error('25/587 是 STARTTLS 明文端口，请关闭「隐式 TLS」或改用 465'),
                      );
                    }
                    if (!implicitTls && value === 465) {
                      return Promise.reject(
                        new Error('465 是隐式 TLS 端口，请开启「隐式 TLS」或改用 587/25'),
                      );
                    }
                    return Promise.resolve();
                  },
                }),
              ]}
            >
              <InputNumber min={1} max={65535} style={{ width: 120 }} />
            </Form.Item>
            <Form.Item label="验证码有效期（分钟）" name="codeMinutes" rules={[{ required: true }]}>
              <InputNumber min={1} max={30} style={{ width: 140 }} />
            </Form.Item>
          </Space>

          <Space size={16} style={{ display: 'flex' }} align="start">
            <Form.Item label="账号" name="smtpUser" style={{ flex: 1, minWidth: 260 }}>
              <Input placeholder="通常就是发件邮箱" autoComplete="off" />
            </Form.Item>
            <Form.Item label="密码 / 授权码" name="smtpPassword" style={{ flex: 1, minWidth: 260 }}>
              <Input.Password placeholder={passwordHint} autoComplete="new-password" />
            </Form.Item>
            <Form.Item
              label="清除已保存密码"
              name="clearSmtpPassword"
              valuePropName="checked"
              tooltip="勾选并保存后，数据库中保存的 SMTP 密码会被清空"
            >
              <Switch />
            </Form.Item>
          </Space>

          <Space size={16} style={{ display: 'flex' }} align="start">
            <Form.Item label="发件人邮箱" name="smtpFrom" style={{ flex: 1, minWidth: 260 }}>
              <Input placeholder="留空则使用账号" autoComplete="off" />
            </Form.Item>
            <Form.Item label="发件人名称" name="smtpFromName" style={{ flex: 1, minWidth: 260 }}>
              <Input placeholder="SP 助手" />
            </Form.Item>
          </Space>

          {canManage && (
            <Space.Compact style={{ width: '100%', maxWidth: 520 }}>
              <Input
                placeholder="收件邮箱，用于测试连通性"
                value={testTo}
                onChange={(event) => setTestTo(event.target.value)}
                allowClear
              />
              <Button onClick={onTest} loading={testing}>
                发送测试邮件
              </Button>
            </Space.Compact>
          )}
        </Card>

        <Card
          title="插件允许来源"
          style={{ marginBottom: 20 }}
          loading={loading}
          extra={
            config && (
              <Tag color={config.allowedOriginsSource === 'config' ? 'blue' : 'default'}>
                {config.allowedOriginsSource === 'config'
                  ? '由配置文件固定'
                  : config.allowedOriginsSource === 'database'
                    ? '后台配置'
                    : '未限制'}
              </Tag>
            )
          }
        >
          <Alert
            type="warning"
            showIcon
            style={{ marginBottom: 16 }}
            message="留空表示不限制来源（当前默认）"
            description="填写后只允许列出的来源跨域调用接口，例如 chrome-extension://<扩展ID>。扩展 ID 在 Edge 的扩展管理页可以看到；改完保存即时生效。"
          />
          <Form.Item
            name="allowedOriginsText"
            label="每行一个来源"
            extra={
              config?.allowedOriginsSource === 'config'
                ? '服务器配置文件里已设置 AllowedOrigins，后台保存不会覆盖它，请改配置后重启。'
                : undefined
            }
          >
            <Input.TextArea
              rows={4}
              placeholder={'chrome-extension://abcdefghijklmnop\nhttps://sp.example.com'}
              disabled={!canManage || config?.allowedOriginsSource === 'config'}
            />
          </Form.Item>
        </Card>

        {canManage && (
          <Button type="primary" htmlType="submit" loading={saving}>
            保存服务器配置
          </Button>
        )}
        {!canManage && (
          <Alert type="info" showIcon message="当前角色只能查看，修改需要「服务器配置 · 管理」权限" />
        )}
      </Form>
    </div>
  );
}
