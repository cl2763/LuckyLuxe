# Video Transcript CLI

本工具用于从视频网页链接中提取文案。当前是 CLI 版本，后续可以扩展成网页端。

## 功能流程

1. 输入视频网页链接。
2. 优先使用 `yt-dlp` 提取已有字幕，包括人工字幕和自动字幕。
3. 如果没有字幕，则下载音频。
4. 调用 `faster-whisper` 转写音频。
5. 输出纯文案、时间戳分段和视频元数据。

## 安装依赖

```bash
python3 -m pip install -r tools/video-transcript/requirements.txt
```

首次使用 `faster-whisper` 会下载模型，建议先用默认的 `small`。如果电脑较慢，可以改成 `base` 或 `tiny`。

## 使用方式

```bash
python3 tools/video-transcript/extract.py "https://www.bilibili.com/video/BV113EY6UEyy/"
```

指定输出目录：

```bash
python3 tools/video-transcript/extract.py "视频链接" -o tmp/video-transcripts
```

指定 Whisper 模型：

```bash
python3 tools/video-transcript/extract.py "视频链接" --model-size base
```

## 输出文件

每个视频会生成一个独立目录：

```text
outputs/
  视频标题/
    transcript.txt   # 清理后的纯文案
    segments.json    # 带时间戳的分段
    metadata.json    # 标题、作者、时长、提取方式等
    summary.md       # 给后续 AI 分析使用的 Markdown
    source.*         # 字幕或音频源文件
```

## 后续可扩展命令

后续可以继续增加：

- `analyze`: 分析视频结构和 SOP
- `extract-workflow`: 提取可复用工作流
- `summarize`: 生成短摘要、长摘要、中英双语摘要
- `agent-plan`: 把视频内容转成多 Agent 协作方案
