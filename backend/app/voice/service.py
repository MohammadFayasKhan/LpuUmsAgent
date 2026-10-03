"""
Voice Service Business Logic for ONEE.
"""

import logging
from typing import Dict, Any, Tuple, Optional
from .groq_voice import groq_voice_client
from .schemas import TranscriptionResponse, SynthesisRequest, VoiceHealthResponse
from ..config import settings

logger = logging.getLogger("onee.voice.service")

class VoiceService:
    def __init__(self):
        self.client = groq_voice_client

    async def transcribe(
        self,
        audio_bytes: bytes,
        filename: str = "audio.webm",
        content_type: str = "audio/webm"
    ) -> TranscriptionResponse:
        """
        Transcribes speech audio into verified text.
        """
        if not audio_bytes or len(audio_bytes) < 100:
            raise ValueError("Audio payload is empty or too short to contain speech")

        result = await self.client.transcribe(
            audio_bytes=audio_bytes,
            filename=filename,
            content_type=content_type
        )
        return TranscriptionResponse(**result)

    async def synthesize(
        self,
        request: SynthesisRequest
    ) -> Tuple[bytes, str]:
        """
        Synthesizes high-fidelity speech from text.
        """
        cleaned_text = request.text.strip()
        if not cleaned_text:
            raise ValueError("Text payload cannot be empty")

        return await self.client.synthesize(
            text=cleaned_text,
            voice=request.voice or "alloy",
            model=request.model,
            response_format=request.response_format or "mp3"
        )

    def health(self) -> VoiceHealthResponse:
        has_key = bool(settings.GROQ_VOICE_API_KEY or settings.GROQ_API_KEY)
        return VoiceHealthResponse(
            status="ok" if has_key else "degraded",
            stt_provider=f"groq-{settings.GROQ_WHISPER_MODEL}",
            tts_provider=f"groq-{settings.GROQ_TTS_MODEL}",
            has_voice_key=bool(settings.GROQ_VOICE_API_KEY)
        )

voice_service = VoiceService()
