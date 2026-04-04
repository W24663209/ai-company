from __future__ import annotations

import json
from pathlib import Path
from typing import Optional

from ai_company.core.config import settings
from ai_company.core.exceptions import ProjectNotFoundError
from ai_company.core.models import Project, ProjectType


PROJECTS_FILE = settings.data_dir / "projects.jsonl"


def _ensure_file():
    PROJECTS_FILE.touch(exist_ok=True)


def _read_all() -> list[Project]:
    _ensure_file()
    projects = []
    for line in PROJECTS_FILE.read_text().splitlines():
        if line.strip():
            projects.append(Project.model_validate_json(line))
    return projects


def _write_all(projects: list[Project]):
    _ensure_file()
    lines = [p.model_dump_json() + "\n" for p in projects]
    PROJECTS_FILE.write_text("".join(lines))


def create_project(name: str, project_type: ProjectType, path: Optional[str] = None, memory: str = "", agent_roles: str = "") -> Project:
    resolved_path = path or str(settings.workspace_root / name)
    Path(resolved_path).mkdir(parents=True, exist_ok=True)
    project = Project(name=name, path=resolved_path, type=project_type, memory=memory, agent_roles=agent_roles)
    with PROJECTS_FILE.open("a") as f:
        f.write(project.model_dump_json() + "\n")
    return project


def list_projects() -> list[Project]:
    return _read_all()


def get_project(project_id: str) -> Project:
    for p in _read_all():
        if p.id == project_id or p.name == project_id:
            return p
    raise ProjectNotFoundError(f"Project '{project_id}' not found.")


def delete_project(project_id: str) -> bool:
    projects = _read_all()
    filtered = [p for p in projects if p.id != project_id and p.name != project_id]
    if len(filtered) == len(projects):
        return False
    _write_all(filtered)
    return True


def update_project(project_id: str, **kwargs) -> Project:
    projects = _read_all()
    for idx, p in enumerate(projects):
        if p.id == project_id or p.name == project_id:
            data = p.model_dump()
            data.update(kwargs)
            projects[idx] = Project.model_validate(data)
            _write_all(projects)
            return projects[idx]
    raise ProjectNotFoundError(f"Project '{project_id}' not found.")
