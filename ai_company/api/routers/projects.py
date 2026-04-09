from fastapi import APIRouter, Body, HTTPException

from ai_company.core.exceptions import ProjectNotFoundError
from ai_company.core.models import Project, ProjectType, BuildEnvironment
from ai_company.services import project_service
from ai_company.adapters import python_adapter, node_adapter, java_adapter

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
    environments: list[BuildEnvironment] | None = Body(None),
    active_environment: str | None = Body(None),
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
        if environments is not None:
            kwargs["environments"] = environments
        if active_environment is not None:
            kwargs["active_environment"] = active_environment
        return project_service.update_project(project_id, **kwargs)
    except ProjectNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc))


@router.get("/{project_id}/environments", response_model=list[BuildEnvironment])
def get_project_environments(project_id: str):
    """Get all environments for a project"""
    try:
        project = project_service.get_project(project_id)
        return project.environments or []
    except ProjectNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc))


@router.post("/{project_id}/environments", response_model=Project)
def add_project_environment(project_id: str, environment: BuildEnvironment):
    """Add or update an environment for a project"""
    try:
        project = project_service.get_project(project_id)
        environments = project.environments or []

        # Check if environment with same name exists
        existing_idx = next((i for i, e in enumerate(environments) if e.name == environment.name), -1)
        if existing_idx >= 0:
            environments[existing_idx] = environment
        else:
            environments.append(environment)

        return project_service.update_project(project_id, environments=environments)
    except ProjectNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc))


@router.delete("/{project_id}/environments/{env_name}", response_model=Project)
def delete_project_environment(project_id: str, env_name: str):
    """Delete an environment from a project"""
    try:
        project = project_service.get_project(project_id)
        environments = project.environments or []
        environments = [e for e in environments if e.name != env_name]
        return project_service.update_project(project_id, environments=environments)
    except ProjectNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc))


@router.post("/{project_id}/environments/{env_name}/activate", response_model=Project)
def activate_project_environment(project_id: str, env_name: str):
    """Activate a specific environment"""
    try:
        return project_service.update_project(project_id, active_environment=env_name)
    except ProjectNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc))


@router.get("/runtimes/available")
def get_available_runtimes():
    """Get list of available runtime versions on the system"""
    return {
        "python": python_adapter.get_python_versions(),
        "node": [
            {"version": "16", "available": True},
            {"version": "18", "available": True},
            {"version": "20", "available": True},
            {"version": "22", "available": True},
        ],
        "java": [
            {"version": "11", "available": True},
            {"version": "17", "available": True},
            {"version": "21", "available": True},
        ],
    }
