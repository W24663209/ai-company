from __future__ import annotations

import os
import shutil
import subprocess
import threading
import time
from pathlib import Path
from typing import Optional

from ai_company.core.config import settings
from ai_company.core.exceptions import AICompanyError

SSH_DIR = settings.data_dir / "ssh"

# Simple in-memory clone job tracker
_clone_jobs: dict[str, dict] = {}


def _make_job_id(url: str) -> str:
    import hashlib
    h = hashlib.md5(f"{url}-{time.time()}".encode()).hexdigest()[:12]
    return h


def ensure_ssh_dir() -> Path:
    SSH_DIR.mkdir(parents=True, exist_ok=True)
    return SSH_DIR


def list_ssh_keys() -> list[dict[str, str]]:
    ensure_ssh_dir()
    keys = []
    for pub in sorted(SSH_DIR.glob("*.pub")):
        name = pub.stem
        priv = pub.with_suffix("")
        if priv.exists():
            keys.append({
                "name": name,
                "public_key": pub.read_text(encoding="utf-8").strip(),
            })
    return keys


def generate_ssh_key(name: str, email: str = "ai-company@local") -> dict[str, str]:
    ensure_ssh_dir()
    if not name.replace("_", "").replace("-", "").isalnum():
        raise AICompanyError("Key name must be alphanumeric with _ or - only")

    priv_path = SSH_DIR / name
    pub_path = SSH_DIR / f"{name}.pub"

    if priv_path.exists() or pub_path.exists():
        raise AICompanyError(f"SSH key '{name}' already exists")

    ssh_keygen = shutil.which("ssh-keygen")
    if not ssh_keygen:
        raise AICompanyError("ssh-keygen not found. Please install OpenSSH.")

    result = subprocess.run(
        [
            ssh_keygen,
            "-t", "ed25519",
            "-C", email,
            "-f", str(priv_path),
            "-N", "",
        ],
        capture_output=True,
        text=True,
    )
    if result.returncode != 0:
        raise AICompanyError(f"ssh-keygen failed: {result.stderr}")

    pub_key = pub_path.read_text(encoding="utf-8").strip()
    return {"name": name, "public_key": pub_key}


def delete_ssh_key(name: str) -> bool:
    ensure_ssh_dir()
    priv_path = SSH_DIR / name
    pub_path = SSH_DIR / f"{name}.pub"
    found = False
    for p in (priv_path, pub_path):
        if p.exists():
            p.unlink()
            found = True
    return found


def get_ssh_env() -> dict[str, str]:
    env = os.environ.copy()
    ensure_ssh_dir()
    # Point ssh to our dedicated keys dir via GIT_SSH_COMMAND
    env.setdefault("GIT_SSH_COMMAND", f"ssh -o IdentitiesOnly=yes -o StrictHostKeyChecking=accept-new -F /dev/null -i {SSH_DIR}/%k")
    return env


def _do_clone(job_id: str, url: str, target_path: str, ssh_key_name: Optional[str], branch: Optional[str]) -> None:
    cwd = Path(target_path).parent
    name = Path(target_path).name
    cwd.mkdir(parents=True, exist_ok=True)

    git = shutil.which("git")
    if not git:
        _clone_jobs[job_id]["status"] = "failed"
        _clone_jobs[job_id]["error"] = "git not found"
        return

    # If SSH key is selected but URL is HTTPS, auto-convert to SSH for compatibility
    clone_url = url
    if ssh_key_name and url.startswith("https://github.com/"):
        suffix = url[len("https://github.com/"):]
        if not suffix.endswith(".git"):
            suffix += ".git"
        clone_url = f"git@github.com:{suffix}"
    elif ssh_key_name and url.startswith("https://"):
        # Warn fallback: we can't auto-convert arbitrary hosts easily
        pass

    env = os.environ.copy()
    ensure_ssh_dir()
    if ssh_key_name:
        key_path = SSH_DIR / ssh_key_name
        if key_path.exists():
            env["GIT_SSH_COMMAND"] = (
                f"ssh -o IdentitiesOnly=yes -o StrictHostKeyChecking=accept-new -F /dev/null -i {key_path}"
            )
    else:
        env["GIT_SSH_COMMAND"] = (
            f"ssh -o IdentitiesOnly=yes -o StrictHostKeyChecking=accept-new -F /dev/null"
        )

    cmd = [git, "clone", "--depth", "1", clone_url, str(name)]
    if branch:
        cmd.extend(["--branch", branch])

    process = subprocess.Popen(
        cmd,
        cwd=str(cwd),
        env=env,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
    )
    stdout, stderr = process.communicate()

    job = _clone_jobs.get(job_id)
    if not job:
        return
    if process.returncode != 0:
        job["status"] = "failed"
        job["error"] = stderr or stdout or "git clone failed"
    else:
        job["status"] = "success"
        job["stdout"] = stdout
        job["stderr"] = stderr


def start_clone(
    url: str,
    target_path: str,
    ssh_key_name: Optional[str] = None,
    branch: Optional[str] = None,
) -> str:
    job_id = _make_job_id(url)
    _clone_jobs[job_id] = {
        "id": job_id,
        "url": url,
        "target_path": target_path,
        "status": "running",
        "created_at": time.time(),
    }
    t = threading.Thread(
        target=_do_clone,
        args=(job_id, url, target_path, ssh_key_name, branch),
        daemon=True,
    )
    t.start()
    return job_id


def get_clone_status(job_id: str) -> dict | None:
    return _clone_jobs.get(job_id)


def clone_repository(
    url: str,
    target_path: str,
    ssh_key_name: Optional[str] = None,
    branch: Optional[str] = None,
) -> dict[str, str]:
    job_id = start_clone(url, target_path, ssh_key_name, branch)
    # Wait up to 60 seconds for quick clones
    for _ in range(60):
        time.sleep(1)
        job = get_clone_status(job_id)
        if not job or job["status"] != "running":
            break
    job = get_clone_status(job_id)
    if not job:
        return {"path": str(target_path), "status": "unknown"}
    if job["status"] == "failed":
        raise AICompanyError(job.get("error", "git clone failed"))
    return {"path": str(target_path), "status": job["status"], "stdout": job.get("stdout", ""), "stderr": job.get("stderr", "")}
