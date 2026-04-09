from __future__ import annotations

from datetime import datetime
from pathlib import Path

from ai_company.adapters import java_adapter, node_adapter, python_adapter
from ai_company.core.config import settings
from ai_company.core.exceptions import BuildError
from ai_company.core.models import ProjectType
from ai_company.services.project_service import get_project


def get_active_environment(project) -> dict:
    """Get the currently active environment for a project as a dict."""
    env_name = project.active_environment or "default"
    environments = project.environments or []

    for env in environments:
        if env.name == env_name:
            # Convert Pydantic model to dict
            return env.model_dump() if hasattr(env, 'model_dump') else env

    # Return default if not found
    return {
        "name": "default",
        "runtime_versions": [],
        "env_vars": {},
        "build_dir": "",
        "build_commands": [],
        "active": True
    }


def get_runtime_version(env: dict, runtime: str) -> str | None:
    """Get the version for a specific runtime from environment config."""
    for rv in env.get("runtime_versions", []):
        if rv.get("runtime") == runtime:
            return rv.get("version")
    return None


def build_project(
    project_id: str,
    command: list[str] | None = None,
    jdk_version: str | None = None,
    node_version: str | None = None,
    python_version: str | None = None,
    tool: str = "npm",
) -> str:
    project = get_project(project_id)
    log_dir = settings.shared_dir / "artifacts" / "builds" / project.id
    log_dir.mkdir(parents=True, exist_ok=True)
    log_path = log_dir / f"{datetime.utcnow().isoformat()}.log"

    # Get active environment configuration
    env_config = get_active_environment(project)

    # Merge environment variables (project.env + environment.env_vars)
    env = {**(project.env or {}), **(env_config.get("env_vars") or {})}

    # Get build directory from environment
    build_dir = env_config.get("build_dir", "")
    working_dir = str(Path(project.path) / build_dir) if build_dir else project.path

    # Get runtime versions from environment (fallback to provided values or defaults)
    if jdk_version is None:
        jdk_version = get_runtime_version(env_config, "java") or "17"
    if node_version is None:
        node_version = get_runtime_version(env_config, "node")
    if python_version is None:
        python_version = get_runtime_version(env_config, "python") or "3.11"

    # Use custom commands from environment if no command provided
    if command is None:
        env_commands = env_config.get("build_commands", [])
        if env_commands:
            # Use first build command from environment
            command = env_commands[0].split()

    if project.type == ProjectType.JAVA:
        rc, stdout, stderr = java_adapter.build(
            project.path, command=command, jdk_version=jdk_version, env=env, working_dir=working_dir
        )
    elif project.type == ProjectType.NODE:
        rc, stdout, stderr = node_adapter.build(
            project.path, command=command, tool=tool, node_version=node_version, env=env, working_dir=working_dir
        )
    elif project.type == ProjectType.PYTHON:
        rc, stdout, stderr = python_adapter.build(
            project.path, command=command, python_version=python_version, env=env, working_dir=working_dir
        )
    elif project.type == ProjectType.MIXED:
        # Auto-detect based on files present in working directory
        work_path = Path(working_dir)
        if (work_path / "pom.xml").exists() or (work_path / "build.gradle").exists():
            rc, stdout, stderr = java_adapter.build(
                project.path, command=command, jdk_version=jdk_version, env=env, working_dir=working_dir
            )
        elif (work_path / "package.json").exists():
            rc, stdout, stderr = node_adapter.build(
                project.path, command=command, tool=tool, node_version=node_version, env=env, working_dir=working_dir
            )
        elif (work_path / "requirements.txt").exists() or (work_path / "pyproject.toml").exists():
            rc, stdout, stderr = python_adapter.build(
                project.path, command=command, python_version=python_version, env=env, working_dir=working_dir
            )
        else:
            # Default to Java build
            rc, stdout, stderr = java_adapter.build(
                project.path, command=command, jdk_version=jdk_version, env=env, working_dir=working_dir
            )
    else:
        raise BuildError(f"Unsupported project type: {project.type}")

    log_content = f"COMMAND: {command}\nEXIT CODE: {rc}\n\nSTDOUT:\n{stdout}\n\nSTDERR:\n{stderr}\n"
    log_path.write_text(log_content, encoding="utf-8")

    if rc != 0:
        raise BuildError(f"Build failed (exit code {rc}). Log: {log_path}")

    return str(log_path)
