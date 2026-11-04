import { useCallback, useEffect, useState } from 'react';
import {
  AutoComplete,
  Button,
  Col,
  Form,
  Input,
  InputNumber,
  Modal,
  Popconfirm,
  Row,
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
import { adminApi, type ModelProvider, type ModelSpec, type ModelUpdate } from '@/api/admin';
import { useAuth } from '@/store/auth';

const providerNames: Record<string, string> = {
  zhipu: '智谱 AI',
  deepseek: 'DeepSeek',
  dashscope: '阿里云百炼',
  qianfan: '百度千帆',
  siliconflow: '硅基流动',
};

const categoryPresets = ['高性价比', '高级', '最智能'];

const categoryColors: Record<string, string> = {
  高性价比: 'green',
  高级: 'blue',
  最智能: 'purple',
};

type EditorState = { mode: 'create' } | { mode: 'edit'; model: ModelSpec } | null;

interface ModelFormValues extends ModelUpdate {
  modelId: string;
  displayName: string;
  provider: string;
  upstreamModel: string;
}

export default function ModelList() {
  const [models, setModels] = useState<ModelSpec[]>([]);
  const [providers, setProviders] = useState<ModelProvider[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [editor, setEditor] = useState<EditorState>(null);
  const [saving, setSaving] = useState(false);
  const [showDeprecated, setShowDeprecated] = useState(false);

  const [form] = Form.useForm<ModelFormValues>();
  const can = useAuth((s) => s.can);
  const canManage = can('models.manage');

  const load = useCallback(async () => {
    const [rows, providerRows] = await Promise.all([
      adminApi.models(),
      adminApi.modelProviders(),
    ]);
    setModels(rows);
    setProviders(providerRows);
  }, []);

  useEffect(() => {
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

  const run = async (task: () => Promise<unknown>, success: string) => {
    try {
      await task();
      message.success(success);
      await load();
    } catch {
      // 请求拦截器已提示错误
    }
  };

  const toggle = async (model: ModelSpec, enabled: boolean) => {
    setSavingId(model.modelId);
    try {
      const updated = await adminApi.updateModel(model.modelId, { isEnabled: enabled });
      setModels((list) => list.map((item) => (item.modelId === updated.modelId ? updated : item)));
      message.success(`「${model.displayName}」已${enabled ? '启用' : '停用'}`);
    } catch {
      // 请求拦截器已提示错误
    } finally {
      setSavingId(null);
    }
  };

  const openCreate = () => {
    form.resetFields();
    form.setFieldsValue({
      provider: providers[0]?.provider,
      inputRatePer1K: 2,
      outputRatePer1K: 6,
      maxContextChars: 12000,
      sortOrder: models.reduce((max, item) => Math.max(max, item.sortOrder), 0) + 1,
      supportsVision: false,
      isEnabled: true,
    });
    setEditor({ mode: 'create' });
  };

  const openEdit = (model: ModelSpec) => {
    form.setFieldsValue(model);
    setEditor({ mode: 'edit', model });
  };

  const submit = async () => {
    if (!editor) return;
    const values = await form.validateFields();
    setSaving(true);
    try {
      if (editor.mode === 'create') {
        await adminApi.createModel({
          ...values,
          modelId: values.modelId.trim(),
          displayName: values.displayName.trim(),
          upstreamModel: values.upstreamModel.trim(),
          category: values.category?.trim() ?? '',
          note: values.note?.trim() ?? '',
        });
        message.success('模型已新增');
      } else {
        const { modelId, ...payload } = values;
        void modelId;
        await adminApi.updateModel(editor.model.modelId, {
          ...payload,
          displayName: payload.displayName.trim(),
          upstreamModel: payload.upstreamModel.trim(),
          category: payload.category?.trim() ?? '',
          note: payload.note?.trim() ?? '',
        });
        message.success('模型配置已保存');
      }

      setEditor(null);
      await load();
    } catch {
      // 校验失败或请求失败，提示已在表单/拦截器里显示
    } finally {
      setSaving(false);
    }
  };

  const categoryOptions = Array.from(
    new Set([...categoryPresets, ...models.map((item) => (item.category ?? '').trim()).filter(Boolean)]),
  ).map((value) => ({ value }));

  const columns: TableColumnsType<ModelSpec> = [
    {
      title: '模型',
      dataIndex: 'displayName',
      width: 250,
      render: (value: string, row) => (
        <div>
          <Space size={6}>
            <Typography.Text strong>{value}</Typography.Text>
            {row.isDeprecated && <Tag>已废弃</Tag>}
          </Space>
          <div className="sub-text mono">
            {row.modelId} → {row.upstreamModel}
          </div>
        </div>
      ),
    },
    {
      title: '分类',
      dataIndex: 'category',
      width: 100,
      render: (value: string) =>
        value ? <Tag color={categoryColors[value]}>{value}</Tag> : <Typography.Text type="secondary">未分类</Typography.Text>,
    },
    {
      title: '提供商',
      dataIndex: 'provider',
      width: 120,
      render: (value: string) => <Tag>{providerNames[value] ?? value}</Tag>,
    },
    {
      title: '启用',
      dataIndex: 'isEnabled',
      width: 90,
      render: (enabled: boolean, row) =>
        row.isDeprecated ? (
          <Typography.Text type="secondary">已下线</Typography.Text>
        ) : (
          <Switch
            size="small"
            checked={enabled}
            disabled={!canManage}
            loading={savingId === row.modelId}
            onChange={(checked) => toggle(row, checked)}
          />
        ),
    },
    {
      title: '输入费率',
      dataIndex: 'inputRatePer1K',
      width: 100,
      render: (value: number) => `${value} 分/千`,
    },
    {
      title: '输出费率',
      dataIndex: 'outputRatePer1K',
      width: 100,
      render: (value: number) => `${value} 分/千`,
    },
    {
      title: '上下文',
      dataIndex: 'maxContextChars',
      width: 110,
      render: (value: number) => `${value.toLocaleString()} 字`,
    },
    {
      title: '视觉',
      dataIndex: 'supportsVision',
      width: 80,
      render: (value: boolean) => (value ? <Tag color="purple">支持</Tag> : '-'),
    },
    { title: '排序', dataIndex: 'sortOrder', width: 70 },
    {
      title: '备注',
      dataIndex: 'note',
      ellipsis: true,
      render: (value: string) => value || '-',
    },
    ...(canManage
      ? [
          {
            title: '操作',
            key: 'actions',
            width: 200,
            fixed: 'right' as const,
            render: (_: unknown, row: ModelSpec) => (
              <Space size={0} wrap>
                <Button type="link" size="small" onClick={() => openEdit(row)}>
                  编辑
                </Button>
                {row.isDeprecated ? (
                  <Button
                    type="link"
                    size="small"
                    onClick={() =>
                      run(() => adminApi.deprecateModel(row.modelId, false), '模型已恢复，可重新启用')
                    }
                  >
                    恢复
                  </Button>
                ) : (
                  <Popconfirm
                    title="废弃该模型？"
                    description="废弃后插件不再展示该模型，调用历史保留，可随时恢复。"
                    okText="废弃"
                    okButtonProps={{ danger: true }}
                    cancelText="取消"
                    onConfirm={() =>
                      run(() => adminApi.deprecateModel(row.modelId, true), '模型已废弃')
                    }
                  >
                    <Button type="link" size="small" danger>
                      废弃
                    </Button>
                  </Popconfirm>
                )}
                <Popconfirm
                  title="删除该模型？"
                  description="仅未被调用过的模型可删除；已有调用记录的模型请使用废弃。"
                  okText="删除"
                  okButtonProps={{ danger: true }}
                  cancelText="取消"
                  onConfirm={() => run(() => adminApi.deleteModel(row.modelId), '模型已删除')}
                >
                  <Button type="link" size="small" danger>
                    删除
                  </Button>
                </Popconfirm>
              </Space>
            ),
          },
        ]
      : []),
  ];

  const visibleModels = showDeprecated ? models : models.filter((item) => !item.isDeprecated);

  return (
    <div>
      <Typography.Title level={3} className="page-title">
        模型管理
      </Typography.Title>
      <Typography.Paragraph className="page-desc">
        启用开关决定插件里是否可选；废弃后不再下发但保留调用历史。分类会在插件里分组展示，可填 高性价比 / 高级 / 最智能 或自定义。费率按「分 / 千 token」计算，修改后立即生效。
      </Typography.Paragraph>

      <Space wrap style={{ marginBottom: 16, width: '100%', justifyContent: 'space-between' }}>
        <Button icon={<ReloadOutlined />} onClick={refresh}>
          刷新
        </Button>
        <Space wrap>
          <Space size={6}>
            <Switch size="small" checked={showDeprecated} onChange={setShowDeprecated} />
            <Typography.Text type="secondary">显示已废弃</Typography.Text>
          </Space>
          {canManage && (
            <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
              新增模型
            </Button>
          )}
        </Space>
      </Space>

      <Table
        rowKey="modelId"
        size="middle"
        loading={loading}
        columns={columns}
        dataSource={visibleModels}
        scroll={{ x: 1350 }}
        pagination={false}
      />

      <Modal
        title={editor?.mode === 'edit' ? `编辑模型 · ${editor.model.displayName}` : '新增模型'}
        open={!!editor}
        onOk={submit}
        confirmLoading={saving}
        onCancel={() => setEditor(null)}
        okText="保存"
        cancelText="取消"
        width={720}
        forceRender
      >
        <Form form={form} layout="vertical" preserve={false} style={{ marginTop: 16 }}>
          <Row gutter={16}>
            <Col span={12}>
              <Form.Item
                name="modelId"
                label="模型 ID"
                rules={[
                  { required: true, message: '请输入模型 ID' },
                  {
                    pattern: /^[A-Za-z0-9][A-Za-z0-9._:-]{1,63}$/,
                    message: '2-64 位字母、数字、点、下划线、冒号或短横线',
                  },
                ]}
                extra={editor?.mode === 'edit' ? '模型 ID 是插件调用的唯一标识，创建后不可修改' : undefined}
              >
                <Input disabled={editor?.mode === 'edit'} placeholder="例如 glm-4-flash" />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item
                name="provider"
                label="提供商"
                rules={[{ required: true, message: '请选择提供商' }]}
              >
                <Select
                  options={providers.map((item) => ({
                    value: item.provider,
                    label: `${providerNames[item.provider] ?? item.provider}（${item.provider}）`,
                  }))}
                />
              </Form.Item>
            </Col>
          </Row>

          <Row gutter={16}>
            <Col span={12}>
              <Form.Item
                name="displayName"
                label="显示名称"
                rules={[{ required: true, message: '请输入显示名称' }]}
              >
                <Input maxLength={60} placeholder="插件里展示给用户的名称" />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item
                name="upstreamModel"
                label="上游模型名"
                rules={[{ required: true, message: '请输入上游模型名' }]}
                extra="发给提供商接口的 model 字段"
              >
                <Input maxLength={128} placeholder="例如 glm-4-flash" />
              </Form.Item>
            </Col>
          </Row>

          <Row gutter={16}>
            <Col span={12}>
              <Form.Item
                name="inputRatePer1K"
                label="输入费率（分/千 token）"
                rules={[{ required: true, message: '请输入输入费率' }]}
              >
                <InputNumber min={0} max={100000} precision={0} style={{ width: '100%' }} />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item
                name="outputRatePer1K"
                label="输出费率（分/千 token）"
                rules={[{ required: true, message: '请输入输出费率' }]}
              >
                <InputNumber min={0} max={100000} precision={0} style={{ width: '100%' }} />
              </Form.Item>
            </Col>
          </Row>

          <Row gutter={16}>
            <Col span={12}>
              <Form.Item
                name="maxContextChars"
                label="最大上下文字数"
                rules={[{ required: true, message: '请输入上下文字数' }]}
              >
                <InputNumber min={1000} max={200000} step={1000} style={{ width: '100%' }} />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="sortOrder" label="排序">
                <InputNumber min={0} max={9999} precision={0} style={{ width: '100%' }} />
              </Form.Item>
            </Col>
          </Row>

          <Row gutter={16}>
            <Col span={8}>
              <Form.Item
                name="category"
                label="分类"
                extra="插件里按分类分组展示，可自定义"
              >
                <AutoComplete
                  options={categoryOptions}
                  placeholder="例如 高性价比"
                  allowClear
                  filterOption={(input, option) =>
                    String(option?.value ?? '').toLowerCase().includes(input.toLowerCase())
                  }
                />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="supportsVision" label="支持图片输入" valuePropName="checked">
                <Switch />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item
                name="isEnabled"
                label="启用"
                valuePropName="checked"
                extra={editor?.mode === 'edit' && editor.model.isDeprecated ? '已废弃，恢复后才能启用' : undefined}
              >
                <Switch disabled={editor?.mode === 'edit' && editor.model.isDeprecated} />
              </Form.Item>
            </Col>
          </Row>

          <Form.Item name="note" label="备注">
            <Input.TextArea rows={3} maxLength={200} showCount />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
