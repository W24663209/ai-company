from __future__ import annotations

from datetime import datetime
from pathlib import Path
from typing import Optional

from ai_company.core.config import settings
from ai_company.core.exceptions import ProjectNotFoundError, RequirementNotFoundError
from ai_company.core.models import Requirement, RequirementStatus
from ai_company.services.project_service import get_project


def _resolve_project_id(project_id: str) -> str:
    return get_project(project_id).id


def _req_file(project_id: str) -> Path:
    resolved_id = _resolve_project_id(project_id)
    req_dir = settings.data_dir / "projects" / resolved_id
    req_dir.mkdir(parents=True, exist_ok=True)
    return req_dir / "requirements.jsonl"


def _read_all(project_id: str) -> list[Requirement]:
    file_path = _req_file(project_id)
    file_path.touch(exist_ok=True)
    reqs = []
    for line in file_path.read_text().splitlines():
        if line.strip():
            reqs.append(Requirement.model_validate_json(line))
    return reqs


def _write_all(project_id: str, reqs: list[Requirement]):
    file_path = _req_file(project_id)
    lines = [r.model_dump_json() + "\n" for r in reqs]
    file_path.write_text("".join(lines))


def create_requirement(
    project_id: str,
    title: str,
    description: str = "",
    status: RequirementStatus = RequirementStatus.PENDING,
    priority: int = 3,
) -> Requirement:
    resolved_id = _resolve_project_id(project_id)
    req = Requirement(
        project_id=resolved_id,
        title=title,
        description=description,
        status=status,
        priority=priority,
    )
    req_dir = settings.data_dir / "projects" / resolved_id
    req_dir.mkdir(parents=True, exist_ok=True)
    file_path = req_dir / "requirements.jsonl"
    with file_path.open("a") as f:
        f.write(req.model_dump_json() + "\n")
    return req


def list_requirements(project_id: str) -> list[Requirement]:
    return _read_all(project_id)


def get_requirement(project_id: str, requirement_id: str) -> Requirement:
    for r in _read_all(project_id):
        if r.id == requirement_id:
            return r
    raise RequirementNotFoundError(f"Requirement '{requirement_id}' not found.")


def update_requirement(
    project_id: str,
    requirement_id: str,
    title: Optional[str] = None,
    description: Optional[str] = None,
    status: Optional[RequirementStatus] = None,
    priority: Optional[int] = None,
) -> Requirement:
    reqs = _read_all(project_id)
    for idx, r in enumerate(reqs):
        if r.id == requirement_id:
            data = r.model_dump()
            if title is not None:
                data["title"] = title
            if description is not None:
                data["description"] = description
            if status is not None:
                data["status"] = status
            if priority is not None:
                data["priority"] = priority
            data["updated_at"] = datetime.utcnow().isoformat()
            reqs[idx] = Requirement.model_validate(data)
            _write_all(project_id, reqs)
            return reqs[idx]
    raise RequirementNotFoundError(f"Requirement '{requirement_id}' not found.")
