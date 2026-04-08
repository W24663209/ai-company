"""Agent message router for AI agent communications and code reviews"""
from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field

from ai_company.core.exceptions import AICompanyError
from ai_company.services import agent_message_service

router = APIRouter()


class CreateAgentMessage(BaseModel):
    project_id: str = Field(..., description="Project ID")
    requirement_id: str = Field(..., description="Requirement ID")
    sender: str = Field(..., description="Agent name/role")
    content: str = Field(..., description="Message content")
    message_type: str = Field(default="communication", description="Message type")
    subject: str = Field(default="", description="Message subject")
    receiver: str = Field(default="", description="Target agent")
    context: dict = Field(default_factory=dict, description="Additional context")
    parent_id: str = Field(default="", description="Parent message ID for threading")


class CreateReviewMessage(BaseModel):
    project_id: str = Field(..., description="Project ID")
    requirement_id: str = Field(..., description="Requirement ID")
    reviewer: str = Field(default="PM Agent", description="Reviewer name")
    subject: str = Field(..., description="Review subject")
    review_content: str = Field(..., description="Detailed review content")
    files_reviewed: list[str] = Field(default_factory=list, description="Files that were reviewed")
    issues_found: list[dict] = Field(default_factory=list, description="Issues found during review")
    verdict: str = Field(..., description="Review verdict: approved, needs_fix, or rejected")


class CreateCommunicationMessage(BaseModel):
    project_id: str = Field(..., description="Project ID")
    requirement_id: str = Field(..., description="Requirement ID")
    sender: str = Field(..., description="Sending agent")
    receiver: str = Field(..., description="Target agent")
    subject: str = Field(..., description="Message subject")
    content: str = Field(..., description="Message content")
    related_files: list[str] = Field(default_factory=list, description="Related files")


@router.get("/messages")
def list_agent_messages(
    project_id: Optional[str] = Query(None),
    requirement_id: Optional[str] = Query(None),
    message_type: Optional[str] = Query(None),
    sender: Optional[str] = Query(None),
    limit: int = Query(100)
):
    """List agent messages with filters"""
    messages = agent_message_service.list_messages(
        project_id=project_id,
        requirement_id=requirement_id,
        message_type=message_type,
        sender=sender,
        limit=limit
    )
    return [m.to_dict() for m in messages]


@router.get("/messages/{message_id}")
def get_agent_message(message_id: str):
    """Get a specific agent message"""
    message = agent_message_service.get_message(message_id)
    if not message:
        raise HTTPException(status_code=404, detail="Message not found")
    return message.to_dict()


@router.post("/messages")
def create_agent_message(msg: CreateAgentMessage):
    """Create a new agent message"""
    try:
        message = agent_message_service.create_message(
            project_id=msg.project_id,
            requirement_id=msg.requirement_id,
            sender=msg.sender,
            content=msg.content,
            message_type=msg.message_type,
            subject=msg.subject,
            receiver=msg.receiver,
            context=msg.context,
            parent_id=msg.parent_id
        )
        return message.to_dict()
    except AICompanyError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@router.post("/messages/review")
def create_review_message(review: CreateReviewMessage):
    """Create a code review message"""
    try:
        message = agent_message_service.create_review_message(
            project_id=review.project_id,
            requirement_id=review.requirement_id,
            reviewer=review.reviewer,
            subject=review.subject,
            review_content=review.review_content,
            files_reviewed=review.files_reviewed,
            issues_found=review.issues_found,
            verdict=review.verdict
        )
        return message.to_dict()
    except AICompanyError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@router.post("/messages/communication")
def create_communication_message(comm: CreateCommunicationMessage):
    """Create an agent-to-agent communication message"""
    try:
        message = agent_message_service.create_communication_message(
            project_id=comm.project_id,
            requirement_id=comm.requirement_id,
            sender=comm.sender,
            receiver=comm.receiver,
            subject=comm.subject,
            content=comm.content,
            related_files=comm.related_files
        )
        return message.to_dict()
    except AICompanyError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@router.get("/conversations/{requirement_id}")
def get_conversation_thread(requirement_id: str):
    """Get all messages for a requirement (conversation thread)"""
    messages = agent_message_service.get_conversation_thread(requirement_id)
    return [m.to_dict() for m in messages]


@router.delete("/messages/{message_id}")
def delete_agent_message(message_id: str):
    """Delete an agent message"""
    if agent_message_service.delete_message(message_id):
        return {"deleted": True}
    raise HTTPException(status_code=404, detail="Message not found")


@router.get("/stats")
def get_message_stats(project_id: Optional[str] = Query(None)):
    """Get message statistics"""
    return agent_message_service.get_message_stats(project_id=project_id)
