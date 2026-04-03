from fastapi import Request

from ai_company.core.config import Settings


def get_settings(request: Request) -> Settings:
    return request.app.state.settings
