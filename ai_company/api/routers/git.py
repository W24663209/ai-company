from fastapi import APIRouter, HTTPException

from ai_company.core.exceptions import AICompanyError
from ai_company.services import git_service

router = APIRouter()


@router.get("/ssh-keys")
def list_ssh_keys():
    return git_service.list_ssh_keys()


@router.post("/ssh-keys")
def create_ssh_key(name: str, email: str = "ai-company@local"):
    try:
        return git_service.generate_ssh_key(name, email)
    except AICompanyError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@router.delete("/ssh-keys/{name}")
def remove_ssh_key(name: str):
    if git_service.delete_ssh_key(name):
        return {"deleted": True}
    raise HTTPException(status_code=404, detail="SSH key not found")


@router.post("/clone")
def clone_repo(url: str, target_path: str, ssh_key_name: str | None = None, branch: str | None = None):
    try:
        job_id = git_service.start_clone(url, target_path, ssh_key_name=ssh_key_name, branch=branch)
        return {"status": "started", "job_id": job_id, "target_path": target_path}
    except AICompanyError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@router.get("/clone/{job_id}")
def clone_status(job_id: str):
    job = git_service.get_clone_status(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Clone job not found")
    return job
