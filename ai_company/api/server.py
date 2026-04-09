from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware

from ai_company.api.routers import agent_messages, agents, database, files, git, project_links, project_messages, projects, requirements, skills, terminal
from ai_company.core.config import settings

create_app = None

def create_app_instance() -> FastAPI:
    app = FastAPI(title="AI Company", version="0.1.0")
    app.state.settings = settings

    # CORS for SSE streaming
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    app.include_router(projects.router, prefix="/projects", tags=["projects"])
    app.include_router(requirements.router, prefix="/requirements", tags=["requirements"])
    app.include_router(agents.router, prefix="/agents", tags=["agents"])
    app.include_router(skills.router, prefix="/skills", tags=["skills"])
    app.include_router(project_links.router, prefix="/api", tags=["project_links"])
    app.include_router(terminal.router, prefix="/ws", tags=["terminal"])
    app.include_router(git.router, prefix="/git", tags=["git"])
    app.include_router(files.router, prefix="/files", tags=["files"])
    app.include_router(database.router, prefix="/db", tags=["database"])
    app.include_router(agent_messages.router, prefix="/agents", tags=["agent_messages"])
    app.include_router(project_messages.router, prefix="/messages", tags=["project_messages"])

    @app.get("/health")
    def health() -> dict[str, str]:
        return {"status": "ok"}

    frontend_dir = settings.project_root / "frontend"
    if frontend_dir.exists():
        app.mount("/", StaticFiles(directory=str(frontend_dir), html=True), name="frontend")

    return app


app = create_app_instance()
