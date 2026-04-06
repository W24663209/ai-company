"""Skills management router"""
from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, HTTPException, Query

from ai_company.core.models import Skill
from ai_company.services import skill_service

router = APIRouter()


@router.post("", response_model=Skill)
def create_skill(
    name: str,
    content: str,
    description: str = "",
    category: str = "general",
    tags: str = "",  # comma-separated
):
    """Create a new skill"""
    tag_list = [t.strip() for t in tags.split(",") if t.strip()]
    skill = skill_service.create_skill(
        name=name,
        content=content,
        description=description,
        category=category,
        tags=tag_list
    )
    return skill


@router.get("", response_model=list[Skill])
def list_skills(
    category: Optional[str] = None,
    tag: Optional[str] = None,
):
    """List all skills with optional filtering"""
    return skill_service.list_skills(category=category, tag=tag)


@router.get("/{skill_id}", response_model=Skill)
def get_skill(skill_id: str):
    """Get a skill by ID"""
    skill = skill_service.get_skill(skill_id)
    if not skill:
        raise HTTPException(status_code=404, detail="Skill not found")
    return skill


@router.patch("/{skill_id}", response_model=Skill)
def update_skill(
    skill_id: str,
    name: Optional[str] = None,
    content: Optional[str] = None,
    description: Optional[str] = None,
    category: Optional[str] = None,
    tags: Optional[str] = None,
):
    """Update a skill"""
    kwargs = {}
    if name is not None:
        kwargs["name"] = name
    if content is not None:
        kwargs["content"] = content
    if description is not None:
        kwargs["description"] = description
    if category is not None:
        kwargs["category"] = category
    if tags is not None:
        kwargs["tags"] = [t.strip() for t in tags.split(",") if t.strip()]

    skill = skill_service.update_skill(skill_id, **kwargs)
    if not skill:
        raise HTTPException(status_code=404, detail="Skill not found")
    return skill


@router.delete("/{skill_id}")
def delete_skill(skill_id: str):
    """Delete a skill"""
    success = skill_service.delete_skill(skill_id)
    if not success:
        raise HTTPException(status_code=404, detail="Skill not found")
    return {"status": "deleted"}


# Project-Skill binding endpoints

@router.post("/bind/{project_id}/{skill_id}")
def bind_skill_to_project(
    project_id: str,
    skill_id: str,
    priority: int = Query(5, ge=1, le=10),
):
    """Bind a skill to a project"""
    binding = skill_service.bind_skill_to_project(project_id, skill_id, priority)
    if not binding:
        raise HTTPException(status_code=404, detail="Skill not found")
    return binding


@router.delete("/bind/{project_id}/{skill_id}")
def unbind_skill_from_project(project_id: str, skill_id: str):
    """Remove a skill binding from a project"""
    success = skill_service.unbind_skill_from_project(project_id, skill_id)
    if not success:
        raise HTTPException(status_code=404, detail="Binding not found")
    return {"status": "unbound"}


@router.get("/project/{project_id}")
def get_project_skills(project_id: str):
    """Get all skills bound to a project"""
    skills_with_bindings = skill_service.get_project_skills(project_id, enabled_only=False)
    return [
        {
            "skill": skill.model_dump(),
            "binding": binding.model_dump(),
        }
        for skill, binding in skills_with_bindings
    ]


@router.patch("/bind/{project_id}/{skill_id}")
def update_project_skill_binding(
    project_id: str,
    skill_id: str,
    enabled: Optional[bool] = None,
    priority: Optional[int] = Query(None, ge=1, le=10),
):
    """Update a project-skill binding"""
    binding = skill_service.update_project_skill_binding(
        project_id, skill_id, enabled=enabled, priority=priority
    )
    if not binding:
        raise HTTPException(status_code=404, detail="Binding not found")
    return binding


@router.post("/init-defaults")
def init_default_skills():
    """Initialize default skills"""
    skill_service.init_default_skills()
    return {"status": "initialized"}
