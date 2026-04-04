# AI Company

Multi-project AI agent collaboration platform with Claude Code integration.

## Features

- **Multi-project management**: Create and manage multiple software projects.
- **Requirement management**: Track requirements per project with status and priority.
- **Cross-project agent communication**: Shared directory inbox/outbox for agent coordination.
- **Build support**: Java (JDK 11/17 + Maven) and Node (npm/pnpm) builds.
- **Claude Code integration**: Launch Claude Code sessions scoped to projects and requirements.

## Quick Start

### 1. Install dependencies

```bash
source .venv/bin/activate
pip install -e "."
```

### 2. CLI usage

```bash
python main.py --help

# Create a project
python main.py project create demo --type java

# List projects
python main.py project list

# Add a requirement
python main.py req add --project demo --title "Initialize Maven project"

# List requirements
python main.py req list --project demo

# Run a build
python main.py build java demo --jdk 17

# Launch a Claude session for a requirement
python main.py agent run --project demo --requirement REQ_ID

# Send/receive shared messages
python main.py agent send --sender my_agent --msg '{"status":"done"}' --project demo
python main.py agent read --project demo
```

### 3. API usage

Start the FastAPI server:

```bash
uvicorn ai_company.api.server:app --reload
```

Then visit `http://127.0.0.1:8000/docs` for interactive API documentation.

## Project Structure

```
ai_company/
├── core/          # Config, models, exceptions
├── cli/           # Typer CLI commands
├── api/           # FastAPI server and routers
├── services/      # Business logic (projects, requirements, builds, shared dir, Claude)
└── adapters/      # Java and Node build adapters
```

## Environment

Copy `.env.example` to `.env` and adjust paths as needed.

## Requirements

- Python >= 3.12
- Java 17 (and optionally Java 11)
- Maven
- Node.js + npm
- Claude Code CLI (`claude`)
