from __future__ import annotations

import os
import shutil
import subprocess
from pathlib import Path
from typing import Optional

from ai_company.core.config import settings
from ai_company.core.exceptions import BuildError


def discover_python(version: str) -> Optional[str]:
    """Return Python executable path for requested version (e.g., 3.9, 3.10, 3.11, 3.12)."""
    # Try version-specific names first
    version_clean = version.replace(".", "")
    candidates = [
        f"python{version}",  # python3.11
        f"python{version_clean}",  # python311
        f"py -{version}",  # Windows py launcher
    ]

    # Add common paths for macOS/Homebrew
    if os.path.exists(f"/opt/homebrew/bin/python{version}"):
        return f"/opt/homebrew/bin/python{version}"
    if os.path.exists(f"/usr/local/bin/python{version}"):
        return f"/usr/local/bin/python{version}"

    # Check pyenv
    pyenv_root = os.environ.get("PYENV_ROOT", os.path.expanduser("~/.pyenv"))
    pyenv_python = os.path.join(pyenv_root, "versions", version, "bin", "python")
    if os.path.exists(pyenv_python):
        return pyenv_python

    # Try conda
    conda_root = os.environ.get("CONDA_ROOT", os.path.expanduser("~/anaconda3"))
    conda_python = os.path.join(conda_root, "envs", f"python{version_clean}", "bin", "python")
    if os.path.exists(conda_python):
        return conda_python

    # Fallback: try to find in PATH
    for candidate in candidates:
        found = shutil.which(candidate)
        if found:
            return found

    # Last resort: check if system python matches version
    system_python = shutil.which("python3") or shutil.which("python")
    if system_python:
        try:
            result = subprocess.run(
                [system_python, "--version"],
                capture_output=True,
                text=True,
                timeout=5
            )
            if version in result.stdout:
                return system_python
        except:
            pass

    return None


def build(
    project_path: str,
    command: Optional[list[str]] = None,
    python_version: str = "3.11",
    env: Optional[dict[str, str]] = None,
    working_dir: Optional[str] = None,
) -> tuple[int, str, str]:
    """Build Python project using specified Python version."""
    python_exe = discover_python(python_version)
    if not python_exe:
        raise BuildError(f"Python {python_version} not found. Please install it or use pyenv/conda.")

    cwd = Path(working_dir) if working_dir else Path(project_path)
    if not cwd.exists():
        raise BuildError(f"Working directory does not exist: {cwd}")

    # Determine build command
    cmd = command or []
    if not cmd:
        # Auto-detect build command based on project files
        if (cwd / "pyproject.toml").exists():
            cmd = [python_exe, "-m", "pip", "install", "-e", "."]
        elif (cwd / "setup.py").exists():
            cmd = [python_exe, "setup.py", "install"]
        elif (cwd / "requirements.txt").exists():
            cmd = [python_exe, "-m", "pip", "install", "-r", "requirements.txt"]
        elif (cwd / "Pipfile").exists():
            pipenv = shutil.which("pipenv")
            if pipenv:
                cmd = [pipenv, "install"]
            else:
                cmd = [python_exe, "-m", "pip", "install", "pipenv", "&&", "pipenv", "install"]
        elif (cwd / "poetry.lock").exists() or (cwd / "pyproject.toml").exists():
            poetry = shutil.which("poetry")
            if poetry:
                cmd = [poetry, "install"]
            else:
                cmd = [python_exe, "-m", "pip", "install", "poetry", "&&", "poetry", "install"]
        else:
            # Default: just check syntax
            cmd = [python_exe, "-m", "py_compile", "*.py"]

    build_env = os.environ.copy()
    if env:
        build_env.update(env)

    # Set Python-specific env vars
    build_env["PYTHON"] = python_exe
    build_env["PYTHON_VERSION"] = python_version

    # Run build
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


def run_tests(
    project_path: str,
    python_version: str = "3.11",
    test_path: Optional[str] = None,
    env: Optional[dict[str, str]] = None,
) -> tuple[int, str, str]:
    """Run Python tests using pytest or unittest."""
    python_exe = discover_python(python_version)
    if not python_exe:
        raise BuildError(f"Python {python_version} not found.")

    cwd = Path(project_path)

    # Determine test command
    cmd = [python_exe, "-m"]

    if (cwd / "pytest.ini").exists() or (cwd / "pyproject.toml").exists():
        cmd.extend(["pytest", "-v"])
    elif (cwd / "tox.ini").exists():
        cmd = ["tox"]
    else:
        cmd.extend(["unittest", "discover", "-v"])

    if test_path:
        cmd.append(test_path)

    build_env = os.environ.copy()
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


def get_python_versions() -> list[dict]:
    """Return list of available Python versions."""
    versions = ["3.8", "3.9", "3.10", "3.11", "3.12"]
    result = []
    for v in versions:
        exe = discover_python(v)
        result.append({
            "version": v,
            "available": exe is not None,
            "path": exe
        })
    return result
