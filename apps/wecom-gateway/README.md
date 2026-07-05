# Lucky Luxe WeCom Gateway

Fixed-IP gateway for Enterprise WeChat / WeChat Customer Service integration.

The gateway is intentionally small:

- Receives WeCom callback verification and message events on a fixed-IP server.
- Proxies `/wechat/customer-service/webhook` to the main Lucky Luxe OS backend.
- Keeps future WeCom API calls on a stable outbound IP for Enterprise WeChat trusted-IP requirements.

Production host:

- Reserved IP: `165.227.255.152`
- Planned domain: `wecom.luckyluxeatelier.com`
- Upstream: `https://www.luckyluxeatelier.com`

