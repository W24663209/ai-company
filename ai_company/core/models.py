from __future__ import annotations

import uuid
from datetime import datetime
from enum import Enum
from pathlib import Path
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field


class ProjectType(str, Enum):
    JAVA = "java"
    NODE = "node"
    MIXED = "mixed"


class RequirementStatus(str, Enum):
    PENDING = "pending"
    IN_PROGRESS = "in_progress"
    DONE = "done"


class BuildTool(str, Enum):
    MAVEN = "maven"
    NPM = "npm"
    PNPM = "pnpm"


class Project(BaseModel):
    model_config = ConfigDict(extra="ignore")

    id: str = Field(default_factory=lambda: str(uuid.uuid4())[:8])
    name: str
    path: str
    type: ProjectType
    created_at: datetime = Field(default_factory=datetime.utcnow)
    config: dict[str, Any] = Field(default_factory=dict)
    memory: str = ""
    agent_roles: str = ""
    claude_settings: str = ""
    scripts: list[dict[str, str]] = Field(default_factory=list)
    env: dict[str, str] = Field(default_factory=dict)


class Requirement(BaseModel):
    model_config = ConfigDict(extra="ignore")

    id: str = Field(default_factory=lambda: str(uuid.uuid4())[:8])
    project_id: str
    title: str
    description: str = ""
    status: RequirementStatus = RequirementStatus.PENDING
    priority: int = 3  # 1= highest
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)


class BuildConfig(BaseModel):
    model_config = ConfigDict(extra="ignore")

    tool: BuildTool
    version_constraint: str = ""
    commands: list[str] = Field(default_factory=list)
    env: dict[str, str] = Field(default_factory=dict)


class AgentMessage(BaseModel):
    model_config = ConfigDict(extra="ignore")

    id: str = Field(default_factory=lambda: str(uuid.uuid4())[:8])
    sender: str
    recipient: str = "*"  # * = broadcast
    project_id: str = ""
    payload: dict[str, Any] = Field(default_factory=dict)
    timestamp: datetime = Field(default_factory=datetime.utcnow)


class AgentPresence(BaseModel):
    model_config = ConfigDict(extra="ignore")

    agent_name: str
    project_id: str = ""
    status: Literal["idle", "working", "done", "error"] = "idle"
    updated_at: datetime = Field(default_factory=datetime.utcnow)
