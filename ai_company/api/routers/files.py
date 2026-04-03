from __future__ import annotations

from pathlib import Path

from fastapi import APIRouter, Body, HTTPException

from ai_company.core.exceptions import ProjectNotFoundError
from ai_company.services.project_service import get_project

router = APIRouter()

MAX_READ_SIZE = 2 * 1024 * 1024  # 2MB
MAX_WRITE_SIZE = 2 * 1024 * 1024  # 2MB

TEXT_EXTENSIONS = {
    ".txt", ".md", ".json", ".js", ".ts", ".jsx", ".tsx", ".mjs", ".cjs",
    ".py", ".java", ".go", ".rs", ".c", ".cpp", ".h", ".hpp", ".cs",
    ".rb", ".php", ".swift", ".kt", ".scala", ".sh", ".bash", ".zsh",
    ".yaml", ".yml", ".toml", ".ini", ".cfg", ".conf", ".properties",
    ".html", ".htm", ".css", ".scss", ".sass", ".less", ".xml", ".svg",
    ".sql", ".graphql", ".prisma", ".dockerfile", ".gitignore",
    ".env", ".env.example", ".eslintrc", ".prettierrc", ".babelrc",
    ".lock", ".log", ".csv", ".tsv", ".gitattributes",
}

BINARY_EXTENSIONS = {
    ".png", ".jpg", ".jpeg", ".gif", ".bmp", ".webp", ".ico", ".svgz",
    ".mp3", ".mp4", ".avi", ".mov", ".wmv", ".flv", ".mkv",
    ".pdf", ".doc", ".docx", ".xls", ".xlsx", ".ppt", ".pptx",
    ".zip", ".rar", ".7z", ".tar", ".gz", ".bz2", ".xz",
    ".exe", ".dll", ".so", ".dylib", ".class", ".jar", ".war", ".ear",
    ".o", ".a", ".lib", ".obj", ".pyc", ".pyo",
    ".woff", ".woff2", ".ttf", ".otf", ".eot",
    ".wasm", ".map",
}


def _resolve_path(project_id: str, rel_path: str) -> Path:
    try:
        project = get_project(project_id)
    except ProjectNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc))

    base = Path(project.path).resolve()
    target = (base / rel_path.lstrip("/")) if rel_path else base
    target = target.resolve()

    # Prevent path traversal
    if not str(target).startswith(str(base)):
        raise HTTPException(status_code=400, detail="Invalid path")
    return target


def _is_text_file(path: Path) -> bool:
    ext = path.suffix.lower()
    if ext in TEXT_EXTENSIONS:
        return True
    if ext in BINARY_EXTENSIONS:
        return False
    # Try reading first bytes for null byte heuristic
    try:
        with open(path, "rb") as f:
            chunk = f.read(8192)
            return b"\x00" not in chunk
    except Exception:
        return False


@router.get("/{project_id}")
def read_file_or_list(project_id: str, path: str = ""):
    target = _resolve_path(project_id, path)

    if target.is_dir():
        items = []
        try:
            entries = sorted(target.iterdir(), key=lambda e: (not e.is_dir(), e.name.lower()))
        except PermissionError:
            raise HTTPException(status_code=403, detail="Permission denied")
        for entry in entries:
            try:
                stat = entry.stat()
                items.append({
                    "name": entry.name,
                    "path": str(entry.relative_to(Path(get_project(project_id).path).resolve())).replace("\\", "/"),
                    "is_dir": entry.is_dir(),
                    "size": stat.st_size,
                    "mtime": stat.st_mtime,
                })
            except Exception:
                pass
        return {
            "type": "directory",
            "path": path,
            "items": items,
        }

    if not target.is_file():
        raise HTTPException(status_code=404, detail="File not found")

    size = target.stat().st_size
    if size > MAX_READ_SIZE:
        return {
            "type": "file",
            "path": path,
            "name": target.name,
            "size": size,
            "readable": False,
            "reason": "File too large",
        }

    is_text = _is_text_file(target)
    if not is_text:
        return {
            "type": "file",
            "path": path,
            "name": target.name,
            "size": size,
            "readable": False,
            "reason": "Binary file",
        }

    try:
        content = target.read_text(encoding="utf-8", errors="replace")
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Read failed: {exc}")

    return {
        "type": "file",
        "path": path,
        "name": target.name,
        "size": size,
        "readable": True,
        "content": content,
    }


@router.post("/{project_id}")
def write_file(project_id: str, path: str, content: str = Body(..., embed=True)):
    target = _resolve_path(project_id, path)

    if target.is_dir():
        raise HTTPException(status_code=400, detail="Path is a directory")

    if len(content.encode("utf-8")) > MAX_WRITE_SIZE:
        raise HTTPException(status_code=400, detail="Content too large")

    # Only allow writing text files
    if target.exists() and not _is_text_file(target):
        raise HTTPException(status_code=400, detail="Binary files cannot be edited")

    try:
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(content, encoding="utf-8")
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Write failed: {exc}")

    return {"ok": True, "path": path, "size": target.stat().st_size}


@router.delete("/{project_id}")
def delete_file_or_dir(project_id: str, path: str):
    target = _resolve_path(project_id, path)

    if not target.exists():
        raise HTTPException(status_code=404, detail="File not found")

    try:
        if target.is_dir():
            import shutil
            shutil.rmtree(target)
        else:
            target.unlink()
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Delete failed: {exc}")

    return {"ok": True}
