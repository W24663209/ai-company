import json
import os
from pathlib import Path

from fastapi import APIRouter, HTTPException, Body
from pydantic import BaseModel

router = APIRouter()


def get_global_settings_path() -> Path:
    """获取全局 settings.json 路径"""
    home = Path.home()
    return home / ".claude" / "settings.json"


class GlobalSettingsResponse(BaseModel):
    content: str


class GlobalSettingsUpdate(BaseModel):
    content: str


@router.get("/global-settings", response_model=GlobalSettingsResponse)
def get_global_settings():
    """获取全局 Claude settings.json 内容"""
    settings_path = get_global_settings_path()

    if not settings_path.exists():
        # 返回默认配置
        default_config = {
            "env": {},
            "permissions": {"allow": []},
            "skipDangerousModePermissionPrompt": False
        }
        return GlobalSettingsResponse(content=json.dumps(default_config, indent=2))

    try:
        content = settings_path.read_text(encoding="utf-8")
        return GlobalSettingsResponse(content=content)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"读取配置失败: {e}")


@router.post("/global-settings")
def update_global_settings(data: GlobalSettingsUpdate):
    """更新全局 Claude settings.json 内容"""
    settings_path = get_global_settings_path()

    # 验证 JSON 格式
    try:
        parsed = json.loads(data.content)
    except json.JSONDecodeError as e:
        raise HTTPException(status_code=400, detail=f"JSON 格式错误: {e}")

    # 确保目录存在
    settings_path.parent.mkdir(parents=True, exist_ok=True)

    try:
        # 写入文件
        settings_path.write_text(data.content, encoding="utf-8")
        return {"success": True, "message": "配置已保存"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"保存配置失败: {e}")
