"""Project link and cross-project collaboration service"""
from __future__ import annotations

import json
from pathlib import Path
from typing import Optional
from datetime import datetime

from ai_company.core.config import settings
from ai_company.core.models import ProjectLink, ProjectLinkType, CrossProjectMessage

PROJECT_LINKS_FILE = settings.data_dir / "project_links.json"
CROSS_PROJECT_MESSAGES_FILE = settings.data_dir / "cross_project_messages.json"


def _load_project_links() -> dict[str, ProjectLink]:
    """Load all project links from disk"""
    if not PROJECT_LINKS_FILE.exists():
        return {}
    try:
        data = json.loads(PROJECT_LINKS_FILE.read_text(encoding="utf-8"))
        return {k: ProjectLink(**v) for k, v in data.items()}
    except Exception:
        return {}


def _save_project_links(links: dict[str, ProjectLink]) -> None:
    """Save all project links to disk"""
    PROJECT_LINKS_FILE.parent.mkdir(parents=True, exist_ok=True)
    data = {k: v.model_dump() for k, v in links.items()}
    PROJECT_LINKS_FILE.write_text(json.dumps(data, indent=2, default=str), encoding="utf-8")


def _load_cross_project_messages() -> dict[str, CrossProjectMessage]:
    """Load all cross-project messages from disk"""
    if not CROSS_PROJECT_MESSAGES_FILE.exists():
        return {}
    try:
        data = json.loads(CROSS_PROJECT_MESSAGES_FILE.read_text(encoding="utf-8"))
        return {k: CrossProjectMessage(**v) for k, v in data.items()}
    except Exception:
        return {}


def _save_cross_project_messages(messages: dict[str, CrossProjectMessage]) -> None:
    """Save all cross-project messages to disk"""
    CROSS_PROJECT_MESSAGES_FILE.parent.mkdir(parents=True, exist_ok=True)
    data = {k: v.model_dump() for k, v in messages.items()}
    CROSS_PROJECT_MESSAGES_FILE.write_text(json.dumps(data, indent=2, default=str), encoding="utf-8")


# Project Link CRUD operations

def create_project_link(
    source_project_id: str,
    target_project_id: str,
    link_type: ProjectLinkType,
    description: str = "",
    auto_route_messages: bool = True
) -> ProjectLink:
    """Create a link between two projects"""
    if source_project_id == target_project_id:
        raise ValueError("Cannot link a project to itself")

    links = _load_project_links()

    # Check if link already exists
    for link in links.values():
        if (link.source_project_id == source_project_id and
            link.target_project_id == target_project_id and
            link.link_type == link_type):
            return link

    link = ProjectLink(
        source_project_id=source_project_id,
        target_project_id=target_project_id,
        link_type=link_type,
        description=description,
        auto_route_messages=auto_route_messages
    )
    links[link.id] = link
    _save_project_links(links)
    return link


def get_project_link(link_id: str) -> Optional[ProjectLink]:
    """Get a project link by ID"""
    links = _load_project_links()
    return links.get(link_id)


def list_project_links(project_id: str = None) -> list[ProjectLink]:
    """List all project links, optionally filtered by project"""
    links = _load_project_links()
    result = list(links.values())

    if project_id:
        result = [
            link for link in result
            if link.source_project_id == project_id or link.target_project_id == project_id
        ]

    return sorted(result, key=lambda l: l.created_at, reverse=True)


def get_linked_projects(project_id: str) -> list[tuple[ProjectLink, str]]:
    """Get all projects linked to the given project

    Returns list of (link, linked_project_id) tuples
    """
    links = list_project_links(project_id)
    result = []

    for link in links:
        if link.source_project_id == project_id:
            result.append((link, link.target_project_id))
        elif link.target_project_id == project_id:
            result.append((link, link.source_project_id))

    return result


def update_project_link(link_id: str, **kwargs) -> Optional[ProjectLink]:
    """Update a project link"""
    links = _load_project_links()
    link = links.get(link_id)
    if not link:
        return None

    for key, value in kwargs.items():
        if hasattr(link, key):
            setattr(link, key, value)

    links[link_id] = link
    _save_project_links(links)
    return link


def delete_project_link(link_id: str) -> bool:
    """Delete a project link"""
    links = _load_project_links()
    if link_id not in links:
        return False

    del links[link_id]
    _save_project_links(links)
    return True


def get_link_graph(project_id: str = None, depth: int = 2) -> dict:
    """Get the project link graph for visualization

    Returns:
        {
            "nodes": [{"id": "...", "name": "...", "type": "..."}],
            "edges": [{"id": "...", "source": "...", "target": "...", "type": "..."}]
        }
    """
    from ai_company.services.project_service import list_projects, get_project

    links = list_project_links()
    if project_id:
        # Find all related projects up to specified depth
        related_ids = {project_id}
        current_level = {project_id}

        for _ in range(depth):
            next_level = set()
            for link in links:
                if link.source_project_id in current_level:
                    next_level.add(link.target_project_id)
                if link.target_project_id in current_level:
                    next_level.add(link.source_project_id)
            related_ids.update(next_level)
            current_level = next_level

        # Filter links to only include related projects
        links = [
            link for link in links
            if link.source_project_id in related_ids and link.target_project_id in related_ids
        ]
        project_ids = related_ids
    else:
        project_ids = set()
        for link in links:
            project_ids.add(link.source_project_id)
            project_ids.add(link.target_project_id)

    # Build nodes
    nodes = []
    for pid in project_ids:
        project = get_project(pid)
        if project:
            nodes.append({
                "id": pid,
                "name": project.name,
                "type": project.type.value
            })

    # Build edges
    edges = []
    for link in links:
        edges.append({
            "id": link.id,
            "source": link.source_project_id,
            "target": link.target_project_id,
            "type": link.link_type,
            "description": link.description
        })

    return {"nodes": nodes, "edges": edges}


# Cross-project message operations

def create_cross_project_message(
    source_project_id: str,
    target_project_id: str,
    sender: str,
    message_type: str,
    subject: str,
    content: str,
    source_requirement_id: str = "",
    target_requirement_id: str = "",
    context: dict = None,
    reply_to: str = ""
) -> CrossProjectMessage:
    """Create a cross-project message"""
    messages = _load_cross_project_messages()

    message = CrossProjectMessage(
        source_project_id=source_project_id,
        target_project_id=target_project_id,
        source_requirement_id=source_requirement_id,
        target_requirement_id=target_requirement_id,
        sender=sender,
        message_type=message_type,
        subject=subject,
        content=content,
        context=context or {},
        reply_to=reply_to
    )
    messages[message.id] = message
    _save_cross_project_messages(messages)

    # Auto-route to linked projects if configured
    _auto_route_message(message)

    return message


def _auto_route_message(message: CrossProjectMessage) -> None:
    """Auto-route message to projects linked to the target"""
    # Find all projects that auto-route from the target
    links = list_project_links(message.target_project_id)

    for link in links:
        if not link.auto_route_messages:
            continue

        # Determine if we should route through this link
        should_route = False
        next_target = None

        if link.source_project_id == message.target_project_id:
            # Target is the source of this link, route to target
            should_route = True
            next_target = link.target_project_id
        elif link.target_project_id == message.target_project_id:
            # Target is the target of this link, route to source
            should_route = True
            next_target = link.source_project_id

        if should_route and next_target:
            # Create a forwarded message
            forwarded = CrossProjectMessage(
                source_project_id=message.source_project_id,
                target_project_id=next_target,
                source_requirement_id=message.source_requirement_id,
                target_requirement_id=message.target_requirement_id,
                sender=f"{message.sender} (via {message.target_project_id})",
                message_type="notify",
                subject=f"[Forwarded] {message.subject}",
                content=message.content,
                context={**message.context, "original_message_id": message.id, "forwarded_from": message.target_project_id},
                reply_to=message.reply_to
            )
            messages = _load_cross_project_messages()
            messages[forwarded.id] = forwarded
            _save_cross_project_messages(messages)


def get_cross_project_message(message_id: str) -> Optional[CrossProjectMessage]:
    """Get a cross-project message by ID"""
    messages = _load_cross_project_messages()
    return messages.get(message_id)


def list_cross_project_messages(
    project_id: str = None,
    direction: str = "both",  # "in", "out", "both"
    status: str = None,
    message_type: str = None
) -> list[CrossProjectMessage]:
    """List cross-project messages with filters"""
    messages = _load_cross_project_messages()
    result = list(messages.values())

    if project_id:
        if direction == "in":
            result = [m for m in result if m.target_project_id == project_id]
        elif direction == "out":
            result = [m for m in result if m.source_project_id == project_id]
        else:  # both
            result = [
                m for m in result
                if m.source_project_id == project_id or m.target_project_id == project_id
            ]

    if status:
        result = [m for m in result if m.status == status]

    if message_type:
        result = [m for m in result if m.message_type == message_type]

    return sorted(result, key=lambda m: m.created_at, reverse=True)


def update_cross_project_message_status(
    message_id: str,
    status: str
) -> Optional[CrossProjectMessage]:
    """Update message status"""
    messages = _load_cross_project_messages()
    message = messages.get(message_id)
    if not message:
        return None

    message.status = status
    message.updated_at = datetime.utcnow()
    messages[message_id] = message
    _save_cross_project_messages(messages)
    return message


def reply_to_cross_project_message(
    original_message_id: str,
    sender: str,
    content: str
) -> Optional[CrossProjectMessage]:
    """Reply to a cross-project message (swaps source/target)"""
    messages = _load_cross_project_messages()
    original = messages.get(original_message_id)
    if not original:
        return None

    # Create reply (swap source and target)
    reply = CrossProjectMessage(
        source_project_id=original.target_project_id,
        target_project_id=original.source_project_id,
        source_requirement_id=original.target_requirement_id,
        target_requirement_id=original.source_requirement_id,
        sender=sender,
        message_type="response",
        subject=f"Re: {original.subject}",
        content=content,
        reply_to=original_message_id
    )
    messages[reply.id] = reply
    _save_cross_project_messages(messages)

    # Update original message status
    original.status = "completed"
    original.updated_at = datetime.utcnow()
    messages[original_message_id] = original
    _save_cross_project_messages(messages)

    return reply


def delete_cross_project_message(message_id: str) -> bool:
    """Delete a cross-project message"""
    messages = _load_cross_project_messages()
    if message_id not in messages:
        return False

    del messages[message_id]
    _save_cross_project_messages(messages)
    return True


def get_project_conversations(project_id: str) -> list[dict]:
    """Get conversation threads for a project

    Returns list of conversation threads, each containing related messages
    """
    messages = list_cross_project_messages(project_id, direction="both")

    # Group by thread (using reply_to chain)
    threads = {}
    for msg in messages:
        if msg.reply_to and msg.reply_to in threads:
            thread_id = threads[msg.reply_to]["id"]
        else:
            thread_id = msg.id

        if thread_id not in threads:
            threads[thread_id] = {
                "id": thread_id,
                "messages": [],
                "participants": set(),
                "last_activity": msg.created_at
            }

        threads[thread_id]["messages"].append(msg)
        threads[thread_id]["participants"].add(msg.source_project_id)
        threads[thread_id]["participants"].add(msg.target_project_id)

        if msg.created_at > threads[thread_id]["last_activity"]:
            threads[thread_id]["last_activity"] = msg.created_at

    # Convert sets to lists and sort by last activity
    result = []
    for thread in threads.values():
        thread["participants"] = list(thread["participants"])
        thread["messages"] = sorted(thread["messages"], key=lambda m: m.created_at)
        result.append(thread)

    return sorted(result, key=lambda t: t["last_activity"], reverse=True)
