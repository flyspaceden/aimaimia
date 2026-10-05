# 华海农科数字讲解员 · 小犀

## 官网首期发布（2026-10-04）

用户选择先上线讲解、视频和常见问题，实时AI后续接入。首页首屏右侧展示完整小犀，两按钮分别进入`/digital-human/`和`/digital-human/?view=film`；6个主内容页面共用导航入口。导航与页面元信息沿用十语切换；六主题讲解与配音保持中文并在页面明确标注。

讲解页提供6段配音、74句详细讲稿、字幕、5种姿态选择、12个常见问题和约7分8秒完整品牌宣传片。`faq.js`只按公司资料答复，资料不足时提供主题/联系入口；不调用或向模型发送问题，问答只留在当前页面。视频采用同一生成女声参考，51段片源各使用一次，含许可素材与AI场景示意，产品界面为依据代码制作的流程示意。

成品视频与6段MP3复用现有OSS存储，URL/Hash/字节数见`media/published-media.json`。媒体目录只有5个小型公开资源入Git，其余成片/原素材/缓存仍忽略。`scripts/prepare-huahai-release.mjs`生成公开静态白名单，`deploy-release.yml`仅以huahai目标发布到官网；制作脚本、原片和缓存不部署到Web目录。

本地预览：`node huahai-corporate-site/digital-human/serve.mjs`，打开`http://127.0.0.1:8768/`；数字讲解页为同域`/digital-human/`。该预览不开放模型代理，无需凭据。完整设计、媒体及发布证据见`docs/features/huahai-digital-human.md`。

## 品牌影片制作

`promo-knowledge.json`为34句完整宣传稿；`film-storyboard.json`安排分镜。`build-consistent-voice.mjs`从本任务生成女声提取固定参考，用一个Qwen3-TTS-VC声线合成全部内容；语音回识、逐句守卫及Hash绑定沿用自然配音模块。参考/声线收据保存在忽略的`build/promo-consistent/`，不克隆真人身份。

`media/stock-clips/manifest.json`记录Pexels/Mixkit Free素材、许可与Hash。原片不再分发，AI关键帧及提示词保存在`assets/film-scenes/`。软件解码避免旧FFmpeg硬解＋硬编引入的冻结；仅帧率/PTS或解码成功不能代替实际相邻帧检查。声线绑定也不能代替完整人工听审。

依次运行`build-consistent-voice.mjs`、`compose-brand-music.py`、`mix-brand-audio.mjs`、`build-content-film.mjs --background --frames --smoke --final`；配乐/混音使用`HUAHAI_VOICE_BUILD=build/promo-consistent`。媒体重制需要本地原片/配音缓存和已授权的模型进程凭据，未知付费请求结果不得盲重发。公开网页播放不需要这些缓存或凭据。

以下为详细主题配音的制作说明。

## 生成媒体

默认使用百炼Qwen3-TTS-Instruct-Flash的Serena温暖女声、FFmpeg和`@napi-rs/canvas`。`voice-config.json`保存声线与自然讲解指令；API凭据只从进程环境读取。角色仍使用原八帧素材。基础与八帧提示见assets/generation-prompt.txt，边距修正提示见assets/padding-edit-prompt.txt。

```bash
HUAHAI_CANVAS_PACKAGES=/absolute/path/to/node_modules node --env-file=/absolute/path/to/ignored.env huahai-corporate-site/digital-human/build-media.mjs
```

依赖目录必须已安装`@napi-rs/canvas`；也可省略并使用普通Node解析。`HUAHAI_CHINESE_FONT`指定中文字体，默认macOS PingFang；`--audio-only`只生成音频、字幕、封面和manifest。

`media/`输出6段MP3、1080p/24fps H.264+AAC MP4、SRT、VTT和manifest。新配音按句边界组成连贯段落，UTF8预算480字节，段间停顿0.2秒；每章开场仍留2秒。正文不改，AI按英文字母朗读。新版完整视频约10分54秒。口型按新音轨RMS驱动，非音素识别。

Paraformer-v2回识词级时间戳，原稿规范化后进行编辑距离与逐句锚点对齐。每段整体匹配不低于88%、每句映射覆盖85%/真实字符匹配80%；明显超过16字符/秒和不/未边界词缺失会失败，禁止用其他句的重复字掩盖漏读。数字年份与AI读法可规范化。字幕是识别时间戳对齐结果，不作毫秒级声学准确性承诺。

`character-config.json`定义4列×2行的八帧布局。网页可预览站立、招呼、行走姿态、侧身和休息；切换会暂停配音，开始播放后回到讲解姿态。行走造型是离散姿态，不是连续步态动画。manifest同时校验角色配置与讲稿Hash，并记录精灵图SHA256。

`build/`缓存绑定原稿、声线配置、对齐算法版本与WAV Hash；签名URL只在内存用于回识，不写入元数据。识别缓存只含正文、时间戳、摘要和请求ID，均受gitignore保护。修改原稿或声线后需重建媒体。网页主题朗读与视频均使用新声线；实时问答的朗读仍来自浏览器SpeechSynthesis。

回归：`node --test huahai-corporate-site/digital-human/natural-voice.test.mjs`。未配置自然配音服务时生成过程直接失败；不会静默回退系统朗读。保留`provider: system`仅用于明确选择旧版系统配音的复现。

## 内容依据

`knowledge.json`提供角色、六章逐句稿、12条FAQ、来源和边界。公司介绍引用[关于页](https://huahainongke.com/about.html)、[业务页](https://huahainongke.com/business.html)、[技术页](https://huahainongke.com/technology.html)与[产业页](https://huahainongke.com/industry.html)，不作为生产验收证明。爱买买依据`5b0125018091779a2ed20b23bc7f2bff5d9e3665`代码核查，保留推荐占位、端差异、权益独立与溯源数据条件。产销自动反馈为建设方向。官网`whitepaper.html`本次404，未作已发布来源。

设计与验收见`docs/features/huahai-digital-human.md`。本地完成不等于官网发布，不触发App OTA、小程序发布或业务数据变更。
