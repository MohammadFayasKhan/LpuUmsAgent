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
    model: str = Field(default="whisper-large-v3", description="Model used for transcription (accuracy-first production default; turbo only via explicit env override)")

class SynthesisRequest(BaseModel):
    text: str = Field(..., max_length=8000, description="Text to synthesize into speech (Orpheus chunks internally at the provider limit)")
    voice: Optional[str] = Field(default="autumn", description="Voice identifier")
    model: Optional[str] = Field(default=None, description="TTS model override")
    response_format: Optional[str] = Field(default="wav", description="Desired audio format: wav (Orpheus default), mp3, opus")

class VoiceHealthResponse(BaseModel):
    status: str = Field(..., description="Service health: ok, degraded, unavailable")
    stt_provider: str = Field(default="groq-whisper-large-v3")
    tts_provider: str = Field(default="groq-orpheus-v1-english")
    has_voice_key: bool = Field(..., description="Whether at least one dedicated voice credential is configured")
    voice_key_count: int = Field(default=1, description="Number of round-robin voice credentials configured (diagnostic, no secret values)")

class NarrationRequest(BaseModel):
    execution_id: str = Field(..., description="Unique execution token")
    user_request: Optional[str] = Field(default="", description="The student's original query")
    current_goal: Optional[str] = Field(default="", description="The active goal")
    intent: Optional[str] = Field(default=None, description="Routed intent capability")
    phase: Optional[str] = Field(default="PROGRESS", description="Current execution phase")
    milestone_type: str = Field(default="MEANINGFUL_PROGRESS", description="Semantic milestone level")
    current_action: Optional[str] = Field(default=None, description="Action description")
    browser_observation: Optional[str] = Field(default=None, description="DOM observation")
    target: Optional[str] = Field(default=None, description="Target element / action")
    discovered_data: Optional[Dict[str, Any]] = Field(default=None, description="Discovered facts")
    verified_facts: Optional[Dict[str, Any]] = Field(default=None, description="Verified facts")
    previous_narrations: List[str] = Field(default_factory=list, description="Already spoken phrases")

class NarrationResponse(BaseModel):
    text: Optional[str] = Field(default=None, description="Generated natural spoken phrase")
    purpose: str = Field(default="MEANINGFUL_PROGRESS", description="Milestone category")
    execution_id: str = Field(..., description="Execution token")
    priority: str = Field(default="MEANINGFUL_PROGRESS", description="VoiceQueue priority")
    should_speak: bool = Field(default=True, description="Whether to speak")
    semantic_key: str = Field(default="", description="Semantic deduplication token")

