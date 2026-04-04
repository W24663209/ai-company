from fastapi import APIRouter, HTTPException

from ai_company.core.exceptions import AICompanyError
from ai_company.core.models import Requirement, RequirementStatus
from ai_company.services import requirement_service

router = APIRouter()


@router.post("", response_model=Requirement)
def create_requirement(
    project_id: str,
    title: str,
    description: str = "",
    status: RequirementStatus = RequirementStatus.PENDING,
    priority: int = 3,
):
    try:
        return requirement_service.create_requirement(
            project_id=project_id,
            title=title,
            description=description,
            status=status,
            priority=priority,
        )
    except AICompanyError as exc:
        raise HTTPException(status_code=404, detail=str(exc))


@router.get("/{project_id}", response_model=list[Requirement])
def list_requirements(project_id: str):
    try:
        return requirement_service.list_requirements(project_id)
    except AICompanyError as exc:
        raise HTTPException(status_code=404, detail=str(exc))


@router.post("/{project_id}/{requirement_id}/status", response_model=Requirement)
def update_requirement_status(project_id: str, requirement_id: str, status: RequirementStatus):
    try:
        return requirement_service.update_requirement(project_id, requirement_id, status=status)
    except AICompanyError as exc:
        raise HTTPException(status_code=404, detail=str(exc))
