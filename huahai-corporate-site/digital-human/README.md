# 华海农科数字讲解员 · 小犀

范围：企业介绍网页与中文视频，共用六主题资料。原官网导航、爱买买业务、买家App及微信小程序没有修改。小犀采用完整四足体态、平滑肤质、收窄脚踝和小灰色卷耳，具有八种表情/姿态，以二维精灵帧驱动中文配音、口型和眨眼。形象为3D风格插画，不是写实真人克隆或音素级口型。

## 本地启动

Node.js 20+，网页无需额外依赖：

```bash
node huahai-corporate-site/digital-human/serve.mjs
```

访问`http://127.0.0.1:8768/`。无模型凭据时，常见问题使用预置资料回答，自由提问明确显示资料不足。实时AI在进程环境中配置`DASHSCOPE_API_KEY`后调用通义服务，不把凭据交给浏览器。可通过`node --env-file=/absolute/path/to/ignored.env .../serve.mjs`传入已有忽略配置。不要把凭据写到网页、资料、日志或提交文件。默认延续现有爱买买`qwen-plus`，可通过`HUAHAI_CHAT_MODEL`更改。

服务固定监听回环地址，校验Host/Origin，限制输入、频率、并发与超时，只提供白名单资源。没有交易或设备工具，不访问数据库。对话仅保留当前浏览器内存中的近期12条，关闭页面后消失，后端不写聊天日志。实时问答会将问题及近期上下文发送给百炼。

该代理用于本地预览，不能直接公网部署。正式发布需完成运行、限流、费用、日志与数据策略、隐私说明和部署验收；静态托管只能提供配音和常见问题。

## 生成媒体

使用macOS的`say`（Tingting中文声音）、FFmpeg和`@napi-rs/canvas`，不克隆真人声音。角色由内置imagegen生成透明背景八帧精灵图，包含站立、两种讲解口型、眨眼、招呼、行走姿态、侧身和休息；场景与版式由Canvas绘制。基础与八帧提示见assets/generation-prompt.txt，最终边距修正提示见assets/padding-edit-prompt.txt。

```bash
HUAHAI_CANVAS_PACKAGES=/absolute/path/to/node_modules node huahai-corporate-site/digital-human/build-media.mjs
```

依赖目录必须已安装`@napi-rs/canvas`；也可省略并使用普通Node解析。`HUAHAI_CHINESE_FONT`指定中文字体，默认macOS PingFang；`--audio-only`只生成音频、字幕、封面和manifest。

忽略目录`media/`输出6段MP3、1080p/24fps H.264+AAC MP4、SRT、VTT、封面和manifest。源动画12fps，编码24fps；口型取真实音频RMS，并有眨眼帧，非音素识别。每章开场留2秒展示不同姿态，句间停顿0.32秒，完整视频约9分41.5秒；字幕时长按实际PCM计算。朗读把“AI”展开为“人工智能”，字幕保留原稿，开场与结语分别位于第一和最后一章。

`character-config.json`定义4列×2行的八帧布局。网页可预览站立、招呼、行走姿态、侧身和休息；切换会暂停配音，开始播放后回到讲解姿态。行走造型是离散姿态，不是连续步态动画。manifest同时校验角色配置与讲稿Hash，并记录精灵图SHA256。

`build/`存储按文本/声音/语速哈希的配音缓存；改稿后重新生成媒体。网页实时回答的朗读来自浏览器SpeechSynthesis，口型仅随朗读状态运动，未精确同步回答音频；浏览器不支持朗读时可阅读文字。

## 内容依据

`knowledge.json`提供角色、六章逐句稿、12条FAQ、来源和边界。公司介绍引用[关于页](https://huahainongke.com/about.html)、[业务页](https://huahainongke.com/business.html)、[技术页](https://huahainongke.com/technology.html)与[产业页](https://huahainongke.com/industry.html)，不作为生产验收证明。爱买买依据`5b0125018091779a2ed20b23bc7f2bff5d9e3665`代码核查，保留推荐占位、端差异、权益独立与溯源数据条件。产销自动反馈为建设方向。官网`whitepaper.html`本次404，未作已发布来源。

设计与验收见`docs/features/huahai-digital-human.md`。本地完成不等于官网发布，不触发App OTA、小程序发布或业务数据变更。
