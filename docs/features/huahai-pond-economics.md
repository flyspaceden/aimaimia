# 华海官网鱼塘订阅经济学模型

范围仅为集团官网 `/jjxmx` 的密码访问页及单塘测算，不改变商城、App、小程序、IoT 认证、真实设备或资金数据。

## 口径与源码

- `huahai-corporate-site/jjxmx/index.html`：测算与官网样式；初始使用用户最后选择的 23 亩、10 个月、塘口价 15 元/斤、饲料 9,000 元/吨、原料肉比 1.56、假设下降 0.10。
- 支持面积 2–40 亩、周期 4–12 月、塘口价 10–20 元/斤、料肉比 1.3–1.8、饲料 5,000–13,000 元/吨。
- 每亩每周期出鱼 4,500 斤；饲料吨价除以 2,000 得元/斤。料肉比按出塘重量减入塘重量近似净增重，不估算死亡鱼耗料，不把预测改善当作实测效果。
- 草案月费：每塘基础费 1,290 元，前 10 亩每亩 49 元，超过 10 至 20 亩的部分 39 元，超过 20 至 40 亩的部分 29 元；各段超额累进。
- 设备含安装 13,000–18,000 元、月维护通信 300–500 元；36 月经济寿命是假设。24 月现金余额计入寿命内替换、不计残值，毛利未扣获客、研发、融资及税费。
- 本周期计费月数为养殖月数加分摊空塘月数。客户收益/费用达到 2 倍为筛选目标，不承诺增产或实际料肉比降低。

## 密码与会话

- 登录页 `jjxmx/login.html` 只提供密码表单；密码经 HTTPS POST 到 `/jjxmx/login`，服务器校验，正确后跳转 `/jjxmx`。
- Nginx Lua 门禁覆盖 `/jjxmx`、整个 `/jjxmx/` 路径及直接 `index.html`；未认证不会收到测算内容。其他子路径返回 404。
- `scripts/nginx/huahai-economics-gate.lua`：服务器保存 HMAC 校验值及独立随机签名密钥，会话签名有效期 12 小时，Cookie 为 HttpOnly/Secure/SameSite=Strict；登录与退出要求同源 Origin。
- 每 IP 10 分钟最多 6 次登录尝试，使用 Nginx shared dict 原子计数；正确登录清除本 IP 的计数。响应禁缓存、禁止索引和 iframe 嵌入。
- 凭据只存服务器 `/www/server/huahai-economics/credentials.lua` 与本地忽略的 `docs/operations/密码本.md`，不放进页面、脚本或提交。

## 定向发布与回退

用户本次已授权官网指定路径上线与访问密码设置。部署源须为经过 PR、CI、独立审查的 main exact SHA。通过现有 `deploy-release.yml` 的 `huahai-economics` 独立目标及 production approval，仅发布 `jjxmx/` 两个页面和门禁，不执行整个集团官网目录的 rsync。`scripts/deploy-huahai-economics.sh` 在发布前备份并自动回退失败操作。

- Lua 脚本安装为 `/www/server/huahai-economics/gate.lua`；凭据权限 root:www 0640。
- 共享区模板放进 Nginx http 上下文的 vhost include，门禁模板放进现有 `extension/huahainongke.com/*.conf` include。
- 先备份并安装拒绝未认证访问的门禁，`nginx -t` 通过后 reload，再发布页面，避免首次发布裸露内容。缺凭据或页面返回 503。
- 记录文件 SHA、Nginx 配置 SHA、备份目录和实际 main SHA。上线检查未登录、错误密码、正确密码、伪造/过期 Cookie、直接路径、退出、HTTP 跳转及首页未变化。
- 回退恢复本次页面/门禁/共享区备份并 `nginx -t`、reload；撤销源码用本次提交的 revert PR。无数据库回退步骤。不得仅撤掉门禁而保留可公开读取的页面。

本地模型测试：`node --test scripts/__tests__/huahai-economics.test.mjs`。实际部署证据另记在忽略的 `docs/operations/阿里云部署.md`。
