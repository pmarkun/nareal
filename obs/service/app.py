"""Loopback-only HTTP API, review panel and transparent browser-source overlay."""
import argparse
import asyncio
import json
import os
import secrets
from contextlib import asynccontextmanager
from pathlib import Path

import numpy as np
from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import FileResponse, JSONResponse
from pydantic import BaseModel, ConfigDict, Field

from .domain import Edit
from .providers import Whisper, checker
from .runtime import Runtime
from .store import Conflict, Store

WEB = Path(__file__).resolve().parent / 'web'


def create_app(directory: Path, token: str, transcriber=None, provider=None, port=8766):
    store = Store(directory / 'obs.sqlite')
    runtime = Runtime(store, transcriber or Whisper(), provider or checker())

    @asynccontextmanager
    async def lifespan(app):
        await runtime.start()
        yield
        await runtime.close()
        store.close()

    app = FastAPI(title='Na Real · OBS', lifespan=lifespan, docs_url=None, redoc_url=None, openapi_url=None)
    app.state.runtime, app.state.store = runtime, store

    @app.middleware('http')
    async def boundary(request: Request, call_next):
        hosts = {f'127.0.0.1:{port}', f'localhost:{port}', f'[::1]:{port}'}
        host = request.headers.get('host', '')
        origin = request.headers.get('origin')
        if host not in hosts or (origin and origin not in {f'http://127.0.0.1:{port}', f'http://localhost:{port}'}):
            return JSONResponse({'detail': 'Origem não autorizada.'}, 403)
        public = request.method == 'GET' and request.url.path in {'/', '/overlay', '/panel.js', '/overlay.js', '/style.css', '/api/overlay', '/health'}
        if not public and not secrets.compare_digest(request.headers.get('authorization', ''), 'Bearer ' + token):
            return JSONResponse({'detail': 'Informe a chave local do operador.'}, 401)
        if request.method in {'POST', 'PUT', 'PATCH'}:
            try:
                length = int(request.headers.get('content-length', '-1'))
            except ValueError:
                length = -1
            if length < 0 or length > 300000:
                return JSONResponse({'detail': 'Corpo ausente ou maior que 300 kB.'}, 413)
        response = await call_next(request)
        response.headers['Cache-Control'] = 'no-store'
        response.headers['X-Content-Type-Options'] = 'nosniff'
        response.headers['Referrer-Policy'] = 'no-referrer'
        response.headers['Content-Security-Policy'] = "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'"
        return response

    @app.exception_handler(Conflict)
    async def conflict(_, exc):
        return JSONResponse({'detail': str(exc)}, 409)

    @app.exception_handler(KeyError)
    async def missing(_, exc):
        return JSONResponse({'detail': 'Fala não encontrada.'}, 404)

    @app.get('/')
    async def panel():
        return FileResponse(WEB / 'panel.html')

    @app.get('/overlay')
    async def overlay_page():
        return FileResponse(WEB / 'overlay.html')

    @app.get('/health')
    async def health():
        return {'ok': True, 'schema': 'nareal.obs.v1'}

    @app.get('/{asset}')
    async def assets(asset: str):
        if asset not in {'panel.js', 'overlay.js', 'style.css'}:
            raise HTTPException(404)
        return FileResponse(WEB / asset)

    @app.get('/api/state')
    async def state():
        return {'revision': store.revision, 'automatic': store.automatic(),
                'capture': runtime.state(), 'records': store.all(), 'overlay': store.overlay()}

    @app.get('/api/export')
    async def export():
        return JSONResponse({'schema': 'nareal.obs.v1', 'records': store.all(limit=-1)},
                            headers={'Content-Disposition': 'attachment; filename="nareal-obs.json"'})

    @app.get('/api/overlay')
    async def overlay():
        return {'item': store.overlay()}

    class Session(BaseModel):
        source: str = Field(min_length=1, max_length=300)

    @app.post('/api/session')
    async def begin(body: Session):
        return runtime.begin(body.source)

    @app.post('/api/session/{ident}/stop')
    async def end(ident: str):
        await runtime.end(ident)
        return {'ok': True}

    @app.post('/api/audio')
    async def audio(request: Request):
        if request.headers.get('content-type', '').split(';')[0] != 'application/octet-stream':
            raise HTTPException(415, 'Envie áudio mono Float32 little-endian, 16 kHz.')
        raw = await request.body()
        if not raw or len(raw) % 4 or len(raw) > 128000:
            raise HTTPException(400, 'Áudio deve ter até 2s, em Float32 mono 16 kHz.')
        samples = np.frombuffer(raw, dtype='<f4').copy()
        if not np.isfinite(samples).all() or np.max(np.abs(samples)) > 1.01:
            raise HTTPException(400, 'Amostras de áudio inválidas.')
        try:
            sequence = int(request.headers['x-sequence'])
            start_ms = int(request.headers['x-start-ms'])
            if sequence < 0 or start_ms < 0:
                raise ValueError()
            ident = request.headers['x-session']
        except (KeyError, ValueError):
            raise HTTPException(400, 'Metadados de captura inválidos.')
        runtime.push(ident, sequence, start_ms, samples)
        return {'ok': True, 'queued': runtime.audio.qsize()}

    @app.post('/api/warmup')
    async def warmup():
        try:
            await runtime.warmup()
        except ValueError as exc:
            raise HTTPException(503, str(exc))
        return {'ready': True}

    class Mode(BaseModel):
        automatic: bool

    @app.put('/api/mode')
    async def mode(body: Mode):
        return {'automatic': store.automatic(body.automatic)}

    class Action(BaseModel):
        model_config = ConfigDict(extra='forbid')
        version: int = Field(ge=1)
        action: str = Field(pattern='^(approve|close|publish|check)$')

    @app.post('/api/records/{ident}/action')
    async def action(ident: str, body: Action):
        item = store.get(ident)
        if item['version'] != body.version:
            raise Conflict('A análise mudou. Recarregue antes de continuar.')
        if body.action == 'check':
            if item['status'] != 'pending':
                raise Conflict('Somente falas pendentes podem ser checadas novamente.')
            runtime.enqueue(item)
        elif body.action == 'close':
            item['status'] = 'closed'
            store.save(item, 'closed', expected=body.version)
        elif body.action == 'publish':
            if item['status'] != 'approved':
                raise Conflict('Aprove a análise antes de exibir manualmente.')
            store.publish(item)
        else:
            if item['phase'] != 'ready' or item['status'] != 'pending':
                raise Conflict('Aguarde a checagem ou salve uma revisão manual.')
            Edit.model_validate({k: item[k] for k in ('version', 'claim', 'verdict', 'explanation', 'sources')})
            item['status'] = 'approved'
            store.save(item, 'approved', expected=body.version)
            store.publish(item)
        return {'ok': True}

    @app.put('/api/records/{ident}')
    async def edit(ident: str, body: Edit):
        item = store.get(ident)
        item.update(body.model_dump(exclude={'version'}), phase='ready', error='', status='pending')
        return store.save(item, 'edited', expected=body.version)

    @app.post('/api/hide')
    async def hide():
        store.hide()
        return {'ok': True}

    return app


def main():
    parser = argparse.ArgumentParser(description='Na Real · serviço local para OBS')
    parser.add_argument('--port', type=int, default=8766)
    parser.add_argument('--data-dir', type=Path, default=Path.home() / '.nareal-obs')
    args = parser.parse_args()
    if not 1024 <= args.port <= 65535:
        parser.error('Use uma porta entre 1024 e 65535.')
    args.data_dir.mkdir(parents=True, exist_ok=True)
    token_file = args.data_dir / 'operator.key'
    if not token_file.exists():
        fd = os.open(token_file, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(fd, 'w') as handle:
            handle.write(secrets.token_urlsafe(32))
    token = token_file.read_text().strip()
    if len(token) < 24:
        raise RuntimeError('Chave local inválida. Remova operator.key para gerar outra.')
    print(f'\nPainel: http://127.0.0.1:{args.port}/#token={token}\nOverlay: http://127.0.0.1:{args.port}/overlay\n', flush=True)
    import uvicorn
    uvicorn.run(create_app(args.data_dir, token, port=args.port), host='127.0.0.1', port=args.port, access_log=False)


if __name__ == '__main__':
    main()
