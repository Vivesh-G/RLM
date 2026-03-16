import os
import json
import asyncio
import re
from typing import AsyncGenerator

import dspy
from fastapi import FastAPI, UploadFile, File, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse, FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

# GROQ CONFIG via DsPy
GROQ_API_KEY = os.getenv("GROQ_API_KEY")
MODEL        = "groq/meta/llama-3.1-8b"

lm = dspy.LM(MODEL, api_key=GROQ_API_KEY, max_tokens=1024)
dspy.configure(lm=lm)

# dspy.RLM:
# signature  — "context, instructions, query -> answer"
# The LM receives context as a Python variable in a sandboxed REPL.
# It writes Python code to explore it (peek, regex, llm_query, etc.)
# Each REPL iteration is recorded in result.trajectory
# Requires Deno installed: https://deno.land/
class RLM_signature(dspy.Signature):
    """You are a helpful assistant that answers queries based on the provided context.
    You have access to a Python REPL where `context` is available as a variable.
    Write and execute Python code to explore the context and answer the query."""
    context = dspy.InputField(desc="The context text to explore and query")
    directions = dspy.InputField(desc="Instructions for how to process the query")
    query = dspy.InputField(desc="The user's question")
    answer = dspy.OutputField(desc="The final answer to the user's query")


rlm_module = dspy.RLM(
    RLM_signature,
    max_iterations=2,
    max_llm_calls=5,
    verbose=True,
)

# initialize fastapi app
app = FastAPI(title="RLM Studio", version="3.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.mount("/static", StaticFiles(directory="static"), name="static")


# helper functions

def sse(event: str, data: dict) -> str:
    return f"event: {event}\ndata: {json.dumps(data)}\n\n"


def context_meta(text: str) -> dict:
    return {
        "length": len(text),
        "lines":  text.count("\n") + 1,
        "words":  len(text.split()),
    }


# Streaming RLM execution

async def rlm_stream(
    system_prompt: str,
    user_prompt:   str,
    context:       str,
) -> AsyncGenerator[str, None]:
    
    # running dspy.RLM in a background thread (it's synchronous internally).
    # dspy.RLM places `context` as a live Python variable in a Deno/Pyodide
    # REPL. The LM writes Python code to explore it across N iterations.
    # after execution completes, stream each trajectory step (REPL iteration)
    # as an SSE event so the frontend can render them progressively.

    instructions = system_prompt or "Answer the user query accurately using the provided context."
    meta = context_meta(context)

    yield sse("status", {
        "message": f"Initialising DSPy RLM  ·  {meta['length']:,} chars  ·  {meta['lines']} lines",
    })
    await asyncio.sleep(0.05)

    yield sse("status", {
        "message": "Running dspy.RLM — LM is writing Python code to explore your context…",
    })

    # execute dspy.RLM in a thread so we don't block the event loop
    try:
        result = await asyncio.to_thread(
            rlm_module,
            context=context,
            directions=instructions,
            query=user_prompt,
        )
    except Exception as exc:
        err = str(exc)
        if "deno" in err.lower() or "pyodide" in err.lower() or "wasm" in err.lower():
            err = (
                "Deno is not installed or not on PATH — it is required for dspy.RLM's "
                "sandboxed Python REPL.\n\n"
                "Install: curl -fsSL https://deno.land/install.sh | sh\n"
                "Then restart your shell and re-run uvicorn."
            )
        yield sse("error", {"message": err})
        return

    # stream trajectory (one SSE per REPL iteration)
    trajectory = getattr(result, "trajectory", []) or []

    for i, step in enumerate(trajectory):
        reasoning = (step.get("reasoning") or "").strip()
        code      = (step.get("code")      or "").strip()
        output    = (step.get("output")    or "").strip()

        yield sse("repl_step", {
            "index":     i,
            "total":     len(trajectory),
            "reasoning": reasoning,
            "code":      code,
            "output":    output,
        })
        await asyncio.sleep(0.12)

    # final answer
    answer = getattr(result, "answer", "") or ""
    if not answer:
        answer = "(No answer returned — the model may have exhausted its iterations.)"

    yield sse("answer", {"text": answer})
    yield sse("done",   {
        "total_steps":   len(trajectory),
        "final_reasoning": getattr(result, "final_reasoning", "") or "",
    })


# routes
class RunRequest(BaseModel):
    system_prompt: str = ""
    user_prompt:   str
    context:       str


@app.post("/run")
async def run_rlm(req: RunRequest):
    if not req.user_prompt.strip():
        raise HTTPException(400, "user_prompt is required")
    if not req.context.strip():
        raise HTTPException(400, "context is required")

    return StreamingResponse(
        rlm_stream(req.system_prompt, req.user_prompt, req.context),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@app.post("/upload")
async def upload_file(file: UploadFile = File(...)):
    raw = await file.read()
    text = raw.decode("utf-8")
    return {"filename": file.filename, "text": text, "size": len(text)}


@app.get("/health")
async def health():
    return {"status": "ok", "model": MODEL}


@app.get("/")
async def index():
    return FileResponse("static/index.html")