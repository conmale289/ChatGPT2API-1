from __future__ import annotations

import json
from typing import Any

from sqlalchemy import Column, String, Text, create_engine, Integer, text
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker

from services.storage.base import StorageBackend

Base = declarative_base()


class AccountModel(Base):
    """Account data model"""
    __tablename__ = "accounts"

    id = Column(Integer, primary_key=True, autoincrement=True)
    access_token = Column(String(2048), unique=True, nullable=False, index=True)
    data = Column(Text, nullable=False)  # Store complete account data in JSON format


class AuthKeyModel(Base):
    """Authentication key data model"""
    __tablename__ = "auth_keys"

    id = Column(Integer, primary_key=True, autoincrement=True)
    key_id = Column(String(255), unique=True, nullable=False, index=True)
    data = Column(Text, nullable=False)


class GalleryItemModel(Base):
    """Gallery item data model.
    Same storage mode as accounts/auth_keys (primary key + business_key + JSON data):
    Business fields are stuffed into the data JSON, and listing/filtering is handled by the service layer with in-memory sorting and pagination.
    Data volume is expected to be small (public releases ≪ total generated), so no index/column splitting is necessary.
    """
    __tablename__ = "gallery_items"

    id = Column(Integer, primary_key=True, autoincrement=True)
    item_id = Column(String(64), unique=True, nullable=False, index=True)
    data = Column(Text, nullable=False)


class ChatConversationModel(Base):
    __tablename__ = "chat_conversations"

    id = Column(Integer, primary_key=True, autoincrement=True)
    conversation_id = Column(String(64), unique=True, nullable=False, index=True)
    data = Column(Text, nullable=False)


class DatabaseStorageBackend(StorageBackend):
    """Database storage backend (supports SQLite, PostgreSQL, MySQL, etc.)"""

    def __init__(self, database_url: str):
        self.database_url = database_url
        self.engine = create_engine(
            database_url,
            pool_pre_ping=True,  # Automatically detect if connection is valid
            pool_recycle=3600,   # Recycle connection after 1 hour
        )
        Base.metadata.create_all(self.engine)
        self.Session = sessionmaker(bind=self.engine)

    def load_accounts(self) -> list[dict[str, Any]]:
        """Load account data from the database"""
        session = self.Session()
        try:
            accounts = []
            for row in session.query(AccountModel).all():
                try:
                    account_data = json.loads(row.data)
                    if isinstance(account_data, dict):
                        accounts.append(account_data)
                except json.JSONDecodeError:
                    continue
            return accounts
        finally:
            session.close()

    def save_accounts(self, accounts: list[dict[str, Any]]) -> None:
        """Save account data to the database"""
        self._save_rows(AccountModel, accounts, "access_token")

    def load_auth_keys(self) -> list[dict[str, Any]]:
        """Load authentication key data from the database"""
        return self._load_rows(AuthKeyModel)

    def save_auth_keys(self, auth_keys: list[dict[str, Any]]) -> None:
        """Save authentication key data to the database"""
        self._save_rows(AuthKeyModel, auth_keys, "id", "key_id")

    def load_gallery_items(self) -> list[dict[str, Any]]:
        """Load gallery items from the database"""
        return self._load_rows(GalleryItemModel)

    def save_gallery_items(self, items: list[dict[str, Any]]) -> None:
        """Save gallery items to the database"""
        self._save_rows(GalleryItemModel, items, "id", "item_id")

    def load_chat_conversations(self) -> list[dict[str, Any]]:
        return self._load_rows(ChatConversationModel)

    def save_chat_conversations(self, items: list[dict[str, Any]]) -> None:
        self._save_rows(ChatConversationModel, items, "id", "conversation_id")

    def _load_rows(self, model: type[AccountModel] | type[AuthKeyModel] | type[GalleryItemModel] | type[ChatConversationModel]) -> list[dict[str, Any]]:
        session = self.Session()
        try:
            items = []
            for row in session.query(model).all():
                try:
                    item_data = json.loads(row.data)
                    if isinstance(item_data, dict):
                        items.append(item_data)
                except json.JSONDecodeError:
                    continue
            return items
        finally:
            session.close()

    def _save_rows(
        self,
        model: type[AccountModel] | type[AuthKeyModel] | type[GalleryItemModel] | type[ChatConversationModel],
        items: list[dict[str, Any]],
        source_key: str,
        target_key: str | None = None,
    ) -> None:
        session = self.Session()
        try:
            session.query(model).delete()
            for item in items:
                if not isinstance(item, dict):
                    continue
                key_value = str(item.get(source_key) or "").strip()
                if not key_value:
                    continue
                session.add(
                    model(
                        **{target_key or source_key: key_value},
                        data=json.dumps(item, ensure_ascii=False),
                    )
                )
            session.commit()
        except Exception as e:
            session.rollback()
            raise e
        finally:
            session.close()

    def health_check(self) -> dict[str, Any]:
        """Health check"""
        try:
            session = self.Session()
            try:
                # Attempt to execute simple query
                session.execute(text("SELECT 1"))
                count = session.query(AccountModel).count()
                auth_key_count = session.query(AuthKeyModel).count()
                gallery_count = session.query(GalleryItemModel).count()
                chat_conversation_count = session.query(ChatConversationModel).count()
                return {
                    "status": "healthy",
                    "backend": "database",
                    "database_url": self._mask_password(self.database_url),
                    "account_count": count,
                    "auth_key_count": auth_key_count,
                    "gallery_count": gallery_count,
                    "chat_conversation_count": chat_conversation_count,
                }
            finally:
                session.close()
        except Exception as e:
            return {
                "status": "unhealthy",
                "backend": "database",
                "error": str(e),
            }

    def get_backend_info(self) -> dict[str, Any]:
        """Get storage backend information"""
        db_type = "unknown"
        if "sqlite" in self.database_url:
            db_type = "sqlite"
        elif "postgresql" in self.database_url or "postgres" in self.database_url:
            db_type = "postgresql"
        elif "mysql" in self.database_url:
            db_type = "mysql"
        
        return {
            "type": "database",
            "db_type": db_type,
            "description": f"Database storage ({db_type})",
            "database_url": self._mask_password(self.database_url),
        }

    @staticmethod
    def _mask_password(url: str) -> str:
        """Hide password in database connection string"""
        if "://" not in url:
            return url
        try:
            protocol, rest = url.split("://", 1)
            if "@" in rest:
                credentials, host = rest.split("@", 1)
                if ":" in credentials:
                    username, _ = credentials.split(":", 1)
                    return f"{protocol}://{username}:****@{host}"
            return url
        except Exception:
            return url
