# Job-Ops Tailoring Service

This is the Python-based AI Tailoring Service for the Job-Ops pipeline. It uses LLMs (via Gemini) to intelligently compress, rewrite, and tailor a master JSON Resume to precisely match a given Job Description.

## Architecture

This service works in tandem with the Job-Ops Orchestrator:

1. **Orchestrator** sends a Job Description and the Master Resume to this service.
2. **Tailoring Service** shrinks the resume (`compact.py`) and passes it to the LLM.
3. **LLM** explicitly generates a targeted summary, re-weights work bullet points (favoring the last 3 roles), and selects the top 25 most relevant certificates.
4. **Tailoring Service** safely merges these generated snippets back into the strict `master-resume.json` schema.
5. **Orchestrator** receives the tailored JSON and renders it to a PDF using the local `resumed` CLI.

## Prerequisites

- Python 3.10+
- `pip` or `uv`
- A valid Gemini API Key

## Local Development Setup

1. Install dependencies (if you haven't already):

```bash
pip install -r requirements.txt
# or
pip install fastapi uvicorn pydantic google-genai
```

2. Set your environment variables (or place them in a `.env` file):

```bash
export GEMINI_API_KEY="your_api_key_here"
```

3. Run the development server with hot-reloading:

```bash
uvicorn src.main:app --reload --port 8000
```

The service will be available at `http://127.0.0.1:8000`.

## Containerization (Podman/Docker)

Running `uvicorn` and `npm run dev` in separate terminals is standard for **local development**. However, for a production or fully automated setup, this service is designed to be containerized.

When running as a container (e.g., using `podman compose` or `docker compose`), the startup process is entirely automated:

1. The `.env` file is automatically passed into the containers.
2. The Python container boots up and runs `uvicorn src.main:app --host 0.0.0.0 --port 8000` (without the `--reload` flag).
3. The Node.js Orchestrator container boots up, connects to the Python container via an internal container network (e.g., `http://tailoring-service:8000`), and serves the UI.

No manual terminal commands are needed once containerized.

## Multi-Persona Instances

To run multiple Job-Ops instances (e.g., one for "Product Manager" and one for "Head of IT") on the same machine with isolated databases and master resumes, use the shared network architecture. The commands below use `podman compose`, but `docker compose` works identically if installed.

1. **Start the Shared Tailoring Service**:

   ```bash
   # Use project name 'shared'
   podman compose -p shared -f docker-compose.shared.yml up -d
   ```

2. **Configure Your Personas**:
   Create separate data directories (e.g., `data-pm/` and `data-head-it/`) and place a unique `master-resume.json` in each.

3. **Launch Instances**:
   ```bash
   # Use project names 'pm' and 'head-it'
   podman compose -p pm -f docker-compose.pm.yml up -d
   podman compose -p head-it -f docker-compose.head-it.yml up -d
   ```

Each instance will be isolated on its own port (e.g., 3001, 3002) but will share the same `tailoring-service` container and Gemini request cache.

## Troubleshooting

- **Caching Issues:** If you notice the AI is not updating results during testing, ensure the local SQLite cache in `src/cache.py` is disabled or cleared.
- **Missing Certificates:** Ensure your master resume uses the official JSON Resume key `"certificates"` (not `"certifications"`).
