"""SQLite persistence, review conflicts and the bounded overlay publication queue."""
import json
import sqlite3
import threading
import time
from pathlib import Path


class Conflict(ValueError):
    pass


class Store:
    def __init__(self, path: Path):
        path.parent.mkdir(parents=True, exist_ok=True)
        self.lock = threading.RLock()
        self.db = sqlite3.connect(path, check_same_thread=False)
        self.db.execute('PRAGMA journal_mode=WAL')
        self.db.executescript('''
            CREATE TABLE IF NOT EXISTS records(id TEXT PRIMARY KEY, body TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS audit(at REAL, record_id TEXT, action TEXT, body TEXT);
            CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY, value TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS publication(record_id TEXT, version INTEGER, start REAL, end REAL, automatic INTEGER);
        ''')
        # A restart must not replay yesterday's graphic or re-enable unattended publishing.
        self.db.execute('DELETE FROM publication')
        self.db.execute("INSERT OR REPLACE INTO settings VALUES ('automatic', 'false')")
        self.db.commit()
        self.revision = 0
        for item in self.all(limit=-1):
            if item['phase'] in ('checking', 'queued'):
                item.update(phase='error', error='Serviço reiniciado. Selecione Checar novamente.')
                self.save(item, 'interrupted', expected=item['version'])

    def all(self, limit=300):
        with self.lock:
            return [json.loads(r[0]) for r in self.db.execute('SELECT body FROM records ORDER BY rowid DESC LIMIT ?', (limit,))]

    def get(self, ident):
        with self.lock:
            row = self.db.execute('SELECT body FROM records WHERE id=?', (ident,)).fetchone()
            if not row:
                raise KeyError(ident)
            return json.loads(row[0])

    def save(self, item, action, expected=None):
        with self.lock, self.db:
            if expected is not None:
                current = self.get(item['id'])
                if current['version'] != expected:
                    raise Conflict('Esta análise mudou. Recarregue antes de salvar.')
                item['version'] = expected + 1
                self.db.execute('DELETE FROM publication WHERE record_id=?', (item['id'],))
            self.db.execute('INSERT OR REPLACE INTO records VALUES (?,?)', (item['id'], json.dumps(item, ensure_ascii=False)))
            self.db.execute('INSERT INTO audit VALUES (?,?,?,?)', (time.time(), item['id'], action, json.dumps(item, ensure_ascii=False)))
            self.db.commit()
            self.revision += 1
            return item

    def automatic(self, value=None):
        with self.lock, self.db:
            if value is not None:
                self.db.execute("INSERT OR REPLACE INTO settings VALUES ('automatic', ?)", (json.dumps(value),))
                if not value:
                    self.db.execute('DELETE FROM publication WHERE automatic=1')
                self.db.execute('INSERT INTO audit VALUES (?,?,?,?)', (time.time(), '', 'automatic', json.dumps(value)))
                self.revision += 1
            return json.loads(self.db.execute("SELECT value FROM settings WHERE key='automatic'").fetchone()[0])

    def publish(self, item, duration=20, automatic=False):
        with self.lock, self.db:
            now = time.time()
            self.db.execute('DELETE FROM publication WHERE end<=?', (now,))
            if self.db.execute('SELECT 1 FROM publication WHERE record_id=?', (item['id'],)).fetchone():
                return
            count, last = self.db.execute('SELECT count(*), max(end) FROM publication').fetchone()
            if count >= 5:
                raise Conflict('Fila de overlay cheia. Retire uma tarja ou aguarde.')
            start = max(now, last or now)
            self.db.execute('INSERT INTO publication VALUES (?,?,?,?,?)', (item['id'], item['version'], start, start + duration, automatic))
            self.db.execute('INSERT INTO audit VALUES (?,?,?,?)', (now, item['id'], 'publish', json.dumps({'automatic': automatic})))
            self.revision += 1

    def hide(self):
        with self.lock, self.db:
            self.db.execute('DELETE FROM publication')
            self.db.execute('INSERT INTO audit VALUES (?,?,?,?)', (time.time(), '', 'hide', '{}'))
            self.revision += 1

    def overlay(self):
        with self.lock:
            now = time.time()
            rows = self.db.execute('SELECT record_id, version, end, automatic FROM publication WHERE start<=? AND end>? ORDER BY start LIMIT 1', (now, now)).fetchall()
            for ident, version, end, automatic in rows:
                item = self.get(ident)
                if item['version'] != version or item['status'] == 'closed':
                    continue
                # Never expose working context, errors or draft transcript to overlay readers.
                return {k: item[k] for k in ('id', 'version', 'claim', 'verdict', 'explanation', 'start_ms', 'end_ms')} | {
                    'sources': [{k: s[k] for k in ('title', 'url')} for s in item['sources']],
                    'label': 'Análise por IA · não revisada' if automatic else 'Revisado pela redação',
                    'expires_at': end}
            return None

    def close(self):
        self.db.close()
