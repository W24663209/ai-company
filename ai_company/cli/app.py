import typer

from ai_company.cli import agent_commands, build_commands, project_commands, requirement_commands

app = typer.Typer(help="AI Company — Multi-project AI agent collaboration platform")

app.add_typer(project_commands.app, name="project", help="Manage projects")
app.add_typer(requirement_commands.app, name="req", help="Manage requirements")
app.add_typer(build_commands.app, name="build", help="Run builds")
app.add_typer(agent_commands.app, name="agent", help="Agent & Claude integration")


def main():
    app()
