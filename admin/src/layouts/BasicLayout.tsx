import { useEffect, useState, type ReactNode } from 'react';
import { Layout, Menu, Button, Spin, Tag, Space, Typography } from 'antd';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import {
  ApiOutlined,
  ControlOutlined,
  CloudServerOutlined,
  DashboardOutlined,
  DesktopOutlined,
  IdcardOutlined,
  KeyOutlined,
  LogoutOutlined,
  MoneyCollectOutlined,
  SafetyCertificateOutlined,
  TeamOutlined,
  ThunderboltFilled,
  UserSwitchOutlined,
  WalletOutlined,
} from '@ant-design/icons';
import type { MenuProps } from 'antd';
import { adminApi } from '@/api/admin';
import { useAuth } from '@/store/auth';

const { Sider, Header, Content } = Layout;

interface MenuEntry {
  key: string;
  icon: ReactNode;
  label: string;
  permission: string;
}

const menuEntries: MenuEntry[] = [
  { key: '/dashboard', icon: <DashboardOutlined />, label: '仪表盘', permission: 'dashboard.view' },
  { key: '/devices', icon: <DesktopOutlined />, label: '设备管理', permission: 'devices.view' },
  { key: '/credits', icon: <MoneyCollectOutlined />, label: '积分管理', permission: 'devices.view' },
  { key: '/models', icon: <ApiOutlined />, label: '模型管理', permission: 'models.view' },
  { key: '/policy', icon: <ControlOutlined />, label: '运营策略', permission: 'policy.view' },
  { key: '/payments', icon: <WalletOutlined />, label: '充值管理', permission: 'policy.view' },
  { key: '/providers', icon: <KeyOutlined />, label: 'KeyEnv 管理', permission: 'keyenvs.view' },
  { key: '/server', icon: <CloudServerOutlined />, label: '服务器配置', permission: 'server.view' },
  { key: '/users', icon: <TeamOutlined />, label: '用户管理', permission: 'users.view' },
  { key: '/admins', icon: <IdcardOutlined />, label: '管理员', permission: 'admins.view' },
  { key: '/roles', icon: <UserSwitchOutlined />, label: '角色管理', permission: 'roles.view' },
];

export default function BasicLayout() {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const identity = useAuth((s) => s.identity);
  const token = useAuth((s) => s.token);
  const key = useAuth((s) => s.key);
  const can = useAuth((s) => s.can);
  const setIdentity = useAuth((s) => s.setIdentity);
  const logout = useAuth((s) => s.logout);
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    if (identity) return;
    if (!token && !key) {
      navigate('/login', { replace: true });
      return;
    }

    adminApi
      .me()
      .then(setIdentity)
      .catch(() => {
        logout();
        navigate('/login', { replace: true });
      });
  }, [identity, token, key, navigate, setIdentity, logout]);

  const onLogout = async () => {
    try {
      await adminApi.logout();
    } catch {
      // 会话已失效也继续清理本地状态
    }
    logout();
    navigate('/login', { replace: true });
  };

  if (!identity) {
    return (
      <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center' }}>
        <Spin size="large" />
      </div>
    );
  }

  const items: MenuProps['items'] = menuEntries
    .filter((item) => can(item.permission))
    .map((item) => ({ key: item.key, icon: item.icon, label: item.label }));

  return (
    <Layout style={{ minHeight: '100vh' }}>
      <Sider
        theme="dark"
        width={220}
        breakpoint="lg"
        collapsible
        collapsed={collapsed}
        onCollapse={setCollapsed}
      >
        <div
          style={{
            height: 64,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 8,
            color: '#fff',
            fontWeight: 600,
            fontSize: 16,
            overflow: 'hidden',
            whiteSpace: 'nowrap',
          }}
        >
          <ThunderboltFilled style={{ color: '#60a5fa', fontSize: 20 }} />
          {!collapsed && <span>SP 管理后台</span>}
        </div>
        <Menu
          theme="dark"
          mode="inline"
          selectedKeys={[pathname]}
          items={items}
          onClick={({ key }) => navigate(key)}
        />
      </Sider>

      <Layout>
        <Header
          style={{
            background: '#fff',
            padding: '0 24px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            borderBottom: '1px solid #f0f0f0',
          }}
        >
          <Typography.Text strong>AI 助手运营控制台</Typography.Text>
          <Space>
            {identity.source === 'key' && (
              <Tag color="orange" icon={<SafetyCertificateOutlined />}>
                应急密钥
              </Tag>
            )}
            <Tag color="blue">{identity.displayName}</Tag>
            <Tag>{identity.roleName}</Tag>
            <Button icon={<LogoutOutlined />} onClick={onLogout}>
              退出
            </Button>
          </Space>
        </Header>

        <Content
          style={{
            margin: 16,
            padding: 20,
            background: '#fff',
            borderRadius: 12,
            minHeight: 280,
          }}
        >
          <Outlet />
        </Content>
      </Layout>
    </Layout>
  );
}
