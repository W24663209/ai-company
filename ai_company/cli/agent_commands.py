from typing import Optional

import typer
from rich.console import Console
from rich.table import Table

from ai_company.core.exceptions import AICompanyError
from ai_company.core.models import AgentMessage, AgentPresence
from ai_company.services import claude_service
from ai_company.services.shared_dir_service import shared_dir_service

app = typer.Typer()
console = Console()


@app.command("run")
def agent_run(
    project_id: str = typer.Option(..., "--project", help="Project ID or name"),
    requirement_id: str = typer.Option(..., "--requirement", help="Requirement ID"),
    working_dir: Optional[str] = typer.Option(None, "--dir", help="Override working directory"),
):
    """Launch a Claude Code session for a requirement."""
    try:
        process = claude_service.launch_claude(project_id, requirement_id, working_dir)
        console.print(f"[green]Launched Claude session[/green] (PID {process.pid})")
        console.print("[dim]Claude is running in the background with the requirement context.[/dim]")
    except AICompanyError as e:
        console.print(f"[red]Error:[/red] {e}")
        raise typer.Exit(1)


@app.command("send")
def agent_send(
    sender: str = typer.Option(..., "--sender", help="Sender agent name"),
    payload: str = typer.Option(..., "--msg", help="Message payload (JSON string or plain text)"),
    recipient: str = typer.Option("*", "--to", help="Recipient agent (default broadcast)"),
    project_id: str = typer.Option("", "--project", help="Associated project ID"),
):
    """Send a message to the shared directory."""
    import json

    try:
        data = json.loads(payload)
    except Exception:
        data = {"text": payload}
    msg = shared_dir_service.send_message(
        sender=sender, recipient=recipient, project_id=project_id, payload=data
    )
    console.print(f"[green]Sent message[/green] {msg.id} to shared inbox")


@app.command("read")
def agent_read(
    project_id: Optional[str] = typer.Option(None, "--project"),
    recipient: Optional[str] = typer.Option(None, "--to"),
):
    """Read messages from the shared directory."""
    msgs = shared_dir_service.read_messages(project_id=project_id, recipient=recipient)
    table = Table(title="Shared Messages")
    table.add_column("Time", style="cyan")
    table.add_column("Sender")
    table.add_column("Recipient")
    table.add_column("Project")
    table.add_column("Payload")
    for m in msgs:
        table.add_row(
            str(m.timestamp),
            m.sender,
            m.recipient,
            m.project_id or "-",
            str(m.payload),
        )
    console.print(table)


@app.command("presence")
def agent_presence(
    agent_name: str = typer.Argument(..., help="Agent name"),
    status: str = typer.Option("idle", "--status", help="idle | working | done | error"),
    project_id: str = typer.Option("", "--project"),
):
    """Register or update agent presence."""
    presence = AgentPresence(
        agent_name=agent_name,
        project_id=project_id,
        status=status,  # type: ignore[arg-type]
    )
    shared_dir_service.register_presence(presence)
    console.print(f"[green]Registered presence[/green] for {agent_name}: {status}")
