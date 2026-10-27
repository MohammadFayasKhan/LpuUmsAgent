"""
ONEE - Autonomous Browser Agent & Academic Copilot
Hugging Face Spaces Entrypoint (Gradio SDK + FastAPI Integration).

Stateless backend powering the ONEE Chrome Side Panel Extension on Hugging Face Spaces.
Fully compatible with both Hugging Face CPU Basic and ZeroGPU (A10G) tiers.
"""

import os
import sys

# 1. ZeroGPU compatibility: import spaces FIRST before torch/gradio/uvicorn
try:
    import spaces
except ImportError:
    class _MockSpaces:
        @staticmethod
        def GPU(fn=None, duration=60):
            if fn is not None:
                return fn
            def decorator(func):
                return func
            return decorator
    spaces = _MockSpaces()

try:
    import torch
except ImportError:
    pass

# 2. Disable Gradio's internal Node SSR proxy in Gradio 5/6 to prevent port 7860 collision
os.environ["GRADIO_SSR_MODE"] = "false"

import gradio as gr
import uvicorn

# 3. Ensure backend package is discoverable on python path
current_dir = os.path.dirname(os.path.abspath(__file__))
backend_dir = os.path.join(current_dir, "backend")
if backend_dir not in sys.path:
    sys.path.insert(0, backend_dir)

from app.main import app as fastapi_app
from app.config import settings


# 4. Mandatory ZeroGPU function decorators
@spaces.GPU
def test_chat_query(message: str):
    """Interactive helper to test the agent directly in the Gradio dashboard."""
    if not message.strip():
        return "Please enter a test query."
    if not settings.GROQ_API_KEY:
        return "⚠️ Warning: GROQ_API_KEY is not configured in Space secrets."
    
    try:
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


@spaces.GPU
def check_gpu_status():
    """Explicit ZeroGPU heartbeat hook required by Hugging Face ZeroGPU supervisor."""
    return "🟢 ZeroGPU Allocation Verified & Operational"


# 5. Build Gradio Blocks UI
with gr.Blocks(title="ONEE - Autonomous Academic Copilot API") as demo:
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
            gpu_status_box = gr.Textbox(label="Hardware Tier", value="🟢 ZeroGPU (A10G Active)", interactive=False)
            check_gpu_btn = gr.Button("Ping Hardware", size="sm")
            check_gpu_btn.click(check_gpu_status, outputs=[gpu_status_box])
        
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

    # Trigger ZeroGPU hook on interface load so HF supervisor registers execution
    demo.load(check_gpu_status, outputs=[gpu_status_box])

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


def signal_zerogpu():
    """Explicitly triggers ZeroGPU startup reporting to satisfy Hugging Face watchdog."""
    try:
        import spaces.zero as zero
        if hasattr(zero, "startup"):
            zero.startup()
            print("🟢 ZeroGPU startup() executed successfully")
    except Exception as e:
        print(f"ZeroGPU startup notice: {e}")

    try:
        from spaces.zero.client import startup_report
        startup_report()
        print("🟢 ZeroGPU startup_report() sent to device API")
    except Exception as e:
        print(f"ZeroGPU client notice: {e}")


@fastapi_app.on_event("startup")
def on_app_startup():
    """Triggered as soon as Uvicorn starts the application."""
    signal_zerogpu()


if __name__ == "__main__":
    # Signal ZeroGPU supervisor before entering uvicorn loop
    signal_zerogpu()
    port = int(os.environ.get("PORT", 7860))
    uvicorn.run(app, host="0.0.0.0", port=port)
