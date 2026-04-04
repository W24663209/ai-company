from __future__ import annotations

import json
import os
import re
import subprocess
import threading
import uuid
from pathlib import Path
from typing import Optional

from ai_company.core.config import settings
from ai_company.core.exceptions import AICompanyError
from ai_company.services.git_service import get_ssh_env
from ai_company.services.project_service import get_project
from ai_company.services.requirement_service import get_requirement

SSH_DIR = settings.data_dir / "ssh"
_session_locks: dict[str, threading.Lock] = {}


def _get_session_lock(key: str) -> threading.Lock:
    if key not in _session_locks:
        _session_locks[key] = threading.Lock()
    return _session_locks[key]


def _get_sessions_path(project_id: str) -> Path:
    return settings.data_dir / "projects" / project_id / "claude_sessions.json"


def _load_sessions(project_id: str) -> dict[str, str]:
    path = _get_sessions_path(project_id)
    if not path.exists():
        return {}
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return {}


def _save_session(project_id: str, requirement_id: str, session_id: str) -> None:
    path = _get_sessions_path(project_id)
    path.parent.mkdir(parents=True, exist_ok=True)
    data = _load_sessions(project_id)
    data[requirement_id] = session_id
    path.write_text(json.dumps(data, indent=2), encoding="utf-8")


def _clear_session(project_id: str, requirement_id: str) -> None:
    path = _get_sessions_path(project_id)
    if not path.exists():
        return
    data = _load_sessions(project_id)
    data.pop(requirement_id, None)
    path.write_text(json.dumps(data, indent=2), encoding="utf-8")


def _get_claude_settings_path(project) -> Optional[str]:
    if not project.claude_settings or not project.claude_settings.strip():
        return None
    settings_dir = settings.data_dir / "projects" / project.id
    settings_dir.mkdir(parents=True, exist_ok=True)
    settings_path = settings_dir / "claude-settings.json"
    settings_path.write_text(project.claude_settings.strip(), encoding="utf-8")
    return str(settings_path)


def _build_system_prompt(project_id: str, requirement_id: str) -> str:
    project = get_project(project_id)
    req = get_requirement(project.id, requirement_id)
    memory_section = f"\nProject Memory:\n{project.memory}\n" if project.memory else ""
    roles_section = f"\nAgent Roles & Responsibilities:\n{project.agent_roles}\n" if project.agent_roles else ""
    prompt = f"""You are an AI software engineer working on a project managed by AI Company.

Project: {project.name}
Project Path: {project.path}
Project Type: {project.type.value}
{memory_section}{roles_section}
Requirement #{req.id}: {req.title}
Status: {req.status.value}
Priority: {req.priority}

Description:
{req.description or "(No description provided)"}

Shared Agent Directory (cross-project communication):
- Path: {settings.shared_dir}
- Inbox (read messages from other agents): {settings.shared_dir}/inbox/
- Outbox (write messages to other agents): {settings.shared_dir}/outbox/
- Artifacts (place completion notes, shared schemas, etc.): {settings.shared_dir}/artifacts/
- Registry (discover other agents or services): {settings.shared_dir}/registry/

YOU HAVE FULL PERMISSION to:
1. Read and write files in the project directory: {project.path}
2. Read and write files in the shared directory: {settings.shared_dir}
3. Execute git commands including commit, push, pull (SSH keys are configured)
4. Run build commands and scripts

Instructions:
- Work inside the project path above.
- **You have FULL AUTONOMY** - Execute git commands (fetch, pull, commit, push), builds, and any other commands directly WITHOUT asking for approval.
- **Actively use the shared directory** to communicate with other agents across projects.
  - If you need help or context from another agent, write a clear message to `{settings.shared_dir}/outbox/`.
  - Before starting work, check `{settings.shared_dir}/inbox/` to see if any agent has left instructions for you.
  - After completing this requirement, write a summary to `{settings.shared_dir}/artifacts/{req.id}_done.json`.
- Use Plan Mode for complex changes if appropriate.
- Do not modify files outside the project path or the shared directory unless explicitly required.
"""
    return prompt


def launch_claude(
    project_id: str,
    requirement_id: str,
    working_dir: Optional[str] = None,
) -> subprocess.Popen:
    project = get_project(project_id)
    cwd = working_dir or project.path
    prompt = _build_system_prompt(project.id, requirement_id)

    # Merge SSH environment variables for git operations
    env = get_ssh_env()
    env["AI_COMPANY_SHARED_DIR"] = str(settings.shared_dir)
    env["AI_COMPANY_PROJECT_ID"] = project.id
    # Support for third-party API endpoints (OpenRouter, etc.)
    if os.environ.get("ANTHROPIC_API_KEY"):
        env["ANTHROPIC_API_KEY"] = os.environ["ANTHROPIC_API_KEY"]
    if os.environ.get("ANTHROPIC_BASE_URL"):
        env["ANTHROPIC_BASE_URL"] = os.environ["ANTHROPIC_BASE_URL"]
    if os.environ.get("OPENROUTER_API_KEY"):
        env["OPENROUTER_API_KEY"] = os.environ["OPENROUTER_API_KEY"]
    if os.environ.get("CLAUDE_API_KEY"):
        env["CLAUDE_API_KEY"] = os.environ["CLAUDE_API_KEY"]

    try:
        claude_cmd = [
            settings.claude_bin,
            "--permission-mode", "bypassPermissions",
        ]
        settings_path = _get_claude_settings_path(project)
        if settings_path:
            claude_cmd.extend(["--settings", settings_path])
        process = subprocess.Popen(
            claude_cmd,
            cwd=cwd,
            env=env,
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
        )
        if process.stdin:
            process.stdin.write(prompt + "\n")
            process.stdin.flush()
        return process
    except FileNotFoundError as exc:
        raise AICompanyError(
            f"Claude CLI not found at '{settings.claude_bin}'. Is Claude Code installed?"
        ) from exc


def _run_claude(
    claude_cmd: list[str],
    prompt: str,
    cwd: str,
    env: dict[str, str],
) -> dict[str, str | int]:
    # Run Claude directly (container now runs as non-root user)
    result = subprocess.run(
        claude_cmd,
        input=prompt,
        cwd=cwd,
        env=env,
        capture_output=True,
        text=True,
        timeout=600,
    )
    return {
        "stdout": result.stdout,
        "stderr": result.stderr,
        "returncode": result.returncode,
    }


def chat(
    project_id: str,
    requirement_id: str,
    message: str,
    working_dir: Optional[str] = None,
    history: list[dict[str, str]] | None = None,  # kept for backward compat, ignored
) -> dict[str, str | int]:
    """Send a message to Claude using persistent session via --resume to avoid full-history duplication."""
    project = get_project(project_id)
    cwd = working_dir or project.path

    session_key = f"{project_id}:{requirement_id}"
    lock = _get_session_lock(session_key)

    sessions = _load_sessions(project_id)
    existing_session = sessions.get(requirement_id)

    # Use SSH-enabled environment for git operations
    env = get_ssh_env()
    env["AI_COMPANY_SHARED_DIR"] = str(settings.shared_dir)
    env["AI_COMPANY_PROJECT_ID"] = project.id
    # Support for third-party API endpoints
    if os.environ.get("ANTHROPIC_API_KEY"):
        env["ANTHROPIC_API_KEY"] = os.environ["ANTHROPIC_API_KEY"]
    if os.environ.get("ANTHROPIC_BASE_URL"):
        env["ANTHROPIC_BASE_URL"] = os.environ["ANTHROPIC_BASE_URL"]
    if os.environ.get("OPENROUTER_API_KEY"):
        env["OPENROUTER_API_KEY"] = os.environ["OPENROUTER_API_KEY"]
    if os.environ.get("CLAUDE_API_KEY"):
        env["CLAUDE_API_KEY"] = os.environ["CLAUDE_API_KEY"]

    settings_path = _get_claude_settings_path(project)

    def make_cmd(session_id: str | None, is_resume: bool) -> list[str]:
        cmd = [
            settings.claude_bin,
            "-p",
            "--print",
            "--output-format",
            "text",
            "--permission-mode",
            "bypassPermissions",
        ]
        if settings_path:
            cmd.extend(["--settings", settings_path])
        if is_resume and session_id:
            cmd.extend(["--resume", session_id])
        elif session_id:
            cmd.extend(["--session-id", session_id])
        return cmd

    with lock:
        if existing_session:
            # Resume existing session; just pass the user message
            cmd = make_cmd(existing_session, is_resume=True)
            result = _run_claude(cmd, message, cwd, env)

            # Handle stale / missing session gracefully
            stderr = result.get("stderr", "")
            if result["returncode"] != 0 and (
                "No conversation found" in stderr or "not found" in stderr
            ):
                existing_session = None
                _clear_session(project_id, requirement_id)

        if not existing_session:
            # Start new session with full system prompt
            new_session = str(uuid.uuid4())
            prompt = _build_system_prompt(project_id, requirement_id) + f"\n[USER]\n{message}\n"
            cmd = make_cmd(new_session, is_resume=False)
            result = _run_claude(cmd, prompt, cwd, env)

            # If session ID collided (rare), retry once with a fresh UUID
            if result["returncode"] != 0 and "already in use" in result.get("stderr", ""):
                new_session = str(uuid.uuid4())
                cmd = make_cmd(new_session, is_resume=False)
                result = _run_claude(cmd, prompt, cwd, env)

            if result["returncode"] == 0:
                _save_session(project_id, requirement_id, new_session)

    if result["returncode"] != 0:
        # Strip noisy ANSI sequences from stderr before surfacing
        clean_stderr = re.sub(r"\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])", "", result.get("stderr", ""))
        raise AICompanyError(clean_stderr or "Claude exited with an error")

    return result
