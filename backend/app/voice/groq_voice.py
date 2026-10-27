"""
Dedicated Groq Cloud Voice Client for ONEE.

Maintains strict account and credential isolation from the main agent LLM pipeline.

FINAL SPEC — STRICT Groq-only voice, no local fallback of any kind:
  STT: Groq Whisper (whisper-large-v3, accuracy-first) via GROQ_VOICE_API_KEY
       endpoint https://api.groq.com/openai/v1/audio/transcriptions
  TTS: Groq Orpheus (canopylabs/orpheus-v1-english, WAV) via GROQ_VOICE_API_KEY
       endpoint https://api.groq.com/openai/v1/audio/speech
  LLM: main intelligence uses GROQ_API_KEY through a SEPARATE client.

There is NO browser SpeechSynthesis, NO browser SpeechRecognition, and NO local
TTS/STT anywhere in the production path. If Groq voice fails, the backend returns
an explicit provider error and the extension shows an honest voice error while
keeping text chat available.
"""

import asyncio
import httpx
import itertools
import logging
import re
import struct
from typing import Optional, Dict, Any, Tuple, List
from ..config import settings

logger = logging.getLogger("onee.voice.groq")

GROQ_AUDIO_TRANSCRIPTIONS_URL = "https://api.groq.com/openai/v1/audio/transcriptions"
GROQ_AUDIO_SPEECH_URL = "https://api.groq.com/openai/v1/audio/speech"

# Domain vocabulary prompt for Whisper — WORDS ONLY, deliberately WITHOUT any
# course codes. Listing codes (PEAS01, CSE330, ...) here made Whisper hallucinate
# by repeating prompt tokens over noise/silence ("PEAS01 PEAS02 PEAS032 ...").
STT_PROMPT = (
    "LPU UMS attendance examination timetable date sheet seating plan "
    "sample paper duty leave class schedule bunk skip percentage semester "
    "subject semester result repository"
)

# Round-robin rotation across the dedicated VOICE credentials
# (GROQ_VOICE_API_KEY, GROQ_VOICE_API_1, GROQ_VOICE_API_2): consecutive voice
# tasks are dispatched to DIFFERENT Groq voice accounts so concurrent STT/TTS
# requests never queue behind each other on one rate limit, while every task
# still fails over through the remaining voice keys on error.
_ROTATION_COUNTER = itertools.count()


def next_key_rotation(total: int) -> int:
    """Next round-robin start slot across the voice credential pool (0-based)."""
    if total <= 1:
        return 0
    return next(_ROTATION_COUNTER) % total


def transform_speech_identity(text: str) -> str:
    """
    Prepares canonical text for clean, natural speech synthesis by removing
    markdown formatting, raw tables, code blocks, emojis, and symbols.
    Preserves the student's canonical response and ONEE identity.
    """
    if not text:
        return text
    out = text
    # Clean code blocks and inline code
    out = re.sub(r"```[\s\S]*?```", "", out)
    out = re.sub(r"`([^`]+)`", r"\1", out)
    # Clean markdown links [text](url) -> text
    out = re.sub(r"\[([^\]]+)\]\([^\)]+\)", r"\1", out)
    # Strip markdown table divider rows (e.g. | :--- | :--- |)
    out = re.sub(r"^\s*\|?[\s:-]+\|.*$\n?", "", out, flags=re.MULTILINE)
    # Drop ENTIRE markdown table rows: tables are visual layout for chat, never
    # speech. Column headers and raw cell values ("5/10", room codes) must not be
    # read aloud — the prose of the canonical response already carries the answer.
    out = re.sub(r"^\s*\|.*\n?", "", out, flags=re.MULTILINE)
    # Clean blockquote markers
    out = re.sub(r"^\s*>\s*", "", out, flags=re.MULTILINE)
    # Clean bullet points
    out = re.sub(r"^\s*[-*•]\s+", "", out, flags=re.MULTILINE)
    # Clean formatting symbols
    out = re.sub(r"[*~]+", "", out)
    # Underscores become spaces (word separators in filenames/keys), never glue:
    # "CSE408_Sample_Paper.pdf" must read as words, not "CSE408SamplePaper".
    out = re.sub(r"_+", " ", out)
    # Drop ENTIRE markdown heading lines: headings are visual scaffolding for
    # chat ("Attendance Summary", "Schedule Note") — the prose that follows
    # already carries the spoken answer, so reading the heading is noise.
    out = re.sub(r"^#+\s+.*$", "", out, flags=re.MULTILINE)
    out = re.sub(r"\|", ", ", out)
    out = re.sub(r",\s*,+", ", ", out)
    out = re.sub(r"\s+", " ", out).strip()
    # Time ranges spoken with "to": "10:20-11:10" / "09:30 AM - 10:00 AM"
    # (the optional AM/PM group carries its own leading space so the replacement
    # never produces a double space).
    out = re.sub(
        r"(\d{1,2}:\d{2})((?:\s+(?:A\.?M\.?|P\.?M\.?))?)\s*[-–—]\s*(\d{1,2}:\d{2})",
        r"\1\2 to \3",
        out,
    )
    # Natural clock speech: "09:30" -> "9:30"
    out = re.sub(r"(?<!\d)0(\d:\d{2})", r"\1", out)
    # Classroom codes spoken as block + room: "in Room 34-201" -> "in Block 34,
    # Room 201" (consume the leading "Room" word so it cannot duplicate), then
    # bare "33-307" / "R-38-917" forms. Guards keep dates/times untouched.
    out = re.sub(r"(?i)\broom\s+(?:r[:\-]\s*)?(\d{2})-(\d{3})(?!\d)", r"Block \1, Room \2", out)
    out = re.sub(r"(?<![\d:])(?:R[:\-]\s*)?(\d{2})-(\d{3})(?!\d)", r"Block \1, Room \2", out)
    # UMS is three letters, never the word "ums": spell it out for speech.
    out = re.sub(r"\bUMS\b", "U M S", out)
    # Fractions for natural speech: "5/10" -> "5 out of 10". Never touch date
    # forms like 10/8/2026 (lookbehind/lookahead guard) or "711 / S" patterns.
    out = re.sub(r"(?<![\d/])(\d{1,3})\s*/\s*(\d{1,3})(?![\d/])", r"\1 out of \2", out)

    # Spoken date expansion: expand month abbreviations (e.g. "05-Dec-2026" -> "5 December 2026",
    # "Dec" -> "December") so Groq Orpheus speaks natural month names instead of "D ec".
    month_names = {
        "jan": "January",
        "feb": "February",
        "mar": "March",
        "apr": "April",
        "may": "May",
        "jun": "June",
        "jul": "July",
        "aug": "August",
        "sep": "September",
        "sept": "September",
        "oct": "October",
        "nov": "November",
        "dec": "December",
    }

    def _expand_full_date(m: re.Match) -> str:
        day = str(int(m.group(1)))
        m_name = month_names.get(m.group(2).lower(), m.group(2))
        year = m.group(3)
        if len(year) == 2:
            year = f"20{year}"
        return f"{day} {m_name} {year}"

    out = re.sub(
        r"(?i)(?<!\w)0?(\d{1,2})[-/](Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)[a-z]*[-/](\d{2,4})(?!\w)",
        _expand_full_date,
        out,
    )

    def _expand_day_month(m: re.Match) -> str:
        day = str(int(m.group(1)))
        m_name = month_names.get(m.group(2).lower(), m.group(2))
        return f"{day} {m_name}"

    out = re.sub(
        r"(?i)(?<!\w)0?(\d{1,2})[-/](Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)[a-z]*(?!\w)",
        _expand_day_month,
        out,
    )

    def _expand_month_day(m: re.Match) -> str:
        m_name = month_names.get(m.group(1).lower(), m.group(1))
        day = str(int(m.group(2)))
        return f"{m_name} {day}"

    out = re.sub(
        r"(?i)(?<!\w)(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)[a-z]*[-/]0?(\d{1,2})(?!\w)",
        _expand_month_day,
        out,
    )

    def _expand_standalone_month(m: re.Match) -> str:
        raw = m.group(1)
        dot = m.group(2) or ""
        low = raw.lower()
        if low == "mar" and raw == "mar":
            return f"{raw}{dot}"
        expanded = month_names.get(low, raw)
        return f"{expanded}{dot}"

    out = re.sub(
        r"(?i)\b(Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)\b(\.?)",
        _expand_standalone_month,
        out,
    )

    # Transform AI assistant name to Sofia ONLY for voice delivery
    out = re.sub(r"\bI am ONEE\b", "I am Sofia", out, flags=re.IGNORECASE)
    out = re.sub(r"\bI'm ONEE\b", "I'm Sofia", out, flags=re.IGNORECASE)
    out = re.sub(r"\bIm ONEE\b", "I'm Sofia", out, flags=re.IGNORECASE)
    out = re.sub(r"\bmy name is ONEE\b", "my name is Sofia", out, flags=re.IGNORECASE)
    out = re.sub(r"\bThis is ONEE\b", "This is Sofia", out, flags=re.IGNORECASE)
    out = re.sub(r"\bONEE here\b", "Sofia here", out, flags=re.IGNORECASE)
    out = re.sub(r"\bONEE\b", "Sofia", out)
    return out


def _split_into_orpheus_segments(text: str, max_chars: int = 195) -> List[str]:
    """
    Splits text into cohesive sentences or clauses that each fit within Orpheus's character limit.
    Preserves colons in time strings like 09:00 - 10:00.
    """
    cleaned = re.sub(r'\s+', ' ', text.strip())
    if not cleaned:
        return []
    if len(cleaned) <= max_chars:
        return [cleaned]

    # Split by true sentence-ending punctuation (.!?) followed by space
    raw_parts = [p.strip() for p in re.split(r'(?<=[.!?])\s+', cleaned) if p.strip()]
    if not raw_parts:
        raw_parts = [cleaned]

    segments: List[str] = []
    current_segment = ""

    for s in raw_parts:
        part = s.strip()
        if not part:
            continue
        if len(part) <= max_chars:
            if current_segment and len(current_segment) + len(part) + 1 <= max_chars:
                current_segment = f"{current_segment} {part}"
            else:
                if current_segment:
                    segments.append(current_segment)
                current_segment = part
        else:
            # Sentence itself is longer than max_chars: split on clauses (, or ;)
            clause_parts = re.split(r'(?<=[,;])\s+', part)
            for cp in clause_parts:
                cp_trimmed = cp.strip()
                if not cp_trimmed:
                    continue
                if current_segment and len(current_segment) + len(cp_trimmed) + 1 <= max_chars:
                    current_segment = f"{current_segment} {cp_trimmed}"
                else:
                    if current_segment:
                        segments.append(current_segment)
                    current_segment = cp_trimmed[:max_chars]

    if current_segment:
        segments.append(current_segment)

    return segments if segments else [cleaned[:max_chars]]


def _parse_wav_pcm(segment: bytes) -> Tuple[bytes, bytes]:
    """
    Parses a WAV byte payload into (fmt_chunk_bytes, raw_pcm_bytes).

    Deliberately does NOT trust the header's declared frame/data sizes: real
    Orpheus segments can carry streaming-style sizes that break wave.setparams,
    which used to truncate multi-sentence replies to the first chunk. Only the
    actual bytes present in the payload are used.
    Raises ValueError when the payload is not a parseable WAV.
    """
    if not segment or len(segment) < 12 or segment[0:4] != b'RIFF' or segment[8:12] != b'WAVE':
        raise ValueError('segment is not a RIFF/WAVE payload')

    pos = 12
    fmt: Optional[bytes] = None
    while pos + 8 <= len(segment):
        chunk_id = segment[pos:pos + 4]
        declared = int.from_bytes(segment[pos + 4:pos + 8], 'little')
        body_start = pos + 8
        if chunk_id == b'fmt ':
            end = min(body_start + declared, len(segment))
            fmt = segment[body_start:end]
            pos = end + (declared & 1)
        elif chunk_id == b'data':
            if fmt is None:
                raise ValueError('data chunk before fmt chunk')
            # Ignore bogus declared sizes; take the bytes actually present,
            # stopping before any trailing chunks (e.g. LIST/id3).
            declared_end = body_start + declared
            if declared == 0 or declared_end > len(segment):
                pcm = segment[body_start:]
            else:
                pcm = segment[body_start:declared_end]
            return fmt, pcm
        else:
            if declared <= 0:
                raise ValueError('malformed WAV chunk size')
            pos = body_start + declared + (declared & 1)
    raise ValueError('no data chunk found in WAV payload')


def _combine_wav_segments(wav_list: List[bytes]) -> bytes:
    """
    Combines multiple WAV audio payloads into a single seamless WAV file by
    concatenating raw PCM and re-deriving the header from the real byte counts.

    Failure raises: silently returning only the first segment would truncate
    the canonical response, and an honest TTS failure must be reported instead.
    """
    if not wav_list:
        return b""
    if len(wav_list) == 1:
        return wav_list[0]

    parsed = [_parse_wav_pcm(seg) for seg in wav_list]
    fmt = parsed[0][0]
    if any(f != fmt for f, _ in parsed):
        raise ValueError('WAV segments have mismatched fmt chunks; refusing to splice')

    pcm = b''.join(p for _, p in parsed)
    # 32-bit RIFF sizes: guard against absurd payloads before packing.
    if len(pcm) >= 0xFFFFFFFF - 36:
        raise ValueError('combined PCM payload exceeds RIFF size limits')
    if len(pcm) % 2:
        pcm += b'\x00'

    header = (
        b'RIFF'
        + struct.pack('<L', 36 + len(pcm))
        + b'WAVE'
        + b'fmt '
        + struct.pack('<L', len(fmt))
        + fmt
        + b'data'
        + struct.pack('<L', len(pcm))
    )
    return header + pcm


class GroqVoiceClient:
    def __init__(self):
        # Dedicated Voice API Key with fallback to core intelligence keys
        self.whisper_model = settings.GROQ_WHISPER_MODEL
        self.tts_model = settings.GROQ_TTS_MODEL

        if not self.whisper_model:
            raise ValueError("GROQ_WHISPER_MODEL is not configured. The intended primary STT path is Groq Whisper.")
        if not self.tts_model:
            raise ValueError("GROQ_TTS_MODEL is not configured. The intended primary TTS path is Groq Orpheus.")

    def get_candidate_keys(self) -> List[str]:
        """STRICT CREDENTIAL BOUNDARY: voice STT/TTS uses GROQ_VOICE_API_KEY ONLY.
        It must never borrow the main LLM credential."""
        return settings.get_voice_api_keys()

    async def transcribe(
        self,
        audio_bytes: bytes,
        filename: str = "audio.webm",
        content_type: str = "audio/webm",
        language: str = "en"
    ) -> Dict[str, Any]:
        """
        Transcribes speech audio into text using Groq Whisper with automatic key fallback.
        Returns dict with keys: text, language, duration, model.
        """
        keys = self.get_candidate_keys()
        if not keys:
            raise ValueError(
                "GROQ_VOICE_API_KEY is not configured on backend for voice transcription. "
                "voice-client has no credential; refusing to borrow the main LLM key."
            )
        rotation = next_key_rotation(len(keys))
        ordered_slots = [(rotation + i) % len(keys) for i in range(len(keys))]
        logger.info(
            "[voice-client] STT request: model=%s bytes=%d key_count=%d rotation_start=%d "
            "(voice credentials only)",
            self.whisper_model, len(audio_bytes), len(keys), rotation
        )

        files = {
            "file": (filename, audio_bytes, content_type)
        }
        data = {
            "model": self.whisper_model,
            "response_format": "json",
            # Deterministic transcription: no sampling variance in transcripts.
            "temperature": "0",
            # Domain vocabulary prompt: helps Whisper correctly transcribe
            # UMS-specific terms. Static vocabulary ONLY — never course codes
            # (they primed token-repetition hallucinations over noise), never a
            # fake answer or invented course.
            "prompt": STT_PROMPT
        }
        if language:
            data["language"] = language

        last_error = None
        async with httpx.AsyncClient(timeout=30.0) as client:
            for attempt, slot in enumerate(ordered_slots):
                key = keys[slot]
                headers = {
                    "Authorization": f"Bearer {key}"
                }
                try:
                    response = await client.post(
                        GROQ_AUDIO_TRANSCRIPTIONS_URL,
                        headers=headers,
                        data=data,
                        files=files
                    )
                    if response.status_code == 200:
                        res_json = response.json()
                        logger.info(
                            "[voice-client] STT ok: key_index=%d attempt=%d (voice credentials only)",
                            slot, attempt + 1
                        )
                        return {
                            "text": res_json.get("text", "").strip(),
                            "language": res_json.get("language", language),
                            "duration": res_json.get("duration"),
                            "model": self.whisper_model
                        }

                    err_text = response.text
                    logger.warning(
                        "[Groq Whisper] key_index=%d failed (HTTP %s - %s). Trying next voice key...",
                        slot, response.status_code, err_text[:200]
                    )
                    last_error = f"HTTP {response.status_code}: {err_text[:200]}"
                    if response.status_code in {429, 401, 403, 500, 502, 503, 504}:
                        continue
                    response.raise_for_status()
                except httpx.HTTPError as e:
                    logger.warning("[Groq Whisper] key_index=%d HTTP error: %s", slot, str(e))
                    last_error = str(e)
                    continue

        raise RuntimeError(f"All Groq Whisper voice keys exhausted. Last error: {last_error}")

    async def synthesize(
        self,
        text: str,
        voice: Optional[str] = None,
        model: Optional[str] = None,
        response_format: str = "wav"
    ) -> Tuple[bytes, str]:
        """
        Synthesizes text into audio bytes using Groq Orpheus with automatic key fallback.
        If text exceeds 195 characters, segments are synthesized and seamlessly combined
        into a single complete WAV file to prevent truncation.
        Returns (audio_bytes, content_type).
        """
        keys = self.get_candidate_keys()
        if not keys:
            raise ValueError(
                "GROQ_VOICE_API_KEY is not configured on backend for voice synthesis. "
                "voice-client has no credential; refusing to borrow the main LLM key."
            )
        logger.info(
            "[voice-client] TTS request prepared: model=%s chars=%d (GROQ_VOICE_API_KEY only)",
            model or self.tts_model, len(text)
        )

        raw_voice = (voice or settings.GROQ_TTS_VOICE or "autumn").strip().lower()
        valid_voices = {"autumn", "diana", "hannah", "austin", "daniel", "troy"}
        chosen_voice = raw_voice if raw_voice in valid_voices else "autumn"
        chosen_model = model or self.tts_model
        spoken_text = transform_speech_identity(text)
        trimmed_text = spoken_text.strip()

        segments = _split_into_orpheus_segments(trimmed_text, max_chars=195)
        if not segments:
            segments = [trimmed_text[:195]]

        effective_format = "wav" if "orpheus" in chosen_model.lower() else response_format
        rotation = next_key_rotation(len(keys))
        logger.info(
            "[voice-client] TTS synthesis: segments=%d key_count=%d rotation_start=%d "
            "(voice credentials only)",
            len(segments), len(keys), rotation
        )

        async def synth_segment(client: httpx.AsyncClient, segment: str, seg_idx: int) -> bytes:
            """Synthesize ONE text segment: starts on its round-robin voice key so
            parallel segments spread across accounts, then fails over through the
            remaining voice keys. Raises if EVERY voice key fails — partial audio
            is never returned (no truncation)."""
            primary = (rotation + seg_idx) % len(keys)
            order = [(primary + k) % len(keys) for k in range(len(keys))]
            seg_last_error: Optional[str] = None
            for attempt, slot in enumerate(order):
                payload = {
                    "model": chosen_model,
                    "input": segment,
                    "voice": chosen_voice,
                    "response_format": effective_format
                }
                headers = {
                    "Authorization": f"Bearer {keys[slot]}",
                    "Content-Type": "application/json"
                }
                try:
                    response = await client.post(
                        GROQ_AUDIO_SPEECH_URL,
                        headers=headers,
                        json=payload
                    )
                    if response.status_code == 200:
                        logger.info(
                            "[voice-client] TTS segment %d/%d ok: key_index=%d attempt=%d chars=%d",
                            seg_idx + 1, len(segments), slot, attempt + 1, len(segment)
                        )
                        return response.content

                    err_text = response.text
                    if "model_terms_required" in err_text or "requires terms acceptance" in err_text:
                        logger.error(
                            "[ONEE Voice] Terms acceptance required for model '%s' on key_index=%d. "
                            "Please accept terms in Groq console.",
                            chosen_model, slot
                        )
                    logger.warning(
                        "[Groq TTS] Segment %d/%d failed on key_index=%d (HTTP %s - %s). Trying next voice key...",
                        seg_idx + 1, len(segments), slot, response.status_code, err_text[:200]
                    )
                    seg_last_error = f"HTTP {response.status_code}: {err_text[:200]}"
                except httpx.HTTPError as e:
                    logger.warning(
                        "[Groq TTS] Segment %d/%d HTTP error on key_index=%d: %s",
                        seg_idx + 1, len(segments), slot, str(e)
                    )
                    seg_last_error = str(e)
            raise RuntimeError(
                f"All voice keys exhausted for segment {seg_idx + 1}: {seg_last_error}"
            )

        # Parallel synthesis across segments and voice keys. asyncio.gather
        # preserves INPUT ORDER, so the combined audio can never be reordered,
        # truncated, or skipped. One failed segment fails the request honestly
        # (the client shows a voice error) instead of returning partial speech.
        async with httpx.AsyncClient(timeout=35.0) as client:
            audio_segments: List[bytes] = list(
                await asyncio.gather(
                    *(synth_segment(client, seg, i) for i, seg in enumerate(segments))
                )
            )

        content_type = "audio/wav" if effective_format == "wav" else f"audio/{effective_format}"
        if len(audio_segments) == 1:
            return audio_segments[0], content_type
        if effective_format != "wav":
            # Multi-segment splicing is only defined for WAV payloads; returning
            # the first segment alone would silently truncate the response.
            raise RuntimeError(
                f"Multi-segment {effective_format} synthesis is not supported; refusing to truncate."
            )
        combined_audio = _combine_wav_segments(audio_segments)
        return combined_audio, content_type


groq_voice_client = GroqVoiceClient()
