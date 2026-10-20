"""Replace this class to use another speech model without changing any input adapter."""
import os
import threading


class WhisperTranscriber:
    def __init__(self):
        self.model = None
        self.lock = threading.Lock()

    def transcribe(self, pcm, offset, phase):
        import numpy as np
        with self.lock:
            if self.model is None:
                phase('Carregando modelo de transcrição')
                from faster_whisper import WhisperModel
                self.model = WhisperModel(os.environ.get('WHISPER_MODEL', 'base'), device='cpu', compute_type='int8',
                                          cpu_threads=int(os.environ.get('WHISPER_THREADS', '2')),
                                          download_root=os.environ.get('MODEL_CACHE', '/models'))
            phase('Transcrevendo áudio no servidor')
            samples = np.frombuffer(pcm, dtype=np.int16).astype(np.float32) / 32768.0
            segments, _ = self.model.transcribe(samples, language='pt', vad_filter=True, beam_size=1,
                                                condition_on_previous_text=False, no_speech_threshold=0.6)
            # No guessed names: diarization is a separate, replaceable stage.
            return [{'text': s.text.strip(), 'start': round(offset + s.start, 3),
                     'end': round(offset + s.end, 3), 'speaker': 'Falante não identificado'}
                    for s in segments if s.text.strip()]
