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


class Skill(BaseModel):
    """Skill/prompt template for AI agents"""
    model_config = ConfigDict(extra="ignore")

    id: str = Field(default_factory=lambda: str(uuid.uuid4())[:8])
    name: str
    description: str = ""
    content: str  # The actual skill content/prompt
    category: str = "general"  # e.g., "coding", "debugging", "analysis", "general"
    tags: list[str] = Field(default_factory=list)
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)


class ProjectSkillBinding(BaseModel):
    """Many-to-many relationship between Project and Skill"""
    model_config = ConfigDict(extra="ignore")

    project_id: str
    skill_id: str
    enabled: bool = True
    priority: int = 5  # 1-10, higher means more important
    added_at: datetime = Field(default_factory=datetime.utcnow)


class ProjectLinkType(str, Enum):
    DEPENDS_ON = "depends_on"  # 依赖于
    DEPENDENCY_OF = "dependency_of"  # 被依赖
    RELATED = "related"  # 相关
    PARENT = "parent"  # 父项目
    CHILD = "child"  # 子项目
    COLLABORATES = "collaborates"  # 协作


class ProjectLink(BaseModel):
    """Link between projects for collaboration"""
    model_config = ConfigDict(extra="ignore")

    id: str = Field(default_factory=lambda: str(uuid.uuid4())[:8])
    source_project_id: str  # 源项目
    target_project_id: str  # 目标项目
    link_type: ProjectLinkType
    description: str = ""  # 链接描述
    auto_route_messages: bool = True  # 是否自动路由消息
    created_at: datetime = Field(default_factory=datetime.utcnow)


class CrossProjectMessage(BaseModel):
    """Message that can be routed between linked projects"""
    model_config = ConfigDict(extra="ignore")

    id: str = Field(default_factory=lambda: str(uuid.uuid4())[:8])
    source_project_id: str
    source_requirement_id: str = ""  # 可选：关联的需求
    target_project_id: str
    target_requirement_id: str = ""  # 可选：目标需求
    sender: str  # 发送者标识
    message_type: Literal["request", "response", "notify", "delegate", "question"]
    subject: str  # 消息主题
    content: str  # 消息内容
    context: dict[str, Any] = Field(default_factory=dict)  # 上下文数据
    status: Literal["pending", "delivered", "read", "processing", "completed", "failed"] = "pending"
    reply_to: str = ""  # 回复哪条消息
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)
