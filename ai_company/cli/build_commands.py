from typing import Optional

import typer
from rich.console import Console

from ai_company.core.exceptions import AICompanyError
from ai_company.core.models import ProjectType
from ai_company.services import build_service, project_service

app = typer.Typer()
console = Console()


@app.command("java")
def build_java(
    project_id: str = typer.Argument(..., help="Project ID or name"),
    jdk_version: str = typer.Option("17", "--jdk", help="JDK version (11 or 17)"),
    command: Optional[str] = typer.Option(None, "--cmd", help="Custom maven command (space-separated)"),
):
    """Run a Java/Maven build."""
    try:
        project = project_service.get_project(project_id)
        if project.type not in (ProjectType.JAVA, ProjectType.MIXED):
            console.print(f"[yellow]Warning: project type is {project.type.value}[/yellow]")
        cmd = command.split() if command else None
        log_path = build_service.build_project(project.id, command=cmd, jdk_version=jdk_version)
        console.print(f"[green]Build succeeded.[/green] Log: {log_path}")
    except AICompanyError as e:
        console.print(f"[red]Build error:[/red] {e}")
        raise typer.Exit(1)


@app.command("node")
def build_node(
    project_id: str = typer.Argument(..., help="Project ID or name"),
    tool: str = typer.Option("npm", "--tool", help="Build tool: npm or pnpm"),
    node_version: Optional[str] = typer.Option(None, "--node", help="Node version via nvm"),
    command: Optional[str] = typer.Option(None, "--cmd", help="Custom build command (space-separated)"),
):
    """Run a Node build."""
    try:
        project = project_service.get_project(project_id)
        if project.type not in (ProjectType.NODE, ProjectType.MIXED):
            console.print(f"[yellow]Warning: project type is {project.type.value}[/yellow]")
        cmd = command.split() if command else None
        log_path = build_service.build_project(
            project.id, command=cmd, tool=tool, node_version=node_version
        )
        console.print(f"[green]Build succeeded.[/green] Log: {log_path}")
    except AICompanyError as e:
        console.print(f"[red]Build error:[/red] {e}")
        raise typer.Exit(1)
