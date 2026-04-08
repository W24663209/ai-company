"""Agent message service for tracking AI agent communications and code reviews"""
from __future__ import annotations

import json
import uuid
from datetime import datetime
from pathlib import Path
from typing import Optional
from enum import Enum

from ai_company.core.config import settings
from ai_company.core.exceptions import AICompanyError

AGENT_MESSAGES_FILE = settings.data_dir / "agent_messages.json"


class AgentMessageType(str, Enum):
    REVIEW = "review"           # Code review from PM agent
    COMMUNICATION = "communication"  # Agent-to-agent communication
    DECISION = "decision"       # Architecture/implementation decision
    ALERT = "alert"            # Warning or error from agent
    SUMMARY = "summary"        # Work completion summary


class AgentMessage:
    def __init__(
        self,
        id: str = None,
        project_id: str = "",
        requirement_id: str = "",
        sender: str = "",           # Agent name/role
        receiver: str = "",         # Target agent or "all"
        message_type: str = "communication",
        subject: str = "",
        content: str = "",
        context: dict = None,       # Additional data (files, diffs, etc.)
        parent_id: str = "",        # For threaded conversations
        created_at: str = None
    ):
        self.id = id or str(uuid.uuid4())[:12]
        self.project_id = project_id
        self.requirement_id = requirement_id
        self.sender = sender
        self.receiver = receiver
        self.message_type = message_type
        self.subject = subject
        self.content = content
        self.context = context or {}
        self.parent_id = parent_id
        self.created_at = created_at or datetime.utcnow().isoformat()

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "project_id": self.project_id,
            "requirement_id": self.requirement_id,
            "sender": self.sender,
            "receiver": self.receiver,
            "message_type": self.message_type,
            "subject": self.subject,
            "content": self.content,
            "context": self.context,
            "parent_id": self.parent_id,
            "created_at": self.created_at
        }

    @classmethod
    def from_dict(cls, data: dict) -> AgentMessage:
        return cls(**data)


def _load_messages() -> dict[str, AgentMessage]:
    """Load all agent messages from disk"""
    if not AGENT_MESSAGES_FILE.exists():
        return {}
    try:
        data = json.loads(AGENT_MESSAGES_FILE.read_text(encoding="utf-8"))
        return {k: AgentMessage.from_dict(v) for k, v in data.items()}
    except Exception:
        return {}


def _save_messages(messages: dict[str, AgentMessage]) -> None:
    """Save all agent messages to disk"""
    AGENT_MESSAGES_FILE.parent.mkdir(parents=True, exist_ok=True)
    data = {k: v.to_dict() for k, v in messages.items()}
    AGENT_MESSAGES_FILE.write_text(json.dumps(data, indent=2, default=str), encoding="utf-8")


# CRUD operations

def create_message(
    project_id: str,
    requirement_id: str,
    sender: str,
    content: str,
    message_type: str = "communication",
    subject: str = "",
    receiver: str = "",
    context: dict = None,
    parent_id: str = ""
) -> AgentMessage:
    """Create a new agent message"""
    messages = _load_messages()

    message = AgentMessage(
        project_id=project_id,
        requirement_id=requirement_id,
        sender=sender,
        receiver=receiver,
        message_type=message_type,
        subject=subject or f"{message_type.upper()} from {sender}",
        content=content,
        context=context or {},
        parent_id=parent_id
    )

    messages[message.id] = message
    _save_messages(messages)
    return message


def get_message(message_id: str) -> Optional[AgentMessage]:
    """Get a message by ID"""
    messages = _load_messages()
    return messages.get(message_id)


def list_messages(
    project_id: str = None,
    requirement_id: str = None,
    message_type: str = None,
    sender: str = None,
    limit: int = 100
) -> list[AgentMessage]:
    """List agent messages with filters"""
    messages = _load_messages()
    result = list(messages.values())

    if project_id:
        result = [m for m in result if m.project_id == project_id]

    if requirement_id:
        result = [m for m in result if m.requirement_id == requirement_id]

    if message_type:
        result = [m for m in result if m.message_type == message_type]

    if sender:
        result = [m for m in result if m.sender == sender]

    # Sort by created_at descending
    result = sorted(result, key=lambda m: m.created_at, reverse=True)

    return result[:limit]


def get_conversation_thread(requirement_id: str) -> list[AgentMessage]:
    """Get all messages for a specific requirement (conversation thread)"""
    messages = list_messages(requirement_id=requirement_id, limit=1000)
    return sorted(messages, key=lambda m: m.created_at)


def delete_message(message_id: str) -> bool:
    """Delete a message"""
    messages = _load_messages()
    if message_id not in messages:
        return False

    del messages[message_id]
    _save_messages(messages)
    return True


def delete_project_messages(project_id: str) -> int:
    """Delete all messages for a project"""
    messages = _load_messages()
    to_delete = [k for k, v in messages.items() if v.project_id == project_id]

    for k in to_delete:
        del messages[k]

    _save_messages(messages)
    return len(to_delete)


# Helper functions for specific message types

def create_review_message(
    project_id: str,
    requirement_id: str,
    reviewer: str,
    subject: str,
    review_content: str,
    files_reviewed: list[str],
    issues_found: list[dict],
    verdict: str  # "approved", "needs_fix", "rejected"
) -> AgentMessage:
    """Create a code review message from PM agent"""
    context = {
        "files_reviewed": files_reviewed,
        "issues_found": issues_found,
        "verdict": verdict,
        "review_type": "code_review"
    }

    return create_message(
        project_id=project_id,
        requirement_id=requirement_id,
        sender=reviewer,
        receiver="developer",
        message_type="review",
        subject=subject,
        content=review_content,
        context=context
    )


def create_communication_message(
    project_id: str,
    requirement_id: str,
    sender: str,
    receiver: str,
    subject: str,
    content: str,
    related_files: list[str] = None
) -> AgentMessage:
    """Create an agent-to-agent communication message"""
    context = {
        "related_files": related_files or []
    }

    return create_message(
        project_id=project_id,
        requirement_id=requirement_id,
        sender=sender,
        receiver=receiver,
        message_type="communication",
        subject=subject,
        content=content,
        context=context
    )


def create_decision_message(
    project_id: str,
    requirement_id: str,
    agent: str,
    decision: str,
    rationale: str,
    alternatives_considered: list[str]
) -> AgentMessage:
    """Create an architecture/implementation decision message"""
    context = {
        "alternatives_considered": alternatives_considered,
        "decision_type": "architecture"
    }

    content = f"**决策**: {decision}\n\n**理由**: {rationale}"

    return create_message(
        project_id=project_id,
        requirement_id=requirement_id,
        sender=agent,
        message_type="decision",
        subject=f"[决策] {decision[:50]}...",
        content=content,
        context=context
    )


def get_message_stats(project_id: str = None) -> dict:
    """Get statistics about agent messages"""
    messages = list_messages(project_id=project_id, limit=10000)

    stats = {
        "total": len(messages),
        "by_type": {},
        "by_sender": {},
        "by_project": {}
    }

    for msg in messages:
        # By type
        stats["by_type"][msg.message_type] = stats["by_type"].get(msg.message_type, 0) + 1

        # By sender
        stats["by_sender"][msg.sender] = stats["by_sender"].get(msg.sender, 0) + 1

        # By project
        if msg.project_id:
            stats["by_project"][msg.project_id] = stats["by_project"].get(msg.project_id, 0) + 1

    return stats
