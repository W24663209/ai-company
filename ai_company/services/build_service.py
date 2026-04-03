from __future__ import annotations

from datetime import datetime
from pathlib import Path

from ai_company.adapters import java_adapter, node_adapter
from ai_company.core.config import settings
from ai_company.core.exceptions import BuildError
from ai_company.core.models import ProjectType
from ai_company.services.project_service import get_project


def build_project(
    project_id: str,
    command: list[str] | None = None,
    jdk_version: str = "17",
    node_version: str | None = None,
    tool: str = "npm",
) -> str:
    project = get_project(project_id)
    log_dir = settings.shared_dir / "artifacts" / "builds" / project.id
    log_dir.mkdir(parents=True, exist_ok=True)
    log_path = log_dir / f"{datetime.utcnow().isoformat()}.log"

    env = project.env or {}
    if project.type == ProjectType.JAVA:
        rc, stdout, stderr = java_adapter.build(
            project.path, command=command, jdk_version=jdk_version, env=env
        )
    elif project.type == ProjectType.NODE:
        rc, stdout, stderr = node_adapter.build(
            project.path, command=command, tool=tool, node_version=node_version, env=env
        )
    elif project.type == ProjectType.MIXED:
        # Default to Java build if no command specified; user can disambiguate later
        rc, stdout, stderr = java_adapter.build(
            project.path, command=command, jdk_version=jdk_version, env=env
        )
    else:
        raise BuildError(f"Unsupported project type: {project.type}")

    log_content = f"COMMAND: {command}\nEXIT CODE: {rc}\n\nSTDOUT:\n{stdout}\n\nSTDERR:\n{stderr}\n"
    log_path.write_text(log_content, encoding="utf-8")

    if rc != 0:
        raise BuildError(f"Build failed (exit code {rc}). Log: {log_path}")

    return str(log_path)
