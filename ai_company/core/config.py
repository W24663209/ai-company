from __future__ import annotations

import os
import shutil
from pathlib import Path
from typing import Optional

from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    # Base paths
    project_root: Path = Path(__file__).resolve().parent.parent.parent
    data_dir: Path = project_root / "data"
    workspace_root: Path = project_root / "workspace"
    shared_dir: Path = project_root / "shared"

    # Java / Node discovery
    java_home_11: Optional[str] = None
    java_home_17: Optional[str] = None
    maven_bin: Optional[str] = None
    nvm_dir: Optional[str] = None
    node_default_version: str = ""

    # Claude
    claude_bin: str = "claude"

    class Config:
        env_file = ".env"
        env_file_encoding = "utf-8"

    def __init__(self, **kwargs):
        super().__init__(**kwargs)
        self.data_dir.mkdir(parents=True, exist_ok=True)
        self.workspace_root.mkdir(parents=True, exist_ok=True)
        self._ensure_shared_dirs()
        self._detect_toolchains()

    def _ensure_shared_dirs(self):
        for sub in ("inbox", "outbox", "artifacts", "registry"):
            (self.shared_dir / sub).mkdir(parents=True, exist_ok=True)

    def _detect_toolchains(self):
        # Maven
        self.maven_bin = shutil.which("mvn")

        # JDK discovery heuristics for macOS/Linux
        possible_java_roots = [
            "/Library/Java/JavaVirtualMachines",
            "/usr/lib/jvm",
            os.path.expanduser("~/server"),
            os.path.expanduser("~/.sdkman/candidates/java"),
        ]
        for root in possible_java_roots:
            base = Path(root)
            if not base.exists():
                continue
            # macOS style: Contents/Home nested inside .app or jdk dir
            for entry in base.rglob("Contents/Home"):
                if "jdk-11" in str(entry) or "11.0" in str(entry):
                    self.java_home_11 = str(entry)
                if "jdk-17" in str(entry) or "17.0" in str(entry):
                    self.java_home_17 = str(entry)
            # Linux style: direct subdirectories that contain bin/java
            for entry in base.iterdir():
                if not entry.is_dir():
                    continue
                java_bin = entry / "bin" / "java"
                if not java_bin.exists():
                    continue
                name = entry.name.lower()
                if ("11" in name or "jdk-11" in name) and not self.java_home_11:
                    self.java_home_11 = str(entry)
                if ("17" in name or "jdk-17" in name) and not self.java_home_17:
                    self.java_home_17 = str(entry)

        # Node / NVM
        nvm_path = os.path.expanduser("~/.nvm")
        if os.path.isdir(nvm_path):
            self.nvm_dir = nvm_path

        # Try to infer default node version from current env
        node_bin = shutil.which("node")
        if node_bin:
            self.node_default_version = ""


settings = Settings()
