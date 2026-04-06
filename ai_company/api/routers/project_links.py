"""Project links and cross-project collaboration router"""
from __future__ import annotations

from typing import Optional, Literal

from fastapi import APIRouter, HTTPException, Query

from ai_company.core.models import ProjectLink, ProjectLinkType, CrossProjectMessage
from ai_company.services import project_link_service

router = APIRouter()


# Project Link endpoints

@router.post("/links", response_model=ProjectLink)
def create_project_link(
    source_project_id: str,
    target_project_id: str,
    link_type: ProjectLinkType = ProjectLinkType.RELATED,
    description: str = "",
    auto_route_messages: bool = True,
):
    """Create a link between two projects"""
    try:
        link = project_link_service.create_project_link(
            source_project_id=source_project_id,
            target_project_id=target_project_id,
            link_type=link_type,
            description=description,
            auto_route_messages=auto_route_messages
        )
        return link
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.get("/links")
def list_project_links(project_id: Optional[str] = None):
    """List project links"""
    links = project_link_service.list_project_links(project_id)
    return links


@router.get("/links/{link_id}", response_model=ProjectLink)
def get_project_link(link_id: str):
    """Get a specific project link"""
    link = project_link_service.get_project_link(link_id)
    if not link:
        raise HTTPException(status_code=404, detail="Link not found")
    return link


@router.get("/{project_id}/linked-projects")
def get_linked_projects(project_id: str):
    """Get all projects linked to the given project"""
    from ai_company.services.project_service import get_project

    linked = project_link_service.get_linked_projects(project_id)
    result = []
    for link, linked_project_id in linked:
        project = get_project(linked_project_id)
        if project:
            result.append({
                "link": link.model_dump(),
                "project": {
                    "id": project.id,
                    "name": project.name,
                    "type": project.type.value,
                }
            })
    return result


@router.patch("/links/{link_id}", response_model=ProjectLink)
def update_project_link(
    link_id: str,
    description: Optional[str] = None,
    auto_route_messages: Optional[bool] = None,
):
    """Update a project link"""
    kwargs = {}
    if description is not None:
        kwargs["description"] = description
    if auto_route_messages is not None:
        kwargs["auto_route_messages"] = auto_route_messages

    link = project_link_service.update_project_link(link_id, **kwargs)
    if not link:
        raise HTTPException(status_code=404, detail="Link not found")
    return link


@router.delete("/links/{link_id}")
def delete_project_link(link_id: str):
    """Delete a project link"""
    success = project_link_service.delete_project_link(link_id)
    if not success:
        raise HTTPException(status_code=404, detail="Link not found")
    return {"status": "deleted"}


@router.get("/graph")
def get_link_graph(
    project_id: Optional[str] = None,
    depth: int = Query(2, ge=1, le=5),
):
    """Get project link graph for visualization"""
    return project_link_service.get_link_graph(project_id, depth)


# Cross-project message endpoints

@router.post("/messages", response_model=CrossProjectMessage)
def create_cross_project_message(
    source_project_id: str,
    target_project_id: str,
    sender: str,
    message_type: Literal["request", "response", "notify", "delegate", "question"],
    subject: str,
    content: str,
    source_requirement_id: Optional[str] = None,
    target_requirement_id: Optional[str] = None,
    reply_to: Optional[str] = None,
):
    """Send a message to another project"""
    message = project_link_service.create_cross_project_message(
        source_project_id=source_project_id,
        target_project_id=target_project_id,
        sender=sender,
        message_type=message_type,
        subject=subject,
        content=content,
        source_requirement_id=source_requirement_id or "",
        target_requirement_id=target_requirement_id or "",
        reply_to=reply_to or ""
    )
    return message


@router.get("/messages")
def list_cross_project_messages(
    project_id: Optional[str] = None,
    direction: Literal["in", "out", "both"] = "both",
    status: Optional[str] = None,
    message_type: Optional[str] = None,
):
    """List cross-project messages"""
    messages = project_link_service.list_cross_project_messages(
        project_id=project_id,
        direction=direction,
        status=status,
        message_type=message_type
    )
    return messages


@router.get("/{project_id}/inbox")
def get_project_inbox(
    project_id: str,
    status: Optional[str] = None,
):
    """Get inbox messages for a project"""
    messages = project_link_service.list_cross_project_messages(
        project_id=project_id,
        direction="in",
        status=status
    )
    return messages


@router.get("/{project_id}/outbox")
def get_project_outbox(
    project_id: str,
    status: Optional[str] = None,
):
    """Get outbox messages for a project"""
    messages = project_link_service.list_cross_project_messages(
        project_id=project_id,
        direction="out",
        status=status
    )
    return messages


@router.get("/messages/{message_id}", response_model=CrossProjectMessage)
def get_cross_project_message(message_id: str):
    """Get a specific message"""
    message = project_link_service.get_cross_project_message(message_id)
    if not message:
        raise HTTPException(status_code=404, detail="Message not found")
    return message


@router.patch("/messages/{message_id}/status")
def update_message_status(
    message_id: str,
    status: Literal["pending", "delivered", "read", "processing", "completed", "failed"],
):
    """Update message status"""
    message = project_link_service.update_cross_project_message_status(message_id, status)
    if not message:
        raise HTTPException(status_code=404, detail="Message not found")
    return message


@router.post("/messages/{message_id}/reply", response_model=CrossProjectMessage)
def reply_to_message(
    message_id: str,
    sender: str,
    content: str,
):
    """Reply to a cross-project message"""
    reply = project_link_service.reply_to_cross_project_message(
        original_message_id=message_id,
        sender=sender,
        content=content
    )
    if not reply:
        raise HTTPException(status_code=404, detail="Original message not found")
    return reply


@router.get("/{project_id}/conversations")
def get_project_conversations(project_id: str):
    """Get conversation threads for a project"""
    return project_link_service.get_project_conversations(project_id)


@router.delete("/messages/{message_id}")
def delete_cross_project_message(message_id: str):
    """Delete a cross-project message"""
    success = project_link_service.delete_cross_project_message(message_id)
    if not success:
        raise HTTPException(status_code=404, detail="Message not found")
    return {"status": "deleted"}
