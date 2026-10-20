"""Input adapters return media metadata; they never own transcript storage or models."""
from dataclasses import dataclass
import html
import os
import re
import subprocess
import selectors
import time
import tempfile
from typing import Iterator


class InputError(Exception):
    pass


@dataclass
class Media:
    url: str
    live: bool
    duration: float | None = None
    captions: list[dict] | None = None
    headers: dict | None = None


def parse_vtt(content: str, rolling: bool = False) -> list[dict]:
    """Handle WebVTT rolling captions without repeating overlapping words."""
    def timestamp(value):
        parts = value.replace(',', '.').split(':')
        return sum(float(p) * 60 ** i for i, p in enumerate(reversed(parts)))
    output, previous, previous_end = [], [], 0
    for cue in re.split(r'\n\s*\n', content.replace('\r', '')):
        match = re.search(r'(\d{1,2}:\d{2}(?::\d{2})?[.,]\d+)\s*-->\s*(\d{1,2}:\d{2}(?::\d{2})?[.,]\d+)[^\n]*\n(.*)', cue, re.S)
        if not match:
            continue
        start, end = timestamp(match[1]), timestamp(match[2])
        if end <= start:
            continue
        voice = re.search(r'<v(?:\.[^ >]+)?\s+([^>]+)>', match[3])
        text = html.unescape(re.sub(r'<[^>]+>', '', match[3]))
        words = text.split()
        fresh = words
        if start < previous_end or rolling and start <= previous_end + 0.05:
            for size in range(min(len(previous), len(words)), 0, -1):
                if previous[-size:] == words[:size]:
                    fresh = words[size:]
                    break
        previous, previous_end = words, end
        if fresh:
            output.append({'text': ' '.join(fresh), 'speaker': voice[1] if voice else 'Falante não identificado', 'start': start, 'end': end})
    return output


class YouTubeInput:
    def prepare(self, job, phase) -> Media:
        import httpx
        import yt_dlp
        phase('Consultando YouTube e legendas')
        options = {'quiet': True, 'no_warnings': True, 'noplaylist': True,
                   'format': 'bestaudio/best', 'socket_timeout': 15,
                   'retries': 1, 'extractor_retries': 1, 'js_runtimes': {'node': {}},
                   'logger': SilentLogger()}
        try:
            with yt_dlp.YoutubeDL(options) as downloader:
                info = downloader.extract_info('https://www.youtube.com/watch?v=' + job['video_id'], download=False)
        except Exception:
            raise InputError('O YouTube não liberou este vídeo ao servidor. Importe a transcrição ou use a entrada OBS.') from None
        live = bool(info.get('is_live'))
        media = Media(info.get('url', ''), live, info.get('duration'), headers=info.get('http_headers', {}))
        # Live captions are not a complete resumable archive; transcribe the live audio.
        if not live:
            for catalog, rolling in ((info.get('subtitles', {}), False), (info.get('automatic_captions', {}), True)):
                languages = sorted((k for k in catalog if re.fullmatch(r'pt(?:-[A-Za-z]+)?', k)), key=lambda x: x != 'pt')
                for language in languages:
                    entry = next((e for e in catalog[language] if e.get('ext') == 'vtt'), None)
                    if not entry:
                        continue
                    try:
                        with httpx.Client(timeout=30, follow_redirects=True) as client:
                            with client.stream('GET', entry['url'], headers=media.headers) as response:
                                response.raise_for_status()
                                data = bytearray()
                                for chunk in response.iter_bytes():
                                    data.extend(chunk)
                                    if len(data) > 8_000_000:
                                        raise ValueError('Caption too large')
                        captions = parse_vtt(data.decode('utf-8'), rolling=rolling)
                        if captions:
                            media.captions = captions
                            return media
                    except Exception:
                        phase('Legenda indisponível; preparando transcrição do áudio')
        if not media.url:
            raise InputError('Nenhum áudio disponível neste vídeo.')
        return media


class OBSInput:
    def prepare(self, job, phase) -> Media:
        url = os.environ.get('OBS_STREAM_URL', '')
        if not url:
            raise InputError('A entrada OBS não está configurada no transcritor.')
        phase('Aguardando áudio do OBS')
        return Media(url, True)


class SilentLogger:
    # yt-dlp errors may contain signed URLs. UI receives bounded, actionable errors instead.
    def debug(self, *args): pass
    def warning(self, *args): pass
    def error(self, *args): pass


def input_adapter(kind):
    adapters = {'youtube': YouTubeInput, 'obs': OBSInput}
    if kind not in adapters:
        raise InputError('Tipo de entrada não suportado.')
    return adapters[kind]()


def pcm_chunks(media: Media, offset: float, chunk_seconds: int, cancelled, diagnostics=None) -> Iterator[bytes]:
    """One decoder shared by every adapter. Pipe backpressure bounds memory usage."""
    command = ['ffmpeg', '-nostdin', '-hide_banner', '-loglevel', 'error', '-rw_timeout', '20000000']
    if media.headers:
        safe = {k: v for k, v in media.headers.items() if k.lower() in ('user-agent', 'referer', 'origin') and '\n' not in str(v) and '\r' not in str(v)}
        if safe:
            command += ['-headers', ''.join(f'{k}: {v}\r\n' for k, v in safe.items())]
    if offset and not media.live:
        command += ['-ss', str(offset)]
    command += ['-i', media.url, '-vn', '-ac', '1', '-ar', '16000', '-f', 's16le', 'pipe:1']
    error_file = tempfile.TemporaryFile() if diagnostics else None
    process = subprocess.Popen(command, stdout=subprocess.PIPE, stderr=error_file if error_file else subprocess.DEVNULL)
    selector = selectors.DefaultSelector()
    selector.register(process.stdout, selectors.EVENT_READ)
    buffer = bytearray()
    size = 16000 * 2 * chunk_seconds
    received = False
    last_data = time.monotonic()
    try:
        while not cancelled():
            if time.monotonic() - last_data > 45:
                raise InputError('O áudio não respondeu. Confira a transmissão e tente novamente.')
            if not selector.select(timeout=1):
                continue
            chunk = os.read(process.stdout.fileno(), 65536)
            if not chunk:
                if buffer:
                    yield bytes(buffer[:len(buffer) // 2 * 2])
                process.wait(timeout=5)
                if process.returncode != 0 or not received:
                    if error_file:
                        error_file.seek(0)
                        diagnostics(re.sub(r'rtmps?://[^\s]+', '[RTMP]', error_file.read(4000).decode('utf-8', errors='replace')))
                    raise InputError('Não foi possível ler o áudio da transmissão.')
                return
            received = True
            last_data = time.monotonic()
            buffer.extend(chunk)
            while len(buffer) >= size:
                yield bytes(buffer[:size])
                del buffer[:size]
                last_data = time.monotonic()
    finally:
        selector.close()
        if process.poll() is None:
            process.terminate()
            try:
                process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait()
        process.stdout.close()
        if error_file:
            error_file.close()
