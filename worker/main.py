"""Single worker, durable queue/checkpoints in the web service, no shared filesystem."""
import json
import os
import signal
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import httpx
from adapters import InputError, input_adapter, pcm_chunks
from transcriber import WhisperTranscriber

API = os.environ.get('NAREAL_URL', '').rstrip('/') + '/api/ingest/worker'
TOKEN = os.environ.get('INGEST_WORKER_TOKEN', '')
if len(TOKEN) < 32 or not API.startswith(('http://', 'https://')):
    raise RuntimeError('Configure NAREAL_URL e INGEST_WORKER_TOKEN.')
shutdown = threading.Event()
model = WhisperTranscriber()
client = httpx.Client(timeout=35, headers={'Authorization': 'Bearer ' + TOKEN})
last_contact = 0.0


def request(body):
    global last_contact
    for attempt in range(3):
        try:
            response = client.post(API, json=body)
            if response.status_code == 409:
                return {'stop': True}
            response.raise_for_status()
            last_contact = time.monotonic()
            return response.json()
        except httpx.HTTPError:
            if attempt == 2:
                raise
            shutdown.wait(2)


class Session:
    def __init__(self, job):
        self.job = job
        self.cursor = float(job['cursor_seconds'])
        self.phase_text = 'Preparando entrada'
        self.stop = threading.Event()
        self.lock = threading.RLock()
        self.thread = threading.Thread(target=self.heartbeat, daemon=True)

    def send(self, **extra):
        with self.lock:
            if self.stop.is_set() or shutdown.is_set():
                return False
            result = request({'action': 'update', 'id': self.job['id'], 'lease': self.job['lease_token'],
                              'phase': self.phase_text, 'cursor': self.cursor, **extra})
            if result.get('stop'):
                self.stop.set()
                return False
            return True

    def phase(self, value):
        self.phase_text = value
        if not self.send():
            raise InterruptedError()

    def heartbeat(self):
        while not self.stop.wait(12) and not shutdown.is_set():
            try:
                self.send()
            except Exception:
                # Losing coordination stops decoding, so another lease cannot duplicate work.
                self.stop.set()

    def cancelled(self):
        return self.stop.is_set() or shutdown.is_set()

    def commit(self, segments, cursor, **extra):
        with self.lock:
            if not self.send(segments=segments, cursor=cursor, **extra):
                raise InterruptedError()
            self.cursor = cursor


def process(job):
    session = Session(job)
    session.thread.start()
    try:
        media = input_adapter(job['source']).prepare(job, session.phase)
        if media.captions:
            captions = [s for s in media.captions if s['end'] > session.cursor]
            session.phase('Importando legenda do YouTube')
            for i in range(0, len(captions), 100):
                batch = captions[i:i + 100]
                session.commit(batch, max(session.cursor, max(s['end'] for s in batch)), duration=media.duration, replaceCaptions=bool(job.get('replace_job_id')))
            session.send(status='completed', phase='Legenda importada')
            return
        duration = None if media.live else media.duration
        reconnects = 0
        while not session.cancelled():
            try:
                got_audio = False
                for pcm in pcm_chunks(media, session.cursor, 20, session.cancelled):
                    if session.cancelled():
                        raise InterruptedError()
                    got_audio = True
                    reconnects = 0
                    start = session.cursor
                    segments = model.transcribe(pcm, start, session.phase)
                    session.commit(segments, round(start + len(pcm) / 32000, 3), duration=duration)
                if not media.live:
                    session.send(status='completed', phase='Áudio transcrito')
                    return
                session.phase('Sinal encerrado; aguardando reconexão do OBS' if job['source'] == 'obs' else 'Aguardando reconexão da live')
            except InputError:
                if not media.live:
                    raise
                reconnects += 1
                session.phase('Aguardando sinal do OBS' if job['source'] == 'obs' else 'Aguardando áudio da live')
                # A live URL can expire; resolve it again through its own adapter.
                if job['source'] == 'youtube' and reconnects % 3 == 0:
                    media = input_adapter('youtube').prepare(job, session.phase)
            if session.stop.wait(3):
                break
    except InterruptedError:
        pass
    except Exception as error:
        message = str(error) if isinstance(error, InputError) else 'O transcritor falhou. Confira os recursos e reinicie o processamento.'
        try:
            session.send(status='failed', phase='Falha no processamento', error=message)
        except Exception:
            pass
        print(json.dumps({'event': 'job_failed', 'id': job['id'], 'error': message}), flush=True)
    finally:
        session.stop.set()
        session.thread.join(timeout=40)


def loop():
    while not shutdown.is_set():
        try:
            result = request({'action': 'claim'})
            if result.get('job'):
                print(json.dumps({'event': 'job_started', 'id': result['job']['id'], 'source': result['job']['source']}), flush=True)
                process(result['job'])
        except Exception:
            print(json.dumps({'event': 'coordination_unavailable'}), flush=True)
        shutdown.wait(3)


class Health(BaseHTTPRequestHandler):
    def do_GET(self):
        healthy = time.monotonic() - last_contact < 120
        self.send_response(200 if healthy else 503)
        self.end_headers()
        self.wfile.write(json.dumps({'ok': healthy}).encode())

    def log_message(self, *args):
        pass


if __name__ == '__main__':
    for sig in (signal.SIGTERM, signal.SIGINT):
        signal.signal(sig, lambda *_: shutdown.set())
    threading.Thread(target=loop, daemon=True).start()
    if os.environ.get('OBS_PROBE_PUBLISH_URL'):
        from probe import run
        threading.Thread(target=run, args=(model,), daemon=True).start()
    server = ThreadingHTTPServer(('0.0.0.0', int(os.environ.get('PORT', '8080'))), Health)
    server.timeout = 1
    while not shutdown.is_set():
        server.handle_request()
    server.server_close()
