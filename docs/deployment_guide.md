# Free Cloud Hosting & Custom Domain Guide

This guide will teach you exactly how to take this local Mafia game from your computer and put it on the public internet, completely for free, attached to your very own custom domain (like `mymafiagame.com`). 

We will use **Render.com**, which is a highly respected cloud platform that offers a generous 100% free tier for Python web applications.

Please follow these steps slowly and exactly as written. Don't worry if you haven't done this before—every tiny detail is explained.

---

## Phase 1: Pushing Your Code to GitHub

Render.com needs a place to download your code from. The industry standard way to do this is using GitHub.

1. **Create a GitHub Account:** Go to [GitHub.com](https://github.com) and sign up for a free account if you don't have one.
2. **Download GitHub Desktop:** If you aren't comfortable with the command line, download [GitHub Desktop](https://desktop.github.com/). It's a visual app that makes uploading code very easy.
3. **Create a Repository (Repo):** 
   - Open GitHub Desktop.
   - Click `File` -> `Add Local Repository`.
   - Select the `llm-mafia-game` folder on your computer.
   - If it says "This directory does not appear to be a Git repository", click the blue **"create a repository"** link. Name it `town-mafia-ai`.
4. **Publish Your Code:**
   - In the bottom left, type "Initial commit" in the summary box and click the blue **Commit to main** button.
   - Now click the big blue **Publish repository** button at the top.
   - **CRITICAL:** Check the box that says **"Keep this code private"**. Because your `.env` file might accidentally be uploaded, keeping it private ensures hackers cannot steal your API keys. Click Publish.

---

## Phase 2: Deploying to Render.com

Now that your code is safely stored on GitHub, we will tell Render to spin up a free server, download your code, and run the Python backend.

1. **Create a Render Account:** Go to [Render.com](https://render.com) and click **Get Started**. Sign up using the **"Sign up with GitHub"** button. This automatically links your GitHub account.
2. **Create a Web Service:**
   - On the Render dashboard, click the **"New +"** button in the top right.
   - Select **"Web Service"**.
   - Under "Connect a repository", you will see the `town-mafia-ai` repository you just created. Click **Connect**.
3. **Configure the Server:**
   - **Name:** Type whatever you want (e.g., `town-mafia-game`).
   - **Region:** Choose the region closest to you (e.g., US East, Frankfurt).
   - **Branch:** Leave as `main`.
   - **Runtime:** This must be set to **`Python 3`**.
   - **Build Command:** Delete whatever is there and type exactly this:
     ```bash
     pip install -r requirements.txt
     ```
   - **Start Command:** Delete whatever is there and type exactly this:
     ```bash
     uvicorn server:app --host 0.0.0.0 --port $PORT
     ```
   - **Instance Type:** Scroll down and select the **Free** tier option.

4. **Add Your API Keys (Environment Variables):**
   - Scroll down and click **"Advanced"**.
   - Click **"Add Environment Variable"**.
   - For the **Key**, type: `GROQ_API_KEY`
   - For the **Value**, paste your actual secret Groq API key.
   - *(If you use OpenAI or others, click "Add Environment Variable" again and add `OPENAI_API_KEY`, etc.)*
   - Also add one more variable to fix a common Python glitch:
     - Key: `PYTHON_VERSION`
     - Value: `3.11.0`

5. **Deploy!**
   - Scroll to the bottom and click **"Create Web Service"**.
   - You will see a black console screen pop up with lots of text. Render is currently building a mini-computer for you, installing Python, downloading your code, and running it. This will take about 2 to 5 minutes.
   - When it says `Uvicorn running on http://0.0.0.0...`, you are live! Look near the top left of the screen, right under your project name, to find your free Render URL (it will look like `town-mafia-game.onrender.com`). Click it to test your game!

---

## Phase 3: Connecting Your Custom Domain

Right now, your game is live on a `.onrender.com` link. Let's attach the custom domain you purchased.

### Step A: Tell Render About Your Domain
1. In your Render Dashboard, click on your running `town-mafia-game` Web Service.
2. On the left-hand menu, click **"Settings"**.
3. Scroll down until you find the **"Custom Domains"** section.
4. Click **"Add Custom Domain"**.
5. Type in your domain name (e.g., `mymafiagame.com`) and click Save.
6. Render will now show you some **DNS Records** that you need to copy into your domain registrar. It will usually give you an `A Record` (a string of numbers like `216.24.57.1`) and a `CNAME Record` (like `town-mafia-game.onrender.com`).

### Step B: Update Your Domain Registrar (GoDaddy, Namecheap, Hostinger, etc.)
1. Open a new tab and log in to the website where you bought your domain.
2. Find the **"DNS Management"** or **"Advanced DNS"** settings for your domain. You will see a list of records.
3. **Add the A Record:**
   - Click "Add New Record".
   - Type: `A`
   - Name/Host: `@` (The `@` symbol simply means the root of your domain, like mymafiagame.com)
   - Value/Target: Paste the IP address number Render gave you (e.g., `216.24.57.1`).
   - TTL: Leave as Default or Auto.
   - Save.
4. **Add the CNAME Record (For "www"):**
   - Click "Add New Record".
   - Type: `CNAME`
   - Name/Host: `www`
   - Value/Target: Paste your Render URL (e.g., `town-mafia-game.onrender.com`).
   - Save.

### Step C: Wait for the Internet to Update
- DNS changes are not instant. It is like updating a global phonebook. It can take anywhere from 5 minutes to 24 hours for the internet to recognize the connection.
- Go back to the Render Custom Domains settings page and occasionally click the **"Verify"** button next to your domain. 
- Once it verifies successfully, Render will automatically issue a free SSL Certificate so your website gets the secure padlock icon (`https://`). 

---

## Important Note Regarding Free Hosting
Because you are using a Free Tier on Render, **your server will go to sleep if no one visits it for 15 minutes**. 
- **What this means:** When you or a friend load the website after it has been asleep, it might take 30 to 50 seconds to "wake up" and load the page. 
- **Once it is awake:** The game will run flawlessly and instantly just like it did on your local computer.
- If you ever decide you hate the 50-second wake-up delay, you can upgrade the Render web service to the "Starter" tier for $7/month, which keeps it awake 24/7 forever.

**Congratulations! Your cinematic AI game is now fully hosted on the internet for the world to play.**

---

## Appendix: How is this 100% Free? (Zero-Cost Breakdown)

You might be wondering: *"How am I getting AI Text-to-Speech, Speech-to-Text, and Large Language Model intelligence without paying massive API bills?"* 

This project was specifically engineered to be **fast, fun, clean, and cheap ($0)**. Here is the magic behind it:

### 1. Speech-to-Text (Voice Input) & Text-to-Speech (Audio Voices)
- **Cost: $0.00**
- We do **not** use paid services like ElevenLabs or OpenAI Whisper.
- Instead, the game uses the **Web Speech API**. This is a powerful AI engine built natively into modern browsers (like Chrome, Safari, and Edge). 
- All voice generation and speech recognition happens locally on the player's own device/browser in real-time. It costs you absolutely nothing, regardless of how many people play your game!

### 2. The AI Brains (Language Models)
- **Cost: $0.00**
- The game relies on **Groq** and the `llama-3.1-8b-instant` model by default.
- Groq processes AI using LPUs (Language Processing Units) which are insanely fast, and currently, Groq offers an extremely generous **Free Tier** for developers.
- It is so fast and cheap that as long as you use the default Groq setting, your API bill will remain at zero while providing instantaneous AI responses.

### 3. The Server Hosting
- **Cost: $0.00**
- As detailed above, Render's Free Web Service tier gives you a cloud computer that spins up when requested. It easily handles the SSE streams and Python backend without any credit card required. 

By combining the Browser's native Audio APIs with Groq's free LLM tier and Render's free hosting, you have built a massively complex AI application that runs flawlessly on the cloud without burning a single penny!
