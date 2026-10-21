import asyncio
import time

import httpx
import numpy as np
import pytest
from fastapi.testclient import TestClient

from service.app import create_app
from service.domain import Evidence, Segmenter, checked_analysis, record
from service.providers import Gemini
from service.store import Store

TOKEN = 'test-key-only-not-a-production-credential'
AUTH = {'Authorization': 'Bearer ' + TOKEN}
SOURCE = Evidence(id='ibge', title='Fonte fictícia de teste', url='https://example.org/dados', excerpt='Evidência de teste.')
RESULT = {'claim': 'Afirmação fictícia de teste', 'verdict': 'Inconclusivo',
          'explanation': 'Este teste não estabelece qualquer fato real.', 'sources': []}


class Transcriber:
    def prepare(self):
        pass

    def transcribe(self, samples, context):
        assert len(samples) >= 8000
        return 'Afirmação fictícia de teste, sem relação com um debate real.'


class Checker:
    name = 'Provedor simulado para teste'

    async def check(self, text, context):
        return dict(RESULT)


@pytest.fixture
def client(tmp_path):
    app = create_app(tmp_path, TOKEN, Transcriber(), Checker())
    with TestClient(app, base_url='http://127.0.0.1:8766') as c:
        yield c


def wait_for(client, predicate):
    deadline = time.monotonic() + 4
    while time.monotonic() < deadline:
        state = client.get('/api/state', headers=AUTH).json()
        if predicate(state):
            return state
        time.sleep(.01)
    raise AssertionError(state)


def create_ready(client):
    item = record('Fala fictícia do teste.', 1000, 4000, 'test')
    item.update(RESULT, phase='ready')
    client.app.state.store.save(item, 'fixture')
    return item


def test_loopback_and_auth_boundaries(client):
    assert client.get('/').status_code == 200
    assert client.get('/health').json()['ok']
    assert client.get('/api/state').status_code == 401
    assert client.get('/api/export').status_code == 401
    assert client.get('/api/state', headers=AUTH).status_code == 200
    assert client.get('/api/state', headers=AUTH | {'Origin': 'https://evil.example'}).status_code == 403
    assert client.get('/api/overlay', headers={'Host': 'evil.example'}).status_code == 403
    assert client.post('/api/hide', json={}).status_code == 401


def test_capture_to_review_to_overlay_and_withdraw(client):
    assert client.post('/api/session', json={'source': 'Debate'}, headers=AUTH).status_code == 409
    assert client.post('/api/warmup', json={}, headers=AUTH).status_code == 200
    session = client.post('/api/session', json={'source': 'Debate'}, headers=AUTH).json()['id']
    audio = np.concatenate((np.full(32000, .1, dtype='<f4'), np.zeros(16000, dtype='<f4')))
    for seq, start in enumerate(range(0, len(audio), 16000)):
        response = client.post('/api/audio', content=audio[start:start+16000].tobytes(), headers=AUTH | {
            'Content-Type': 'application/octet-stream', 'X-Session': session,
            'X-Sequence': str(seq), 'X-Start-Ms': str(seq * 1000)})
        assert response.status_code == 200, response.text
    state = wait_for(client, lambda s: s['records'] and s['records'][0]['phase'] == 'ready')
    item = state['records'][0]
    assert item['start_ms'] == 0 and 2600 <= item['end_ms'] <= 3000
    assert item['status'] == 'pending'
    assert client.get('/api/overlay').json()['item'] is None
    response = client.post(f"/api/records/{item['id']}/action", headers=AUTH, json={'version': item['version'], 'action': 'approve'})
    assert response.status_code == 200, response.text
    overlay = client.get('/api/overlay').json()['item']
    assert overlay['label'] == 'Revisado pela redação'
    assert not {'text', 'context', 'error'} & overlay.keys()
    item = client.app.state.store.get(item['id'])
    assert client.put(f"/api/records/{item['id']}", headers=AUTH, json={
        'version': item['version'], **RESULT}).status_code == 200
    assert client.get('/api/overlay').json()['item'] is None
    assert client.app.state.store.get(item['id'])['status'] == 'pending'


def test_stale_revision_cannot_override_review(client):
    item = create_ready(client)
    path = f"/api/records/{item['id']}"
    assert client.put(path, headers=AUTH, json={'version': 1, **RESULT}).status_code == 200
    assert client.put(path, headers=AUTH, json={'version': 1, **RESULT}).status_code == 409
    assert client.post(path + '/action', headers=AUTH, json={'version': 1, 'action': 'approve'}).status_code == 409


def test_no_factual_verdict_without_evidence(client):
    item = create_ready(client)
    result = {**RESULT, 'verdict': 'Falso'}
    assert client.put(f"/api/records/{item['id']}", headers=AUTH, json={'version': 1, **result}).status_code == 422
    with pytest.raises(ValueError):
        checked_analysis({'claim': 'Uma alegação', 'verdict': 'Falso', 'explanation': 'Uma conclusão sem fontes.', 'source_ids': []}, [])
    with pytest.raises(ValueError):
        checked_analysis({'claim': 'Uma alegação', 'verdict': 'Falso', 'explanation': 'Uma conclusão sem fontes.', 'source_ids': ['inventada']}, [SOURCE])
    with pytest.raises(ValueError):
        Evidence(id='bad', title='Não executar', url='javascript:alert(1)')


def test_automatic_is_explicit_and_never_editorially_approved(client):
    item = create_ready(client)
    client.app.state.runtime.maybe_publish(item)
    assert client.get('/api/overlay').json()['item'] is None
    client.put('/api/mode', headers=AUTH, json={'automatic': True})
    client.app.state.runtime.maybe_publish(item)
    assert client.get('/api/overlay').json()['item']['label'] == 'Análise por IA · não revisada'
    assert client.app.state.store.get(item['id'])['status'] == 'pending'
    client.put('/api/mode', headers=AUTH, json={'automatic': False})
    assert client.get('/api/overlay').json()['item'] is None


def test_bad_audio_and_duplicate_packets(client):
    client.post('/api/warmup', json={}, headers=AUTH)
    session = client.post('/api/session', json={'source': 'Som'}, headers=AUTH).json()['id']
    headers = AUTH | {'Content-Type': 'application/octet-stream', 'X-Session': session, 'X-Sequence': '0', 'X-Start-Ms': '0'}
    assert client.post('/api/audio', content=b'bad', headers=headers).status_code == 400
    assert client.post('/api/audio', content=np.array([float('nan')], dtype='<f4').tobytes(), headers=headers).status_code == 400
    valid = np.zeros(1600, dtype='<f4').tobytes()
    assert client.post('/api/audio', content=valid, headers=headers).status_code == 200
    assert client.post('/api/audio', content=valid, headers=headers).status_code == 409
    assert client.post('/api/audio', content=valid, headers=headers | {'X-Session': 'outro'}).status_code == 409


def test_segmenter_silence_gaps_and_forced_cut():
    segmenter = Segmenter()
    assert segmenter.feed(np.zeros(32000, dtype=np.float32), 0) == []
    segmenter.feed(np.full(16000, .1, dtype=np.float32), 2000)
    gap = segmenter.feed(np.full(16000, .1, dtype=np.float32), 6000)
    assert len(gap) == 1 and gap[0][1:] == (2000, 3000)
    assert segmenter.flush()[0][1:] == (6000, 7000)
    long = Segmenter().feed(np.full(16000*20, .1, dtype=np.float32), 0)
    assert len(long) == 1 and long[0][1:] == (0, 18000)


def test_persistence_never_replays_overlay_or_auto(tmp_path):
    path = tmp_path / 'obs.sqlite'
    store = Store(path)
    item = record('Uma fala teste.', 0, 1000, 'test')
    item.update(RESULT, phase='ready')
    store.save(item, 'test'); store.automatic(True); store.publish(item, automatic=True); store.close()
    restored = Store(path)
    assert len(restored.all()) == 1
    assert restored.overlay() is None and restored.automatic() is False
    restored.close()


def test_gemini_grounding_then_structured_json(monkeypatch):
    monkeypatch.setenv('GEMINI_API_KEY', 'test-only')
    requests = []
    def transport(request):
        requests.append(request)
        if len(requests) == 1:
            return httpx.Response(200, json={'candidates': [{'finishReason': 'STOP', 'groundingMetadata': {
                'groundingChunks': [{'web': {'uri': SOURCE.url, 'title': SOURCE.title}}],
                'groundingSupports': [{'segment': {'text': 'Trecho sustentado.'}, 'groundingChunkIndices': [0]}]}}]})
        return httpx.Response(200, json={'candidates': [{'finishReason': 'STOP', 'content': {'parts': [{'text':
            '{"claim":"Afirmação teste","verdict":"Falso","explanation":"Contradição documentada para teste.","source_ids":["web-0"]}'}]}}]})
    result = asyncio.run(Gemini(httpx.MockTransport(transport)).check('Fala teste.', ''))
    assert result['sources'][0]['url'] == SOURCE.url
    assert len(requests) == 2 and requests[0].headers['x-goog-api-key'] == 'test-only'


def test_edit_during_check_keeps_human_changes(client):
    item = create_ready(client)
    # Simulate the version held by an in-flight model; saving with it must fail.
    original = dict(item)
    edit = {**RESULT, 'claim': 'Correção feita pelo revisor'}
    client.put(f"/api/records/{item['id']}", headers=AUTH, json={'version': 1, **edit})
    with pytest.raises(ValueError):
        client.app.state.store.save(original, 'model-late', expected=1)
    assert client.app.state.store.get(item['id'])['claim'] == edit['claim']
