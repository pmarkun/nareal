"""Optional bounded RTMP/model smoke test. It never writes claims or transcripts."""
import json
import os
import subprocess
import threading
import time
from adapters import Media, pcm_chunks


def run(transcriber):
    publish = os.environ.get('OBS_PROBE_PUBLISH_URL', '')
    read = os.environ.get('OBS_STREAM_URL', '')
    if not publish or not read:
        return
    print(json.dumps({'event': 'obs_smoke_started'}), flush=True)
    producer = None
    reader = None
    deadline = time.monotonic() + 50
    try:
        # Synthetic English speech tests transport/model execution, not Portuguese accuracy.
        producer = subprocess.Popen(['ffmpeg', '-nostdin', '-hide_banner', '-loglevel', 'error',
            '-re', '-f', 'lavfi', '-i', 'flite=text=This is a test of the live transcription system. The server receives audio and produces text.:voice=slt',
            '-af', 'apad', '-t', '35', '-c:a', 'aac', '-f', 'flv', publish], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        time.sleep(2)
        reader = pcm_chunks(Media(read, True), 0, 20, lambda: time.monotonic() > deadline)
        pcm = next(reader)
        reader.close()
        print(json.dumps({'event':'obs_audio_received','audioSeconds':len(pcm)/32000}),flush=True)
        segments = transcriber.transcribe(pcm, 0, lambda phase: print(json.dumps({'event':'obs_smoke_phase','phase':phase}),flush=True))
        print(json.dumps({'event': 'obs_smoke_passed', 'audioSeconds': len(pcm) / 32000,
                          'segments': len(segments), 'recognizedCharacters': sum(len(s['text']) for s in segments)}), flush=True)
    except Exception as error:
        print(json.dumps({'event': 'obs_smoke_failed', 'type': type(error).__name__}), flush=True)
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
