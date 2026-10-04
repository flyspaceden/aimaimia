# 华海农科数字讲解员 · 小犀

本次网页视频入口采用完整品牌宣传片：保留战略、理念、技术路线、爱买买、全产销链与农业大健康六个方向，使用同一份生成女声参考和不同来源的连续视频镜头。互动主题讲解保留详细资料版。视频画面含授权素材与AI场景示意；产品界面为依据代码制作的流程示意。没有公司基地实拍或项目验收含义。

## 品牌宣传片制作（2026-10-04）

`promo-knowledge.json`为34句完整宣传稿，`film-storyboard.json`按台词安排场景。`build-consistent-voice.mjs`从本任务已生成的温暖女声提取固定参考，用一个Qwen3-TTS-VC声线合成全部内容；语音回识、逐句守卫及Hash绑定沿用自然配音模块。参考音频和声线收据只留在忽略的`build/promo-consistent/`，不克隆真人身份。

`media/stock-clips/manifest.json`记录逐页核实的Pexels/Mixkit Free素材来源、许可与文件Hash。Restricted/付费素材不入片，原片音轨不参与配音；每个场景片源只使用一次。原片与缓存不随网页交付包再分发。AI场景的原始关键帧和提示词位于`assets/film-scenes/`，通过内置imagegen制作；动画调用万相，配置见三个`*video-config.json`。

渲染使用软件解码，避开本机FFmpeg 4.2.2在VideoToolbox硬解和硬编组合时引入的重复帧。分镜缓存单独放在`build/brand-v2/`，不能复用旧缓存。仅检查帧率/PTS和解码成功不足以确认流畅，需要检查实际相邻画面更新。声线参数一致也不能代替跨段听审。

依次运行`build-consistent-voice.mjs`、`compose-brand-music.py`、`mix-brand-audio.mjs`、`build-content-film.mjs --background --frames --smoke --final`；统一设置`HUAHAI_VOICE_BUILD=build/promo-consistent`用于配乐/混音，并按本机配置FFmpeg、FFprobe与Canvas目录。付费生成步骤需进程凭据，缓存/原子提交锁用于防止未知结果和并发重跑重复收费。

完整文件为`media/huahai-brand-film-v2.mp4`（1080p）；网页使用`huahai-brand-film-v2-preview.mp4`（720p Baseline轻量版），并提供完整片下载、SRT/VTT字幕与混合来源manifest。API凭据、签名URL、原片和缓存不放入公开交付包。

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
