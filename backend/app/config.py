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
    GROQ_API_KEY: str = ""
    GROQ_VOICE_API_KEY: str = ""
    GROQ_MODEL: str = "qwen/qwen3.8-27b"
    GROQ_WHISPER_MODEL: str = "whisper-large-v3-turbo"
    GROQ_TTS_MODEL: str = "canopylabs/orpheus-v1-english"
    HOST: str = "0.0.0.0"
    PORT: int = 8000

    model_config = SettingsConfigDict(
        env_file=os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), ".env"),
        env_file_encoding="utf-8",
        extra="ignore"
    )

settings = Settings()
