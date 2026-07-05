# Lucky Luxe 小程序演示版

这是一个基于需求文档实现的 Lucky Luxe 微信小程序与网页版演示项目。小程序客户端已接入后端 API；微信登录需要在线上后端配置小程序 AppID/AppSecret 环境变量后才能真实测试。

## 打开方式

1. 打开微信开发者工具。
2. 选择“导入项目”。
3. 项目目录选择当前文件夹：`/Users/changliu/Documents/Codex/2026-04-29/new-chat`。
4. AppID 可选择测试号或使用游客模式。

## 已实现流程

- 首页品牌展示、快捷入口、人气推荐、门店展示。
- 美甲/美睫服务分类、服务列表、服务详情。
- 预约填写：日期、时间、附加服务、参考图、备注。
- 购物车：选择、删除、重新填写、合计定金。
- 结算：新人券、储值抵扣、模拟支付。
- 支付成功页、我的、订单列表、订单详情、我的资产。

## 当前占位

- 门店地址、电话、营业时间为“待补充”。
- 服务项目为演示数据。
- 微信登录接口已接入，需在 Railway/后端环境变量中配置 `WECHAT_MINI_APPID`、`WECHAT_MINI_SECRET`、`WECHAT_MINI_TOKEN_SECRET`。
- 真实微信支付暂未接入，等待微信支付商户号。

## 本地后端

后端第一版已经放在 `apps/api`。当前本地可运行版本不需要 Docker 或 npm，直接使用本机已有 Node.js 和本地 SQLite。

启动命令：

```bash
/Users/changliu/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node apps/api/local-server.mjs
```

API 地址：

```text
http://localhost:4000
```

管理员接口测试 token：

```text
Authorization: Bearer owner-demo-token
```

微信小程序登录所需后端环境变量：

```text
WECHAT_MINI_APPID=wx9ef73918f91c8a3d
WECHAT_MINI_SECRET=<只放在后端环境变量的新 AppSecret>
WECHAT_MINI_TOKEN_SECRET=<openssl rand -hex 32 生成>
```
