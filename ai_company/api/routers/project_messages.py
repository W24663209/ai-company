"""Project message template router for custom work message formats"""
from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field

from ai_company.core.exceptions import AICompanyError
from ai_company.services import project_message_template_service

router = APIRouter()


class MessageField(BaseModel):
    name: str = Field(..., description="Field identifier")
    label: str = Field(..., description="Field display label")
    type: str = Field(..., description="Field type: text, textarea, file, select, number")
    required: bool = Field(default=False, description="Is field required")
    placeholder: str = Field(default="", description="Placeholder text")
    options: list[str] = Field(default_factory=list, description="Options for select type")


class UpdateTemplateRequest(BaseModel):
    fields: list[MessageField] = Field(..., description="List of message fields")


@router.get("/templates/{project_id}")
def get_template(project_id: str):
    """Get message template for a project"""
    template = project_message_template_service.get_or_create_template(project_id)
    return template.to_dict()


@router.put("/templates/{project_id}")
def update_template(project_id: str, req: UpdateTemplateRequest):
    """Update message template for a project"""
    try:
        fields = [f.model_dump() for f in req.fields]
        template = project_message_template_service.update_template(project_id, fields)
        return template.to_dict()
    except AICompanyError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@router.delete("/templates/{project_id}")
def delete_template(project_id: str):
    """Delete message template for a project"""
    if project_message_template_service.delete_template(project_id):
        return {"deleted": True}
    raise HTTPException(status_code=404, detail="Template not found")


@router.get("/field-types")
def get_field_types():
    """Get available field types"""
    return project_message_template_service.get_default_field_types()
