"""Isolated UI-test server with fictional data. Never used by start.sh."""
from pathlib import Path
import tempfile
import uvicorn
from service.app import create_app
from service.domain import record


class FakeWhisper:
    def prepare(self):
        pass

    def transcribe(self, samples, context):
        return 'Fala fictícia de teste.'


class FakeChecker:
    name = 'IA simulada para teste'

    async def check(self, text, context):
        return {'claim': 'Afirmação fictícia', 'verdict': 'Inconclusivo',
                'explanation': 'Exemplo de teste, sem checagem de fato real.', 'sources': []}


if __name__ == '__main__':
    app = create_app(Path(tempfile.mkdtemp(prefix='nareal-ui-')), 'fixture-token-not-a-real-user-secret', FakeWhisper(), FakeChecker())
    item = record('Este é um exemplo fictício para testar a revisão de uma fala.', 1000, 9000, 'fixture')
    item.update(phase='ready', claim='Exemplo fictício para testar a revisão',
                explanation='Este exemplo serve apenas para validar a interface, sem afirmar um fato real.')
    app.state.store.save(item, 'fixture')
    uvicorn.run(app, host='127.0.0.1', port=8766, access_log=False)
