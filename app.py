"""
ONEE - Autonomous Browser Agent & Academic Copilot
Hugging Face Spaces Entrypoint (Gradio SDK + FastAPI Integration).

This file enables 100% free hosting on Hugging Face Spaces using the Gradio SDK.
It mounts the entire stateless FastAPI backend (/api/chat, /health, /api/voice/...)
alongside an interactive dashboard and live health monitor.
"""

import os
import sys
import json
import httpx
import uvicorn
import gradio as gr

# Ensure backend package is discoverable on python path
current_dir = os.path.dirname(os.path.abspath(__file__))
backend_dir = os.path.join(current_dir, "backend")
if backend_dir not in sys.path:
    sys.path.insert(0, backend_dir)

from app.main import app as fastapi_app
from app.config import settings

# ZeroGPU compatibility hook (satisfies Hugging Face startup validator if ZeroGPU is active)
try:
    import spaces
    @spaces.GPU(duration=10)
    def _zerogpu_init():
        return True
except (ImportError, Exception):
    pass

def test_chat_query(message: str):
    """Interactive helper to test the agent directly in the Gradio dashboard."""
    if not message.strip():
        return "Please enter a test query."
    if not settings.GROQ_API_KEY:
        return "⚠️ Warning: GROQ_API_KEY is not configured in Space secrets."
    
    try:
        # Test query against internal agent service
        from app.agent.agent import onee_agent
        import asyncio
        response = asyncio.run(onee_agent.run(
            user_message=message,
            attendance=None,
            history=[],
            stream=False
        ))
        return response.message if hasattr(response, "message") else str(response)
    except Exception as e:
        return f"Error executing test query: {str(e)}"

# Custom styling for the Gradio dashboard
custom_css = """
footer {visibility: hidden !important;}
.gradio-container {max-width: 960px !important; margin: 0 auto !important;}
"""

with gr.Blocks(title="ONEE - Autonomous Academic Copilot API", css=custom_css, theme=gr.themes.Soft()) as demo:
    gr.Markdown("""
    # 🎓 ONEE → Autonomous Browser Agent & Academic Copilot
    **Stateless Backend Service powering the ONEE Chrome Side Panel Extension**
    """)

    with gr.Row():
        with gr.Column(scale=1):
            gr.Markdown("### 📡 System Telemetry")
            gr.Textbox(label="API Status", value="🟢 Online & Ready", interactive=False)
            gr.Textbox(label="Active LLM Model", value=f"{settings.GROQ_MODEL} (Groq Cloud)", interactive=False)
            gr.Textbox(label="Voice Engines", value="Groq Whisper large-v3 + Groq Orpheus", interactive=False)
            gr.Textbox(label="Port Binding", value=f"{os.environ.get('PORT', 7860)}", interactive=False)
        
        with gr.Column(scale=2):
            gr.Markdown("### 🧪 Live Agent Query Tester")
            query_input = gr.Textbox(
                label="Test a query directly against the agent",
                placeholder="e.g. Can you explain how safe-bunk algebra works in ONEE?",
                lines=3
            )
            test_btn = gr.Button("Send Query", variant="primary")
            query_output = gr.Textbox(label="Agent Response", lines=6, interactive=False)
            test_btn.click(test_chat_query, inputs=[query_input], outputs=[query_output])

    gr.Markdown("---")
    gr.Markdown("""
    ### 🔌 Active REST & SSE Endpoints for Chrome Extension
    - `GET  /health` → Service health check and model verification
    - `POST /api/chat` → Token-streaming conversational reasoning with grounded context
    - `POST /api/agent/plan` → Autonomous Computer Use browser action planner
    - `POST /api/voice/transcribe` → Groq Whisper large-v3 speech-to-text transcription
    - `POST /api/voice/speak` → Groq Orpheus expressive audio synthesis
    
    *Repository:* [github.com/MohammadFayasKhan/LpuUmsAgent](https://github.com/MohammadFayasKhan/LpuUmsAgent)
    """)

@fastapi_app.get("/")
async def root_discovery():
    """Root endpoint for status verification and link to Gradio UI."""
    return {
        "status": "online",
        "service": "ONEE Autonomous Academic Copilot API",
        "health": "/health",
        "ui": "/ui",
        "docs": "/docs"
    }

# Mount Gradio at /ui so FastAPI endpoints (/health, /api/*) remain completely unhindered
app = gr.mount_gradio_app(fastapi_app, demo, path="/ui")

if __name__ == "__main__":
    port = int(os.environ.get("PORT", 7860))
    uvicorn.run(app, host="0.0.0.0", port=port)
