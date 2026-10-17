"""
Groq Cloud API Service & Model Fallback Chain for ONEE.

Manages LLM completions over Groq Cloud:
- Primary model: qwen/qwen3.8-27b (high reasoning & fast token output).
- Secondary fallback: qwen/qwen3.6-27b.
- Tertiary fallback: openai/gpt-oss-120b.
- Connection resilience: Automatic model switching on transient rate limit or network errors.
"""

import asyncio
import httpx
import json
import logging
from typing import List, Dict, Any, Optional, AsyncGenerator
from ..config import settings

logger = logging.getLogger("onee.groq")

GROQ_API_URL = "https://api.groq.com/openai/v1/chat/completions"

# Production Model Fallback Chain for Core Intelligence
MODEL_CHAIN: List[Dict[str, Any]] = [
    {
        "id": "qwen/qwen3.8-27b",
        "role": "primary",
        "vision": True,
        "reasoning": True,
        "tools": True,
        "structured_output": True
    },
    {
        "id": "openai/gpt-oss-120b",
        "role": "fallback_1",
        "vision": False,
        "reasoning": True,
        "tools": True,
        "structured_output": True
    },
    {
        "id": "openai/gpt-oss-20b",
        "role": "fallback_2",
        "vision": False,
        "reasoning": True,
        "tools": True,
        "structured_output": True
    }
]

FALLBACK_HTTP_STATUSES = {429, 408, 500, 502, 503, 504}
FALLBACK_ERROR_CODES = {
    "rate_limit_exceeded",
    "tokens_per_day_exceeded",
    "tokens_per_minute_exceeded",
    "requests_per_minute_exceeded",
    "temporarily_unavailable",
    "service_unavailable",
    "timeout",
    "capacity_exceeded",
    "model_overloaded",
    "server_error"
}

def should_fallback(status_code: int, error_text: str = "") -> bool:
    """
    Determines whether an error is transient / quota-related and eligible for model fallback.
    Explicitly avoids falling back on authentication (401), authorization (403),
    malformed schema (400), or missing model (404).
    """
    if status_code in FALLBACK_HTTP_STATUSES:
        return True

    err_lower = error_text.lower()
    for code in FALLBACK_ERROR_CODES:
        if code in err_lower:
            return True

    if any(phrase in err_lower for phrase in ["rate limit", "tpd", "tokens per day", "quota exceeded", "capacity"]):
        return True

    return False


class GroqService:
    def __init__(self, api_key: Optional[str] = None):
        if api_key:
            self.api_keys = [api_key]
        else:
            # STRICT CREDENTIAL BOUNDARY: the main LLM intelligence client uses
            # GROQ_API_KEY ONLY. It must never borrow the voice credential.
            self.api_keys = settings.get_main_api_keys()
        self.api_key = self.api_keys[0] if self.api_keys else (settings.GROQ_API_KEY or "")
        self.client_label = "main-client"
        logger.info(
            "[main-client] LLM client initialized: keys=%d primary_model=%s (GROQ_API_KEY only)",
            len(self.api_keys),
            settings.GROQ_MODEL,
        )
        self.primary_model = settings.GROQ_MODEL or MODEL_CHAIN[0]["id"]
        self.model_chain = self._build_model_chain()

    def _build_model_chain(self) -> List[Dict[str, Any]]:
        # Ensure primary model configured in settings is first
        chain = []
        primary_found = False
        for m in MODEL_CHAIN:
            if m["id"] == self.primary_model:
                chain.append({**m, "role": "primary"})
                primary_found = True
            else:
                chain.append(m)
        if not primary_found:
            chain.insert(0, {
                "id": self.primary_model,
                "role": "primary",
                "vision": True,
                "reasoning": True,
                "tools": True,
                "structured_output": True
            })
        return chain

    def _sanitize_messages_for_model(self, messages: List[Dict[str, Any]], model_config: Dict[str, Any]) -> List[Dict[str, Any]]:
        """
        If a model lacks vision capability (e.g. GPT-OSS 120B), converts multimodal
        content arrays into pure text descriptions so the call succeeds without schema errors.
        """
        if model_config.get("vision", False):
            return messages

        sanitized = []
        for msg in messages:
            content = msg.get("content")
            if isinstance(content, list):
                # Filter out image_url parts and keep only text parts
                text_parts = []
                for part in content:
                    if isinstance(part, dict) and part.get("type") == "text":
                        text_parts.append(part.get("text", ""))
                    elif isinstance(part, str):
                        text_parts.append(part)
                sanitized.append({**msg, "content": " ".join(text_parts)})
            else:
                sanitized.append(msg)
        return sanitized

    async def call_chat_completion(
        self,
        messages: List[Dict[str, Any]],
        tools: Optional[List[Dict[str, Any]]] = None,
        tool_choice: str = "auto",
        temperature: float = 0.2,
        max_tokens: int = 1024
    ) -> Dict[str, Any]:
        """
        Calls Groq OpenAI-compatible Chat Completions endpoint with an automatic
        resilient model & multi-key fallback chain.
        """
        keys_to_try = list(self.api_keys) if self.api_keys else ([self.api_key] if self.api_key else [])
        if not keys_to_try:
            raise ValueError("No Groq API keys are configured on the backend.")

        # STRICT CREDENTIAL BOUNDARY diagnostic (no secret values logged):
        # proves every chat-completion attempt below runs on the MAIN client
        # with GROQ_API_KEY — never the voice credential.
        logger.info(
            "[main-client] chat completion request: model_chain=%d keys=%d client=main (GROQ_API_KEY only)",
            len(self.model_chain), len(keys_to_try)
        )

        last_error = None

        for model_config in self.model_chain:
            model_id = model_config["id"]
            is_fallback = model_config["role"] != "primary"

            # Adapt messages for model capabilities
            adapted_messages = self._sanitize_messages_for_model(messages, model_config)

            effective_max_tokens = max(max_tokens, 4096) if model_config.get("reasoning", False) else max_tokens
            payload: Dict[str, Any] = {
                "model": model_id,
                "messages": adapted_messages,
                "temperature": temperature,
                "max_tokens": effective_max_tokens
            }

            if model_config.get("reasoning", False):
                payload["reasoning_format"] = "hidden"

            if tools and model_config.get("tools", True):
                payload["tools"] = tools
                payload["tool_choice"] = tool_choice

            for k_idx, key in enumerate(keys_to_try):
                headers = {
                    "Authorization": f"Bearer {key}",
                    "Content-Type": "application/json"
                }

                try:
                    if is_fallback or k_idx > 0:
                        logger.info(f"[ONEE AI Router] Calling '{model_id}' using Key #{k_idx + 1}")

                    async with httpx.AsyncClient(timeout=30.0) as client:
                        response = await client.post(
                            GROQ_API_URL,
                            headers=headers,
                            json=payload
                        )

                        if response.status_code == 200:
                            data = response.json()
                            data["_onee_metadata"] = {
                                "model_used": model_id,
                                "fallback_used": is_fallback or k_idx > 0,
                                "model_role": model_config["role"]
                            }
                            if is_fallback or k_idx > 0:
                                logger.info(f"[ONEE AI Router] ✔ Fallback to '{model_id}' (Key #{k_idx + 1}) succeeded!")
                            return data

                        # Handle transient errors eligible for fallback
                        err_text = response.text
                        if should_fallback(response.status_code, err_text):
                            logger.warning(
                                f"[ONEE AI Router] Model '{model_id}' on Key #{k_idx + 1} unavailable (Status {response.status_code}: {err_text[:120]}...). "
                                f"Trying next key/model in fallback chain..."
                            )
                            last_error = RuntimeError(f"Model '{model_id}' key #{k_idx + 1} failed ({response.status_code}): {err_text}")
                            continue

                        # Non-fallback error (400, 401, etc.) -> fail immediately
                        logger.error(f"[ONEE AI Router] Non-recoverable API error {response.status_code} for '{model_id}': {err_text}")
                        raise RuntimeError(f"Groq API returned status {response.status_code}: {err_text}")

                except httpx.TimeoutException as te:
                    logger.warning(f"[ONEE AI Router] Timeout calling '{model_id}' with Key #{k_idx + 1}. Cascading...")
                    last_error = te
                    continue
                except Exception as e:
                    if "Groq API returned status" in str(e):
                        raise e
                    logger.warning(f"[ONEE AI Router] Unexpected error with '{model_id}' Key #{k_idx + 1}: {e}. Cascading...")
                    last_error = e
                    continue

        raise RuntimeError(f"All models and keys in ONEE fallback chain exhausted. Last error: {last_error}")

    async def stream_chat_completion(
        self,
        messages: List[Dict[str, Any]],
        temperature: float = 0.2,
        max_tokens: int = 1024
    ) -> AsyncGenerator[str, None]:
        """
        Streams delta content chunks from Groq API with automatic pre-stream
        model and key failover if rate-limited or unavailable.
        """
        keys_to_try = list(self.api_keys) if self.api_keys else ([self.api_key] if self.api_key else [])
        if not keys_to_try:
            raise ValueError("No Groq API keys are configured on the backend.")

        # STRICT CREDENTIAL BOUNDARY diagnostic (no secret values logged):
        # proves streaming requests run on the MAIN client only.
        logger.info(
            "[main-client] stream completion request: model_chain=%d keys=%d client=main (GROQ_API_KEY only)",
            len(self.model_chain), len(keys_to_try)
        )

        stream_started = False
        last_error = None

        for model_config in self.model_chain:
            if stream_started:
                break
            model_id = model_config["id"]
            is_fallback = model_config["role"] != "primary"
            adapted_messages = self._sanitize_messages_for_model(messages, model_config)

            effective_max_tokens = max(max_tokens, 4096) if model_config.get("reasoning", False) else max_tokens
            payload: Dict[str, Any] = {
                "model": model_id,
                "messages": adapted_messages,
                "temperature": temperature,
                "max_tokens": effective_max_tokens,
                "stream": True
            }

            if model_config.get("reasoning", False):
                payload["reasoning_format"] = "hidden"

            for k_idx, key in enumerate(keys_to_try):
                if stream_started:
                    break
                headers = {
                    "Authorization": f"Bearer {key}",
                    "Content-Type": "application/json"
                }

                try:
                    if is_fallback or k_idx > 0:
                        logger.info(f"[ONEE AI Stream Router] Attempting stream with '{model_id}' on Key #{k_idx + 1}")

                    async with httpx.AsyncClient(timeout=35.0) as client:
                        async with client.stream("POST", GROQ_API_URL, headers=headers, json=payload) as response:
                            if response.status_code != 200:
                                err_bytes = await response.aread()
                                err_text = err_bytes.decode("utf-8", errors="ignore")
                                if should_fallback(response.status_code, err_text):
                                    logger.warning(
                                        f"[ONEE AI Stream Router] Model '{model_id}' Key #{k_idx + 1} failed ({response.status_code}). "
                                        f"Trying next key/model..."
                                    )
                                    last_error = RuntimeError(f"Stream start failed ({response.status_code}): {err_text}")
                                    continue
                                else:
                                    raise RuntimeError(f"Groq streaming error ({response.status_code}): {err_text}")

                            # Stream successfully connected
                            stream_started = True
                            if is_fallback or k_idx > 0:
                                logger.info(f"[ONEE AI Stream Router] ✔ Streaming connected with '{model_id}' on Key #{k_idx + 1}")

                            async for line in response.aiter_lines():
                                if not line:
                                    continue
                                if line.startswith("data: "):
                                    data_str = line[6:].strip()
                                    if data_str == "[DONE]":
                                        break
                                    try:
                                        parsed = json.loads(data_str)
                                        delta = parsed["choices"][0].get("delta", {})
                                        content = delta.get("content")
                                        if content:
                                            yield content
                                    except Exception:
                                        continue
                            return

                except Exception as e:
                    if stream_started:
                        # If stream already began delivering tokens, raise so we don't interweave conflicting outputs
                        raise e
                    last_error = e
                    logger.warning(f"[ONEE AI Stream Router] Failed before stream start on '{model_id}' Key #{k_idx + 1}: {e}. Trying next...")
                    continue

        raise RuntimeError(f"All streaming models and keys in fallback chain failed. Last error: {last_error}")


groq_service = GroqService()
