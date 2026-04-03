from fastapi import APIRouter, HTTPException

from ai_company.core.exceptions import AICompanyError
from ai_company.core.models import AgentMessage, AgentPresence
from ai_company.services import claude_service, worklog_service
from ai_company.services.shared_dir_service import shared_dir_service

router = APIRouter()


@router.post("/run")
def run_agent(project_id: str, requirement_id: str, working_dir: str | None = None):
    try:
        process = claude_service.launch_claude(project_id, requirement_id, working_dir)
        return {"pid": process.pid}
    except AICompanyError as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@router.post("/chat")
def chat(project_id: str, requirement_id: str, payload: dict):
    try:
        message = payload.get("message", "")
        history = payload.get("history", [])
        result = claude_service.chat(project_id, requirement_id, message, history=history)
        if result["returncode"] != 0:
            raise HTTPException(status_code=500, detail=result["stderr"] or "Claude exited with error")
        return {"response": result["stdout"]}
    except AICompanyError as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@router.post("/worklog/{project_id}/{requirement_id}")
def save_worklog(project_id: str, requirement_id: str, payload: dict):
    worklog_service.save_worklog(project_id, requirement_id, payload.get("history", []))
    return {"status": "ok"}


@router.get("/worklog/{project_id}/{requirement_id}")
def load_worklog(project_id: str, requirement_id: str):
    return worklog_service.load_worklog(project_id, requirement_id)


@router.post("/messages")
def send_message(sender: str, payload: dict, recipient: str = "*", project_id: str = ""):
    msg = shared_dir_service.send_message(
        sender=sender, recipient=recipient, project_id=project_id, payload=payload
    )
    return msg


@router.get("/messages")
def read_messages(
    project_id: str | None = None,
    recipient: str | None = None,
):
    return shared_dir_service.read_messages(project_id=project_id, recipient=recipient)


@router.post("/presence")
def register_presence(presence: AgentPresence):
    shared_dir_service.register_presence(presence)
    return {"status": "ok"}


@router.get("/presence")
def list_presence():
    return shared_dir_service.list_presence()
