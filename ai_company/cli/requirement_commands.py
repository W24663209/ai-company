from typing import Optional

import typer
from rich.console import Console
from rich.table import Table

from ai_company.core.exceptions import AICompanyError
from ai_company.core.models import RequirementStatus
from ai_company.services import requirement_service

app = typer.Typer()
console = Console()


@app.command("add")
def req_add(
    project_id: str = typer.Option(..., "--project", help="Project ID or name"),
    title: str = typer.Option(..., "--title", help="Requirement title"),
    description: str = typer.Option("", "--desc", help="Requirement description"),
    priority: int = typer.Option(3, "--priority", help="Priority (1=highest)"),
):
    """Add a requirement to a project."""
    try:
        req = requirement_service.create_requirement(
            project_id=project_id,
            title=title,
            description=description,
            priority=priority,
        )
        console.print(f"[green]Added requirement[/green] {req.id}: {req.title}")
    except AICompanyError as e:
        console.print(f"[red]Error:[/red] {e}")
        raise typer.Exit(1)


@app.command("list")
def req_list(
    project_id: str = typer.Option(..., "--project", help="Project ID or name"),
):
    """List requirements for a project."""
    try:
        reqs = requirement_service.list_requirements(project_id)
        table = Table(title=f"Requirements for {project_id}")
        table.add_column("ID", style="cyan")
        table.add_column("Title")
        table.add_column("Status")
        table.add_column("Priority")
        for r in reqs:
            table.add_row(r.id, r.title, r.status.value, str(r.priority))
        console.print(table)
    except AICompanyError as e:
        console.print(f"[red]Error:[/red] {e}")
        raise typer.Exit(1)


@app.command("update")
def req_update(
    project_id: str = typer.Option(..., "--project", help="Project ID or name"),
    requirement_id: str = typer.Argument(..., help="Requirement ID"),
    title: Optional[str] = typer.Option(None, "--title"),
    description: Optional[str] = typer.Option(None, "--desc"),
    status: Optional[RequirementStatus] = typer.Option(None, "--status"),
    priority: Optional[int] = typer.Option(None, "--priority"),
):
    """Update a requirement."""
    try:
        req = requirement_service.update_requirement(
            project_id=project_id,
            requirement_id=requirement_id,
            title=title,
            description=description,
            status=status,
            priority=priority,
        )
        console.print(f"[green]Updated requirement[/green] {req.id}: {req.title}")
    except AICompanyError as e:
        console.print(f"[red]Error:[/red] {e}")
        raise typer.Exit(1)
