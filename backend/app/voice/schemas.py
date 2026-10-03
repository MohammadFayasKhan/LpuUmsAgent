"""
Pydantic Schemas for ONEE Voice Service.
"""

from typing import Optional, List, Dict, Any
from pydantic import BaseModel, Field

class TranscriptionJsonRequest(BaseModel):
    audio_base64: str = Field(..., description="Base64 encoded audio data")
    content_type: Optional[str] = Field(default="audio/webm", description="MIME type of the audio")
    filename: Optional[str] = Field(default="audio.webm", description="Audio filename")

class TranscriptionResponse(BaseModel):
    text: str = Field(..., description="Transcribed text from audio stream")
    language: Optional[str] = Field(default="en", description="Detected language code")
    duration: Optional[float] = Field(default=None, description="Audio duration in seconds if known")
    model: str = Field(default="whisper-large-v3-turbo", description="Model used for transcription")

class SynthesisRequest(BaseModel):
    text: str = Field(..., max_length=1000, description="Text to synthesize into speech")
    voice: Optional[str] = Field(default="alloy", description="Voice identifier")
    model: Optional[str] = Field(default=None, description="TTS model override")
    response_format: Optional[str] = Field(default="mp3", description="Desired audio format: mp3, wav, opus")

class VoiceHealthResponse(BaseModel):
    status: str = Field(..., description="Service health: ok, degraded, unavailable")
    stt_provider: str = Field(default="groq-whisper-large-v3-turbo")
    tts_provider: str = Field(default="groq-orpheus-v1-english")
    has_voice_key: bool = Field(..., description="Whether a dedicated GROQ_VOICE_API_KEY is configured")
