from __future__ import annotations

import os
import shutil
import subprocess
from pathlib import Path
from typing import Optional

from ai_company.core.config import settings
from ai_company.core.exceptions import BuildError


def ensure_pnpm() -> Optional[str]:
    pnpm = shutil.which("pnpm")
    if pnpm:
        return pnpm
    npm = shutil.which("npm")
    if npm:
        subprocess.run([npm, "install", "-g", "pnpm"], check=False)
        return shutil.which("pnpm")
    return None


def build(
    project_path: str,
    command: Optional[list[str]] = None,
    tool: str = "npm",
    node_version: Optional[str] = None,
    env: Optional[dict[str, str]] = None,
) -> tuple[int, str, str]:
    cwd = Path(project_path)
    if not cwd.exists():
        raise BuildError(f"Project path does not exist: {project_path}")

    resolved_tool = shutil.which(tool) or tool
    if tool == "pnpm":
        resolved_tool = ensure_pnpm() or tool

    cmd = command or [resolved_tool, "install"]
    if cmd[0] in ("npm", "pnpm") and resolved_tool:
        cmd[0] = resolved_tool

    build_env = os.environ.copy()
    if env:
        build_env.update(env)

    # If NVM is available and a specific node version is requested,
    # wrap the command in a bash source invocation.
    if node_version and settings.nvm_dir and os.path.isdir(settings.nvm_dir):
        shell_cmd = (
            f'source "{settings.nvm_dir}/nvm.sh" && '
            f'nvm use {node_version} && '
            f'{" ".join(cmd)}'
        )
        process = subprocess.Popen(
            ["bash", "-c", shell_cmd],
            cwd=str(cwd),
            env=build_env,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
        )
    else:
        process = subprocess.Popen(
            cmd,
            cwd=str(cwd),
            env=build_env,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
        )

    stdout, stderr = process.communicate()
    return process.returncode, stdout, stderr
