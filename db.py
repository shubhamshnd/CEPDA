"""Thin psycopg2 layer. One pool for the whole app, schema passed per query."""
from contextlib import contextmanager

from psycopg2 import sql
from psycopg2.extras import RealDictCursor
from psycopg2.pool import ThreadedConnectionPool

from config import DATABASE_URL

_pool = None


def _get_pool():
    global _pool
    if _pool is None:
        _pool = ThreadedConnectionPool(1, 8, DATABASE_URL)
    return _pool


@contextmanager
def connection():
    pool = _get_pool()
    conn = pool.getconn()
    # Autocommit: read-only dashboard, and one failed query must not
    # abort the transaction for every section after it.
    conn.autocommit = True
    try:
        yield conn
    finally:
        pool.putconn(conn)


class SchemaQuery:
    """Runs SQL against one location's schema.

    Write table references as {s}.table_name; the schema is quoted safely
    with sql.Identifier, so a schema name from config can never inject SQL.
    """

    def __init__(self, conn, schema):
        self.conn = conn
        self.schema = sql.Identifier(schema)

    def _compose(self, text):
        return sql.SQL(text).format(s=self.schema)

    def all(self, text, params=None):
        with self.conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute(self._compose(text), params or {})
            return cur.fetchall()

    def one(self, text, params=None):
        rows = self.all(text, params)
        return rows[0] if rows else None

    def scalar(self, text, params=None, default=0):
        row = self.one(text, params)
        if not row:
            return default
        val = next(iter(row.values()))
        return default if val is None else val
