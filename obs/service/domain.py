"""Stable contracts and streaming segmentation; no model or network dependencies."""
from __future__ import annotations

import math
import re
import time
import uuid
from typing import Literal
from urllib.parse import urlsplit

import numpy as np
from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

Verdict = Literal['Verdadeiro', 'Falso', 'Enganoso', 'Inconclusivo', 'Não verificável']


class Evidence(BaseModel):
    model_config = ConfigDict(extra='forbid')
    id: str = Field(min_length=1, max_length=100)
    title: str = Field(min_length=1, max_length=300)
    url: str = Field(max_length=2000)
    excerpt: str = Field(default='', max_length=6000)

    @field_validator('url')
    @classmethod
    def safe_url(cls, value):
        parsed = urlsplit(value)
        if parsed.scheme not in ('https', 'http') or not parsed.hostname or parsed.username or parsed.password:
            raise ValueError('A fonte deve ter URL HTTP(S), sem credenciais.')
        return value


class Analysis(BaseModel):
    model_config = ConfigDict(extra='forbid')
    claim: str = Field(min_length=3, max_length=1500)
    verdict: Verdict
    explanation: str = Field(min_length=10, max_length=4000)
    source_ids: list[str] = Field(max_length=8)


class Edit(BaseModel):
    model_config = ConfigDict(extra='forbid')
    version: int = Field(ge=1)
    claim: str = Field(min_length=3, max_length=1500)
    verdict: Verdict
    explanation: str = Field(min_length=10, max_length=4000)
    sources: list[Evidence] = Field(max_length=8)

    @model_validator(mode='after')
    def require_evidence(self):
        if self.verdict in ('Verdadeiro', 'Falso', 'Enganoso') and not self.sources:
            raise ValueError('Veredito factual exige pelo menos uma fonte.')
        if len({s.id for s in self.sources}) != len(self.sources):
            raise ValueError('IDs de fonte repetidos.')
        return self


def checked_analysis(raw: dict, sources: list[Evidence]) -> dict:
    result = Analysis.model_validate(raw)
    allowed = {s.id: s for s in sources}
    if any(i not in allowed for i in result.source_ids):
        raise ValueError('O modelo citou uma fonte que não foi recuperada.')
    selected = [allowed[i].model_dump() for i in dict.fromkeys(result.source_ids)]
    if result.verdict in ('Verdadeiro', 'Falso', 'Enganoso') and not selected:
        raise ValueError('O modelo emitiu veredito factual sem evidência vinculada.')
    return {**result.model_dump(exclude={'source_ids'}), 'sources': selected}


def fingerprint(text: str) -> str:
    return re.sub(r'\W+', ' ', text.casefold()).strip()


def record(text: str, start: int, end: int, session: str, context: str = '') -> dict:
    return dict(id=uuid.uuid4().hex, session=session, start_ms=start, end_ms=end,
                speaker='Falante não identificado', text=text, context=context,
                claim=text[:1500], verdict='Inconclusivo', explanation='Aguardando checagem.',
                sources=[], status='pending', phase='queued', error='', version=1,
                created_at=time.time(), latency_ms=None)


class Segmenter:
    """Energy VAD, 20 ms frames, minimum 2s / maximum 18s, 700ms pause.

    Timings are on the capture clock, not on completion time of the models.
    This detects pauses, NOT speakers. Forced cuts retain context downstream.
    """
    def __init__(self, threshold: float = .008):
        self.threshold = threshold
        self.samples = np.empty(0, dtype=np.float32)
        self.start_ms = 0
        self.expected_ms: int | None = None
        self.silence = 0
        self.speech = False

    def feed(self, samples: np.ndarray, start_ms: int) -> list[tuple[np.ndarray, int, int]]:
        result = []
        # A gap must never be joined into a fabricated continuous utterance.
        if self.expected_ms is not None and abs(start_ms - self.expected_ms) > 50:
            result.extend(self.flush())
        self.expected_ms = start_ms + round(len(samples) / 16)
        for offset in range(0, len(samples), 320):
            frame = samples[offset:offset + 320]
            if not len(self.samples):
                self.start_ms = start_ms + round(offset / 16)
            energy = math.sqrt(float(np.mean(frame * frame))) if len(frame) else 0
            if energy >= self.threshold:
                self.speech = True
                self.silence = 0
            else:
                self.silence += len(frame)
            self.samples = np.concatenate((self.samples, frame))
            size = len(self.samples)
            if size >= 288000 or (self.speech and size >= 32000 and self.silence >= 11200):
                result.extend(self.flush())
            elif not self.speech and size >= 16000:
                self.samples = np.empty(0, dtype=np.float32)
                self.silence = 0
        return result

    def flush(self) -> list[tuple[np.ndarray, int, int]]:
        result = []
        if self.speech and len(self.samples) >= 8000:
            result.append((self.samples, self.start_ms, self.start_ms + round(len(self.samples) / 16)))
        self.samples = np.empty(0, dtype=np.float32)
        self.speech = False
        self.silence = 0
        return result
