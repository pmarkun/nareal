"""Optional bounded RTMP/model smoke test. It never writes claims or transcripts."""
import json
import os
import subprocess
import threading
import time
import tempfile
import re
from adapters import Media, pcm_chunks, InputError


def run(transcriber):
    publish = os.environ.get('OBS_PROBE_PUBLISH_URL', '')
    read = os.environ.get('OBS_STREAM_URL', '')
    if not publish or not read:
        return
    print(json.dumps({'event': 'obs_smoke_started'}), flush=True)
    producer = None
    reader = None
    errors = tempfile.TemporaryFile()
    deadline = time.monotonic() + 60
    try:
        # Synthetic English speech tests transport/model execution, not Portuguese accuracy.
        producer = subprocess.Popen(['ffmpeg', '-nostdin', '-hide_banner', '-loglevel', 'error',
            '-re', '-f', 'lavfi', '-i', 'flite=text=This is a test of the live transcription system. The server receives audio and produces text.:voice=slt',
            '-af', 'apad', '-t', '35', '-c:a', 'aac', '-f', 'flv', publish], stdout=subprocess.DEVNULL, stderr=errors)
        time.sleep(2)
        while True:
            reader = pcm_chunks(Media(read, True), 0, 20, lambda: time.monotonic() > deadline, diagnostics=lambda message: print(json.dumps({'event':'obs_decoder_diagnostic','message':message}),flush=True))
            try:
                pcm = next(reader)
                break
            except InputError:
                reader.close()
                if time.monotonic() > deadline or producer.poll() is not None:
                    raise
                time.sleep(2)
        reader.close()
        print(json.dumps({'event':'obs_audio_received','audioSeconds':len(pcm)/32000}),flush=True)
        segments = transcriber.transcribe(pcm, 0, lambda phase: print(json.dumps({'event':'obs_smoke_phase','phase':phase}),flush=True))
        print(json.dumps({'event': 'obs_smoke_passed', 'audioSeconds': len(pcm) / 32000,
                          'segments': len(segments), 'recognizedCharacters': sum(len(s['text']) for s in segments)}), flush=True)
    except Exception as error:
        errors.seek(0)
        message=re.sub(r'rtmps?://[^\s]+', '[RTMP]',errors.read(4000).decode('utf-8',errors='replace'))
        print(json.dumps({'event': 'obs_smoke_failed', 'type': type(error).__name__, 'message':message}), flush=True)
    finally:
        if reader:
            reader.close()
        if producer and producer.poll() is None:
            producer.terminate()
            try:
                producer.wait(timeout=5)
            except subprocess.TimeoutExpired:
                producer.kill()
                producer.wait()
        errors.close()
