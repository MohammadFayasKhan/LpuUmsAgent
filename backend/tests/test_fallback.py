import pytest
import httpx
from unittest.mock import AsyncMock, patch, MagicMock
from app.services.groq_service import GroqService, should_fallback, MODEL_CHAIN

def test_should_fallback():
    assert should_fallback(429, "Rate limit reached for model qwen/qwen3.8-27b") is True
    assert should_fallback(503, "Service unavailable") is True
    assert should_fallback(504, "Gateway timeout") is True
    assert should_fallback(200, "rate_limit_exceeded") is True
    assert should_fallback(200, "tokens per day exceeded") is True
    
    # Non-fallback errors
    assert should_fallback(400, "Invalid json schema") is False
    assert should_fallback(401, "Invalid API key") is False
    assert should_fallback(403, "Forbidden") is False
    assert should_fallback(404, "Model not found") is False

@pytest.mark.asyncio
async def test_groq_service_fallback_on_429():
    service = GroqService(api_key="gsk_test_key")

    # Mock response for primary model (429) and fallback model (200)
    mock_429 = MagicMock()
    mock_429.status_code = 429
    mock_429.text = "Rate limit reached for model qwen/qwen3.8-27b on TPD"

    mock_200 = MagicMock()
    mock_200.status_code = 200
    mock_200.json.return_value = {
        "choices": [{"message": {"content": "Hello from fallback!"}}]
    }

    fallback_model_id = MODEL_CHAIN[1]["id"]

    call_count = 0
    async def mock_post(*args, **kwargs):
        nonlocal call_count
        call_count += 1
        payload = kwargs.get("json", {})
        model = payload.get("model")
        if model == "qwen/qwen3.8-27b":
            return mock_429
        elif model == fallback_model_id:
            return mock_200
        return mock_429

    with patch("httpx.AsyncClient.post", side_effect=mock_post):
        result = await service.call_chat_completion(
            messages=[{"role": "user", "content": "Test prompt"}]
        )
        
        assert result["choices"][0]["message"]["content"] == "Hello from fallback!"
        assert result["_onee_metadata"]["model_used"] == fallback_model_id
        assert result["_onee_metadata"]["fallback_used"] is True
        assert call_count == 2

def test_generate_fallback_numeric_followup():
    from app.agent.agent import onee_agent
    from app.schemas.attendance import AttendanceSummary, AttendanceRecord
    from app.schemas.chat import ChatMessage

    summary = AttendanceSummary(
        studentName="Fayas",
        registrationNumber="12104928",
        totalCourses=2,
        totalClasses=50,
        totalAttended=48,
        totalAbsent=2,
        overallPercentage=96.0,
        courses=[
            AttendanceRecord(code="CSE329", name="PRELUDE TO COMPETITIVE CODING", attended=24, total=24, absent=0, percentage=100.0),
            AttendanceRecord(code="CSE408", name="DESIGN AND ANALYSIS OF ALGORITHMS", attended=24, total=26, absent=2, percentage=92.31)
        ],
        fetchedAt="2026-09-01T12:00:00Z"
    )

    history = [
        ChatMessage(sender="user", text="what if i skip 4 classes in cse329?"),
        ChatMessage(sender="assistant", text="Here is your skip impact analysis for CSE329.")
    ]

    resp = onee_agent._generate_fallback("what about 5", activities=[], attendance=summary, history=history)
    assert resp.message is not None
    assert "CSE329" in resp.message
    assert "What If I Skip 5 Classes?" in resp.message
    assert "| **Current** | `24 / 24` | **100%** | 🟢 Safe |" in resp.message
    assert "| **Skip 5 Classes** | `24 / 29` | **83%** | 🟢 Safe |" in resp.message
    assert len(resp.suggestions) > 0
    assert any("CSE329" in s for s in resp.suggestions)

