from fastapi import FastAPI
from pydantic import BaseModel
from backend.query.agent import run_agent
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from typing import Optional
import backend.query.utils as utils  
import asyncio
import json
import sys

app = FastAPI(title="Query Service")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


class Query(BaseModel):
    question: str

@app.post("/ask")
async def ask(query: Query):
    result = run_agent(query.question)
    return {
        "answer": result["final_answer"],
        "dev_history": result["history"]
    }

@app.get("/ask_stream")
async def ask_stream(question: str):
    async def event_generator():
        queue: asyncio.Queue = asyncio.Queue()
        loop = asyncio.get_event_loop()

        class StdoutStreamer:
            def __init__(self):
                self._buffer = ""

            def write(self, s: str):
                self._buffer += s
                while "\n" in self._buffer:
                    line, self._buffer = self._buffer.split("\n", 1)
                    line = line.strip()
                    if line:
                        loop.call_soon_threadsafe(
                            queue.put_nowait,
                            {"type": "log", "message": line}
                        )

            def flush(self):
                pass

        def worker():
            original_stdout = sys.stdout
            sys.stdout = StdoutStreamer()
            try:
                result = run_agent(question)

                loop.call_soon_threadsafe(
                    queue.put_nowait,
                    {
                        "type": "result",
                        "answer": result["final_answer"],
                        "code": None,              
                        "history": result["history"],  
                    }
                )
            except Exception as e:
                loop.call_soon_threadsafe(
                    queue.put_nowait,
                    {"type": "error", "error": str(e)}
                )
            finally:
                sys.stdout = original_stdout
                loop.call_soon_threadsafe(
                    queue.put_nowait,
                    {"type": "done"}
                )

        loop.run_in_executor(None, worker)

        while True:
            msg = await queue.get()

            if msg["type"] == "log":
                payload = json.dumps(
                    {"type": "log", "message": msg["message"]},
                    ensure_ascii=False,
                )
                yield f"data: {payload}\n\n"

            elif msg["type"] == "result":
                payload = json.dumps(
                    {
                        "type": "result",
                        "answer": msg["answer"],  
                        "code": msg.get("code"), 
                        "history": msg.get("history", []), 
                    },
                    ensure_ascii=False,
                    default=str,  
                )
                yield f"data: {payload}\n\n"

            elif msg["type"] == "error":
                payload = json.dumps(
                    {"type": "error", "error": msg["error"]},
                    ensure_ascii=False,
                )
                yield f"data: {payload}\n\n"

            elif msg["type"] == "done":
                break

    return StreamingResponse(event_generator(), media_type="text/event-stream")

@app.get("/feedbacks")
async def get_feedbacks(
    office: Optional[str] = None,
    service: Optional[str] = None,
    level: Optional[int] = None,
    limit: int = 10000,
):

    all_results = utils.get_all_feedback(limit=limit)

    filtered_payloads = []
    for r in all_results:
        payload = r.get("payload", {}) or {}

        if office and payload.get("office") != office:
            continue
        if service and payload.get("service") != service:
            continue
        if level is not None and payload.get("Level") != level:
            continue

        filtered_payloads.append(payload)

    return {"feedbacks": filtered_payloads}