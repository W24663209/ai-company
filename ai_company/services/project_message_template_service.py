"""Project message template service for custom work message formats"""
from __future__ import annotations

import json
from dataclasses import dataclass, field
from pathlib import Path
from typing import Optional

from ai_company.core.config import settings
from ai_company.core.exceptions import AICompanyError

TEMPLATE_FILE = settings.data_dir / "project_message_templates.json"


@dataclass
class MessageField:
    name: str
    label: str
    field_type: str  # 'text', 'file', 'textarea', 'select', 'number'
    required: bool = False
    placeholder: str = ""
    options: list[str] = field(default_factory=list)  # For select type

    def to_dict(self) -> dict:
        return {
            "name": self.name,
            "label": self.label,
            "type": self.field_type,
            "required": self.required,
            "placeholder": self.placeholder,
            "options": self.options
        }

    @classmethod
    def from_dict(cls, data: dict) -> MessageField:
        return cls(
            name=data.get("name", ""),
            label=data.get("label", ""),
            field_type=data.get("type", "text"),
            required=data.get("required", False),
            placeholder=data.get("placeholder", ""),
            options=data.get("options", [])
        )


@dataclass
class ProjectMessageTemplate:
    project_id: str
    fields: list[MessageField] = field(default_factory=list)

    def to_dict(self) -> dict:
        return {
            "project_id": self.project_id,
            "fields": [f.to_dict() for f in self.fields]
        }

    @classmethod
    def from_dict(cls, data: dict) -> ProjectMessageTemplate:
        return cls(
            project_id=data.get("project_id", ""),
            fields=[MessageField.from_dict(f) for f in data.get("fields", [])]
        )


def _load_templates() -> dict[str, ProjectMessageTemplate]:
    """Load all project message templates"""
    if not TEMPLATE_FILE.exists():
        return {}
    try:
        data = json.loads(TEMPLATE_FILE.read_text(encoding="utf-8"))
        return {k: ProjectMessageTemplate.from_dict(v) for k, v in data.items()}
    except Exception as e:
        print(f"Error loading templates: {e}")
        return {}


def _save_templates(templates: dict[str, ProjectMessageTemplate]) -> None:
    """Save all project message templates"""
    TEMPLATE_FILE.parent.mkdir(parents=True, exist_ok=True)
    data = {k: v.to_dict() for k, v in templates.items()}
    TEMPLATE_FILE.write_text(json.dumps(data, indent=2), encoding="utf-8")


def get_template(project_id: str) -> Optional[ProjectMessageTemplate]:
    """Get message template for a project"""
    templates = _load_templates()
    return templates.get(project_id)


def get_or_create_template(project_id: str) -> ProjectMessageTemplate:
    """Get or create default template for a project"""
    templates = _load_templates()

    if project_id in templates:
        return templates[project_id]

    # Create default template - same as frontend default
    template = ProjectMessageTemplate(
        project_id=project_id,
        fields=[
            MessageField(
                name="docking_doc",
                label="对接文档",
                field_type="file",
                required=False,
                placeholder="上传对接文档或从共享文档选择"
            ),
            MessageField(
                name="shared_docs",
                label="共享文档",
                field_type="file",
                required=False,
                placeholder="从共享目录选择文档"
            ),
            MessageField(
                name="route_id",
                label="路由ID",
                field_type="text",
                required=False,
                placeholder="例如: /api/users"
            ),
            MessageField(
                name="requirement",
                label="需求",
                field_type="textarea",
                required=True,
                placeholder="描述具体需求..."
            )
        ]
    )

    templates[project_id] = template
    _save_templates(templates)
    return template


def update_template(project_id: str, fields: list[dict]) -> ProjectMessageTemplate:
    """Update message template for a project"""
    templates = _load_templates()

    template = ProjectMessageTemplate(
        project_id=project_id,
        fields=[MessageField.from_dict(f) for f in fields]
    )

    templates[project_id] = template
    _save_templates(templates)
    return template


def delete_template(project_id: str) -> bool:
    """Delete message template for a project"""
    templates = _load_templates()

    if project_id not in templates:
        return False

    del templates[project_id]
    _save_templates(templates)
    return True


def get_default_field_types() -> list[dict]:
    """Get available field types with descriptions"""
    return [
        {"type": "text", "label": "单行文本", "description": "短文本输入"},
        {"type": "textarea", "label": "多行文本", "description": "长文本输入，可换行"},
        {"type": "file", "label": "文件上传", "description": "支持上传文件"},
        {"type": "select", "label": "下拉选择", "description": "从选项中选择"},
        {"type": "number", "label": "数字", "description": "数值输入"}
    ]
