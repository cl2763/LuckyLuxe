#!/usr/bin/env python3
"""
Video transcript extraction CLI.

Flow:
1. Try existing subtitles with yt-dlp.
2. If no subtitles are available, download audio and transcribe with faster-whisper.
3. Save clean transcript, timestamped segments, and metadata.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import subprocess
import sys
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from urllib import request


LANG_PRIORITY = [
    "zh-Hans",
    "zh-CN",
    "zh",
    "zh-Hant",
    "zh-TW",
    "en",
    "en-US",
    "en-GB",
]


@dataclass
class CommandResult:
    code: int
    stdout: str
    stderr: str


def run_command(args: list[str], cwd: Path | None = None) -> CommandResult:
    proc = subprocess.run(
        args,
        cwd=str(cwd) if cwd else None,
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
    )
    return CommandResult(proc.returncode, proc.stdout, proc.stderr)


def yt_dlp_cmd() -> list[str]:
    result = run_command([sys.executable, "-m", "yt_dlp", "--version"])
    if result.code == 0:
        return [sys.executable, "-m", "yt_dlp"]

    binary = shutil.which("yt-dlp")
    if binary:
        return [binary]

    raise RuntimeError(
        "缺少 yt-dlp。请先运行：python3 -m pip install -r tools/video-transcript/requirements.txt"
    )


def slugify(value: str, fallback: str = "video") -> str:
    value = re.sub(r"[\\/:*?\"<>|]+", "-", value).strip()
    value = re.sub(r"\s+", "-", value)
    return value[:90] or fallback


def load_video_info(url: str) -> dict[str, Any]:
    cmd = yt_dlp_cmd() + ["-J", "--skip-download", url]
    result = run_command(cmd)
    if result.code != 0:
        if is_bilibili_url(url):
            print("[video-transcript] yt-dlp failed for Bilibili, using Bilibili public API fallback.")
            return load_bilibili_info(url)
        if is_xhs_url(url):
            print("[video-transcript] yt-dlp failed for Xiaohongshu, using page JSON fallback.")
            return load_xhs_info(url)
        raise RuntimeError(f"yt-dlp 获取视频信息失败：\n{result.stderr.strip()}")
    return json.loads(result.stdout)


def is_bilibili_url(url: str) -> bool:
    return "bilibili.com" in url or "b23.tv" in url


def is_xhs_url(url: str) -> bool:
    return "xiaohongshu.com" in url or "xhslink.com" in url


def extract_bvid(url: str) -> str | None:
    match = re.search(r"(BV[0-9A-Za-z]+)", url)
    return match.group(1) if match else None


def http_json(url: str, referer: str | None = None) -> dict[str, Any]:
    headers = {
        "User-Agent": "Mozilla/5.0",
        "Referer": referer or "https://www.bilibili.com/",
        "Origin": "https://www.bilibili.com",
    }
    req = request.Request(url, headers=headers)
    with request.urlopen(req, timeout=30) as response:
        return json.loads(response.read().decode("utf-8"))


def http_text(url: str, referer: str | None = None) -> tuple[str, str]:
    headers = {
        "User-Agent": (
            "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) "
            "AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 "
            "Mobile/15E148 Safari/604.1"
        ),
        "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
        "Referer": referer or "https://www.xiaohongshu.com/",
    }
    req = request.Request(url, headers=headers)
    with request.urlopen(req, timeout=30) as response:
        return response.read().decode("utf-8", "replace"), response.geturl()


def load_bilibili_info(url: str) -> dict[str, Any]:
    bvid = extract_bvid(url)
    if not bvid:
        raise RuntimeError("无法从 Bilibili URL 中识别 BV 号。")

    referer = f"https://www.bilibili.com/video/{bvid}/"
    view = http_json(f"https://api.bilibili.com/x/web-interface/view?bvid={bvid}", referer)
    if view.get("code") != 0:
        raise RuntimeError(f"Bilibili API 获取视频信息失败：{view.get('message')}")

    data = view.get("data") or {}
    pages = data.get("pages") or []
    cid = pages[0].get("cid") if pages else data.get("cid")
    if not cid:
        raise RuntimeError("Bilibili API 没有返回 cid。")

    player = http_json(f"https://api.bilibili.com/x/player/v2?bvid={bvid}&cid={cid}", referer)
    subtitles = ((player.get("data") or {}).get("subtitle") or {}).get("subtitles") or []

    return {
        "_fallback": "bilibili",
        "id": bvid,
        "bvid": bvid,
        "cid": cid,
        "title": data.get("title") or bvid,
        "webpage_url": referer,
        "original_url": url,
        "extractor": "bilibili-api",
        "duration": data.get("duration"),
        "uploader": ((data.get("owner") or {}).get("name")),
        "subtitles": {
            item.get("lan") or item.get("lan_doc") or f"subtitle-{idx}": [item]
            for idx, item in enumerate(subtitles)
        },
    }


def load_xhs_info(url: str) -> dict[str, Any]:
    html_text, final_url = http_text(url)
    match = re.search(r"window\.__SETUP_SERVER_STATE__=(\{.*?\})</script>", html_text, re.S)
    if not match:
        raise RuntimeError("无法从小红书页面中解析视频数据。请确认链接可公开访问。")

    state = json.loads(match.group(1))
    page_data = state.get("LAUNCHER_SSR_STORE_PAGE_DATA") or {}
    note = page_data.get("noteData") or {}
    if not note:
        raise RuntimeError("小红书页面没有返回 noteData。")

    video_url = None
    video = (((note.get("video") or {}).get("media") or {}).get("stream") or {})
    for codec in ("h264", "h265", "av1", "h266"):
        streams = video.get(codec) or []
        if streams:
            video_url = streams[0].get("masterUrl") or (streams[0].get("backupUrls") or [None])[0]
            if video_url:
                break

    if not video_url:
        raise RuntimeError("小红书页面没有找到可下载的视频流。")

    user = note.get("user") or {}
    media = ((note.get("video") or {}).get("media") or {})
    return {
        "_fallback": "xiaohongshu",
        "id": note.get("noteId") or "xhs-video",
        "title": note.get("title") or "xiaohongshu-video",
        "description": note.get("desc"),
        "webpage_url": final_url,
        "original_url": url,
        "extractor": "xiaohongshu-page-json",
        "duration": ((media.get("video") or {}).get("duration")) or ((media.get("capa") or {}).get("duration")),
        "uploader": user.get("nickName"),
        "subtitles": {},
        "_xhs_video_url": video_url,
    }


def pick_subtitle(info: dict[str, Any]) -> tuple[str, bool] | None:
    manual = info.get("subtitles") or {}
    auto = info.get("automatic_captions") or {}

    def pick_from(pool: dict[str, Any]) -> str | None:
        keys = list(pool.keys())
        for preferred in LANG_PRIORITY:
            for key in keys:
                if key == preferred or key.lower().startswith(preferred.lower()):
                    return key
        return keys[0] if keys else None

    lang = pick_from(manual)
    if lang:
        return lang, False

    lang = pick_from(auto)
    if lang:
        return lang, True

    return None


def subtitle_files(base: Path) -> list[Path]:
    patterns = [
        f"{base.name}*.srt",
        f"{base.name}*.vtt",
        f"{base.name}*.ass",
    ]
    files: list[Path] = []
    for pattern in patterns:
        files.extend(sorted(base.parent.glob(pattern)))
    return files


def download_subtitle(url: str, base: Path, lang: str, is_auto: bool) -> Path | None:
    if is_bilibili_url(url):
        info = load_bilibili_info(url)
        subtitle_items = (info.get("subtitles") or {}).get(lang) or []
        if subtitle_items:
            item = subtitle_items[0]
            subtitle_url = item.get("subtitle_url") or item.get("url")
            if subtitle_url:
                if subtitle_url.startswith("//"):
                    subtitle_url = "https:" + subtitle_url
                out = base.with_suffix(".json")
                req = request.Request(
                    subtitle_url,
                    headers={
                        "User-Agent": "Mozilla/5.0",
                        "Referer": info.get("webpage_url") or "https://www.bilibili.com/",
                    },
                )
                with request.urlopen(req, timeout=30) as response:
                    out.write_bytes(response.read())
                return out
        return None

    cmd = yt_dlp_cmd() + [
        "--skip-download",
        "--sub-langs",
        lang,
        "--sub-format",
        "srt/vtt/best",
        "-o",
        str(base) + ".%(ext)s",
    ]
    cmd.append("--write-auto-subs" if is_auto else "--write-subs")
    cmd.append(url)

    result = run_command(cmd)
    if result.code != 0:
        raise RuntimeError(f"字幕下载失败：\n{result.stderr.strip()}")

    files = subtitle_files(base)
    return files[0] if files else None


def clean_subtitle_text(path: Path) -> tuple[str, list[dict[str, Any]]]:
    raw = path.read_text(encoding="utf-8", errors="ignore")
    if path.suffix.lower() == ".json":
        data = json.loads(raw)
        body = data.get("body") or []
        lines = []
        segments = []
        for item in body:
            text = (item.get("content") or "").strip()
            if not text:
                continue
            lines.append(text)
            segments.append(
                {
                    "start": item.get("from"),
                    "end": item.get("to"),
                    "text": text,
                }
            )
        return "\n".join(lines).strip() + "\n", segments

    blocks = re.split(r"\n\s*\n", raw.replace("\r\n", "\n"))
    transcript_lines: list[str] = []
    segments: list[dict[str, Any]] = []
    previous = ""

    time_re = re.compile(
        r"(?P<start>\d{1,2}:\d{2}:\d{2}[,.]\d{3})\s+-->\s+(?P<end>\d{1,2}:\d{2}:\d{2}[,.]\d{3})"
    )

    for block in blocks:
        lines = [line.strip() for line in block.split("\n") if line.strip()]
        if not lines:
            continue

        start = end = None
        text_lines: list[str] = []
        for line in lines:
            if line.upper().startswith("WEBVTT") or line.upper().startswith("NOTE"):
                continue
            if re.fullmatch(r"\d+", line):
                continue
            match = time_re.search(line)
            if match:
                start = match.group("start").replace(",", ".")
                end = match.group("end").replace(",", ".")
                continue
            clean = re.sub(r"<[^>]+>", "", line)
            clean = re.sub(r"\{[^}]+\}", "", clean)
            clean = clean.strip()
            if clean:
                text_lines.append(clean)

        text = " ".join(text_lines)
        text = re.sub(r"\s+", " ", text).strip()
        if not text or text == previous:
            continue

        transcript_lines.append(text)
        segments.append({"start": start, "end": end, "text": text})
        previous = text

    return "\n".join(transcript_lines).strip() + "\n", segments


def download_audio(url: str, base: Path) -> Path:
    if is_bilibili_url(url):
        info = load_bilibili_info(url)
        return download_bilibili_audio(info, base)
    if is_xhs_url(url):
        info = load_xhs_info(url)
        return download_xhs_video(info, base)

    cmd = yt_dlp_cmd() + [
        "-f",
        "ba/bestaudio",
        "-o",
        str(base) + ".%(ext)s",
        url,
    ]
    result = run_command(cmd)
    if result.code != 0:
        raise RuntimeError(f"音频下载失败：\n{result.stderr.strip()}")

    candidates = [
        p
        for p in base.parent.glob(base.name + ".*")
        if p.suffix.lower() in {".m4a", ".mp3", ".webm", ".opus", ".wav", ".m4s"}
    ]
    if not candidates:
        raise RuntimeError("音频下载完成，但没有找到音频文件。")
    return max(candidates, key=lambda p: p.stat().st_size)


def download_bilibili_audio(info: dict[str, Any], base: Path) -> Path:
    bvid = info["bvid"]
    cid = info["cid"]
    referer = info.get("webpage_url") or f"https://www.bilibili.com/video/{bvid}/"
    play = http_json(
        f"https://api.bilibili.com/x/player/playurl?bvid={bvid}&cid={cid}&qn=16&fnval=16&fourk=0",
        referer,
    )
    if play.get("code") != 0:
        raise RuntimeError(f"Bilibili API 获取音频失败：{play.get('message')}")
    audio_streams = (((play.get("data") or {}).get("dash") or {}).get("audio") or [])
    if not audio_streams:
        raise RuntimeError("Bilibili playurl 没有返回音频流。")

    stream = audio_streams[0]
    audio_url = stream.get("baseUrl") or stream.get("base_url")
    if not audio_url:
        raise RuntimeError("Bilibili 音频流缺少 URL。")

    out = base.with_suffix(".m4a")
    req = request.Request(
        audio_url,
        headers={
            "User-Agent": "Mozilla/5.0",
            "Referer": referer,
            "Origin": "https://www.bilibili.com",
        },
    )
    with request.urlopen(req, timeout=120) as response, out.open("wb") as file:
        while True:
            chunk = response.read(1024 * 1024)
            if not chunk:
                break
            file.write(chunk)
    return out


def download_xhs_video(info: dict[str, Any], base: Path) -> Path:
    video_url = info.get("_xhs_video_url")
    if not video_url:
        raise RuntimeError("小红书 fallback 缺少视频 URL。")

    out = base.with_suffix(".mp4")
    req = request.Request(
        video_url,
        headers={
            "User-Agent": (
                "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) "
                "AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 "
                "Mobile/15E148 Safari/604.1"
            ),
            "Referer": "https://www.xiaohongshu.com/",
        },
    )
    with request.urlopen(req, timeout=120) as response, out.open("wb") as file:
        while True:
            chunk = response.read(1024 * 1024)
            if not chunk:
                break
            file.write(chunk)
    return out


def transcribe_audio(audio_path: Path, model_size: str) -> tuple[str, list[dict[str, Any]]]:
    try:
        from faster_whisper import WhisperModel
    except ImportError as exc:
        raise RuntimeError(
            "没有可用字幕，需要转写音频，但缺少 faster-whisper。\n"
            "请运行：python3 -m pip install -r tools/video-transcript/requirements.txt"
        ) from exc

    model = WhisperModel(model_size, device="auto", compute_type="auto")
    segments_iter, info = model.transcribe(str(audio_path), vad_filter=True)

    lines: list[str] = []
    segments: list[dict[str, Any]] = []
    for segment in segments_iter:
        text = segment.text.strip()
        if not text:
            continue
        lines.append(text)
        segments.append(
            {
                "start": round(float(segment.start), 3),
                "end": round(float(segment.end), 3),
                "text": text,
            }
        )

    metadata = {
        "detected_language": getattr(info, "language", None),
        "language_probability": getattr(info, "language_probability", None),
    }
    segments.insert(0, {"transcription_metadata": metadata})
    return "\n".join(lines).strip() + "\n", segments


def write_outputs(
    output_dir: Path,
    info: dict[str, Any],
    transcript: str,
    segments: list[dict[str, Any]],
    source: str,
    extra: dict[str, Any],
) -> None:
    output_dir.mkdir(parents=True, exist_ok=True)

    metadata = {
        "source": source,
        "created_at": datetime.now(timezone.utc).isoformat(),
        "title": info.get("title"),
        "webpage_url": info.get("webpage_url"),
        "original_url": info.get("original_url"),
        "extractor": info.get("extractor"),
        "duration": info.get("duration"),
        "uploader": info.get("uploader"),
        "extra": extra,
    }

    (output_dir / "transcript.txt").write_text(transcript, encoding="utf-8")
    (output_dir / "segments.json").write_text(
        json.dumps(segments, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    (output_dir / "metadata.json").write_text(
        json.dumps(metadata, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    (output_dir / "summary.md").write_text(
        "# Transcript Extraction\n\n"
        f"- Title: {metadata.get('title')}\n"
        f"- Source: {source}\n"
        f"- URL: {metadata.get('webpage_url') or metadata.get('original_url')}\n"
        f"- Duration: {metadata.get('duration')}\n\n"
        "## Transcript\n\n"
        f"{transcript}",
        encoding="utf-8",
    )


def extract(url: str, output_root: Path, model_size: str) -> Path:
    info = load_video_info(url)
    title = info.get("title") or info.get("id") or "video"
    output_dir = output_root / slugify(title)
    output_dir.mkdir(parents=True, exist_ok=True)

    base = output_dir / "source"
    subtitle_choice = pick_subtitle(info)

    if subtitle_choice:
        lang, is_auto = subtitle_choice
        subtitle_path = download_subtitle(url, base, lang, is_auto)
        if subtitle_path:
            transcript, segments = clean_subtitle_text(subtitle_path)
            write_outputs(
                output_dir,
                info,
                transcript,
                segments,
                "subtitle",
                {"language": lang, "automatic": is_auto, "file": str(subtitle_path)},
            )
            return output_dir

    audio_path = download_audio(url, base)
    transcript, segments = transcribe_audio(audio_path, model_size)
    write_outputs(
        output_dir,
        info,
        transcript,
        segments,
        "faster-whisper",
        {"audio_file": str(audio_path), "model_size": model_size},
    )
    return output_dir


def main() -> int:
    parser = argparse.ArgumentParser(description="Extract video transcript from a webpage URL.")
    parser.add_argument("url", help="Video webpage URL, e.g. Bilibili/Youtube page")
    parser.add_argument(
        "-o",
        "--output",
        default="tools/video-transcript/outputs",
        help="Output root directory",
    )
    parser.add_argument(
        "--model-size",
        default="small",
        help="faster-whisper model size when subtitles are unavailable",
    )
    args = parser.parse_args()

    try:
        output_dir = extract(args.url, Path(args.output), args.model_size)
    except Exception as exc:
        print(f"[video-transcript] ERROR: {exc}", file=sys.stderr)
        return 1

    print(f"[video-transcript] Done: {output_dir}")
    print(f"[video-transcript] Transcript: {output_dir / 'transcript.txt'}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
