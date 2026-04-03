from typing import Optional

import typer
from rich.console import Console
from rich.table import Table

from ai_company.core.exceptions import AICompanyError
from ai_company.core.models import ProjectType
from ai_company.services import project_service

app = typer.Typer()
console = Console()


@app.command("create")
def project_create(
    name: str = typer.Argument(..., help="Project name"),
    project_type: ProjectType = typer.Option(ProjectType.JAVA, "--type", help="Project type"),
    path: Optional[str] = typer.Option(None, "--path", help="Custom project path"),
):
    """Create a new project."""
    try:
        project = project_service.create_project(name, project_type, path)
        console.print(f"[green]Created project[/green] {project.name} ({project.id}) at {project.path}")
    except AICompanyError as e:
        console.print(f"[red]Error:[/red] {e}")
        raise typer.Exit(1)


@app.command("list")
def project_list():
    """List all projects."""
    projects = project_service.list_projects()
    table = Table(title="Projects")
    table.add_column("ID", style="cyan")
    table.add_column("Name", style="magenta")
    table.add_column("Type")
    table.add_column("Path")
    for p in projects:
        table.add_row(p.id, p.name, p.type.value, p.path)
    console.print(table)


@app.command("delete")
def project_delete(
    project_id: str = typer.Argument(..., help="Project ID or name"),
):
    """Delete a project."""
    if project_service.delete_project(project_id):
        console.print(f"[green]Deleted project {project_id}[/green]")
    else:
        console.print(f"[red]Project {project_id} not found[/red]")
        raise typer.Exit(1)
