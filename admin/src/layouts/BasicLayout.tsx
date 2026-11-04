import { useState } from 'react';
import { Layout, Menu, Button, Tag, Space, Typography } from 'antd';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import {
  ApiOutlined,
  ControlOutlined,
  DashboardOutlined,
  DesktopOutlined,
  KeyOutlined,
  LogoutOutlined,
  ThunderboltFilled,
} from '@ant-design/icons';
import type { MenuProps } from 'antd';
import { useAuth } from '@/store/auth';

const { Sider, Header, Content } = Layout;

const items: MenuProps['items'] = [
  { key: '/dashboard', icon: <DashboardOutlined />, label: '仪表盘' },
  { key: '/devices', icon: <DesktopOutlined />, label: '设备管理' },
  { key: '/models', icon: <ApiOutlined />, label: '模型管理' },
  { key: '/policy', icon: <ControlOutlined />, label: '运营策略' },
  { key: '/providers', icon: <KeyOutlined />, label: 'KeyEnv 管理' },
];

export default function BasicLayout() {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const logout = useAuth((s) => s.logout);
  const [collapsed, setCollapsed] = useState(false);

  const onLogout = () => {
    logout();
    navigate('/login', { replace: true });
  };

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
            <Tag color="green">管理密钥已连接</Tag>
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
