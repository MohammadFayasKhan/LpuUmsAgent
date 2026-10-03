"""
FastAPI Router for ONEE Voice Endpoints.
"""

import logging
import base64
from fastapi import APIRouter, UploadFile, File, HTTPException, status, Response
from .schemas import (
    TranscriptionResponse,
    TranscriptionJsonRequest,
    SynthesisRequest,
    VoiceHealthResponse
)
from .service import voice_service

logger = logging.getLogger("onee.voice.router")

router = APIRouter(prefix="/api/voice", tags=["Voice"])

@router.get("/health", response_model=VoiceHealthResponse, status_code=status.HTTP_200_OK)
async def voice_health():
    """
    Returns health status of the voice subsystem.
    """
    return voice_service.health()

@router.post("/transcribe", response_model=TranscriptionResponse, status_code=status.HTTP_200_OK)
async def transcribe_audio_endpoint(file: UploadFile = File(...)):
    """
    Transcribes student speech audio (e.g. webm/wav) into text using Groq Whisper.
    """
    try:
        audio_bytes = await file.read()
        content_type = file.content_type or "audio/webm"
        filename = file.filename or "speech.webm"

        result = await voice_service.transcribe(
            audio_bytes=audio_bytes,
            filename=filename,
            content_type=content_type
        )
        return result
    except ValueError as ve:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(ve)
        )
    except Exception as e:
        logger.exception("Voice transcription failed")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Speech transcription failed: {str(e)}"
        )

@router.post("/transcribe-json", response_model=TranscriptionResponse, status_code=status.HTTP_200_OK)
async def transcribe_json_endpoint(request: TranscriptionJsonRequest):
    """
    Transcribes base64-encoded student speech audio into text using Groq Whisper.
    """
    try:
        raw_b64 = request.audio_base64
        if "," in raw_b64:
            raw_b64 = raw_b64.split(",", 1)[1]
        audio_bytes = base64.b64decode(raw_b64)
        result = await voice_service.transcribe(
            audio_bytes=audio_bytes,
            filename=request.filename or "speech.webm",
            content_type=request.content_type or "audio/webm"
        )
        return result
    except ValueError as ve:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(ve)
        )
    except Exception as e:
        logger.exception("Voice base64 transcription failed")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Speech transcription failed: {str(e)}"
        )

@router.post("/speak", status_code=status.HTTP_200_OK)
async def speak_text_endpoint(request: SynthesisRequest):
    """
    Synthesizes expressive spoken audio from text using Groq Orpheus/TTS.
    """
    try:
        audio_bytes, media_type = await voice_service.synthesize(request)
        return Response(
            content=audio_bytes,
            media_type=media_type,
            headers={
                "Cache-Control": "no-cache",
                "Content-Disposition": "inline; filename=speech.mp3"
            }
        )
    except ValueError as ve:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(ve)
        )
    except Exception as e:
        logger.exception("Voice synthesis failed")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Speech synthesis failed: {str(e)}"
        )
