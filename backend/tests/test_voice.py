"""
Unit tests for ONEE Voice Module Backend Endpoints and Services.
"""

import pytest
import httpx
from unittest.mock import AsyncMock, patch
from fastapi.testclient import TestClient
from app.main import app
from app.voice.service import voice_service

client = TestClient(app)

def test_voice_health():
    response = client.get("/api/voice/health")
    assert response.status_code == 200
    data = response.json()
    assert "status" in data
    assert "stt_provider" in data
    assert "tts_provider" in data
    assert "has_voice_key" in data
    # Diagnostic: number of round-robin voice credentials (count only, no values)
    assert "voice_key_count" in data
    assert isinstance(data["voice_key_count"], int)

@pytest.mark.asyncio
async def test_transcribe_empty_file_rejected():
    response = client.post(
        "/api/voice/transcribe",
        files={"file": ("empty.webm", b"", "audio/webm")}
    )
    assert response.status_code == 400
    assert "empty or too short" in response.json()["detail"].lower()

@pytest.mark.asyncio
async def test_transcribe_mock_success():
    mock_result = {
        "text": "Check my attendance",
        "language": "en",
        "duration": 2.1,
        "model": "whisper-large-v3-turbo"
    }

    with patch.object(voice_service.client, "transcribe", new=AsyncMock(return_value=mock_result)):
        dummy_audio = b"fake audio content bytes repeated to exceed one hundred bytes minimum requirement for test." * 2
        response = client.post(
            "/api/voice/transcribe",
            files={"file": ("speech.webm", dummy_audio, "audio/webm")}
        )
        assert response.status_code == 200
        data = response.json()
        assert data["text"] == "Check my attendance"
        assert data["model"] == "whisper-large-v3-turbo"

@pytest.mark.asyncio
async def test_transcribe_json_mock_success():
    import base64
    mock_result = {
        "text": "What is my next exam?",
        "language": "en",
        "duration": 1.8,
        "model": "whisper-large-v3-turbo"
    }

    with patch.object(voice_service.client, "transcribe", new=AsyncMock(return_value=mock_result)):
        dummy_audio = b"fake audio content bytes repeated to exceed one hundred bytes minimum requirement for test." * 2
        b64_data = base64.b64encode(dummy_audio).decode("utf-8")
        response = client.post(
            "/api/voice/transcribe-json",
            json={"audio_base64": b64_data, "content_type": "audio/webm"}
        )
        assert response.status_code == 200
        data = response.json()
        assert data["text"] == "What is my next exam?"

@pytest.mark.asyncio
async def test_speak_empty_text_rejected():
    response = client.post(
        "/api/voice/speak",
        json={"text": "   ", "voice": "alloy"}
    )
    assert response.status_code == 400

@pytest.mark.asyncio
async def test_speak_mock_success():
    mock_audio_bytes = b"ID3\x03\x00\x00\x00\x00\x00#TSSE\x00\x00\x00\x0f\x00\x00\x03fake-audio-mp3-bytes"
    with patch.object(voice_service.client, "synthesize", new=AsyncMock(return_value=(mock_audio_bytes, "audio/mp3"))):
        response = client.post(
            "/api/voice/speak",
            json={"text": "Opening your examination schedule.", "voice": "alloy"}
        )
        assert response.status_code == 200
        assert response.headers["content-type"] == "audio/mp3"
        assert response.content == mock_audio_bytes

def test_orpheus_long_text_segmentation():
    from app.voice.groq_voice import _split_into_orpheus_segments
    long_summary = (
        "You have 4 classes scheduled for Monday. Your day begins with Object Oriented Programming "
        "at 09:00 - 10:00 in Room 34-201, followed by Data Structures at 10:00 - 11:00 in Room 34-202. "
        "You have 2 more sessions in the afternoon, concluding with Web Development at 03:00 - 04:00 in Room 34-205."
    )
    segments = _split_into_orpheus_segments(long_summary, max_chars=195)
    assert len(segments) >= 2
    for seg in segments:
        assert len(seg) <= 195
    # Verify no content was lost across segments
    combined = " ".join(segments)
    assert "Object Oriented Programming" in combined
    assert "Web Development" in combined


def test_strict_credential_boundaries():
    """GROQ_VOICE_API_KEY is for voice STT+TTS; GROQ_API_KEY is for the main LLM.
    Neither client may borrow the other credential."""
    from app.config import Settings

    s = Settings(
        GROQ_API_KEY="main-key-abc",
        GROQ_VOICE_API_KEY="voice-key-xyz",
        GROQ_VOICE_API_1="",
        GROQ_VOICE_API_2="",
    )
    assert s.get_main_api_keys() == ["main-key-abc"]
    assert s.get_voice_api_keys() == ["voice-key-xyz"]
    # No cross-contamination in either direction
    assert "voice-key-xyz" not in s.get_main_api_keys()
    assert "main-key-abc" not in s.get_voice_api_keys()
    # Deprecated combined accessor resolves to the main key only
    assert s.get_groq_api_keys() == ["main-key-abc"]


def test_voice_client_refuses_missing_voice_key():
    """The voice client must refuse STT and TTS without GROQ_VOICE_API_KEY,
    even when GROQ_API_KEY is present (no borrowing the main credential)."""
    import asyncio
    from unittest.mock import patch
    from app.voice.groq_voice import GroqVoiceClient

    with patch("app.voice.groq_voice.settings") as mock_settings:
        mock_settings.GROQ_WHISPER_MODEL = "whisper-large-v3"
        mock_settings.GROQ_TTS_MODEL = "canopylabs/orpheus-v1-english"
        mock_settings.get_voice_api_keys = lambda: []
        client = GroqVoiceClient()
        with pytest.raises(ValueError, match="GROQ_VOICE_API_KEY"):
            asyncio.run(client.transcribe(b"x" * 512))
        with pytest.raises(ValueError, match="GROQ_VOICE_API_KEY"):
            asyncio.run(client.synthesize(text="Hello"))


def test_accuracy_first_stt_model_default():
    """Production STT default is whisper-large-v3 (accuracy-first); turbo must be
    an explicit configuration choice, never a silent default."""
    from app.config import Settings

    s = Settings(GROQ_API_KEY="k", GROQ_VOICE_API_KEY="v")
    assert s.GROQ_WHISPER_MODEL == "whisper-large-v3"
    assert s.GROQ_STT_MODEL == "whisper-large-v3"
    assert s.GROQ_TTS_MODEL == "canopylabs/orpheus-v1-english"


def test_wav_segment_combining_survives_streaming_style_sizes():
    """REGRESSION: real Groq Orpheus segments declare streaming-style sizes
    (0xFFFFFFFF) which broke wave.setparams with
    'L' format requires 0 <= number <= 4294967295 and silently returned only
    the FIRST segment — truncating every multi-sentence TTS reply.
    The combiner must splice the real PCM bytes instead of trusting headers."""
    import struct as _struct
    from app.voice.groq_voice import _combine_wav_segments

    def make_wav(nframes: int, data_size_field: int) -> bytes:
        fmt = _struct.pack('<HHIIHH', 1, 1, 24000, 48000, 2, 16)
        pcm = b'\x00\x00' * nframes
        return (
            b'RIFF' + _struct.pack('<L', data_size_field) + b'WAVE'
            + b'fmt ' + _struct.pack('<L', len(fmt)) + fmt
            + b'data' + _struct.pack('<L', data_size_field) + pcm
        )

    bogus = 0xFFFFFFFF
    seg1 = make_wav(24000, bogus)   # 1 second, streaming-style header
    seg2 = make_wav(48000, bogus)   # 2 seconds, streaming-style header

    combined = _combine_wav_segments([seg1, seg2])
    assert combined[:4] == b'RIFF'
    assert combined[8:12] == b'WAVE'
    # Total PCM must be the sum of BOTH segments (no truncation to first).
    import io as _io, wave as _wave
    with _wave.open(_io.BytesIO(combined)) as w:
        assert w.getnframes() == 72000
        assert w.getframerate() == 24000
    # Declared data size in the fresh header must equal real payload length.
    data_size = int.from_bytes(combined[40:44], 'little')
    assert data_size == len(combined) - 44

    # Normal (accurate-size) segments must also combine correctly.
    normal = _combine_wav_segments([make_wav(1000, 2000 + 36), make_wav(2000, 4000 + 36)])
    with _wave.open(_io.BytesIO(normal)) as w:
        assert w.getnframes() == 3000

    # Mismatched formats must raise rather than splice invalid audio.
    fmt_g711 = _struct.pack('<HHIIHH', 1, 7, 8000, 8000, 1, 1)
    bad = (
        b'RIFF' + _struct.pack('<L', 100) + b'WAVE'
        + b'fmt ' + _struct.pack('<L', len(fmt_g711)) + fmt_g711
        + b'data' + _struct.pack('<L', 2) + b'\x00\x00'
    )
    with pytest.raises(ValueError):
        _combine_wav_segments([seg1, bad])


def test_voice_health_requires_voice_key_only():
    """A configured main key must NOT make the voice pipeline report healthy."""
    from unittest.mock import patch
    from app.voice.service import voice_service

    with patch("app.voice.service.settings") as mock_settings:
        mock_settings.get_voice_api_keys = lambda: []
        mock_settings.GROQ_API_KEY = "main-key-present"
        mock_settings.GROQ_WHISPER_MODEL = "whisper-large-v3"
        mock_settings.GROQ_TTS_MODEL = "canopylabs/orpheus-v1-english"
        health = voice_service.health()
        assert health.status == "degraded"
        assert health.has_voice_key is False
        assert health.voice_key_count == 0

    with patch("app.voice.service.settings") as mock_settings:
        mock_settings.get_voice_api_keys = lambda: ["v1", "v2", "v3"]
        mock_settings.GROQ_API_KEY = "main-key-present"
        mock_settings.GROQ_WHISPER_MODEL = "whisper-large-v3"
        mock_settings.GROQ_TTS_MODEL = "canopylabs/orpheus-v1-english"
        health = voice_service.health()
        assert health.status == "ok"
        assert health.voice_key_count == 3


def test_voice_key_pool_three_credentials_excluding_main():
    """GROQ_VOICE_API_KEY + GROQ_VOICE_API_1 + GROQ_VOICE_API_2 form the voice
    pool; the main GROQ_API_KEY must never be part of it (either direction)."""
    from app.config import Settings

    s = Settings(
        GROQ_API_KEY="main-key-abc",
        GROQ_VOICE_API_KEY="voice-key-0",
        GROQ_VOICE_API_1="voice-key-1",
        GROQ_VOICE_API_2="voice-key-2",
    )
    pool = s.get_voice_api_keys()
    assert pool == ["voice-key-0", "voice-key-1", "voice-key-2"]
    assert "main-key-abc" not in pool
    assert s.get_main_api_keys() == ["main-key-abc"]
    # Deduplication: same key configured twice counts once.
    s2 = Settings(
        GROQ_API_KEY="m",
        GROQ_VOICE_API_KEY="dup",
        GROQ_VOICE_API_1="dup",
        GROQ_VOICE_API_2="other",
    )
    assert s2.get_voice_api_keys() == ["dup", "other"]


def test_voice_key_rotation_round_robin():
    """Consecutive voice tasks rotate across the pool so concurrent STT/TTS
    requests hit DIFFERENT voice accounts."""
    from app.voice.groq_voice import next_key_rotation

    rots = [next_key_rotation(3) for _ in range(6)]
    for a, b in zip(rots, rots[1:]):
        assert (b - a) % 3 == 1  # strictly advancing round-robin
    assert all(0 <= r < 3 for r in rots)
    # Single-key pool never rotates.
    assert next_key_rotation(1) == 0
    assert next_key_rotation(0) == 0


def _make_test_wav(pcm_byte: int, frames: int = 1000) -> bytes:
    import struct as _struct
    fmt = _struct.pack('<HHIIHH', 1, 1, 24000, 48000, 2, 16)
    pcm = bytes([pcm_byte]) * (frames * 2)
    return (
        b'RIFF' + _struct.pack('<L', 36 + len(pcm)) + b'WAVE'
        + b'fmt ' + _struct.pack('<L', len(fmt)) + fmt
        + b'data' + _struct.pack('<L', len(pcm)) + pcm
    )


def test_tts_parallel_segments_use_distinct_keys_and_preserve_order():
    """REGRESSION for latency + truncation:
    - each text segment starts on a DIFFERENT round-robin voice key
    - segments synthesize in PARALLEL, but the combined audio keeps INPUT order
      even when a later segment finishes FIRST (out-of-order completion)"""
    import asyncio
    from unittest.mock import patch, MagicMock
    from app.voice.groq_voice import GroqVoiceClient

    alpha_wav = _make_test_wav(0x11)
    beta_wav = _make_test_wav(0x22)
    segment_key_log = []

    class FakeResponse:
        def __init__(self, content=b""):
            self.status_code = 200
            self.content = content
            self.text = ""

    async def fake_post(self, url, headers=None, json=None, **kwargs):
        segment = json["input"]
        key = headers["Authorization"].replace("Bearer ", "", 1)
        if "Alpha" in segment:
            await asyncio.sleep(0.15)  # finishes LAST
            segment_key_log.append(("alpha", key))
            return FakeResponse(alpha_wav)
        await asyncio.sleep(0.01)  # finishes FIRST
        segment_key_log.append(("beta", key))
        return FakeResponse(beta_wav)

    # Two sentences >195 chars combined but each <=195 => exactly 2 segments.
    text = (
        "Alpha segment: " + "very important attendance details for CSE330. " * 2 + " " +
        "Beta segment: " + "safe bunk margin notes for CSE329 remain unchanged. " * 2
    )

    with patch("app.voice.groq_voice.settings") as mock_settings:
        mock_settings.get_voice_api_keys = lambda: ["key-A", "key-B", "key-C"]
        mock_settings.GROQ_TTS_MODEL = "canopylabs/orpheus-v1-english"
        mock_settings.GROQ_TTS_VOICE = "autumn"
        client = GroqVoiceClient()

        with patch.object(httpx.AsyncClient, "post", fake_post):
            audio, content_type = asyncio.run(client.synthesize(text=text))

    assert content_type == "audio/wav"
    # Exactly two segments were synthesized.
    assert len(segment_key_log) == 2
    alpha_key = next(k for name, k in segment_key_log if name == "alpha")
    beta_key = next(k for name, k in segment_key_log if name == "beta")
    # Round-robin: the two segments of ONE request start on DIFFERENT keys.
    assert alpha_key != beta_key
    assert alpha_key in ("key-A", "key-B", "key-C")
    assert beta_key in ("key-A", "key-B", "key-C")
    # ORDER PRESERVED: alpha (finished last) audio comes FIRST in the output,
    # and BOTH segments are present (no truncation to the fast segment).
    pcm = audio[44:]
    assert pcm[:2000] == bytes([0x11]) * 2000, "segment 1 audio must come first"
    assert pcm[2000:4000] == bytes([0x22]) * 2000, "segment 2 audio must follow"
    assert len(pcm) == 4000


def test_tts_fails_over_to_next_voice_key_and_never_returns_partial_audio():
    """A failing key (429) rotates to the next voice key; if EVERY key fails the
    request raises — partial/truncated audio is never returned."""
    import asyncio
    from unittest.mock import patch
    from app.voice.groq_voice import GroqVoiceClient

    attempts = []

    class FakeResponse:
        def __init__(self, status, content=b""):
            self.status_code = status
            self.content = content
            self.text = "rate limited" if status != 200 else ""

    async def fake_post_fail_first_attempt(self, url, headers=None, json=None, **kwargs):
        # Fail the first voice key it tries once, succeed on the next.
        key = headers["Authorization"]
        attempts.append(key)
        if len(attempts) == 1:
            return FakeResponse(429)
        return FakeResponse(200, _make_test_wav(0x33))

    async def fake_post_all_fail(self, url, headers=None, json=None, **kwargs):
        attempts.append(headers["Authorization"])
        return FakeResponse(429)

    with patch("app.voice.groq_voice.settings") as mock_settings:
        mock_settings.get_voice_api_keys = lambda: ["key-A", "key-B", "key-C"]
        mock_settings.GROQ_TTS_MODEL = "canopylabs/orpheus-v1-english"
        mock_settings.GROQ_TTS_VOICE = "autumn"
        client = GroqVoiceClient()

        # Failover: first attempt 429 -> next voice key succeeds.
        with patch.object(httpx.AsyncClient, "post", fake_post_fail_first_attempt):
            audio, _ = asyncio.run(client.synthesize(text="One short sentence for failover."))
        assert len(audio) > 44
        assert len(attempts) == 2

        # Total failure: every voice key fails -> RuntimeError, no partial bytes.
        attempts.clear()
        with patch.object(httpx.AsyncClient, "post", fake_post_all_fail):
            try:
                asyncio.run(client.synthesize(text="One short sentence that cannot speak."))
                raise AssertionError("expected RuntimeError when all voice keys fail")
            except RuntimeError as e:
                assert "voice keys exhausted" in str(e).lower() or "segment" in str(e).lower()


def test_transform_speech_identity_natural_speech():
    """Voice must never read markdown headings, table rows, or '5/10' literally."""
    from app.voice.groq_voice import transform_speech_identity

    raw = (
        "## Attendance Summary\n"
        "| Subject | Attended | Total |\n"
        "| :--- | :--- | :--- |\n"
        "| CSE329 | 5/10 | 8/10 |\n"
        "You attended **5/10** classes in CSE329, that is 80%.\n"
        "Date: 10/8/2026\n"
    )
    out = transform_speech_identity(raw)

    # Headings and table rows are visual layout, never speech.
    assert "Attendance Summary" not in out or not out.lstrip().startswith("Attendance")
    assert "|" not in out
    assert "Subject" not in out and "Attended" not in out
    # Fractions are spoken naturally, dates stay intact.
    assert "5 out of 10" in out
    assert "5/10" not in out
    assert "10/8/2026" in out
    # Markdown emphasis stripped.
    assert "**" not in out
