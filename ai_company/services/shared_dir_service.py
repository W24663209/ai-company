from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional

from ai_company.core.config import settings
from ai_company.core.models import AgentMessage, AgentPresence


class SharedDirService:
    """Manages cross-project agent communication through the shared directory."""

    def __init__(self):
        self.shared = settings.shared_dir
        for sub in ("inbox", "outbox", "artifacts", "registry"):
            (self.shared / sub).mkdir(parents=True, exist_ok=True)

    def send_message(
        self,
        sender: str,
        recipient: str = "*",
        project_id: str = "",
        payload: Optional[dict[str, Any]] = None,
    ) -> AgentMessage:
        msg = AgentMessage(
            sender=sender,
            recipient=recipient,
            project_id=project_id,
            payload=payload or {},
        )
        target = self.shared / "inbox" / f"{msg.timestamp.isoformat()}_{msg.id}.json"
        target.write_text(msg.model_dump_json(), encoding="utf-8")
        return msg

    def read_messages(
        self,
        project_id: Optional[str] = None,
        recipient: Optional[str] = None,
        since: Optional[datetime] = None,
    ) -> list[AgentMessage]:
        results = []
        for folder in (self.shared / "inbox", self.shared / "outbox"):
            if not folder.exists():
                continue
            for f in sorted(folder.glob("*.json")):
                try:
                    data = json.loads(f.read_text(encoding="utf-8"))
                    msg = AgentMessage.model_validate(data)
                    if project_id and msg.project_id != project_id:
                        continue
                    if recipient and msg.recipient != recipient and msg.recipient != "*":
                        continue
                    if since and msg.timestamp < since:
                        continue
                    results.append(msg)
                except Exception:
                    continue
        return sorted(results, key=lambda m: m.timestamp)

    def write_outbox(self, msg: AgentMessage) -> Path:
        target = self.shared / "outbox" / f"{msg.timestamp.isoformat()}_{msg.id}.json"
        target.write_text(msg.model_dump_json(), encoding="utf-8")
        return target

    def register_presence(self, presence: AgentPresence) -> Path:
        target = self.shared / "registry" / f"{presence.agent_name}.json"
        target.write_text(presence.model_dump_json(), encoding="utf-8")
        return target

    def list_presence(self) -> list[AgentPresence]:
        results = []
        folder = self.shared / "registry"
        if not folder.exists():
            return results
        for f in folder.glob("*.json"):
            try:
                data = json.loads(f.read_text(encoding="utf-8"))
                results.append(AgentPresence.model_validate(data))
            except Exception:
                continue
        return results


shared_dir_service = SharedDirService()
