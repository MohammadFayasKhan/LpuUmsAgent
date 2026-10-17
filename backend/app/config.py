"""
Configuration & Environment Settings for ONEE Backend.

Loads environment variables from .env file:
- GROQ_API_KEY: Authentication token for Groq Cloud LLM inference.
- GROQ_MODEL: Primary model identifier (defaults to qwen/qwen3.8-27b).
- HOST & PORT: Server listening parameters (defaults to 0.0.0.0:8000).
"""

import os
from pydantic_settings import BaseSettings, SettingsConfigDict
from typing import Optional

class Settings(BaseSettings):
    # ONEE CORE INTELLIGENCE (Uses GROQ_API_KEY)
    GROQ_API_KEY: str = ""
    GROQ_PRIMARY_MODEL: str = "qwen/qwen3.8-27b"
    GROQ_MODEL: str = "qwen/qwen3.8-27b"
    GROQ_FALLBACK_MODEL: str = "openai/gpt-oss-120b"

    # ONEE VOICE PIPELINE (Uses GROQ_VOICE_API_KEY exclusively)
    # Accuracy-first STT: whisper-large-v3 is the production default. The fast
    # whisper-large-v3-turbo must only be selected via explicit .env override.
    # Three dedicated VOICE credentials (same voice-only boundary) are round-robined
    # across requests so concurrent STT/TTS tasks spread across accounts for speed,
    # with automatic failover between them. NONE of these may ever be used by the
    # main LLM, and the main key may never be used for voice.
    GROQ_VOICE_API_KEY: str = ""
    GROQ_VOICE_API_1: str = ""
    GROQ_VOICE_API_2: str = ""
    GROQ_STT_MODEL: str = "whisper-large-v3"
    GROQ_WHISPER_MODEL: str = "whisper-large-v3"
    GROQ_TTS_MODEL: str = "canopylabs/orpheus-v1-english"
    GROQ_TTS_VOICE: str = "autumn"

    HOST: str = "0.0.0.0"
    PORT: int = 8000

    @staticmethod
    def _split_keys(candidate: str) -> list[str]:
        keys: list[str] = []
        if candidate and candidate.strip():
            for k in candidate.split(","):
                k = k.strip()
                if k and k not in keys:
                    keys.append(k)
        return keys

    def get_main_api_keys(self) -> list[str]:
        """Strict credential boundary: MAIN LLM intelligence uses GROQ_API_KEY ONLY."""
        return self._split_keys(self.GROQ_API_KEY)

    def get_voice_api_keys(self) -> list[str]:
        """Strict credential boundary: voice STT/TTS uses ONLY the dedicated voice
        credentials (GROQ_VOICE_API_KEY + GROQ_VOICE_API_1 + GROQ_VOICE_API_2),
        deduplicated. The main GROQ_API_KEY must never appear here."""
        keys: list[str] = []
        for raw in (self.GROQ_VOICE_API_KEY, self.GROQ_VOICE_API_1, self.GROQ_VOICE_API_2):
            for k in self._split_keys(raw):
                if k not in keys:
                    keys.append(k)
        return keys

    def get_groq_api_keys(self) -> list[str]:
        """Deprecated combined accessor. Kept only for backwards compatibility and
        now equivalent to the main intelligence keys so neither client can silently
        borrow the other credential."""
        return self.get_main_api_keys()

    model_config = SettingsConfigDict(
        env_file=os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), ".env"),
        env_file_encoding="utf-8",
        extra="ignore"
    )

settings = Settings()
