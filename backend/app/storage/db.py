from collections.abc import Iterator
from contextlib import contextmanager

from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker

from backend.app.storage.models import Base

engine = None
SessionLocal: sessionmaker[Session] | None = None


def init_db(sqlite_url: str) -> None:
    global engine, SessionLocal
    connect_args = {"check_same_thread": False} if sqlite_url.startswith("sqlite") else {}
    engine = create_engine(sqlite_url, connect_args=connect_args)
    SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False)
    Base.metadata.create_all(bind=engine)


def get_session() -> Iterator[Session]:
    if SessionLocal is None:
        init_db("sqlite:///./backend/app/storage/polymarket_bot.db")
    assert SessionLocal is not None
    session = SessionLocal()
    try:
        yield session
    finally:
        session.close()


@contextmanager
def session_scope() -> Iterator[Session]:
    if SessionLocal is None:
        init_db("sqlite:///./backend/app/storage/polymarket_bot.db")
    assert SessionLocal is not None
    session = SessionLocal()
    try:
        yield session
    finally:
        session.close()
