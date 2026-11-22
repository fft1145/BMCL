# BMCL 访问管理后端

零依赖 Node 服务，用来接收启动器上报的 IP、查看访问记录、禁止指定 IP 并填写原因。

## 启动

```bash
ADMIN_TOKEN=换成你的密码 node server/admin-server.js
```

可选环境变量：

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `PORT` | `8787` | 监听端口 |
| `HOST` | `0.0.0.0` | 监听地址 |
| `DATA_FILE` | `server/data.json` | 数据文件位置 |
| `TRUST_PROXY` | 空 | 部署在 Nginx/CDN 后面时设为 `1`，从 `X-Forwarded-For` 取真实 IP |

管理页：`http://服务器地址:8787/admin`，输入 `ADMIN_TOKEN` 登录后可以：

- 查看每个 IP 的启动次数、版本、系统、首次/最近时间
- 禁止某个 IP，并填写会展示给用户的原因
- 解除封禁

## 接入启动器

服务部署到公网后，在仓库根目录 `launcher-version.json` 里加一行：

```json
"adminApi": "https://你的域名"
```

启动器每次启动会：

1. 读取 `launcher-version.json` 的 `adminApi`
2. `POST /visit` 上报版本与系统，服务端记录真实 IP
3. 如果该 IP 在封禁列表里，弹窗显示原因并退出

未配置 `adminApi` 时不会发起任何网络上报，只在本地 `visit-log.jsonl` 留一条记录。

## 接口

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| POST | `/visit` | 上报启动，返回 `{ip, banned, reason}` |
| GET | `/bans` | 当前封禁列表 |
| GET | `/admin` | 管理网页 |
| POST | `/admin/api` | 管理操作，需 `X-Admin-Token` |

## 安全提醒

- `ADMIN_TOKEN` 只放在服务端环境变量里，不要写进启动器或公开仓库。
- IP 属于个人信息，开启上报前请在启动器介绍或群公告里说明用途与保留期限。
- 建议用 HTTPS（Nginx/Caddy 反向代理），并定期备份 `data.json`。
