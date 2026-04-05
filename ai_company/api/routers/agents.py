from fastapi import APIRouter, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.responses import StreamingResponse

from ai_company.core.exceptions import AICompanyError
from ai_company.core.models import AgentMessage, AgentPresence
from ai_company.services import claude_service, worklog_service
from ai_company.services.shared_dir_service import shared_dir_service
import json
import asyncio

router = APIRouter()


@router.post("/run")
def run_agent(project_id: str, requirement_id: str, working_dir: str | None = None):
    try:
        process = claude_service.launch_claude(project_id, requirement_id, working_dir)
        return {"pid": process.pid}
    except AICompanyError as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@router.post("/chat")
async def chat(project_id: str, requirement_id: str, payload: dict):
    """Stream Claude responses via HTTP to prevent gateway timeout."""
    try:
        message = payload.get("message", "")

        async def event_generator():
            async for chunk in claude_service.chat_stream(project_id, requirement_id, message):
                if chunk["type"] in ("stdout", "stderr"):
                    yield f"data: {json.dumps(chunk)}\n\n"
                elif chunk["type"] == "done":
                    yield f"data: {json.dumps(chunk)}\n\n"

        return StreamingResponse(
            event_generator(),
            media_type="text/event-stream",
            headers={
                "Cache-Control": "no-cache",
                "Connection": "keep-alive",
                "X-Accel-Buffering": "no",
            }
        )
    except AICompanyError as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@router.post("/chat/stream")
async def chat_stream(project_id: str, requirement_id: str, payload: dict):
    """Stream Claude responses to prevent gateway timeout."""
    try:
        message = payload.get("message", "")

        async def event_generator():
            async for chunk in claude_service.chat_stream(project_id, requirement_id, message):
                if chunk["type"] in ("stdout", "stderr"):
                    yield f"data: {json.dumps(chunk)}\n\n"
                elif chunk["type"] == "done":
                    yield f"data: {json.dumps(chunk)}\n\n"

        return StreamingResponse(
            event_generator(),
            media_type="text/event-stream",
            headers={
                "Cache-Control": "no-cache",
                "Connection": "keep-alive",
                "X-Accel-Buffering": "no",
            }
        )
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


@router.websocket("/ws/chat/{project_id}/{requirement_id}")
async def chat_ws(websocket: WebSocket, project_id: str, requirement_id: str):
    """WebSocket endpoint for real-time Claude chat to avoid gateway timeout."""
    await websocket.accept()

    # Track connection state
    is_connected = True
    last_activity = asyncio.get_event_loop().time()

    async def keepalive():
        """Send periodic ping to keep connection alive through proxies."""
        nonlocal is_connected, last_activity
        while is_connected:
            try:
                await asyncio.sleep(30)  # Send ping every 30 seconds
                if is_connected:
                    await websocket.send_json({"type": "ping", "timestamp": last_activity})
            except Exception:
                is_connected = False
                break

    async def receive_messages():
        """Receive messages from client and process with Claude."""
        nonlocal is_connected, last_activity
        try:
            while is_connected:
                # Receive message from client with timeout
                try:
                    data = await asyncio.wait_for(websocket.receive_text(), timeout=60.0)
                    last_activity = asyncio.get_event_loop().time()
                except asyncio.TimeoutError:
                    # No message for 60s, send ping to check connection
                    try:
                        await websocket.send_json({"type": "ping"})
                        continue
                    except:
                        break

                # Handle ping/pong from client
                if data == "ping" or data == "pong":
                    continue

                try:
                    message_data = json.loads(data)
                except json.JSONDecodeError:
                    continue

                message = message_data.get("message", "")

                if not message:
                    continue

                # Send acknowledgement
                await websocket.send_json({"type": "status", "status": "processing"})

                # Process with Claude using streaming
                try:
                    full_response = ""
                    async for chunk in claude_service.chat_stream(project_id, requirement_id, message):
                        if not is_connected:
                            break
                        if chunk["type"] == "stdout":
                            full_response += chunk.get("data", "")
                            # Send partial output in real-time
                            await websocket.send_json({
                                "type": "partial",
                                "data": chunk.get("data", "")
                            })
                        elif chunk["type"] == "stderr":
                            await websocket.send_json({
                                "type": "stderr",
                                "data": chunk.get("data", "")
                            })
                        elif chunk["type"] == "done":
                            usage_info = chunk.get("usage")
                            await websocket.send_json({
                                "type": "done",
                                "response": full_response,
                                "returncode": chunk.get("returncode", 0),
                                "usage": usage_info,
                            })

                except Exception as e:
                    try:
                        await websocket.send_json({
                            "type": "error",
                            "message": str(e)
                        })
                    except:
                        pass

        except WebSocketDisconnect:
            pass
        except Exception as e:
            try:
                await websocket.send_json({"type": "error", "message": str(e)})
            except:
                pass
        finally:
            is_connected = False

    # Run both tasks concurrently
    keepalive_task = asyncio.create_task(keepalive())
    receive_task = asyncio.create_task(receive_messages())

    try:
        await receive_task
    finally:
        is_connected = False
        keepalive_task.cancel()
        try:
            await keepalive_task
        except asyncio.CancelledError:
            pass
