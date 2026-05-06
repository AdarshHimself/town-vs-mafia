"""
server.py - Town vs Mafia: AI Edition — FastAPI Server
Run with: python server.py
"""
import asyncio
import concurrent.futures
import json
import queue
import random
import threading
import time
import os
from pathlib import Path
from typing import Optional

from fastapi import FastAPI, Request
from fastapi.responses import HTMLResponse, StreamingResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
import uvicorn

from src.main import create_game

app = FastAPI(title="Town vs Mafia: AI Edition")
app.mount("/web", StaticFiles(directory="web"), name="web")


# ─── Session ──────────────────────────────────────────────────────────────────

class GameSession:
    def __init__(self):
        self.reset()

    def reset(self):
        self.event_queue: queue.Queue = queue.Queue()
        self.human_action_event = threading.Event()
        self.human_action_value: Optional[str] = None
        self.pending_human_prompt: Optional[dict] = None
        self.game_thread: Optional[threading.Thread] = None
        self.stop_flag = threading.Event()
        self.pause_flag = threading.Event()
        self.running = False
        self.game_over = False

SESSION = GameSession()


# ─── SSE Stream ───────────────────────────────────────────────────────────────

async def event_generator():
    loop = asyncio.get_event_loop()
    executor = concurrent.futures.ThreadPoolExecutor(max_workers=1)
    yield f"data: {json.dumps({'type': 'CONNECTED'})}\n\n"

    while True:
        try:
            event = await loop.run_in_executor(
                executor,
                lambda: SESSION.event_queue.get(timeout=1.0)
            )
            yield f"data: {json.dumps(event)}\n\n"
            if event.get('type') in ('GAME_OVER', 'GAME_STOPPED', 'ERROR'):
                await asyncio.sleep(0.3)
                break
        except queue.Empty:
            yield ": keepalive\n\n"
        except Exception:
            yield ": keepalive\n\n"


@app.get("/api/events")
async def events():
    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
            "Connection": "keep-alive",
        }
    )


# ─── Game Orchestration ────────────────────────────────────────────────────────

def emit_event(event: dict):
    SESSION.event_queue.put(event)


def human_input_fn(prompt_data: dict) -> str:
    """Blocks game thread until UI sends an action."""
    SESSION.pending_human_prompt = prompt_data
    SESSION.human_action_event.clear()
    emit_event({"type": "HUMAN_PROMPT", **prompt_data})
    # Wait for UI response (max 5 min) or game stop
    while not SESSION.stop_flag.is_set():
        if SESSION.human_action_event.wait(timeout=1.0):
            break
    result = SESSION.human_action_value or ""
    SESSION.human_action_value = None
    SESSION.pending_human_prompt = None
    return result


def run_game_thread(config: dict):
    try:
        players = build_players(config)
        game = create_game(
            players,
            discussion_rounds=config.get("discussion_rounds", 2),
            event_callback=emit_event,
            human_input_fn=human_input_fn if config.get("human_player") else None,
            stop_flag=SESSION.stop_flag,
            pause_flag=SESSION.pause_flag,
        )
        game.play()
    except Exception as e:
        msg = str(e)
        # Friendly API error messages
        if any(k in msg.lower() for k in ["rate limit", "ratelimit", "429"]):
            msg = "API rate limit exceeded. Please wait a moment and try again."
        elif any(k in msg.lower() for k in ["timeout", "timed out"]):
            msg = "API request timed out. The AI provider may be slow — try again."
        elif any(k in msg.lower() for k in ["api key", "authentication", "401", "403"]):
            msg = "API authentication failed. Check your API key in .env file."
        elif "stopped" in msg.lower():
            msg = None  # Already emitted GAME_STOPPED
        if msg:
            emit_event({"type": "ERROR", "message": msg})
    finally:
        SESSION.running = False
        SESSION.game_over = True


def build_players(config: dict) -> list:
    player_name = config.get("player_name", "You")
    num_players = config.get("num_players", 5)
    ai_provider  = config.get("ai_provider", "groq")
    ai_model     = config.get("ai_model", "llama-3.1-8b-instant")

    role_sets = {
        4: ["mafia", "detective", "villager", "villager"],
        5: ["mafia", "detective", "doctor", "villager", "villager"],
        6: ["mafia", "mafia", "detective", "doctor", "villager", "villager"],
        7: ["mafia", "mafia", "detective", "doctor", "villager", "villager", "villager"],
        8: ["mafia", "mafia", "mafia", "detective", "doctor", "villager", "villager", "villager"],
    }
    roles = role_sets.get(num_players, role_sets[5]).copy()
    random.shuffle(roles)

    ai_names = ["Diya", "Dadi", "Sneha", "Neha", "Arav", "Bhupender", "Rohan", "Rajesh"]
    random.shuffle(ai_names)

    ai_cfg = {"type": ai_provider, "model": ai_model, "temperature": 0.75}

    players = []
    human_placed = False

    for role in roles:
        if not human_placed and config.get("human_player"):
            players.append({
                "name": player_name,
                "role": role,
                "llm": {"type": "human", "player_name": player_name}
            })
            human_placed = True
        else:
            name = ai_names.pop(0) if ai_names else f"Player{len(players)+1}"
            players.append({"name": name, "role": role, "llm": ai_cfg})

    return players


# ─── API Endpoints ─────────────────────────────────────────────────────────────

@app.post("/api/start")
async def start_game(request: Request):
    if SESSION.running:
        return JSONResponse({"error": "Game already running"}, status_code=400)

    config = await request.json()
    SESSION.reset()
    SESSION.running = True

    thread = threading.Thread(target=run_game_thread, args=(config,), daemon=True)
    SESSION.game_thread = thread
    thread.start()

    return JSONResponse({"status": "started"})


@app.post("/api/action")
async def player_action(request: Request):
    data = await request.json()
    SESSION.human_action_value = data.get("value", "")
    SESSION.human_action_event.set()
    return JSONResponse({"status": "ok"})


@app.post("/api/stop")
async def stop_game():
    SESSION.stop_flag.set()
    SESSION.pause_flag.clear()  # Unblock if paused
    SESSION.human_action_event.set()  # Unblock any waiting human input
    # Give thread a moment to notice
    await asyncio.sleep(0.5)
    SESSION.reset()
    return JSONResponse({"status": "stopped"})

@app.post("/api/pause")
async def pause_game():
    if SESSION.running and not SESSION.game_over:
        SESSION.pause_flag.set()
    return JSONResponse({"status": "paused"})

@app.post("/api/resume")
async def resume_game():
    SESSION.pause_flag.clear()
    return JSONResponse({"status": "resumed"})

@app.get("/api/state")
async def get_state():
    return JSONResponse({
        "running": SESSION.running,
        "game_over": SESSION.game_over,
        "pending_prompt": SESSION.pending_human_prompt
    })


@app.get("/", response_class=HTMLResponse)
async def index():
    return HTMLResponse(Path("web/index.html").read_text())


# ─── Entry ─────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    print("\n🎭 Town vs Mafia: AI Edition")
    print("=" * 40)
    print("Open: http://localhost:8001")
    print("=" * 40)
    uvicorn.run(app, host="0.0.0.0", port=8001, log_level="warning")
