"""Database management service for MySQL connections and queries."""
from __future__ import annotations

import json
import re
from contextlib import contextmanager
from dataclasses import dataclass
from typing import Any, Optional

from ai_company.core.config import settings
from ai_company.core.exceptions import AICompanyError

# MySQL support is optional
try:
    import pymysql
    from pymysql.cursors import DictCursor
    MYSQL_AVAILABLE = True
except ImportError:
    MYSQL_AVAILABLE = False

DB_CONFIG_FILE = settings.data_dir / "db_connections.json"


@dataclass
class DBConnection:
    id: str
    name: str
    host: str
    port: int
    database: str
    username: str
    password: str  # Stored encrypted in production should use proper encryption
    project_id: Optional[str] = None

    def to_dict(self, mask_password: bool = True) -> dict:
        result = {
            "id": self.id,
            "name": self.name,
            "host": self.host,
            "port": self.port,
            "database": self.database,
            "username": self.username,
            "project_id": self.project_id,
        }
        if not mask_password:
            result["password"] = self.password
        return result


@dataclass
class QueryResult:
    columns: list[str]
    rows: list[dict[str, Any]]
    row_count: int
    execution_time_ms: float
    affected_rows: int = 0
    message: str = ""
    is_select: bool = True


def _load_connections() -> dict[str, DBConnection]:
    """Load all database connections from file."""
    if not DB_CONFIG_FILE.exists():
        return {}
    try:
        data = json.loads(DB_CONFIG_FILE.read_text(encoding="utf-8"))
        return {
            conn_id: DBConnection(
                id=conn_id,
                name=info.get("name", "Unnamed"),
                host=info.get("host", "localhost"),
                port=info.get("port", 3306),
                database=info.get("database", ""),
                username=info.get("username", ""),
                password=info.get("password", ""),
                project_id=info.get("project_id"),
            )
            for conn_id, info in data.items()
        }
    except Exception as e:
        raise AICompanyError(f"Failed to load database connections: {e}")


def _save_connections(connections: dict[str, DBConnection]) -> None:
    """Save all database connections to file."""
    try:
        DB_CONFIG_FILE.parent.mkdir(parents=True, exist_ok=True)
        data = {
            conn_id: conn.to_dict(mask_password=False)
            for conn_id, conn in connections.items()
        }
        DB_CONFIG_FILE.write_text(json.dumps(data, indent=2), encoding="utf-8")
    except Exception as e:
        raise AICompanyError(f"Failed to save database connections: {e}")


@contextmanager
def _get_connection(conn: DBConnection):
    """Context manager for database connections."""
    if not MYSQL_AVAILABLE:
        raise AICompanyError("MySQL support not available. Install pymysql: pip install pymysql")

    db_conn = None
    try:
        db_conn = pymysql.connect(
            host=conn.host,
            port=conn.port,
            user=conn.username,
            password=conn.password,
            database=conn.database if conn.database else None,
            cursorclass=DictCursor,
            charset='utf8mb4',
        )
        yield db_conn
    except pymysql.Error as e:
        raise AICompanyError(f"Database connection failed: {e}")
    finally:
        if db_conn:
            db_conn.close()


def _generate_connection_id() -> str:
    """Generate a unique connection ID."""
    import uuid
    return str(uuid.uuid4())[:8]


# Public API

def list_connections(project_id: Optional[str] = None) -> list[dict]:
    """List all database connections, optionally filtered by project."""
    connections = _load_connections()
    result = []
    for conn in connections.values():
        if project_id is None or conn.project_id == project_id:
            result.append(conn.to_dict(mask_password=True))
    return sorted(result, key=lambda x: x["name"])


def get_connection(conn_id: str) -> Optional[DBConnection]:
    """Get a database connection by ID."""
    connections = _load_connections()
    return connections.get(conn_id)


def create_connection(
    name: str,
    host: str,
    port: int,
    database: str,
    username: str,
    password: str,
    project_id: Optional[str] = None,
) -> DBConnection:
    """Create a new database connection."""
    connections = _load_connections()

    conn_id = _generate_connection_id()
    conn = DBConnection(
        id=conn_id,
        name=name,
        host=host,
        port=port,
        database=database,
        username=username,
        password=password,
        project_id=project_id,
    )

    # Test connection before saving
    test_connection(conn)

    connections[conn_id] = conn
    _save_connections(connections)
    return conn


def update_connection(
    conn_id: str,
    name: Optional[str] = None,
    host: Optional[str] = None,
    port: Optional[int] = None,
    database: Optional[str] = None,
    username: Optional[str] = None,
    password: Optional[str] = None,
) -> DBConnection:
    """Update an existing database connection."""
    connections = _load_connections()

    if conn_id not in connections:
        raise AICompanyError(f"Connection not found: {conn_id}")

    conn = connections[conn_id]

    if name is not None:
        conn.name = name
    if host is not None:
        conn.host = host
    if port is not None:
        conn.port = port
    if database is not None:
        conn.database = database
    if username is not None:
        conn.username = username
    if password is not None:
        conn.password = password

    # Test connection after update
    test_connection(conn)

    _save_connections(connections)
    return conn


def delete_connection(conn_id: str) -> bool:
    """Delete a database connection."""
    connections = _load_connections()

    if conn_id not in connections:
        return False

    del connections[conn_id]
    _save_connections(connections)
    return True


def test_connection(conn: DBConnection) -> dict:
    """Test a database connection."""
    if not MYSQL_AVAILABLE:
        raise AICompanyError("MySQL support not available. Install pymysql: pip install pymysql")

    try:
        with _get_connection(conn) as db_conn:
            with db_conn.cursor() as cursor:
                cursor.execute("SELECT VERSION() as version")
                result = cursor.fetchone()
                return {
                    "success": True,
                    "version": result.get("version") if result else "Unknown",
                    "message": "Connection successful",
                }
    except AICompanyError:
        raise
    except Exception as e:
        raise AICompanyError(f"Connection test failed: {e}")


def test_connection_by_id(conn_id: str) -> dict:
    """Test a database connection by ID."""
    conn = get_connection(conn_id)
    if not conn:
        raise AICompanyError(f"Connection not found: {conn_id}")
    return test_connection(conn)


def execute_query(conn_id: str, sql: str, limit: int = 1000) -> QueryResult:
    """Execute a SQL query and return results."""
    import time

    conn = get_connection(conn_id)
    if not conn:
        raise AICompanyError(f"Connection not found: {conn_id}")

    # Basic SQL injection prevention - only allow SELECT, SHOW, DESCRIBE, EXPLAIN
    sql_clean = sql.strip().upper()
    is_readonly = (
        sql_clean.startswith("SELECT") or
        sql_clean.startswith("SHOW") or
        sql_clean.startswith("DESCRIBE") or
        sql_clean.startswith("DESC ") or
        sql_clean.startswith("EXPLAIN")
    )

    if not is_readonly:
        raise AICompanyError("Only SELECT, SHOW, DESCRIBE, and EXPLAIN queries are allowed for safety")

    start_time = time.time()

    try:
        with _get_connection(conn) as db_conn:
            with db_conn.cursor() as cursor:
                cursor.execute(sql)

                execution_time = (time.time() - start_time) * 1000

                # Get column names from cursor description
                columns = [desc[0] for desc in cursor.description] if cursor.description else []

                # Fetch results with limit
                rows = cursor.fetchmany(limit) if limit > 0 else cursor.fetchall()

                # Convert to list of dicts (already DictCursor, but ensure serializable)
                rows = [dict(row) for row in rows]

                return QueryResult(
                    columns=columns,
                    rows=rows,
                    row_count=len(rows),
                    execution_time_ms=round(execution_time, 2),
                    message=f"Query executed successfully",
                    is_select=True,
                )
    except AICompanyError:
        raise
    except Exception as e:
        raise AICompanyError(f"Query execution failed: {e}")


def list_databases(conn_id: str) -> list[str]:
    """List all databases on the server."""
    conn = get_connection(conn_id)
    if not conn:
        raise AICompanyError(f"Connection not found: {conn_id}")

    try:
        with _get_connection(conn) as db_conn:
            with db_conn.cursor() as cursor:
                cursor.execute("SHOW DATABASES")
                return [row["Database"] for row in cursor.fetchall()]
    except AICompanyError:
        raise
    except Exception as e:
        raise AICompanyError(f"Failed to list databases: {e}")


def list_tables(conn_id: str, database: Optional[str] = None) -> list[dict]:
    """List all tables in a database."""
    conn = get_connection(conn_id)
    if not conn:
        raise AICompanyError(f"Connection not found: {conn_id}")

    try:
        with _get_connection(conn) as db_conn:
            with db_conn.cursor() as cursor:
                if database:
                    cursor.execute(f"USE `{database}`")
                cursor.execute("SHOW TABLES")
                tables = []
                for row in cursor.fetchall():
                    table_name = list(row.values())[0]
                    tables.append({"name": table_name})
                return tables
    except AICompanyError:
        raise
    except Exception as e:
        raise AICompanyError(f"Failed to list tables: {e}")


def describe_table(conn_id: str, table_name: str, database: Optional[str] = None) -> list[dict]:
    """Describe a table structure."""
    conn = get_connection(conn_id)
    if not conn:
        raise AICompanyError(f"Connection not found: {conn_id}")

    try:
        with _get_connection(conn) as db_conn:
            with db_conn.cursor() as cursor:
                if database:
                    cursor.execute(f"USE `{database}`")
                cursor.execute(f"DESCRIBE `{table_name}`")
                return [dict(row) for row in cursor.fetchall()]
    except AICompanyError:
        raise
    except Exception as e:
        raise AICompanyError(f"Failed to describe table: {e}")


def get_table_info(conn_id: str, table_name: str, database: Optional[str] = None) -> dict:
    """Get detailed information about a table."""
    conn = get_connection(conn_id)
    if not conn:
        raise AICompanyError(f"Connection not found: {conn_id}")

    try:
        with _get_connection(conn) as db_conn:
            with db_conn.cursor() as cursor:
                if database:
                    cursor.execute(f"USE `{database}`")

                # Get table structure
                cursor.execute(f"DESCRIBE `{table_name}`")
                columns = [dict(row) for row in cursor.fetchall()]

                # Get row count (approximate)
                cursor.execute(f"SHOW TABLE STATUS LIKE '{table_name}'")
                status = cursor.fetchone()

                # Get indexes
                cursor.execute(f"SHOW INDEX FROM `{table_name}`")
                indexes = [dict(row) for row in cursor.fetchall()]

                return {
                    "name": table_name,
                    "columns": columns,
                    "indexes": indexes,
                    "row_count": status.get("Rows") if status else None,
                    "engine": status.get("Engine") if status else None,
                    "charset": status.get("Collation") if status else None,
                }
    except AICompanyError:
        raise
    except Exception as e:
        raise AICompanyError(f"Failed to get table info: {e}")
