from __future__ import annotations

import asyncio
import fcntl
import json
import os
import pty
import signal
import struct
import termios
from pathlib import Path

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from ai_company.core.config import settings
from ai_company.services.build_service import get_active_environment, get_runtime_version
from ai_company.services.project_service import get_project

router = APIRouter()


def _set_winsize(fd: int, rows: int, cols: int) -> None:
    try:
        winsize = struct.pack("HHHH", rows, cols, 0, 0)
        fcntl.ioctl(fd, termios.TIOCSWINSZ, winsize)
    except Exception:
        pass


def _resolve_cwd(project_path: str, build_dir: str = "") -> str:
    """Resolve working directory, considering build_dir from environment config."""
    # Start with project path
    base_path = Path(project_path)

    # If build_dir specified, append it
    if build_dir:
        build_path = base_path / build_dir
        if build_path.exists():
            base_path = build_path

    if base_path.exists() and base_path.is_dir():
        return str(base_path)

    # Docker case: host absolute path mapped under /app
    if str(project_path).startswith("/Users/") or str(project_path).startswith("/home/"):
        parts = Path(project_path).parts
        if len(parts) >= 4:
            # e.g. /Users/week/PycharmProjects/ai-company/workspace/demo -> /app/workspace/demo
            rel = Path(*parts[3:])  # skip /Users/<user>/<dir>
            candidate = Path("/app") / rel.relative_to(rel.parts[0]) if rel.parts else Path("/app")
            # More robust: just remap by aligning workspace/data/shared names
            for anchor in ("workspace", "data", "shared"):
                if anchor in parts:
                    idx = parts.index(anchor)
                    candidate = Path("/app") / Path(*parts[idx:])
                    if candidate.exists():
                        # Append build_dir if specified
                        if build_dir:
                            build_candidate = candidate / build_dir
                            if build_candidate.exists():
                                return str(build_candidate)
                        return str(candidate)
    return str(Path("/app/workspace"))


@router.websocket("/terminal/{project_id}")
async def terminal_ws(websocket: WebSocket, project_id: str) -> None:
    await websocket.accept()
    project = get_project(project_id)

    # Get active environment configuration
    env_config = get_active_environment(project)

    # Get runtime versions from environment (query params override environment config)
    java_version = websocket.query_params.get("java_version") or get_runtime_version(env_config, "java")
    node_version = websocket.query_params.get("node_version") or get_runtime_version(env_config, "node")
    python_version = websocket.query_params.get("python_version") or get_runtime_version(env_config, "python")

    # Get build directory from environment
    build_dir = env_config.build_dir if hasattr(env_config, 'build_dir') else env_config.get("build_dir", "")

    # Resolve working directory
    cwd = _resolve_cwd(project.path, build_dir)
    if not Path(cwd).exists():
        await websocket.send_text(f"\r\n[错误] 项目路径不存在: {project.path}\r\n")
        await websocket.close()
        return

    shell = "/bin/zsh" if os.path.exists("/bin/zsh") else "/bin/bash"
    master_fd, slave_fd = pty.openpty()
    pid = os.fork()

    if pid == 0:
        # Child process
        os.close(master_fd)
        os.setsid()
        os.dup2(slave_fd, 0)
        os.dup2(slave_fd, 1)
        os.dup2(slave_fd, 2)
        os.chdir(cwd)
        env = os.environ.copy()
        env["TERM"] = "xterm-256color"
        # Set HOME and default PATH
        env["HOME"] = "/home/claudeuser"
        env["PATH"] = "/home/claudeuser/.local/bin:/home/claudeuser/.nvm/versions/node/v24.14.1/bin:/home/claudeuser/.sdkman/candidates/java/current/bin:/usr/local/bin:/usr/bin:/bin"
        # Source nvm and sdkman in environment
        env["NVM_DIR"] = "/home/claudeuser/.nvm"
        env["SDKMAN_DIR"] = "/home/claudeuser/.sdkman"

        # Merge project.env and environment.env_vars (environment takes precedence)
        if project.env:
            env.update(project.env)
        env_vars = env_config.env_vars if hasattr(env_config, 'env_vars') else env_config.get("env_vars", {})
        if env_vars:
            env.update(env_vars)

        # Set runtime versions from environment config
        if java_version:
            if java_version == "11" and settings.java_home_11:
                env["JAVA_HOME"] = settings.java_home_11
            elif java_version == "17" and settings.java_home_17:
                env["JAVA_HOME"] = settings.java_home_17
            if env.get("JAVA_HOME"):
                env["PATH"] = f"{env['JAVA_HOME']}/bin:{env['PATH']}"

        if node_version:
            env["NODE_VERSION"] = node_version
            # Set NVM to use specific node version
            nvm_node_path = f"/home/claudeuser/.nvm/versions/node/v{node_version}.0.0/bin"
            if Path(nvm_node_path).exists():
                env["PATH"] = f"{nvm_node_path}:{env['PATH']}"

        if python_version:
            env["PYTHON_VERSION"] = python_version

        # Start shell as login shell to load .bash_profile
        os.execle(shell, shell, "-l", env)
    else:
        os.close(slave_fd)
        fl = fcntl.fcntl(master_fd, fcntl.F_GETFL)
        fcntl.fcntl(master_fd, fcntl.F_SETFL, fl | os.O_NONBLOCK)

        loop = asyncio.get_event_loop()

        # WebSocket keepalive
        keepalive_task = None
        async def keepalive() -> None:
            while True:
                try:
                    await asyncio.sleep(30)
                    await websocket.send_text("")
                except Exception:
                    break

        async def reader() -> None:
            while True:
                try:
                    data = await loop.run_in_executor(None, lambda: os.read(master_fd, 8192))
                    if not data:
                        break
                    text = data.decode("utf-8", errors="replace")
                    await websocket.send_text(text)
                except BlockingIOError:
                    await asyncio.sleep(0.05)
                except OSError:
                    break

        async def writer() -> None:
            while True:
                try:
                    msg = await websocket.receive_text()
                    try:
                        payload = json.loads(msg)
                        if payload.get("type") == "resize":
                            _set_winsize(master_fd, int(payload.get("rows", 24)), int(payload.get("cols", 80)))
                            continue
                    except json.JSONDecodeError:
                        pass
                    os.write(master_fd, msg.encode("utf-8"))
                except WebSocketDisconnect:
                    break
                except Exception:
                    break

        read_task = asyncio.create_task(reader())
        write_task = asyncio.create_task(writer())
        keepalive_task = asyncio.create_task(keepalive())

        try:
            await asyncio.gather(read_task, write_task)
        except WebSocketDisconnect:
            pass
        finally:
            read_task.cancel()
            write_task.cancel()
            keepalive_task.cancel()
            try:
                os.kill(pid, signal.SIGTERM)
                os.waitpid(pid, os.WNOHANG)
            except (ProcessLookupError, ChildProcessError):
                pass
            try:
                os.close(master_fd)
            except OSError:
                pass
