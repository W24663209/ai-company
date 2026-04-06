"""Skill management service for AI agents"""
from __future__ import annotations

import json
from pathlib import Path
from typing import Optional

from ai_company.core.config import settings
from ai_company.core.models import Skill, ProjectSkillBinding

SKILLS_FILE = settings.data_dir / "skills.json"
PROJECT_SKILLS_FILE = settings.data_dir / "project_skills.json"


def _load_skills() -> dict[str, Skill]:
    """Load all skills from disk"""
    if not SKILLS_FILE.exists():
        return {}
    try:
        data = json.loads(SKILLS_FILE.read_text(encoding="utf-8"))
        return {k: Skill(**v) for k, v in data.items()}
    except Exception:
        return {}


def _save_skills(skills: dict[str, Skill]) -> None:
    """Save all skills to disk"""
    SKILLS_FILE.parent.mkdir(parents=True, exist_ok=True)
    data = {k: v.model_dump() for k, v in skills.items()}
    SKILLS_FILE.write_text(json.dumps(data, indent=2, default=str), encoding="utf-8")


def _load_project_skills() -> dict[str, list[ProjectSkillBinding]]:
    """Load project-skill bindings from disk"""
    if not PROJECT_SKILLS_FILE.exists():
        return {}
    try:
        data = json.loads(PROJECT_SKILLS_FILE.read_text(encoding="utf-8"))
        return {k: [ProjectSkillBinding(**item) for item in v] for k, v in data.items()}
    except Exception:
        return {}


def _save_project_skills(bindings: dict[str, list[ProjectSkillBinding]]) -> None:
    """Save project-skill bindings to disk"""
    PROJECT_SKILLS_FILE.parent.mkdir(parents=True, exist_ok=True)
    data = {k: [item.model_dump() for item in v] for k, v in bindings.items()}
    PROJECT_SKILLS_FILE.write_text(json.dumps(data, indent=2, default=str), encoding="utf-8")


# Skill CRUD operations

def create_skill(name: str, content: str, description: str = "", category: str = "general", tags: list[str] = None) -> Skill:
    """Create a new skill"""
    skills = _load_skills()
    skill = Skill(
        name=name,
        content=content,
        description=description,
        category=category,
        tags=tags or []
    )
    skills[skill.id] = skill
    _save_skills(skills)
    return skill


def get_skill(skill_id: str) -> Optional[Skill]:
    """Get a skill by ID"""
    skills = _load_skills()
    return skills.get(skill_id)


def list_skills(category: Optional[str] = None, tag: Optional[str] = None) -> list[Skill]:
    """List all skills, optionally filtered by category or tag"""
    skills = _load_skills()
    result = list(skills.values())

    if category:
        result = [s for s in result if s.category == category]

    if tag:
        result = [s for s in result if tag in s.tags]

    return sorted(result, key=lambda s: s.name)


def update_skill(skill_id: str, **kwargs) -> Optional[Skill]:
    """Update a skill"""
    skills = _load_skills()
    skill = skills.get(skill_id)
    if not skill:
        return None

    for key, value in kwargs.items():
        if hasattr(skill, key):
            setattr(skill, key, value)

    from datetime import datetime
    skill.updated_at = datetime.utcnow()

    skills[skill_id] = skill
    _save_skills(skills)
    return skill


def delete_skill(skill_id: str) -> bool:
    """Delete a skill and remove all bindings"""
    skills = _load_skills()
    if skill_id not in skills:
        return False

    del skills[skill_id]
    _save_skills(skills)

    # Remove all bindings to this skill
    project_skills = _load_project_skills()
    for project_id, bindings in project_skills.items():
        project_skills[project_id] = [b for b in bindings if b.skill_id != skill_id]
    _save_project_skills(project_skills)

    return True


# Project-Skill binding operations

def bind_skill_to_project(project_id: str, skill_id: str, priority: int = 5) -> Optional[ProjectSkillBinding]:
    """Bind a skill to a project"""
    # Verify skill exists
    skill = get_skill(skill_id)
    if not skill:
        return None

    project_skills = _load_project_skills()
    bindings = project_skills.get(project_id, [])

    # Check if already bound
    for binding in bindings:
        if binding.skill_id == skill_id:
            binding.enabled = True
            binding.priority = priority
            _save_project_skills(project_skills)
            return binding

    # Create new binding
    binding = ProjectSkillBinding(
        project_id=project_id,
        skill_id=skill_id,
        priority=priority
    )
    bindings.append(binding)
    project_skills[project_id] = bindings
    _save_project_skills(project_skills)
    return binding


def unbind_skill_from_project(project_id: str, skill_id: str) -> bool:
    """Remove a skill binding from a project"""
    project_skills = _load_project_skills()
    bindings = project_skills.get(project_id, [])

    original_count = len(bindings)
    bindings = [b for b in bindings if b.skill_id != skill_id]

    if len(bindings) == original_count:
        return False

    project_skills[project_id] = bindings
    _save_project_skills(project_skills)
    return True


def get_project_skills(project_id: str, enabled_only: bool = True) -> list[tuple[Skill, ProjectSkillBinding]]:
    """Get all skills bound to a project, with their bindings"""
    project_skills = _load_project_skills()
    bindings = project_skills.get(project_id, [])

    if enabled_only:
        bindings = [b for b in bindings if b.enabled]

    # Sort by priority (higher first)
    bindings = sorted(bindings, key=lambda b: b.priority, reverse=True)

    result = []
    all_skills = _load_skills()
    for binding in bindings:
        skill = all_skills.get(binding.skill_id)
        if skill:
            result.append((skill, binding))

    return result


def update_project_skill_binding(project_id: str, skill_id: str, enabled: Optional[bool] = None, priority: Optional[int] = None) -> Optional[ProjectSkillBinding]:
    """Update a project-skill binding"""
    project_skills = _load_project_skills()
    bindings = project_skills.get(project_id, [])

    for binding in bindings:
        if binding.skill_id == skill_id:
            if enabled is not None:
                binding.enabled = enabled
            if priority is not None:
                binding.priority = priority
            _save_project_skills(project_skills)
            return binding

    return None


def get_skills_prompt_for_project(project_id: str) -> str:
    """Generate the skills section for system prompt"""
    project_skills = get_project_skills(project_id, enabled_only=True)

    if not project_skills:
        return ""

    sections = []
    for skill, binding in project_skills:
        sections.append(f"""
### {skill.name} (Priority: {binding.priority}/10)
{skill.content}
""")

    return "\n".join(sections)


# Default skills initialization

def init_default_skills():
    """Initialize default skills if none exist"""
    skills = _load_skills()
    if skills:
        return

    defaults = [
        {
            "name": "代码审查专家",
            "description": "专注于代码质量、最佳实践和潜在问题",
            "content": """When reviewing code:
1. Check for code quality and readability
2. Identify potential bugs or edge cases
3. Suggest performance improvements
4. Ensure consistent style and naming conventions
5. Verify error handling is comprehensive
6. Check for security vulnerabilities

Provide specific, actionable feedback with code examples when possible.""",
            "category": "coding",
            "tags": ["review", "quality", "best-practices"]
        },
        {
            "name": "调试助手",
            "description": "帮助诊断和修复代码问题",
            "content": """When debugging:
1. Analyze error messages and stack traces carefully
2. Identify the root cause, not just symptoms
3. Suggest minimal changes to fix the issue
4. Explain why the fix works
5. Recommend ways to prevent similar issues

Focus on systematic problem-solving and clear explanations.""",
            "category": "debugging",
            "tags": ["debug", "troubleshoot", "fix"]
        },
        {
            "name": "API 设计顾问",
            "description": "RESTful API 设计最佳实践",
            "content": """When designing or reviewing APIs:
1. Follow RESTful principles and conventions
2. Use consistent naming (nouns for resources, plural forms)
3. Return appropriate HTTP status codes
4. Include proper error responses with helpful messages
5. Consider versioning strategy
6. Document parameters, response formats, and examples
7. Think about pagination for list endpoints

Prioritize clarity, consistency, and developer experience.""",
            "category": "coding",
            "tags": ["api", "rest", "design"]
        },
        {
            "name": "Git 工作流助手",
            "description": "Git 提交和分支管理最佳实践",
            "content": """When working with Git:
1. Write clear, descriptive commit messages
2. Use conventional commit format (type: description)
3. Keep commits focused and atomic
4. Create meaningful branch names (feature/, bugfix/, hotfix/)
5. Consider the impact on other developers
6. Follow the project's branching strategy
7. Review changes before committing

Common types: feat, fix, docs, style, refactor, test, chore""",
            "category": "general",
            "tags": ["git", "workflow", "commit"]
        },
    ]

    for skill_data in defaults:
        create_skill(**skill_data)
