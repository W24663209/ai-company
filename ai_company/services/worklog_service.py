from __future__ import annotations

import json
from pathlib import Path

from ai_company.core.config import settings
from ai_company.core.exceptions import ProjectNotFoundError, RequirementNotFoundError
from ai_company.services.project_service import get_project
from ai_company.services.requirement_service import get_requirement


def _worklog_file(project_id: str, requirement_id: str) -> Path:
    project = get_project(project_id)
    req = get_requirement(project.id, requirement_id)
    log_dir = settings.data_dir / "projects" / project.id / "worklogs"
    log_dir.mkdir(parents=True, exist_ok=True)
    return log_dir / f"{req.id}.json"


def save_worklog(project_id: str, requirement_id: str, history: list[dict[str, str]]) -> None:
    """Persist chat history for a requirement."""
    try:
        file_path = _worklog_file(project_id, requirement_id)
        file_path.write_text(json.dumps(history, ensure_ascii=False, indent=2), encoding="utf-8")
    except (ProjectNotFoundError, RequirementNotFoundError):
        pass


def load_worklog(project_id: str, requirement_id: str) -> list[dict[str, str]]:
    """Load persisted chat history for a requirement."""
    try:
        file_path = _worklog_file(project_id, requirement_id)
        if not file_path.exists():
            return []
        data = json.loads(file_path.read_text(encoding="utf-8"))
        if isinstance(data, list):
            return data
        return []
    except (ProjectNotFoundError, RequirementNotFoundError):
        return []
