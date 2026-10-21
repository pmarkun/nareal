"""Bounded capture -> ASR -> checking pipeline. Audio is never stored on disk."""
from __future__ import annotations

import asyncio
import logging
import time
import uuid

import numpy as np

from .domain import Segmenter, fingerprint, record
from .store import Conflict

log = logging.getLogger('nareal.obs')


class Runtime:
    def __init__(self, store, transcriber, provider):
        self.store, self.transcriber, self.provider = store, transcriber, provider
        self.audio = asyncio.Queue(maxsize=8)
        self.checks = asyncio.Queue(maxsize=12)
        self.tasks = []
        self.session = None
        self.segmenter = Segmenter()
        self.sequence = -1
        self.last_end = 0
        self.context = ''
        self.seen = {}
        self.ready = False
        self.error = ''
        self.dropped = 0
        self.busy_asr = False
        self.busy_check = False
        self.warming = False
        self.last_audio = 0.0

    async def start(self):
        self.tasks = [asyncio.create_task(self.audio_worker()), asyncio.create_task(self.check_worker()),
                      asyncio.create_task(self.watchdog())]

    async def watchdog(self):
        while True:
            await asyncio.sleep(5)
            if self.session and time.monotonic() - self.last_audio > 20:
                ident = self.session['id']
                self.error = 'Captura encerrada após 20s sem áudio do OBS.'
                await self.end(ident)

    async def close(self):
        for task in self.tasks:
            task.cancel()
        await asyncio.gather(*self.tasks, return_exceptions=True)

    async def warmup(self):
        if self.warming or self.busy_asr:
            raise Conflict('Modelo ocupado. Aguarde a operação atual.')
        self.warming = True
        try:
            await asyncio.to_thread(self.transcriber.prepare)
            self.ready, self.error = True, ''
        except Exception:
            log.exception('Whisper initialization failed')
            self.error = 'Não foi possível carregar o Whisper. Confira o terminal e o modelo.'
            raise ValueError(self.error)
        finally:
            self.warming = False

    def begin(self, label):
        if not self.ready:
            raise Conflict('Carregue o modelo de transcrição no painel antes de capturar.')
        if self.session is not None or self.busy_asr or not self.audio.empty():
            raise Conflict('Encerre a captura anterior e aguarde a transcrição terminar.')
        self.session = {'id': uuid.uuid4().hex, 'source': label, 'started_at': time.time()}
        self.sequence, self.last_end = -1, 0
        self.segmenter = Segmenter()
        self.context, self.error = '', ''
        self.last_audio = time.monotonic()
        return self.session

    def push(self, session, sequence, start_ms, samples):
        if not self.session or session != self.session['id']:
            raise Conflict('Sessão de captura encerrada. Inicie novamente no OBS.')
        if sequence <= self.sequence or start_ms < self.last_end - 30:
            raise Conflict('Pacote duplicado ou fora de ordem.')
        if sequence != self.sequence + 1:
            self.error = 'Houve perda de áudio. Confira a fala antes de publicar.'
            self.dropped += sequence - self.sequence - 1
        item = (session, samples, start_ms, False)
        try:
            self.audio.put_nowait(item)
        except asyncio.QueueFull:
            self.dropped += 1
            self.error = 'Transcrição atrasada: captura interrompida. Aguarde e reinicie.'
            raise Conflict(self.error)
        self.sequence = sequence
        self.last_audio = time.monotonic()
        self.last_end = start_ms + round(len(samples) / 16)

    async def end(self, session):
        if not self.session or session != self.session['id']:
            return
        await self.audio.put((session, None, self.last_end, True))
        self.session = None

    async def audio_worker(self):
        while True:
            session, samples, start, flush = await self.audio.get()
            self.busy_asr = True
            try:
                segments = self.segmenter.flush() if flush else self.segmenter.feed(samples, start)
                for audio, begin, end in segments:
                    before = time.monotonic()
                    text = await asyncio.to_thread(self.transcriber.transcribe, audio, self.context)
                    if not text:
                        continue
                    item = record(text, begin, end, session, self.context[-2000:])
                    item['transcription_ms'] = round((time.monotonic() - before) * 1000)
                    self.store.save(item, 'transcribed')
                    self.context = (self.context + '\n' + text)[-2000:]
                    self.enqueue(item)
            except Exception:
                log.exception('Transcription failed')
                self.error = 'Falha de transcrição. O áudio deste bloco não foi recuperado.'
                self.dropped += 1
            finally:
                self.busy_asr = False
                self.audio.task_done()

    def enqueue(self, item):
        if item.get('phase') == 'checking':
            raise Conflict('Esta fala já está sendo checada.')
        key = fingerprint(item['text'])
        cached = self.seen.get(key)
        # Reuse evidence for exact repeats for ten minutes; retain independent review.
        if cached and time.time() - cached[0] < 600:
            item.update(cached[1], phase='ready', error='')
            self.store.save(item, 'cached', expected=item['version'])
            self.maybe_publish(item)
            return
        if self.checks.full():
            item.update(phase='error', error='Fila de IA cheia. Selecione Checar novamente depois.')
            self.store.save(item, 'queue-full', expected=item['version'])
            return
        item.update(phase='checking', error='')
        item = self.store.save(item, 'check-start', expected=item['version'])
        self.checks.put_nowait((item['id'], item['version']))

    def maybe_publish(self, item):
        if self.store.automatic() and time.time() - item['created_at'] < 180:
            try:
                self.store.publish(item, automatic=True)
            except Conflict:
                self.error = 'Overlay cheio: uma análise ficou apenas na fila de revisão.'

    async def check_worker(self):
        while True:
            ident, version = await self.checks.get()
            self.busy_check = True
            try:
                item = self.store.get(ident)
                if item['version'] != version or item['status'] != 'pending':
                    continue
                before = time.monotonic()
                try:
                    result = await self.provider.check(item['text'], item['context'])
                    # A reviewer may have changed the record while the network request ran.
                    if self.store.get(ident)['version'] != version:
                        continue
                    item.update(result, phase='ready', error='', latency_ms=round((time.monotonic() - before) * 1000))
                    self.store.save(item, 'checked', expected=version)
                    self.seen[fingerprint(item['text'])] = (time.time(), result)
                    if len(self.seen) > 500:
                        self.seen.pop(next(iter(self.seen)))
                    self.maybe_publish(item)
                except Conflict:
                    pass
                except Exception:
                    log.exception('Checking failed')
                    if self.store.get(ident)['version'] == version:
                        item.update(phase='error', error='IA indisponível ou resposta inválida. Confira a configuração e tente novamente.')
                        self.store.save(item, 'check-error', expected=version)
            finally:
                self.busy_check = False
                self.checks.task_done()

    def state(self):
        return {'session': self.session, 'model_ready': self.ready, 'warming': self.warming,
                'transcriber': 'Whisper local', 'provider': self.provider.name,
                'audio_queue': self.audio.qsize(), 'check_queue': self.checks.qsize(),
                'busy_asr': self.busy_asr, 'busy_check': self.busy_check,
                'dropped': self.dropped, 'error': self.error}
