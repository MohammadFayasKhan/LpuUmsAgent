"""
Stateless FastAPI Backend for ONEE.

We keep this backend completely stateless to protect student privacy:
1. No Database on Server: All student chat history, execution traces, and attendance
   data stay in the extension's local IndexedDB. The backend stores zero user data.
2. Per-Request Inference: Endpoints (/api/chat, /api/agent/plan) receive only the
   minimum grounded context needed to generate the immediate response.
3. Streaming SSE: Responses stream back to the Chrome side panel incrementally
   so students see answers appear with zero perceptible delay.
"""

import json
import logging
from fastapi import FastAPI, HTTPException, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from .config import settings
from .schemas.chat import ChatRequest, ChatResponse
from .schemas.planner import PlanActionRequest, PlanActionResponse
from .agent.agent import onee_agent
from .agent.planner import plan_next_action
from .voice.router import router as voice_router

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s"
)
logger = logging.getLogger("onee.api")

app = FastAPI(
    title="ONEE - LPU Agent API",
    description="Stateless, multi-user isolated backend for ONEE Chrome Extension powered by Groq Qwen.",
    version="2.0.0"
)

# CORS configuration allowing Chrome Extensions and local development
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"]
)

# Include dedicated voice API router
app.include_router(voice_router)

@app.get("/health", status_code=status.HTTP_200_OK)
async def health_check():
    """
    Health check endpoint to verify backend service readiness.
    """
    return {
        "status": "ok",
        "service": "onee-agent-backend",
        "model": settings.GROQ_MODEL
    }

@app.post("/api/chat", response_model=ChatResponse, status_code=status.HTTP_200_OK)
async def chat_endpoint(request: ChatRequest):
    """
    Main chat endpoint for attendance queries, bunk calculations, and natural language assistant.
    """
    try:
        response = await onee_agent.run(
            user_message=request.message,
            attendance=request.attendance,
            history=request.history
        )
        return response
    except Exception as e:
        logger.exception("Error processing chat request")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to process chat: {str(e)}"
        )

@app.post("/api/chat/stream")
async def chat_stream_endpoint(request: ChatRequest):
    """
    Progressive SSE streaming endpoint for real-time token and activity generation.
    """
    async def sse_event_generator():
        try:
            async for event in onee_agent.stream_run(
                user_message=request.message,
                attendance=request.attendance,
                history=request.history
            ):
                payload = json.dumps(event)
                yield f"data: {payload}\n\n"
        except Exception as e:
            logger.exception("Streaming endpoint failure")
            err_payload = json.dumps({
                "type": "error",
                "data": {"message": f"Streaming failure: {str(e)}"}
            })
            yield f"data: {err_payload}\n\n"

    return StreamingResponse(
        sse_event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no"
        }
    )

@app.post("/api/plan-action", response_model=PlanActionResponse, status_code=status.HTTP_200_OK)
async def plan_action_endpoint(request: PlanActionRequest):
    """
    Computer-Use action planning endpoint that decides next browser navigation action.
    """
    try:
        response = await plan_next_action(request)
        return response
    except Exception as e:
        logger.exception("Error planning next agent action")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to plan action: {str(e)}"
        )

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("app.main:app", host=settings.HOST, port=settings.PORT, reload=True)
