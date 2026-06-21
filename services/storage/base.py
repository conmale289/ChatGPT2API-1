from __future__ import annotations

from abc import ABC, abstractmethod
from typing import Any


class StorageBackend(ABC):
    """Abstract storage backend base class"""

    @abstractmethod
    def load_accounts(self) -> list[dict[str, Any]]:
        """Load all account data"""
        pass

    @abstractmethod
    def save_accounts(self, accounts: list[dict[str, Any]]) -> None:
        """Save all account data"""
        pass

    @abstractmethod
    def load_auth_keys(self) -> list[dict[str, Any]]:
        """Load all authentication key data"""
        pass

    @abstractmethod
    def save_auth_keys(self, auth_keys: list[dict[str, Any]]) -> None:
        """Save all authentication key data"""
        pass

    @abstractmethod
    def load_gallery_items(self) -> list[dict[str, Any]]:
        """Load all gallery items"""
        pass

    @abstractmethod
    def save_gallery_items(self, items: list[dict[str, Any]]) -> None:
        """Save all gallery items"""
        pass

    def load_chat_conversations(self) -> list[dict[str, Any]]:
        """Load all chat conversations; return empty when the old backend has not implemented this to avoid startup failure."""
        return []

    def save_chat_conversations(self, items: list[dict[str, Any]]) -> None:
        """Save all chat conversations; default noop, subclasses override as needed."""
        return None

    @abstractmethod
    def health_check(self) -> dict[str, Any]:
        """Health check, returns storage backend status"""
        pass

    @abstractmethod
    def get_backend_info(self) -> dict[str, Any]:
        """Get storage backend information"""
        pass
