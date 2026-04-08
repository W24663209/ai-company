"""Database management router for MySQL connections and queries."""
from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field

from ai_company.core.exceptions import AICompanyError
from ai_company.services import db_service

router = APIRouter()


class DBConnectionCreate(BaseModel):
    name: str = Field(..., description="Connection name")
    host: str = Field(default="localhost", description="Database host")
    port: int = Field(default=3306, description="Database port")
    database: str = Field(default="", description="Default database")
    username: str = Field(..., description="Database username")
    password: str = Field(..., description="Database password")
    project_id: Optional[str] = Field(default=None, description="Associated project ID")


class DBConnectionUpdate(BaseModel):
    name: Optional[str] = None
    host: Optional[str] = None
    port: Optional[int] = None
    database: Optional[str] = None
    username: Optional[str] = None
    password: Optional[str] = None


class QueryExecute(BaseModel):
    sql: str = Field(..., description="SQL query to execute")
    limit: int = Field(default=1000, description="Maximum rows to return")


@router.get("/connections")
def list_connections(project_id: Optional[str] = Query(None)):
    """List all database connections."""
    return db_service.list_connections(project_id)


@router.post("/connections")
def create_connection(conn: DBConnectionCreate):
    """Create a new database connection."""
    try:
        result = db_service.create_connection(
            name=conn.name,
            host=conn.host,
            port=conn.port,
            database=conn.database,
            username=conn.username,
            password=conn.password,
            project_id=conn.project_id,
        )
        return result.to_dict(mask_password=True)
    except AICompanyError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@router.get("/connections/{conn_id}")
def get_connection(conn_id: str):
    """Get a database connection by ID."""
    conn = db_service.get_connection(conn_id)
    if not conn:
        raise HTTPException(status_code=404, detail="Connection not found")
    return conn.to_dict(mask_password=True)


@router.patch("/connections/{conn_id}")
def update_connection(conn_id: str, update: DBConnectionUpdate):
    """Update a database connection."""
    try:
        result = db_service.update_connection(
            conn_id=conn_id,
            name=update.name,
            host=update.host,
            port=update.port,
            database=update.database,
            username=update.username,
            password=update.password,
        )
        return result.to_dict(mask_password=True)
    except AICompanyError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@router.delete("/connections/{conn_id}")
def delete_connection(conn_id: str):
    """Delete a database connection."""
    if db_service.delete_connection(conn_id):
        return {"deleted": True}
    raise HTTPException(status_code=404, detail="Connection not found")


@router.post("/connections/{conn_id}/test")
def test_connection(conn_id: str):
    """Test a database connection."""
    try:
        return db_service.test_connection_by_id(conn_id)
    except AICompanyError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@router.get("/connections/{conn_id}/databases")
def list_databases(conn_id: str):
    """List all databases on the server."""
    try:
        return db_service.list_databases(conn_id)
    except AICompanyError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@router.get("/connections/{conn_id}/tables")
def list_tables(conn_id: str, database: Optional[str] = Query(None)):
    """List all tables in a database."""
    try:
        return db_service.list_tables(conn_id, database)
    except AICompanyError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@router.get("/connections/{conn_id}/tables/{table_name}")
def describe_table(conn_id: str, table_name: str, database: Optional[str] = Query(None)):
    """Describe a table structure."""
    try:
        return db_service.get_table_info(conn_id, table_name, database)
    except AICompanyError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@router.post("/connections/{conn_id}/query")
def execute_query(conn_id: str, query: QueryExecute):
    """Execute a SQL query (read-only: SELECT, SHOW, DESCRIBE, EXPLAIN)."""
    try:
        result = db_service.execute_query(conn_id, query.sql, query.limit)
        return {
            "columns": result.columns,
            "rows": result.rows,
            "row_count": result.row_count,
            "execution_time_ms": result.execution_time_ms,
            "message": result.message,
        }
    except AICompanyError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
