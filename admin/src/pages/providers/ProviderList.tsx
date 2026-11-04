import { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  Button,
  Form,
  Input,
  Modal,
  Popconfirm,
  Select,
  Space,
  Switch,
  Table,
  Tag,
  Typography,
  message,
} from 'antd';
import type { TableColumnsType } from 'antd';
import { PlusOutlined, ReloadOutlined } from '@ant-design/icons';
import { adminApi, type KeyEnvEntry, type KeySource, type ProviderSummary } from '@/api/admin';
import { formatTime } from '@/utils/format';

const providerNames: Record<string, string> = {
  zhipu: '智谱 AI',
  deepseek: 'DeepSeek',
  dashscope: '阿里云百炼',
  qianfan: '百度千帆',
  siliconflow: '硅基流动',
};

const sourceLabels: Record<KeySource, string> = {
  env: '环境变量',
  database: '数据库加密',
  none: '未配置密钥',
};

const sourceColors: Record<KeySource, string> = {
  env: 'blue',
  database: 'cyan',
  none: 'red',
};

function providerName(provider: string) {
  return providerNames[provider] ?? provider;
}

type EditorState =
  | { mode: 'create'; provider?: string }
  | { mode: 'edit'; entry: KeyEnvEntry }
  | null;

interface EditorValues {
  provider: string;
  envName?: string;
  key?: string;
  note?: string;
  activate?: boolean;
}

export default function KeyEnvList() {
  const [providers, setProviders] = useState<ProviderSummary[]>([]);
  const [entries, setEntries] = useState<KeyEnvEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [providerFilter, setProviderFilter] = useState<string>();
  const [includeDeprecated, setIncludeDeprecated] = useState(false);
  const [editor, setEditor] = useState<EditorState>(null);

  const [form] = Form.useForm<EditorValues>();
  const watchedProvider = Form.useWatch('provider', form);
  const defaultEnvName =
    providers.find((item) => item.provider === watchedProvider)?.defaultEnvName ?? '';

  const load = useCallback(async () => {
    const [providerRows, entryRows] = await Promise.all([
      adminApi.providers(),
      adminApi.keyEnvs({ provider: providerFilter, includeDeprecated }),
    ]);
    setProviders(providerRows);
    setEntries(entryRows);
  }, [providerFilter, includeDeprecated]);

  useEffect(() => {
    setLoading(true);
    load()
      .catch(() => undefined)
      .finally(() => setLoading(false));
  }, [load]);

  const refresh = () => {
    setLoading(true);
    load()
      .catch(() => undefined)
      .finally(() => setLoading(false));
  };

  const act = async (task: () => Promise<unknown>, success: string) => {
    try {
      await task();
      message.success(success);
      await load();
    } catch {
      // 请求拦截器已经提示过错误
    }
  };

  const openCreate = (provider?: string) => {
    form.resetFields();
    form.setFieldsValue({ provider: provider ?? providers[0]?.provider, activate: false });
    setEditor({ mode: 'create', provider });
  };

  const openEdit = (entry: KeyEnvEntry) => {
    form.setFieldsValue({
      provider: entry.provider,
      envName: entry.envName,
      key: '',
      note: entry.note,
      activate: entry.isActive,
    });
    setEditor({ mode: 'edit', entry });
  };

  const submit = async () => {
    if (!editor) return;
    const values = await form.validateFields();
    setSaving(true);
    try {
      if (editor.mode === 'create') {
        await adminApi.createKeyEnv({
          provider: values.provider,
          envName: values.envName?.trim() || undefined,
          key: values.key?.trim() || undefined,
          note: values.note?.trim() ?? '',
          activate: values.activate ?? false,
        });
        message.success('KeyEnv 已新增');
      } else {
        await adminApi.updateKeyEnv(editor.entry.id, {
          envName: values.envName?.trim(),
          key: values.key?.trim() || undefined,
          note: values.note?.trim() ?? '',
        });
        message.success('KeyEnv 已更新');
      }

      setEditor(null);
      await load();
    } catch {
      // 校验失败或请求失败，提示已在表单/拦截器里显示
    } finally {
      setSaving(false);
    }
  };

  const selectedProvider = providers.find((item) => item.provider === providerFilter);

  const columns: TableColumnsType<KeyEnvEntry> = [
    {
      title: '提供商',
      dataIndex: 'provider',
      width: 150,
      render: (value: string) => (
        <div>
          <Typography.Text strong>{providerName(value)}</Typography.Text>
          <div className="sub-text mono">{value}</div>
        </div>
      ),
    },
    {
      title: 'KeyEnv',
      dataIndex: 'envName',
      width: 200,
      render: (value: string) => <span className="mono">{value}</span>,
    },
    {
      title: '状态',
      key: 'status',
      width: 130,
      render: (_, row) =>
        row.isDeprecated ? (
          <Tag>已废弃</Tag>
        ) : row.isActive ? (
          <Tag color="green">当前启用</Tag>
        ) : (
          <Tag color="gold">备用</Tag>
        ),
    },
    {
      title: '密钥来源',
      key: 'source',
      width: 140,
      render: (_, row) => <Tag color={sourceColors[row.source]}>{sourceLabels[row.source]}</Tag>,
    },
    {
      title: '尾号',
      dataIndex: 'maskedTail',
      width: 110,
      render: (value: string) => (value ? <span className="mono">{value}</span> : '-'),
    },
    {
      title: '备注',
      dataIndex: 'note',
      ellipsis: true,
      render: (value: string) => value || '-',
    },
    {
      title: '更新时间',
      dataIndex: 'updatedAt',
      width: 170,
      render: (value: string) => formatTime(value),
    },
    {
      title: '操作',
      key: 'actions',
      width: 250,
      render: (_, row) => (
        <Space size={0} wrap>
          {!row.isActive && !row.isDeprecated && (
            <Button
              type="link"
              size="small"
              onClick={() => act(() => adminApi.activateKeyEnv(row.id), '已切换到该 KeyEnv')}
            >
              启用
            </Button>
          )}
          <Button type="link" size="small" onClick={() => openEdit(row)}>
            编辑
          </Button>
          {row.isDeprecated ? (
            <Button
              type="link"
              size="small"
              onClick={() => act(() => adminApi.deprecateKeyEnv(row.id, false), '已恢复')}
            >
              恢复
            </Button>
          ) : (
            <Popconfirm
              title="废弃该 KeyEnv？"
              description="废弃后不再参与密钥解析，密钥保留，可随时恢复。"
              okText="废弃"
              cancelText="取消"
              onConfirm={() => act(() => adminApi.deprecateKeyEnv(row.id, true), '已废弃，可随时恢复')}
            >
              <Button type="link" size="small" danger>
                废弃
              </Button>
            </Popconfirm>
          )}
          <Popconfirm
            title="删除该 KeyEnv？"
            description="库内密文会一并删除，无法恢复。"
            okText="删除"
            okButtonProps={{ danger: true }}
            cancelText="取消"
            onConfirm={() => act(() => adminApi.deleteKeyEnv(row.id), '已删除')}
          >
            <Button type="link" size="small" danger>
              删除
            </Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <div>
      <Typography.Title level={3} className="page-title">
        KeyEnv 管理
      </Typography.Title>
      <Typography.Paragraph className="page-desc">
        每个提供商可配置多条 KeyEnv，只有当前启用的一条参与密钥解析；环境变量优先，其次使用库内加密副本。
      </Typography.Paragraph>

      <Space wrap style={{ marginBottom: 12 }}>
        {providers.map((item) => (
          <Tag
            key={item.provider}
            color={item.usable ? 'green' : 'red'}
            style={{ cursor: 'pointer', marginBottom: 4 }}
            onClick={() => setProviderFilter(item.provider)}
          >
            {providerName(item.provider)} · {item.activeEnvName || '无启用条目'}
          </Tag>
        ))}
      </Space>

      {selectedProvider && !selectedProvider.usable && (
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 16 }}
          message="该提供商当前没有启用的 KeyEnv"
          description="相关模型不会下发给用户，需要在下方新增或启用一条 KeyEnv 后恢复。"
        />
      )}

      <Space wrap style={{ marginBottom: 16, width: '100%', justifyContent: 'space-between' }}>
        <Space wrap>
          <Select
            allowClear
            placeholder="全部提供商"
            style={{ width: 220 }}
            value={providerFilter}
            onChange={setProviderFilter}
            options={providers.map((item) => ({
              value: item.provider,
              label: `${providerName(item.provider)}（${item.usable ? '可用' : '未启用'}）`,
            }))}
          />
          <Space>
            <Switch checked={includeDeprecated} onChange={setIncludeDeprecated} />
            <span>显示已废弃</span>
          </Space>
          <Button icon={<ReloadOutlined />} onClick={refresh}>
            刷新
          </Button>
        </Space>
        <Button type="primary" icon={<PlusOutlined />} onClick={() => openCreate(providerFilter)}>
          新增 KeyEnv
        </Button>
      </Space>

      <Table
        rowKey="id"
        size="middle"
        loading={loading}
        columns={columns}
        dataSource={entries}
        pagination={false}
      />

      <Modal
        title={editor?.mode === 'edit' ? '编辑 KeyEnv' : '新增 KeyEnv'}
        open={!!editor}
        onOk={submit}
        confirmLoading={saving}
        onCancel={() => setEditor(null)}
        okText="保存"
        cancelText="取消"
        forceRender
      >
        <Form form={form} layout="vertical" preserve={false}>
          <Form.Item
            name="provider"
            label="提供商"
            rules={[{ required: true, message: '请选择提供商' }]}
          >
            <Select
              disabled={editor?.mode === 'edit'}
              options={providers.map((item) => ({
                value: item.provider,
                label: `${providerName(item.provider)}（${item.provider}）`,
              }))}
            />
          </Form.Item>

          <Form.Item
            name="envName"
            label="KeyEnv 环境变量名"
            rules={[
              {
                pattern: /^[A-Za-z_][A-Za-z0-9_]*$/,
                message: '只能包含字母、数字和下划线，且不能以数字开头',
              },
            ]}
            extra={defaultEnvName ? `留空则使用默认环境变量名 ${defaultEnvName}` : '留空则使用提供商默认环境变量名'}
          >
            <Input className="mono" placeholder={defaultEnvName || '例如 DEEPSEEK_API_KEY'} />
          </Form.Item>

          <Form.Item
            name="key"
            label="密钥值"
            extra={
              editor?.mode === 'edit'
                ? '留空表示保持现有密钥不变'
                : '可留空，此时只读取服务器上的同名环境变量'
            }
            rules={[
              {
                validator: (_, value?: string) =>
                  !value || value.trim().length >= 8
                    ? Promise.resolve()
                    : Promise.reject(new Error('密钥长度不足 8 位')),
              },
            ]}
          >
            <Input.Password placeholder="粘贴 API Key（至少 8 位）" autoComplete="new-password" />
          </Form.Item>

          <Form.Item name="note" label="备注">
            <Input placeholder="例如：主账号 / 备用 Key / 2026-11 轮换" maxLength={200} />
          </Form.Item>

          {editor?.mode === 'create' && (
            <Form.Item
              name="activate"
              label="创建后立即启用"
              valuePropName="checked"
              extra="该提供商当前没有启用条目时会自动启用"
            >
              <Switch />
            </Form.Item>
          )}
        </Form>

        <Typography.Paragraph type="secondary" style={{ fontSize: 12, marginBottom: 0 }}>
          密钥会使用服务端 Data Protection 加密后落库，页面与日志都不会出现明文。
        </Typography.Paragraph>
      </Modal>
    </div>
  );
}
