# SP AI 助手

面向国内用户的网页 AI 助手：Edge 侧边栏扩展 + ASP.NET Core 模型网关 + React 管理后台。

用户在网页侧边栏里总结、列大纲、翻译、解释划线、润色改写或直接问答；服务端统一代持各家大模型 Key，按积分计费；运营人员通过后台管理模型、积分、密钥与管理员权限。

## 功能特性

**侧边栏扩展**
- 网页总结、大纲、翻译、解释、润色，以及自由多轮对话
- 读取当前页面正文、网页框选区域截图提问、截图标绘（矩形/圆圈/画笔/马赛克）、图片问答、语音输入
- 国产大模型切换，按「高性价比 / 高级 / 最智能」等分类分组展示
- 积分余额与流水展示，模型不可用时明确提示
- 邮箱验证码注册与登录，积分和聊天记录跟随账号；未登录可匿名试用，登录后合并本机积分与本机聊天记录

**服务端网关**
- 统一代理智谱、DeepSeek、阿里云百炼、百度千帆、硅基流动
- KeyEnv 多条目密钥管理，支持新增、启用、废弃、删除，环境变量优先
- 积分预扣与按量结算，失败自动退回
- 对话 SSE 流式返回，支持视觉输入与语音转写

**管理后台**
- 仪表盘：用户、余额、调用与消耗统计
- 设备管理：搜索设备、查看设备绑定的用户账号、封禁/解封；积分不挂在设备上
- 积分管理：按注册用户查看余额、累计消耗与调用次数，支持增加、扣减、直接设为指定余额；手工调账不计入消费统计
- 模型管理：新增/编辑/删除/废弃，费率、上下文、视觉能力与分类
- 运营策略：注册赠送积分、对话开关、公告
- KeyEnv 管理：多密钥轮换、启用与废弃
- 用户管理：插件端注册用户的新增、编辑、重置密码、封禁/解封与删除，与后台管理员分表存储
- 管理员与角色：后台管理员账号增删改，角色按模块授权（查看/管理）

## 项目结构

```
sp/
├─ edge/                 # Edge Manifest V3 扩展（侧边栏 + 页面提取脚本）
│  ├─ sidepanel/         # 侧边栏页面、样式与逻辑
│  ├─ content/           # 内容脚本
│  ├─ shared/            # 正文提取等共享脚本
│  └─ background.js      # 右键菜单、划词入口、打开侧边栏
├─ server/               # ASP.NET Core 10 + EF Core + SQLite
│  ├─ Program.cs         # 服务注册、中间件与启动迁移（HTTP 接口已迁至 Controllers）
│  ├─ Controllers/       # 按业务域分组的 API：公开接口 / 后台接口各自成类
│  ├─ Contracts/         # 请求体 DTO（按域被各控制器引用）
│  ├─ Filters/           # 后台统一鉴权与权限过滤
│  ├─ Domain/            # 实体
│  ├─ Services/          # 计费、模型网关、密钥解析、邮件、管理员鉴权
│  ├─ Data/              # DbContext 与种子
│  ├─ wwwroot/admin/     # 后台构建产物（gitignore）
│  └─ appsettings.json
├─ admin/                # React 18 + Vite + Ant Design 管理后台
└─ tests-web/            # 本地验证脚本与截图（开发辅助，非运行必需）
```

## 快速开始

### 环境要求

- .NET SDK 10
- Node.js 20+（构建管理后台）
- Edge / Chrome（加载未打包扩展）

### 1. 启动后端

```bash
cd server
dotnet run
```

默认监听 `http://127.0.0.1:5080`，首次启动会自动创建 SQLite 数据库 `server/sp.db`、表结构、内置角色与种子模型，并创建初始管理员 `admin`（密码见「管理员登录与初始化」）。

健康检查：`GET http://127.0.0.1:5080/health`

### 2. 启动管理后台

开发模式（Vite 5174，`/api` 代理到本地后端）：

```bash
cd admin
npm install
npm run dev
```

后端接口地址统一在 `admin/.env` 里配置，无需改代码：

| 变量 | 作用 | 默认值 |
| --- | --- | --- |
| `VITE_API_BASE` | 请求的 baseURL，构建时编译进产物 | `/api`（同源，走反代） |
| `VITE_DEV_PROXY_TARGET` | 仅 `npm run dev`：Vite 把 `/api` 代理到哪个后端 | `http://127.0.0.1:7788` |

后端在另一台机器且没有反向代理时，把 `VITE_API_BASE` 改成 `http://IP:7788/api`。个人本地覆盖写在 `admin/.env.local`（已在 gitignore 中，优先级高于 `.env`）。

构建到后端托管目录，之后访问 `http://127.0.0.1:5080/admin/`：

```bash
npm run build:server
```

> `server/src/wwwroot/admin` 已在 gitignore 中，每次更新后台代码后都需要重新构建。

### 3. 加载 Edge 扩展

1. 打开 `edge://extensions`，开启“开发人员模式”
2. 选择“加载解压缩的扩展”，指向仓库的 `edge/` 目录
3. 点击工具栏图标打开侧边栏即可使用；后端地址写死在 `edge/config.js`，发布打包时由 `tools/pack-extension.py --server` 改写
4. 修改扩展代码后，在扩展管理页点“重新加载”

扩展需要站点访问权限才能读取网页正文；若提示无法读取页面，请检查扩展的“网站访问权限”。

## 管理员登录与初始化

**初始管理员账号**

| 用户名 | 初始密码 | 角色 |
| --- | --- | --- |
| `admin` | `SpInit@7Kq9xT2m` | 超级管理员 |

首次启动时，如果 `AdminUsers` 表为空，服务端会自动创建该账号（当前仓库内的 `server/sp.db` 已经创建好）。用「账号登录」页签登录即可，会话 12 小时过期。

> 该密码写在 README 里，仅用于首次进入。登录后请立刻在「管理员」中修改；生产环境也可以在启动前用环境变量 `Admin__InitialPassword` 覆盖，避免继续使用默认值。账号只在用户表为空时创建，重启不会重置已修改的密码。

账号初始化配置：

| 配置项 | 说明 | 默认 |
| --- | --- | --- |
| `Admin:InitialUsername` | 初始管理员用户名 | `admin` |
| `Admin:InitialPassword` | 初始管理员密码，少于 8 位或留空则跳过自动创建 | `SpInit@7Kq9xT2m` |

**应急密钥（Admin__Key）**

当前配置的应急密钥（已写入 `server/src/appsettings.json`）：

| 用途 | 值 |
| --- | --- |
| 登录页「应急密钥」 | `3591b2e1a3b697cfce19445b4a2a1bdebb7a1e7e2f4d4dd69fd1e19d647f3ea8` |

生成一个 64 位十六进制随机串（任选一种）：

```bash
# Linux / macOS / Git Bash
openssl rand -hex 32
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

```powershell
# PowerShell
[Convert]::ToHexString([Security.Cryptography.RandomNumberGenerator]::GetBytes(32)).ToLower()
```

把生成的串配置到环境变量（优先级更高）或 `appsettings.json`：

```bash
# 示例：临时启动
Admin__Key=生成的随机串 dotnet run
```

```json
// 或 appsettings.json
"Admin": { "Key": "生成的随机串" }
```

登录页切到“应急密钥”页签输入即可，权限等同全部模块；留空则禁用。该密钥不过期，属于长期总钥匙，建议只在应急时使用。

> 上面的密钥已随仓库提交，仅用于本地开发。对外部署前必须重新生成并替换，否则任何拿到仓库的人都能直接进入后台。

**手动创建账号**

已有管理员或在应急密钥模式下，也可以调用接口新增账号：

```bash
curl -X POST http://127.0.0.1:5080/api/admin/users \
  -H "X-Admin-Key: $Admin__Key" \
  -H "Content-Type: application/json" \
  -d '{"username":"operator","displayName":"运营同学","roleId":2,"password":"请换成强密码"}'
```

`roleId=1` 为内置“超级管理员”，`roleId=2` 为“运营”。

内置角色：

| 角色 | 权限范围 |
| --- | --- |
| 超级管理员 | 全部模块（系统内置，不可删除/改权限） |
| 运营 | 设备、积分的查看与管理，模型、策略、KeyEnv |
| 只读 | 各模块只读 |

密码使用 ASP.NET Core `PasswordHasher` 哈希存储，无法反查；忘记密码只能由其他管理员重置。

权限键里 `users.*` 管插件端普通用户（`Users` 表），`admins.*` 管后台管理员（`AdminUsers` 表），两套账号分表存储。普通用户接口为 `/api/admin/members`（列表、新增、编辑、封禁、删除），管理员接口仍为 `/api/admin/users`。

## 配置说明

后端配置位于 `server/src/appsettings.json`，也支持环境变量（`Section__Key` 形式，如 `Admin__Key`）。

| 配置项 | 说明 | 默认 |
| --- | --- | --- |
| `ConnectionStrings:Db` | SQLite 连接串 | `Data Source=sp.db` |
| `Server:Host` / `Server:Port` | 监听地址与端口 | `127.0.0.1:5080` |
| `AllowedOrigins` | CORS 白名单；留空时使用后台「服务器配置」里填写的来源，两处都空则放开所有来源 | 空 |
| `MaxOutputTokens` | 单次回复最大 token | `1024` |
| `Transcribe:Enabled` | 是否开放语音转写 | `true` |
| `Transcribe:Provider` / `Model` | 语音转写提供商与模型 | dashscope / qwen3-asr-flash |
| `Transcribe:CreditsPerCall` | 每次转写扣分 | `3` |
| `Admin:Key` | 应急管理密钥，留空则禁用 | 空 |
| `Providers:{name}:BaseUrl` | 各提供商接口地址 | 见配置文件 |
| `Providers:{name}:KeyEnv` | 各提供商读取的密钥环境变量名 | `{PROVIDER}_API_KEY` |
| `Security:KeysPath` | Data Protection 密钥目录 | `keys` |

`appsettings.Production.json` 中把监听地址设为 `0.0.0.0:7788`，使用 `ASPNETCORE_ENVIRONMENT=Production` 启动即可对外提供服务。

### 提供商密钥

密钥解析顺序：

1. 环境变量（如 `DEEPSEEK_API_KEY`）
2. 数据库中启用的 KeyEnv 条目（后台录入，Data Protection 加密保存）

环境变量优先，适合在服务器上通过系统环境注入；日常轮换可在后台“KeyEnv 管理”里新增条目并启用。明文密钥只在内存中出现，不写日志、不进流水。

## 计费规则

- 新设备匿名使用赠送 200 体验积分；邮箱验证码注册成功的新用户按“运营策略”里的 `FreeCredits` 发放一次（默认 1000），登录/注册时本机体验积分并入账号
- 文本按千 token 向上取整计费：`ceil(tokens / 1000) × 单价`，输入与输出分别计算
- 图片按约 800 token/张估算；语音转写按次固定扣分
- 对话失败或用户中止时按实际用量结算，多预扣部分自动退回
- 后台手工调分（增加/扣减/设为余额）计入流水，但不计入“累计消耗/调用次数”
- 模型单价、上下文上限、启用状态与分类都在后台“模型管理”中维护

## 邮箱验证

注册账号需要先获取邮箱验证码：

- 验证码为 6 位数字，默认 10 分钟有效，校验通过后立即作废
- 同一邮箱 60 秒内只能发一次，每小时最多 5 次；同一 IP 每小时最多 20 次；单个验证码最多尝试 5 次
- 验证码只存 SHA-256 哈希，不落明文
- 新设备匿名账号初始 200 体验积分，登录/注册后并入用户账号；注册赠送只发一次，避免换设备刷注册额度

邮件通过 SMTP 发送。**日常在后台「服务器配置」页维护**（保存即生效，密码加密存库、不回显），首次启动会按 `server/src/appsettings.json` 的 `Email` 段播种，环境变量 `Email__*` 仍然优先：

| 配置项 | 说明 | 默认 |
| --- | --- | --- |
| `Email:Enabled` | 是否启用 SMTP 发送 | `false` |
| `Email:Host` | SMTP 服务器，如 `smtp.qq.com` | 空 |
| `Email:Port` | 端口，常见 465 / 587 | `465` |
| `Email:UseImplicitTls` | 465 隐式 TLS 设为 `true`；587/25 走 STARTTLS 设为 `false` | `true` |
| `Email:User` | SMTP 登录账号 | 空 |
| `Email:Password` | SMTP 密码或授权码，建议只用环境变量注入 | 空 |
| `Email:From` | 发件地址，留空则用 `Email:User` | 空 |
| `Email:FromName` | 发件人显示名 | `SP 助手` |
| `Email:CodeMinutes` | 验证码有效期（分钟） | `10` |
| `Email:ExposeDevCode` | 未配置 SMTP 时在接口响应里返回验证码，仅限本地开发 | `false` |

示例（密码不要写进仓库）：

```bash
Email__Enabled=true \
Email__Host=smtp.qq.com \
Email__Port=465 \
Email__User=you@qq.com \
Email__Password=邮箱授权码 \
Email__From=you@qq.com \
dotnet run
```

未配置 SMTP 时 `/api/auth/email-code` 会返回 503 `email_not_configured`，注册不可用；本地联调可临时设置 `Email__ExposeDevCode=true`，接口会直接带回 `devCode`。

## 聊天记录同步

- 聊天记录仍以本机 `chrome.storage.local` 为主；未登录时不会上传。
- 登录账号后，本机已有记录会并入账号；在其他设备登录同一账号会拉取云端记录，按会话更新时间取较新的一份。
- 删除会话会写一条 30 天的本地删除标记并同步删除云端记录，避免下次同步又恢复回来。
- 换账号登录时不会把上一个账号留在本机的记录并入新账号。
- 服务端限制：单账号最多 100 个会话，单会话最多 200 条消息、约 1MB 内容；插件端上传时只带最近 60 条，单条提示词截断到 4000 字。

## API 概览

公开接口：

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/health` | 健康检查 |
| POST | `/api/device/register` | 设备注册，返回访问 token 与初始余额 |
| GET | `/api/config` | 模型列表、费率、公告、语音配置 |
| GET | `/api/credits` | 当前余额与最近流水 |
| POST | `/api/auth/email-code` | 发送邮箱注册验证码 |
| POST | `/api/auth/register`、`/api/auth/login`、`/api/auth/logout`、`/api/auth/me` | 账号注册（需验证码）、登录、退出与当前账号 |
| GET | `/api/conversations` | 当前账号的聊天记录列表（需账号登录，匿名设备不可用） |
| GET / PUT / DELETE | `/api/conversations/{clientId}` | 读取、整段上传或删除单个会话 |
| POST | `/api/chat` | 对话（SSE 流式） |
| POST | `/api/transcribe` | 语音转写（multipart 文件） |

管理接口位于 `/api/admin/*`，通过 `X-Admin-Token`（账号登录）或 `X-Admin-Key`（应急密钥）鉴权，按模块权限校验：

- `auth/*`、`stats`
- `devices/*`、`credits/*`
- `models/*`、`model-providers`
- `policy`
- `providers/*`、`keyenvs/*`
- `users/*`、`roles/*`

## 数据与迁移

- 数据库为单文件 SQLite，默认 `server/sp.db`，`*.db` 已被 gitignore
- 启动时执行 `EnsureCreated()`，并幂等补齐老库缺失的表与列（如 `IsDeprecated`、`Category`）
- 老库新增列时只会回填一次种子模型的默认值，不会覆盖后台已修改的数据
- 修改后端表结构后需要重启后端才会应用迁移
- Data Protection 密钥默认在 `server/src/keys`，用于解密数据库中的提供商密钥；丢失后需要重新录入所有 Key，务必只保留在服务器上

## 部署建议

- Linux 服务器（Nginx + .NET 10 运行时）的完整步骤见 [deploy/DEPLOY.md](deploy/DEPLOY.md)，打包命令见 [deploy/pack.sh](deploy/pack.sh)
- 后台「服务器配置」页可维护 SMTP 与插件允许来源，保存即生效，不需要改文件重启
- 对外部署时把允许来源设为固定的扩展来源（如 `chrome-extension://<扩展ID>`），并启用 HTTPS
- 首次登录后立即修改 `admin` 的默认密码；或在启动前用 `Admin__InitialPassword` 指定自己的初始密码
- 对外部署前重新生成 `Admin__Key` 并替换仓库里的默认值；不需要应急入口时直接清空，只保留账号登录
- 按最小权限为运营人员分配角色，不要共用超级管理员账号
- 反向代理（Nginx / Caddy）转发到 `5080` 或 `7788`，注意 SSE 需要关闭缓冲
- 备份 `sp.db` 与 `server/src/keys`，两者需配套，只备份数据库无法解密密钥

## 常见问题

**后台打开是 404 或旧页面**

执行 `cd admin && npm run build:server`，并确认 `server/src/wwwroot/admin/index.html` 存在。

**登录页没有可用账号**

首次启动且用户表为空时会自动创建 `admin` / `SpInit@7Kq9xT2m`。如果已手动清空过管理员表，也可用 `Admin__Key` 登录后重新创建账号。

**插件提示连不上服务**

检查 `edge/config.js` 里写死的服务地址、后端是否监听该地址，以及 `AllowedOrigins` 是否允许扩展来源。

**扩展提示无法读取页面**

在 `edge://extensions` 的扩展详情里确认“网站访问权限”覆盖当前站点。

**插件显示“服务已暂停”或模型列表为空**

检查“运营策略”里对话是否开启，以及“KeyEnv 管理”里对应提供商是否有启用且可用的密钥。

**改了代码但行为没变化**

后端需重启；扩展需在扩展管理页重新加载；后台需重新构建并强刷页面。
