from __future__ import annotations

import os
import shutil
import subprocess
from pathlib import Path
from typing import Optional

from ai_company.core.config import settings
from ai_company.core.exceptions import BuildError


def discover_jdk(version: str) -> Optional[str]:
    """Return JAVA_HOME path for requested version (11 or 17)."""
    if version == "11":
        return settings.java_home_11
    if version == "17":
        return settings.java_home_17
    # Fallback: check current java
    java_bin = shutil.which("java")
    if java_bin:
        return None
    return None


def build(
    project_path: str,
    command: Optional[list[str]] = None,
    jdk_version: str = "17",
    env: Optional[dict[str, str]] = None,
    working_dir: Optional[str] = None,
) -> tuple[int, str, str]:
    java_home = discover_jdk(jdk_version)
    if not java_home:
        # If no specific JDK found, rely on system default but warn
        java_home = os.environ.get("JAVA_HOME", "")

    # Use working_dir if provided, otherwise use project_path
    cwd = Path(working_dir) if working_dir else Path(project_path)
    if not cwd.exists():
        raise BuildError(f"Project path does not exist: {cwd}")

    cmd = command or ["mvn", "clean", "compile"]
    if settings.maven_bin and cmd[0] == "mvn":
        cmd[0] = settings.maven_bin

    build_env = os.environ.copy()
    if java_home:
        build_env["JAVA_HOME"] = java_home
        build_env["PATH"] = f"{java_home}/bin:{build_env['PATH']}"
    if env:
        build_env.update(env)

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
