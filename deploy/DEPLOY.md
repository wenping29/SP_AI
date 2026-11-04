# SP 后端部署（Linux + Nginx + .NET 10）

本包是 framework-dependent 的 linux-x64 发布物，服务器上需要 ASP.NET Core 10 运行时，不需要 SDK。

## 包内结构

```
sp-server/
  SpServer                 可执行文件
  SpServer.dll             主程序
  *.dll / runtimes/       依赖
  appsettings.json         默认配置（127.0.0.1:5080）
  appsettings.Production.json  生产监听 0.0.0.0:7788（会被 ASPNETCORE_URLS 覆盖）
  wwwroot/admin/           管理后台静态页（/admin/）
  DEPLOY.md                本文件
  deploy/sp.service        systemd 单元
  deploy/nginx-sp.conf     Nginx 站点示例
  deploy/sp.env.example    环境变量模板
```

数据不在包里：首次启动会自动建库、建表、写入内置角色/模型/初始管理员。

## 1. 安装运行时

Ubuntu / Debian（推荐微软官方源）：

```bash
sudo apt-get update
sudo apt-get install -y dotnet-aspnetcore-runtime-10.0
dotnet --list-runtimes | grep AspNetCore
```

没有配好软件源时，可用官方脚本：

```bash
curl -sSL https://dot.net/v1/dotnet-install.sh | sudo bash -s -- \
  --channel 10.0 --runtime aspnetcore --install-dir /usr/share/dotnet
sudo ln -sf /usr/share/dotnet/dotnet /usr/bin/dotnet
```

## 2. 解压与目录

```bash
sudo useradd --system --home /opt/sp --shell /usr/sbin/nologin sp
sudo mkdir -p /opt/sp /var/lib/sp /etc/sp
sudo tar -xzf sp-server-linux-x64-*.tar.gz -C /opt/sp --strip-components=1
sudo chmod +x /opt/sp/SpServer
sudo chown -R sp:sp /opt/sp /var/lib/sp
```

`/var/lib/sp` 存放 `sp.db` 与 `keys/`（Data Protection 密钥环），升级时**不要动它**。

## 3. 环境变量

```bash
sudo cp /opt/sp/deploy/sp.env.example /etc/sp/sp.env
sudo vi /etc/sp/sp.env          # 至少改 Admin__InitialPassword 和 Admin__Key
sudo chmod 600 /etc/sp/sp.env
sudo chown root:root /etc/sp/sp.env
```

要点：

- `ASPNETCORE_URLS=http://127.0.0.1:7788`：只监听本机，由 Nginx 反代。需要直连再改成 `0.0.0.0:7788`。
- `ConnectionStrings__Db` 与 `Security__KeysPath` 必须指向 `/var/lib/sp`，否则 systemd 的只读保护会让写入失败。
- `Email__*` 与 `DEEPSEEK_API_KEY` 等**可以完全不写**，登录后台用「服务器配置」「KeyEnv 管理」维护即可；环境变量优先级更高。

## 4. systemd

```bash
sudo cp /opt/sp/deploy/sp.service /etc/systemd/system/sp.service
sudo systemctl daemon-reload
sudo systemctl enable --now sp
sudo systemctl status sp --no-pager
curl -s http://127.0.0.1:7788/health     # {"ok":true,...}
```

查看日志：`sudo journalctl -u sp -f`

## 5. Nginx

```bash
sudo cp /opt/sp/deploy/nginx-sp.conf /etc/nginx/conf.d/sp.conf
sudo vi /etc/nginx/conf.d/sp.conf        # 改 server_name
sudo nginx -t && sudo systemctl reload nginx
```

HTTPS（有域名时）：

```bash
sudo apt-get install -y certbot python3-certbot-nginx
sudo certbot --nginx -d sp.example.com
```

配置里已经关掉 `proxy_buffering`（聊天是 SSE 流式返回）并把 `client_max_body_size` 调到 25m（语音上传）。

> 如果暂时不接 Nginx、直接暴露 7788，记得在云安全组放行端口，并把 `ASPNETCORE_URLS` 改成 `http://0.0.0.0:7788`。

## 6. 首次配置（浏览器）

1. 打开 `https://你的域名/admin/`，用 `/etc/sp/sp.env` 里的初始管理员登录，**立刻修改密码**。
2. 「服务器配置」→ 填写 SMTP（QQ 邮箱用授权码，465 端口开隐式 TLS），点「发送测试邮件」确认能收到。
3. 「KeyEnv 管理」→ 为 deepseek 等提供商的启用条目填入上游密钥（环境变量已注入的会显示来源为 env）。
4. 「服务器配置」→ 插件允许来源填 `chrome-extension://<扩展ID>`。扩展 ID 在 Edge「扩展」页可以看到；留空则放开所有来源。
5. 「运营策略」「模型管理」按需调整。

## 7. 插件

`sp-extension-<版本>.zip` 与后端包在同一目录（`deploy/dist/`）：

- 自用/内测：解压后在 `edge://extensions` 打开开发者模式，选择「加载解压缩的扩展」。
- 分发：直接上传到 Edge 加载项商店；或发给用户解压加载。
- 包内默认服务器地址在打包时通过 `tools/pack-extension.py --server https://你的域名` 指定，用户也可以在侧边栏「设置 → 服务器地址」里改。

## 8. 升级与回滚

```bash
sudo systemctl stop sp
sudo mv /opt/sp /opt/sp.bak-$(date +%F)
sudo mkdir /opt/sp
sudo tar -xzf sp-server-linux-x64-新版本.tar.gz -C /opt/sp --strip-components=1
sudo chown -R sp:sp /opt/sp
sudo systemctl start sp
```

- `/var/lib/sp`（库 + 密钥环）和 `/etc/sp/sp.env` 保持不动；启动时会幂等补表、补列。
- 回滚：停服务，把旧目录换回来，再启动。新旧版本共用同一个库，回滚前建议先备份。

## 9. 备份

```bash
sudo mkdir -p /var/backups/sp
sudo sqlite3 /var/lib/sp/sp.db "VACUUM INTO '/var/backups/sp/sp-$(date +%F).db'"
sudo tar -czf /var/backups/sp/keys-$(date +%F).tar.gz -C /var/lib/sp keys
```

`sp.db` 和 `keys/` 必须成对备份：只恢复数据库不恢复密钥环，后台保存的 SMTP 密码与提供商密钥都解不开，需要重新录入。

## 10. 排错

| 现象 | 排查 |
| --- | --- |
| 502 Bad Gateway | `systemctl status sp`、`journalctl -u sp -n 100`，确认 7788 在监听 |
| 插件报 CORS / 预检失败 | 后台「服务器配置」的允许来源是否包含 `chrome-extension://<扩展ID>` |
| 注册返回 503 `email_not_configured` | 后台「服务器配置」启用 SMTP 并填完必填项，或临时开「验证码回显」联调 |
| 模型报「暂未开放」 | 「KeyEnv 管理」里该 provider 是否有启用且填了密钥的条目 |
| 聊天不流式输出 | Nginx 缺 `proxy_buffering off;` |
| 语音/附件上传 413 | 调大 Nginx `client_max_body_size` |
| 时间显示差 8 小时 | 数据库存的是 UTC，后台/插件已按本地时区格式化；不要改服务器时区去"修"数据 |
