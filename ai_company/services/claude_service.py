from __future__ import annotations

import os
import subprocess
from pathlib import Path
from typing import Optional

from ai_company.core.config import settings
from ai_company.core.exceptions import AICompanyError
from ai_company.services.project_service import get_project
from ai_company.services.requirement_service import get_requirement


def _get_claude_settings_path(project) -> Optional[str]:
    if not project.claude_settings or not project.claude_settings.strip():
        return None
    settings_dir = settings.data_dir / "projects" / project.id
    settings_dir.mkdir(parents=True, exist_ok=True)
    settings_path = settings_dir / "claude-settings.json"
    settings_path.write_text(project.claude_settings.strip(), encoding="utf-8")
    return str(settings_path)


def generate_prompt(project_id: str, requirement_id: str) -> str:
    project = get_project(project_id)
    req = get_requirement(project.id, requirement_id)
    memory_section = f"\nProject Memory:\n{project.memory}\n" if project.memory else ""
    roles_section = f"\nAgent Roles & Responsibilities:\n{project.agent_roles}\n" if project.agent_roles else ""
    prompt = f"""You are an AI software engineer working on a project managed by AI Company.

Project: {project.name}
Project Path: {project.path}
Project Type: {project.type.value}
Shared Agent Directory: {settings.shared_dir}
{memory_section}{roles_section}
Requirement #{req.id}: {req.title}
Status: {req.status.value}
Priority: {req.priority}

Description:
{req.description or "(No description provided)"}

Instructions:
- Work inside the project path above.
- Read and write agent messages to the shared directory when you need to communicate with other agents:
  - Inbox: {settings.shared_dir}/inbox/
  - Outbox: {settings.shared_dir}/outbox/
- When finished, consider writing a completion note to {settings.shared_dir}/artifacts/{req.id}_done.json summarizing what was done.
- Use Plan Mode for complex changes if appropriate.
- Do not modify files outside the project path unless explicitly required.
"""
    return prompt


def launch_claude(
    project_id: str,
    requirement_id: str,
    working_dir: Optional[str] = None,
) -> subprocess.Popen:
    project = get_project(project_id)
    cwd = working_dir or project.path
    prompt = generate_prompt(project.id, requirement_id)

    claude_cmd = [settings.claude_bin, "--dangerously-skip-permissions"]

    settings_path = _get_claude_settings_path(project)
    if settings_path:
        claude_cmd.extend(["--settings", settings_path])

    env = os.environ.copy()
    env["AI_COMPANY_SHARED_DIR"] = str(settings.shared_dir)
    env["AI_COMPANY_PROJECT_ID"] = project.id

    try:
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


def chat(
    project_id: str,
    requirement_id: str,
    message: str,
    working_dir: Optional[str] = None,
    history: list[dict[str, str]] | None = None,
) -> dict[str, str | int]:
    """Send a message to Claude in non-interactive print mode and return the response."""
    project = get_project(project_id)
    req = get_requirement(project.id, requirement_id)
    cwd = working_dir or project.path

    memory_section = f"\nProject Memory:\n{project.memory}\n" if project.memory else ""
    roles_section = f"\nAgent Roles & Responsibilities:\n{project.agent_roles}\n" if project.agent_roles else ""
    base_prompt = f"""You are an AI software engineer working on a project managed by AI Company.

Project: {project.name}
Project Path: {project.path}
Project Type: {project.type.value}
{memory_section}{roles_section}
Requirement #{req.id}: {req.title}
Status: {req.status.value}
Priority: {req.priority}

Description:
{req.description or "(No description provided)"}

Instructions:
- Work inside the project path above.
- Think step by step and explain your reasoning process before giving the final answer.
- Use Plan Mode for complex changes if appropriate.
- Do not modify files outside the project path unless explicitly required.
- When finished, summarize what you did.
"""

    history_text = ""
    if history:
        for h in history:
            role = h.get("role", "user")
            text = h.get("text", "")
            history_text += f"\n[{role.upper()}]\n{text}\n"

    full_prompt = f"{base_prompt}{history_text}\n[USER]\n{message}\n"

    claude_cmd = [
        settings.claude_bin,
        "-p",
        "--print",
        "--output-format",
        "text",
        "--dangerously-skip-permissions",
    ]

    settings_path = _get_claude_settings_path(project)
    if settings_path:
        claude_cmd.extend(["--settings", settings_path])

    env = os.environ.copy()
    env["AI_COMPANY_SHARED_DIR"] = str(settings.shared_dir)
    env["AI_COMPANY_PROJECT_ID"] = project.id

    try:
        result = subprocess.run(
            claude_cmd,
            input=full_prompt,
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
    except FileNotFoundError as exc:
        raise AICompanyError(
            f"Claude CLI not found at '{settings.claude_bin}'. Is Claude Code installed?"
        ) from exc
    except subprocess.TimeoutExpired:
        raise AICompanyError("Claude response timed out after 10 minutes.")
