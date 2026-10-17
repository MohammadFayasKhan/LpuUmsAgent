"""
Voice Service Business Logic for ONEE.
"""

import logging
from typing import Dict, Any, Tuple, Optional
from .groq_voice import groq_voice_client, transform_speech_identity
from .schemas import (
    TranscriptionResponse,
    SynthesisRequest,
    VoiceHealthResponse,
    NarrationRequest,
    NarrationResponse
)
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
        sanitized = transform_speech_identity(request.text)
        cleaned_text = sanitized.strip()
        if not cleaned_text:
            raise ValueError("Text payload cannot be empty")

        return await self.client.synthesize(
            text=cleaned_text,
            voice=request.voice or settings.GROQ_TTS_VOICE or "autumn",
            model=request.model,
            # Orpheus serves WAV; never assume MP3 for this endpoint.
            response_format=request.response_format or "wav"
        )

    async def generate_dynamic_narration(self, request: NarrationRequest) -> NarrationResponse:
        """
        Uses Groq LLM to generate a dynamic, conversational spoken phrase
        strictly grounded in the factual evidence without canned templates.
        """
        from ..services.groq_service import groq_service
        semantic_key = f"{request.phase}_{request.milestone_type}_{request.target or ''}".strip('_')

        prev_lower = [p.lower() for p in request.previous_narrations]

        system_instruction = (
            "You are ONEE, the intelligent AI academic companion for LPU students. "
            "Your job is to generate ONE short, natural, conversational spoken phrase (1 sentence, strictly under 18 words) "
            "describing the current agent milestone.\n\n"
            "STRICT RULES:\n"
            "1. Grounding: Talk ONLY about what is actually happening or discovered based on the evidence. Never invent dates, percentages, rooms, or actions.\n"
            "2. First-person voice: Speak naturally as ONEE.\n"
            "3. NO Scripted Templates: Never use canned phrases like 'I'll check your examination schedule on UMS' or 'Finding your examination section'. "
            "Tailor your wording to the student's exact query.\n"
            "4. Anti-Repetition: Do not repeat or rephrase anything already spoken in previous narrations.\n"
            "5. If no speech is needed, reply with 'SILENT'."
        )

        user_prompt = (
            f"Student Request: {request.user_request or request.current_goal}\n"
            f"Active Goal: {request.current_goal}\n"
            f"Milestone: {request.milestone_type} ({request.phase})\n"
            f"Current Action: {request.current_action or 'none'}\n"
            f"Target: {request.target or 'none'}\n"
            f"Observation: {request.browser_observation or 'none'}\n"
            f"Discovered Data: {request.discovered_data or request.verified_facts or 'none'}\n"
            f"Previous Spoken Narrations: {request.previous_narrations}\n\n"
            "Generate ONE natural spoken sentence:"
        )

        try:
            messages = [
                {"role": "system", "content": system_instruction},
                {"role": "user", "content": user_prompt}
            ]
            response = await groq_service.call_chat_completion(
                messages=messages,
                temperature=0.3,
                max_tokens=250
            )
            raw_choices = response.get("choices", [])
            content = ""
            if raw_choices and len(raw_choices) > 0:
                content = (raw_choices[0].get("message", {}).get("content") or "").strip()
            elif "content" in response:
                content = (response.get("content") or "").strip()

            content = content.strip('"').strip("'")
            logger.info(f"[VoiceService] Dynamic narration raw LLM output: {content!r}")
            if not content or content.upper() == "SILENT" or content.upper() == "NO_NARRATION":
                return NarrationResponse(
                    text=None,
                    purpose=request.milestone_type,
                    execution_id=request.execution_id,
                    priority=request.milestone_type,
                    should_speak=False,
                    semantic_key=semantic_key
                )

            if content.lower() in prev_lower:
                return NarrationResponse(
                    text=None,
                    purpose=request.milestone_type,
                    execution_id=request.execution_id,
                    priority=request.milestone_type,
                    should_speak=False,
                    semantic_key=semantic_key
                )

            return NarrationResponse(
                text=content,
                purpose=request.milestone_type,
                execution_id=request.execution_id,
                priority=request.milestone_type,
                should_speak=True,
                semantic_key=semantic_key
            )
        except Exception as e:
            logger.warning(f"[VoiceService] Dynamic narration LLM call failed: {e}")
            return NarrationResponse(
                text=None,
                purpose=request.milestone_type,
                execution_id=request.execution_id,
                priority=request.milestone_type,
                should_speak=False,
                semantic_key=semantic_key
            )

    def health(self) -> VoiceHealthResponse:
        # STRICT CREDENTIAL BOUNDARY: voice health depends ONLY on the dedicated
        # voice credentials (primary + _1 + _2). A configured main LLM key must
        # never make the voice pipeline look healthy. Diagnostic reports the key
        # COUNT only — never any secret value.
        voice_keys = settings.get_voice_api_keys()
        has_key = bool(voice_keys)
        return VoiceHealthResponse(
            status="ok" if has_key else "degraded",
            stt_provider=f"groq-{settings.GROQ_WHISPER_MODEL}",
            tts_provider=f"groq-{settings.GROQ_TTS_MODEL}",
            has_voice_key=has_key,
            voice_key_count=len(voice_keys)
        )

voice_service = VoiceService()
