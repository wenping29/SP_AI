import { useCallback, useEffect, useState } from 'react';
import {
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
import { adminApi, type AdminRole, type AdminUser } from '@/api/admin';
import { useAuth } from '@/store/auth';
import { formatTime } from '@/utils/format';

type EditorState = { mode: 'create' } | { mode: 'edit'; user: AdminUser } | null;

interface UserFormValues {
  username?: string;
  displayName?: string;
  roleId: number;
  password?: string;
  isDisabled?: boolean;
}

export default function AdminList() {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [roles, setRoles] = useState<AdminRole[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [editor, setEditor] = useState<EditorState>(null);

  const [form] = Form.useForm<UserFormValues>();
  const can = useAuth((s) => s.can);
  const identity = useAuth((s) => s.identity);
  const canManage = can('admins.manage');

  const load = useCallback(async () => {
    const userRows = await adminApi.users();
    setUsers(userRows);
    // 只有能管理管理员时才需要角色下拉；纯查看角色无权读取 /roles
    if (canManage) setRoles(await adminApi.roles());
  }, [canManage]);

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

  const act = async (task: () => Promise<unknown>, success: string) => {
    try {
      await task();
      message.success(success);
      await load();
    } catch {
      // 请求拦截器已提示错误
    }
  };

  const openCreate = () => {
    form.resetFields();
    form.setFieldsValue({ roleId: roles[0]?.id, isDisabled: false });
    setEditor({ mode: 'create' });
  };

  const openEdit = (user: AdminUser) => {
    form.setFieldsValue({
      username: user.username,
      displayName: user.displayName,
      roleId: user.roleId,
      password: '',
      isDisabled: user.isDisabled,
    });
    setEditor({ mode: 'edit', user });
  };

  const submit = async () => {
    if (!editor) return;
    const values = await form.validateFields();
    setSaving(true);
    try {
      if (editor.mode === 'create') {
        await adminApi.createUser({
          username: values.username!.trim(),
          displayName: values.displayName?.trim() || undefined,
          roleId: values.roleId,
          password: values.password!,
        });
        message.success('管理员已新增');
      } else {
        await adminApi.updateUser(editor.user.id, {
          displayName: values.displayName?.trim() ?? '',
          roleId: values.roleId,
          password: values.password ? values.password : undefined,
          isDisabled: values.isDisabled,
        });
        message.success('管理员已更新');
      }

      setEditor(null);
      await load();
    } catch {
      // 校验失败或请求失败，提示已在表单/拦截器里显示
    } finally {
      setSaving(false);
    }
  };

  const isSelf = (user: AdminUser) => identity?.id === user.id;

  const columns: TableColumnsType<AdminUser> = [
    {
      title: '管理员',
      key: 'user',
      width: 220,
      render: (_, row) => (
        <div>
          <Typography.Text strong>{row.displayName}</Typography.Text>
          <div className="sub-text mono">{row.username}</div>
        </div>
      ),
    },
    {
      title: '角色',
      dataIndex: 'roleName',
      width: 150,
      render: (value: string) => <Tag color="geekblue">{value}</Tag>,
    },
    {
      title: '状态',
      dataIndex: 'isDisabled',
      width: 110,
      render: (value: boolean) =>
        value ? <Tag color="red">已停用</Tag> : <Tag color="green">启用</Tag>,
    },
    {
      title: '最近登录',
      dataIndex: 'lastLoginAt',
      width: 180,
      render: (value: string | null) => formatTime(value),
    },
    {
      title: '创建时间',
      dataIndex: 'createdAt',
      width: 180,
      render: (value: string) => formatTime(value),
    },
    ...(canManage
      ? [
          {
            title: '操作',
            key: 'actions',
            width: 220,
            render: (_: unknown, row: AdminUser) => (
              <Space size={0} wrap>
                <Button type="link" size="small" onClick={() => openEdit(row)}>
                  编辑
                </Button>
                <Button
                  type="link"
                  size="small"
                  disabled={isSelf(row)}
                  onClick={() =>
                    act(
                      () => adminApi.updateUser(row.id, { isDisabled: !row.isDisabled }),
                      row.isDisabled ? '已启用该账号' : '已停用该账号',
                    )
                  }
                >
                  {row.isDisabled ? '启用' : '停用'}
                </Button>
                <Popconfirm
                  title="删除该管理员？"
                  description="删除后其登录会话立即失效，操作不可恢复。"
                  okText="删除"
                  okButtonProps={{ danger: true }}
                  cancelText="取消"
                  disabled={isSelf(row)}
                  onConfirm={() => act(() => adminApi.deleteUser(row.id), '已删除')}
                >
                  <Button type="link" size="small" danger disabled={isSelf(row)}>
                    删除
                  </Button>
                </Popconfirm>
              </Space>
            ),
          },
        ]
      : []),
  ];

  return (
    <div>
      <Typography.Title level={3} className="page-title">
        管理员
      </Typography.Title>
      <Typography.Paragraph className="page-desc">
        管理后台登录账号；与插件端注册的普通用户分表管理。角色决定可访问的模块，密码只保存哈希。
      </Typography.Paragraph>

      <Space wrap style={{ marginBottom: 16, width: '100%', justifyContent: 'space-between' }}>
        <Button icon={<ReloadOutlined />} onClick={refresh}>
          刷新
        </Button>
        {canManage && (
          <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
            新增管理员
          </Button>
        )}
      </Space>

      <Table
        rowKey="id"
        size="middle"
        loading={loading}
        columns={columns}
        dataSource={users}
        pagination={false}
      />

      <Modal
        title={editor?.mode === 'edit' ? '编辑管理员' : '新增管理员'}
        open={!!editor}
        onOk={submit}
        confirmLoading={saving}
        onCancel={() => setEditor(null)}
        okText="保存"
        cancelText="取消"
        forceRender
      >
        <Form form={form} layout="vertical" preserve={false}>
          {editor?.mode === 'create' && (
            <Form.Item
              name="username"
              label="用户名"
              rules={[
                { required: true, message: '请输入用户名' },
                {
                  pattern: /^[A-Za-z0-9_.-]{3,32}$/,
                  message: '需为 3-32 位字母、数字、下划线、点或短横线',
                },
              ]}
            >
              <Input placeholder="登录用户名" autoComplete="off" />
            </Form.Item>
          )}

          <Form.Item name="displayName" label="显示名称">
            <Input placeholder="留空则使用用户名" maxLength={50} />
          </Form.Item>

          <Form.Item
            name="roleId"
            label="角色"
            rules={[{ required: true, message: '请选择角色' }]}
            extra={
              editor?.mode === 'edit' && isSelf(editor.user)
                ? '不能修改自己的角色，请让其他管理员操作'
                : undefined
            }
          >
            <Select
              disabled={editor?.mode === 'edit' && isSelf(editor.user)}
              options={roles.map((role) => ({ value: role.id, label: role.name }))}
            />
          </Form.Item>

          <Form.Item
            name="password"
            label={editor?.mode === 'edit' ? '重置密码' : '密码'}
            rules={[
              {
                validator: (_, value?: string) => {
                  if (editor?.mode === 'edit' && !value) return Promise.resolve();
                  if (!value) return Promise.reject(new Error('请输入密码'));
                  return value.length >= 8
                    ? Promise.resolve()
                    : Promise.reject(new Error('密码至少 8 位'));
                },
              },
            ]}
            extra={editor?.mode === 'edit' ? '留空表示不修改密码' : '至少 8 位'}
          >
            <Input.Password placeholder="登录密码" autoComplete="new-password" />
          </Form.Item>

          {editor?.mode === 'edit' && (
            <Form.Item
              name="isDisabled"
              label="启用账号"
              valuePropName="checked"
              getValueProps={(value) => ({ checked: !value })}
              getValueFromEvent={(checked: boolean) => !checked}
              extra={isSelf(editor.user) ? '不能停用自己的账号' : undefined}
            >
              <Switch disabled={isSelf(editor.user)} />
            </Form.Item>
          )}
        </Form>
      </Modal>
    </div>
  );
}
