from pathlib import Path

from fastapi import APIRouter, HTTPException, Query

from ai_company.core.config import settings
from ai_company.core.exceptions import AICompanyError
from ai_company.services import build_service

router = APIRouter()


@router.post("/java/{project_id}")
def build_java(
    project_id: str,
    jdk_version: str = "17",
    command: list[str] | None = Query(None),
):
    try:
        log_path = build_service.build_project(project_id, command=command, jdk_version=jdk_version)
        return {"status": "success", "log": log_path}
    except AICompanyError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@router.post("/node/{project_id}")
def build_node(
    project_id: str,
    tool: str = "npm",
    node_version: str | None = None,
    command: list[str] | None = Query(None),
):
    try:
        log_path = build_service.build_project(
            project_id, command=command, tool=tool, node_version=node_version
        )
        return {"status": "success", "log": log_path}
    except AICompanyError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@router.get("/log")
def read_log(path: str):
    log_path = Path(path).resolve()
    base = (settings.shared_dir / "artifacts" / "builds").resolve()
    if not str(log_path).startswith(str(base)):
        raise HTTPException(status_code=403, detail="Invalid log path")
    if not log_path.exists():
        raise HTTPException(status_code=404, detail="Log not found")
    content = log_path.read_text(encoding="utf-8", errors="replace")
    return {"content": content}
