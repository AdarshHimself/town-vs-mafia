# Project Structure & Architecture

Welcome to the **Town vs Mafia: AI Edition** codebase! 

This file explains every major folder and file in the project, what their purpose is, and how they connect to each other. Think of this as the map to your game's brain.

---

## The Root Directory

### `server.py`
**The Bridge / The Server.** 
This is the FastAPI web server. It acts as the bridge between your web browser (the game UI) and the Python backend (the AI logic). 
- It serves the website files to your browser.
- It handles the "START GAME", "PAUSE", and "EXIT" buttons.
- It runs the `Game` loop in a separate background thread so your website doesn't freeze while the AI is "thinking".
- It streams the game events to the frontend in real-time using SSE (Server-Sent Events).

### `.env`
**The Secret Vault.**
This file contains your secret API keys (like your `GROQ_API_KEY` or `OPENAI_API_KEY`). It is hidden from the public and should *never* be uploaded to GitHub to prevent hackers from stealing your AI credits.

### `requirements.txt`
**The Shopping List.**
A list of all the Python packages (like `fastapi`, `uvicorn`, `groq`) required to run the backend. When you run `pip install -r requirements.txt`, Python reads this list and downloads the necessary tools.

---

## 📂 `src/` (The Game Brain)
This folder holds all the Python files that control the game rules and the AI.

### `src/main.py`
**The Game Master.**
This file contains the `Game` and `GameState` classes. It dictates the entire flow of the game. 
It moves the game through phases: 
1. **Day Phase** (Players introduce themselves)
2. **Discussion** (Players argue about who the Mafia is)
3. **Voting** (Players vote to arrest someone)
4. **Night Phase** (Mafia kills, Doctor saves, Detective investigates).
It logs everything that happens and sends that data back to `server.py` to be shown on your screen.

### `src/agents.py`
**The Player Minds.**
This contains the `MafiaAgent` class. Every player in the game (both AI and Human) is an "Agent". 
- It gives them a `memory` so they remember what happened in past rounds.
- It constructs the prompt (the text we send to the AI) telling them their role and what is happening.
- It parses their response to figure out who they decided to vote for or kill.

### `src/agent_interfaces.py`
**The Translators.**
Different AI companies (Groq, OpenAI, Google) have different ways of receiving messages. This file contains the "wrappers" that translate our game's requests into the specific format required by Groq, OpenAI, Gemini, etc.

### `src/config.py`
**The Rulebook Settings.**
This file holds default settings, like how many "tokens" (words) an AI is allowed to speak at once (`STANDARD_TOKEN_LIMITS`), and which AI models are assigned to which roles by default.

### `src/prompt.txt`
**The Script.**
This is the massive instruction manual sent to the AI. It tells the AI exactly how to behave: "You are playing a game of Mafia. Do not break character. Be suspicious, be deceptive..."

### `src/prompt_utils.py`
**The Formatter.**
This takes the `prompt.txt` file and injects the live game data into it. It swaps out placeholders with the actual names of the players, who died, and what phase it currently is.

---

## 📂 `web/` (The User Interface)
This folder holds the files that run inside the user's internet browser. It controls what the game *looks* and *feels* like.

### `web/index.html`
**The Skeleton.**
This is the HTML file that defines the structure of the website. It contains the Setup Screen, the Game Board, the Player Cards, and the invisible Overlays (like the Skull screen or the Pause screen).

### `web/style.css`
**The Paint & Animations.**
This massive file makes the game beautiful. It contains all the colors, the modern typography (Bebas Neue fonts), the dark/light mode themes, and the cinematic animations (like the bouncy floating voting cards and the glowing borders around the avatars).

### `web/game.js`
**The Puppeteer.**
This is the Javascript file that runs in your browser. It is the heart of the frontend.
- It listens to the SSE stream from `server.py` to know what the AI just said.
- It updates the UI (kills a player, shows a message, starts a timer).
- It runs the Text-to-Speech (`window.speechSynthesis`) to read the AI's messages out loud with different male/female voices.
- It manages the Pause, Play, and Exit buttons.

### 📂 `web/assets/avatars/`
**The Faces.**
This folder contains the 3D Apple/Meta-style PNG images used for the players. The game engine reads the names of these files (e.g., `avatar_female_1_diya.png`) to automatically assign the character "Diya" a female voice and a beautiful portrait.
