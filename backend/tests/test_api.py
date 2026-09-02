import pytest
from httpx import AsyncClient, ASGITransport
from app.main import app

@pytest.mark.asyncio
async def test_health_endpoint():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.get("/health")
        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "ok"
        assert data["service"] == "onee-agent-backend"

@pytest.mark.asyncio
async def test_chat_endpoint_structure():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        payload = {
            "message": "What is my attendance?",
            "attendance": {
                "studentName": "Test Student",
                "registrationNumber": "12345678",
                "totalCourses": 2,
                "totalClasses": 14,
                "totalAttended": 13,
                "totalAbsent": 1,
                "overallPercentage": 92.86,
                "courses": [
                    {"code": "CSE329", "name": "Coding", "attended": 7, "total": 7, "absent": 0, "percentage": 100.0},
                    {"code": "CSE330", "name": "Approaches", "attended": 6, "total": 7, "absent": 1, "percentage": 85.71}
                ],
                "fetchedAt": "2026-09-01T12:00:00Z"
            }
        }
        response = await client.post("/api/chat", json=payload)
        assert response.status_code == 200
        data = response.json()
        assert "message" in data
        assert len(data["message"]) > 0
        assert "activities" in data
        assert isinstance(data["activities"], list)
