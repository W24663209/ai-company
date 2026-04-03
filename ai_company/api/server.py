from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles

from ai_company.api.routers import agents, builds, files, git, projects, requirements, terminal
from ai_company.core.config import settings

create_app = None

def create_app_instance() -> FastAPI:
    app = FastAPI(title="AI Company", version="0.1.0")
    app.state.settings = settings

    app.include_router(projects.router, prefix="/projects", tags=["projects"])
    app.include_router(requirements.router, prefix="/requirements", tags=["requirements"])
    app.include_router(builds.router, prefix="/builds", tags=["builds"])
    app.include_router(agents.router, prefix="/agents", tags=["agents"])
    app.include_router(terminal.router, prefix="/ws", tags=["terminal"])
    app.include_router(git.router, prefix="/git", tags=["git"])
    app.include_router(files.router, prefix="/files", tags=["files"])

    @app.get("/health")
    def health() -> dict[str, str]:
        return {"status": "ok"}

    frontend_dir = settings.project_root / "frontend"
    if frontend_dir.exists():
        app.mount("/", StaticFiles(directory=str(frontend_dir), html=True), name="frontend")

    return app


app = create_app_instance()
