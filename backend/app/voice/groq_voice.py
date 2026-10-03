"""
Dedicated Groq Cloud Voice Client for ONEE.

Maintains strict account and credential isolation from the main agent LLM pipeline:
- STT: whisper-large-v3-turbo (Groq Audio API)
- TTS: canopylabs/orpheus-v1-english or standard speech endpoint
- Uses GROQ_VOICE_API_KEY exclusively
"""

import httpx
import logging
from typing import Optional, Dict, Any, Tuple
from ..config import settings

logger = logging.getLogger("onee.voice.groq")

GROQ_AUDIO_TRANSCRIPTIONS_URL = "https://api.groq.com/openai/v1/audio/transcriptions"
GROQ_AUDIO_SPEECH_URL = "https://api.groq.com/openai/v1/audio/speech"

class GroqVoiceClient:
    def __init__(self):
        # Dedicated Voice API Key takes precedence
        self.api_key = settings.GROQ_VOICE_API_KEY or settings.GROQ_API_KEY
        self.whisper_model = settings.GROQ_WHISPER_MODEL
        self.tts_model = settings.GROQ_TTS_MODEL

    def _get_headers(self) -> Dict[str, str]:
        if not self.api_key:
            raise ValueError("GROQ_VOICE_API_KEY is not configured")
        return {
            "Authorization": f"Bearer {self.api_key}"
        }

    async def transcribe(
        self,
        audio_bytes: bytes,
        filename: str = "audio.webm",
        content_type: str = "audio/webm"
    ) -> Dict[str, Any]:
        """
        Transcribes audio bytes into text using Groq Whisper.
        """
        headers = self._get_headers()
        files = {
            "file": (filename, audio_bytes, content_type)
        }
        data = {
            "model": self.whisper_model,
            "response_format": "json"
        }

        async with httpx.AsyncClient(timeout=30.0) as client:
            try:
                response = await client.post(
                    GROQ_AUDIO_TRANSCRIPTIONS_URL,
                    headers=headers,
                    files=files,
                    data=data
                )
                if response.status_code != 200:
                    logger.error(
                        "Groq Whisper transcription failed: HTTP %s - %s",
                        response.status_code,
                        response.text
                    )
                    response.raise_for_status()

                res_json = response.json()
                return {
                    "text": res_json.get("text", "").strip(),
                    "language": res_json.get("language", "en"),
                    "duration": res_json.get("duration"),
                    "model": self.whisper_model
                }
            except httpx.HTTPError as e:
                logger.error("HTTP error communicating with Groq Whisper: %s", str(e))
                raise

    async def synthesize(
        self,
        text: str,
        voice: str = "alloy",
        model: Optional[str] = None,
        response_format: str = "mp3"
    ) -> Tuple[bytes, str]:
        """
        Synthesizes text into audio bytes using Groq Orpheus or OpenAI-compatible speech endpoint.
        Returns (audio_bytes, content_type).
        """
        headers = self._get_headers()
        headers["Content-Type"] = "application/json"

        chosen_model = model or self.tts_model
        payload = {
            "model": chosen_model,
            "input": text,
            "voice": voice,
            "response_format": response_format
        }

        async with httpx.AsyncClient(timeout=30.0) as client:
            try:
                response = await client.post(
                    GROQ_AUDIO_SPEECH_URL,
                    headers=headers,
                    json=payload
                )
                if response.status_code != 200:
                    logger.error(
                        "Groq TTS synthesis failed: HTTP %s - %s",
                        response.status_code,
                        response.text
                    )
                    response.raise_for_status()

                content_type = response.headers.get("content-type", f"audio/{response_format}")
                return response.content, content_type
            except httpx.HTTPError as e:
                logger.error("HTTP error communicating with Groq TTS: %s", str(e))
                raise

groq_voice_client = GroqVoiceClient()
