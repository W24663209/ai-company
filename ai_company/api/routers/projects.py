from fastapi import APIRouter, Body, HTTPException

from ai_company.core.exceptions import ProjectNotFoundError
from ai_company.core.models import Project, ProjectType
from ai_company.services import project_service

router = APIRouter()


@router.post("", response_model=Project)
def create_project(name: str, project_type: ProjectType, path: str | None = None):
    return project_service.create_project(name, project_type, path)


@router.get("", response_model=list[Project])
def list_projects():
    return project_service.list_projects()


@router.get("/{project_id}", response_model=Project)
def get_project(project_id: str):
    try:
        return project_service.get_project(project_id)
    except ProjectNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc))


@router.delete("/{project_id}")
def delete_project(project_id: str):
    if project_service.delete_project(project_id):
        return {"deleted": True}
    raise HTTPException(status_code=404, detail="Project not found")


@router.patch("/{project_id}", response_model=Project)
def patch_project(
    project_id: str,
    memory: str | None = Body(None),
    agent_roles: str | None = Body(None),
    claude_settings: str | None = Body(None),
    config: dict | None = Body(None),
    scripts: list[dict[str, str]] | None = Body(None),
    env: dict[str, str] | None = Body(None),
):
    try:
        kwargs: dict = {}
        if memory is not None:
            kwargs["memory"] = memory
        if agent_roles is not None:
            kwargs["agent_roles"] = agent_roles
        if claude_settings is not None:
            kwargs["claude_settings"] = claude_settings
        if config is not None:
            kwargs["config"] = config
        if scripts is not None:
            kwargs["scripts"] = scripts
        if env is not None:
            kwargs["env"] = env
        return project_service.update_project(project_id, **kwargs)
    except ProjectNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc))
