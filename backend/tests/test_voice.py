"""
Unit tests for ONEE Voice Module Backend Endpoints and Services.
"""

import pytest
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
