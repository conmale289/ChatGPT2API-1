from __future__ import annotations

import hashlib
import hmac
import secrets
import uuid
from datetime import date, datetime, timezone
from threading import Lock
from typing import Literal

from services.config import config
from services.storage.base import StorageBackend

AuthRole = Literal["admin", "user"]
AccountTier = Literal["free", "premium"]
QuotaKind = Literal[
    "image_daily",
    "image_monthly",
    "image_total",
    "chat_daily",
    "chat_monthly",
    "chat_total",
]

# Three tiers for both image and chat: daily, monthly, total. A deduction will apply to all three tiers; any tier used up results in rejection.
# The total tier is not reset periodically. The daily/monthly tiers have their used count cleared on natural daily/monthly transitions.
_IMAGE_KINDS: tuple[QuotaKind, ...] = ("image_daily", "image_monthly", "image_total")
_CHAT_KINDS: tuple[QuotaKind, ...] = ("chat_daily", "chat_monthly", "chat_total")
_PERIODIC_KINDS: tuple[QuotaKind, ...] = (
    "image_daily",
    "image_monthly",
    "chat_daily",
    "chat_monthly",
)


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _hash_key(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def _today_key() -> str:
    """Natural day in the server's local timezone, used for daily quota transition check."""
    return date.today().isoformat()


def _this_month_key() -> str:
    """Natural month in the server's local timezone, used for monthly quota transition check."""
    today = date.today()
    return f"{today.year:04d}-{today.month:02d}"


def _is_daily_kind(kind: QuotaKind) -> bool:
    return kind.endswith("_daily")


def _is_monthly_kind(kind: QuotaKind) -> bool:
    return kind.endswith("_monthly")


class AuthService:
    def __init__(self, storage: StorageBackend):
        self.storage = storage
        self._lock = Lock()
        self._items = self._load()
        self._last_used_flush_at: dict[str, datetime] = {}

    @staticmethod
    def _clean(value: object) -> str:
        return str(value or "").strip()

    @staticmethod
    def _default_name(role: object) -> str:
        return "Admin Key" if str(role or "").strip().lower() == "admin" else "Standard User"

    @staticmethod
    def _coerce_int(value: object, default: int = 0) -> int:
        try:
            return max(0, int(value))
        except (TypeError, ValueError):
            return default

    @staticmethod
    def _coerce_bool(value: object, default: bool = False) -> bool:
        if value is None:
            return default
        return bool(value)

    @classmethod
    def _normalize_account_tier(cls, value: object, *, role: object = "user") -> AccountTier:
        if str(role or "").strip().lower() == "admin":
            return "premium"
        raw = cls._clean(value).lower().replace("-", "_").replace(" ", "_")
        compact = raw.replace("_", "")
        if compact in {"premium", "advanced", "paid", "plus", "pro", "team", "enterprise", "vip", "high"}:
            return "premium"
        return "free"

    @classmethod
    def _can_use_paid_image_accounts(cls, item: dict[str, object]) -> bool:
        role = cls._clean(item.get("role")).lower()
        return role == "admin" or cls._normalize_account_tier(item.get("account_tier"), role=role) == "premium"

    def _normalize_item(self, raw: object) -> dict[str, object] | None:
        if not isinstance(raw, dict):
            return None
        role = self._clean(raw.get("role")).lower()
        if role not in {"admin", "user"}:
            return None
        key_hash = self._clean(raw.get("key_hash"))
        if not key_hash:
            return None
        item_id = self._clean(raw.get("id")) or uuid.uuid4().hex[:12]
        name = self._clean(raw.get("name")) or self._default_name(role)
        created_at = self._clean(raw.get("created_at")) or _now_iso()
        last_used_at = self._clean(raw.get("last_used_at")) or None
        # Only preserve plaintext for the user role to display/copy in the admin console. Admin role authenticates via config.auth_key
        # and should not have plaintext stored here; filter it out.
        key_plain = self._clean(raw.get("key")) if role == "user" else ""
        account_tier = self._normalize_account_tier(
            raw.get("account_tier", raw.get("image_account_tier")),
            role=role,
        )

        # Image quota transition rules:
        #   - If image_total_quota exists: read in current format.
        #   - Otherwise, map image_quota / quota (legacy one-time total quota) -> image_total_quota, daily/monthly default to unlimited.
        #   - Existing users with three default unlimited tiers continue to retain chat capabilities (same as chat three-tier transition logic).
        legacy_total = raw.get("image_total_quota") is None
        if legacy_total:
            legacy_image_quota = self._coerce_int(raw.get("image_quota", raw.get("quota")), 0)
            legacy_image_used = self._coerce_int(raw.get("image_used", raw.get("used")), 0)
            legacy_image_unlimited = self._coerce_bool(
                raw.get("image_unlimited", raw.get("unlimited")), False
            )
            image_total_quota = legacy_image_quota
            image_total_used = legacy_image_used
            image_total_unlimited = legacy_image_unlimited
        else:
            image_total_quota = self._coerce_int(raw.get("image_total_quota"), 0)
            image_total_used = self._coerce_int(raw.get("image_total_used"), 0)
            image_total_unlimited = self._coerce_bool(raw.get("image_total_unlimited"), False)

        image_daily_quota = self._coerce_int(raw.get("image_daily_quota"), 0)
        image_daily_used = self._coerce_int(raw.get("image_daily_used"), 0)
        image_daily_unlimited = self._coerce_bool(
            raw.get("image_daily_unlimited"), default="image_daily_quota" not in raw
        )
        image_daily_reset_at = self._clean(raw.get("image_daily_reset_at")) or _today_key()
        image_monthly_quota = self._coerce_int(raw.get("image_monthly_quota"), 0)
        image_monthly_used = self._coerce_int(raw.get("image_monthly_used"), 0)
        image_monthly_unlimited = self._coerce_bool(
            raw.get("image_monthly_unlimited"), default="image_monthly_quota" not in raw
        )
        image_monthly_reset_at = self._clean(raw.get("image_monthly_reset_at")) or _this_month_key()

        chat_daily_quota = self._coerce_int(raw.get("chat_daily_quota"), 0)
        chat_daily_used = self._coerce_int(raw.get("chat_daily_used"), 0)
        chat_daily_unlimited = self._coerce_bool(
            raw.get("chat_daily_unlimited"), default="chat_daily_quota" not in raw
        )
        chat_daily_reset_at = self._clean(raw.get("chat_daily_reset_at")) or _today_key()
        chat_monthly_quota = self._coerce_int(raw.get("chat_monthly_quota"), 0)
        chat_monthly_used = self._coerce_int(raw.get("chat_monthly_used"), 0)
        chat_monthly_unlimited = self._coerce_bool(
            raw.get("chat_monthly_unlimited"), default="chat_monthly_quota" not in raw
        )
        chat_monthly_reset_at = self._clean(raw.get("chat_monthly_reset_at")) or _this_month_key()
        chat_total_quota = self._coerce_int(raw.get("chat_total_quota"), 0)
        chat_total_used = self._coerce_int(raw.get("chat_total_used"), 0)
        chat_total_unlimited = self._coerce_bool(
            raw.get("chat_total_unlimited"), default="chat_total_quota" not in raw
        )

        # Admin always has all six tiers enabled, all counters reset to zero to block dirty data.
        if role == "admin":
            image_daily_quota = image_daily_used = 0
            image_monthly_quota = image_monthly_used = 0
            image_total_quota = image_total_used = 0
            chat_daily_quota = chat_daily_used = 0
            chat_monthly_quota = chat_monthly_used = 0
            chat_total_quota = chat_total_used = 0
            image_daily_unlimited = True
            image_monthly_unlimited = True
            image_total_unlimited = True
            chat_daily_unlimited = True
            chat_monthly_unlimited = True
            chat_total_unlimited = True

        return {
            "id": item_id,
            "name": name,
            "role": role,
            "key_hash": key_hash,
            "key": key_plain,
            "account_tier": account_tier,
            "enabled": bool(raw.get("enabled", True)),
            "created_at": created_at,
            "last_used_at": last_used_at,
            "image_daily_quota": image_daily_quota,
            "image_daily_used": image_daily_used,
            "image_daily_unlimited": image_daily_unlimited,
            "image_daily_reset_at": image_daily_reset_at,
            "image_monthly_quota": image_monthly_quota,
            "image_monthly_used": image_monthly_used,
            "image_monthly_unlimited": image_monthly_unlimited,
            "image_monthly_reset_at": image_monthly_reset_at,
            "image_total_quota": image_total_quota,
            "image_total_used": image_total_used,
            "image_total_unlimited": image_total_unlimited,
            "chat_daily_quota": chat_daily_quota,
            "chat_daily_used": chat_daily_used,
            "chat_daily_unlimited": chat_daily_unlimited,
            "chat_daily_reset_at": chat_daily_reset_at,
            "chat_monthly_quota": chat_monthly_quota,
            "chat_monthly_used": chat_monthly_used,
            "chat_monthly_unlimited": chat_monthly_unlimited,
            "chat_monthly_reset_at": chat_monthly_reset_at,
            "chat_total_quota": chat_total_quota,
            "chat_total_used": chat_total_used,
            "chat_total_unlimited": chat_total_unlimited,
        }

    @staticmethod
    def _apply_period_reset(item: dict[str, object]) -> bool:
        """Reset the corresponding used counts to 0 when crossing a natural day/month; returns whether the item was modified.
        Total quota is not reset. Applies to daily/monthly for both image and chat sides."""
        changed = False
        today_key = _today_key()
        month_key = _this_month_key()
        for kind in _PERIODIC_KINDS:
            target_key = today_key if _is_daily_kind(kind) else month_key
            if item.get(f"{kind}_reset_at") != target_key:
                item[f"{kind}_used"] = 0
                item[f"{kind}_reset_at"] = target_key
                changed = True
        return changed

    def _load(self) -> list[dict[str, object]]:
        try:
            items = self.storage.load_auth_keys()
        except Exception:
            return []
        if not isinstance(items, list):
            return []
        return [normalized for item in items if (normalized := self._normalize_item(item)) is not None]

    def _save(self) -> None:
        self.storage.save_auth_keys(self._items)

    def _reload_locked(self) -> None:
        self._items = self._load()

    @staticmethod
    def _remaining(quota: int, used: int, unlimited: bool) -> int | None:
        if unlimited:
            return None
        return max(0, quota - used)

    @classmethod
    def _public_item(cls, item: dict[str, object]) -> dict[str, object]:
        result: dict[str, object] = {
            "id": item.get("id"),
            "name": item.get("name"),
            "role": item.get("role"),
            "enabled": bool(item.get("enabled", True)),
            "created_at": item.get("created_at"),
            "last_used_at": item.get("last_used_at"),
            "account_tier": cls._normalize_account_tier(item.get("account_tier"), role=item.get("role")),
            "can_use_paid_image_accounts": cls._can_use_paid_image_accounts(item),
            "can_use_high_resolution": cls._can_use_paid_image_accounts(item),
            # Only expose "whether it can be revealed to admin"; the actual plaintext must be retrieved separately via get_raw_key.
            "key_visible": bool(item.get("role") == "user" and cls._clean(item.get("key"))),
        }
        for kind in (*_IMAGE_KINDS, *_CHAT_KINDS):
            quota = cls._coerce_int(item.get(f"{kind}_quota"), 0)
            used = cls._coerce_int(item.get(f"{kind}_used"), 0)
            unlimited = bool(item.get(f"{kind}_unlimited", False))
            result[f"{kind}_quota"] = quota
            result[f"{kind}_used"] = used
            result[f"{kind}_unlimited"] = unlimited
            result[f"{kind}_remaining"] = cls._remaining(quota, used, unlimited)
        return result

    def list_keys(self, role: AuthRole | None = None) -> list[dict[str, object]]:
        with self._lock:
            self._reload_locked()
            # Perform periodic reset during list reads as well to avoid the frontend displaying stale daily_used.
            dirty = False
            for item in self._items:
                if str(item.get("role") or "").strip().lower() == "admin":
                    continue
                if self._apply_period_reset(item):
                    dirty = True
            if dirty:
                try:
                    self._save()
                except Exception:
                    pass
            items = [item for item in self._items if role is None or item.get("role") == role]
            return [self._public_item(item) for item in items]

    def _has_key_hash_locked(self, key_hash: str, *, exclude_id: str = "") -> bool:
        for item in self._items:
            item_id = self._clean(item.get("id"))
            if exclude_id and item_id == exclude_id:
                continue
            stored_hash = self._clean(item.get("key_hash"))
            if stored_hash and hmac.compare_digest(stored_hash, key_hash):
                return True
        return False

    def _build_key_hash_locked(self, raw_key: str, *, exclude_id: str = "") -> str:
        candidate = self._clean(raw_key)
        if not candidate:
            raise ValueError("Please enter a new dedicated key")
        admin_key = self._clean(config.auth_key)
        if admin_key and hmac.compare_digest(candidate, admin_key):
            raise ValueError("This key conflicts with the admin key, please choose a new key")
        key_hash = _hash_key(candidate)
        if self._has_key_hash_locked(key_hash, exclude_id=exclude_id):
            raise ValueError("This dedicated key already exists, please choose a new key")
        return key_hash

    def _has_name_locked(self, name: str, *, role: AuthRole | None = None, exclude_id: str = "") -> bool:
        candidate = self._clean(name)
        if not candidate:
            return False
        for item in self._items:
            item_id = self._clean(item.get("id"))
            if exclude_id and item_id == exclude_id:
                continue
            if role is not None and item.get("role") != role:
                continue
            if self._clean(item.get("name")) == candidate:
                return True
        return False

    def _build_default_name_locked(self, role: AuthRole, *, exclude_id: str = "") -> str:
        base_name = self._default_name(role)
        if not self._has_name_locked(base_name, role=role, exclude_id=exclude_id):
            return base_name
        suffix = 2
        while True:
            candidate = f"{base_name} {suffix}"
            if not self._has_name_locked(candidate, role=role, exclude_id=exclude_id):
                return candidate
            suffix += 1

    def _build_name_locked(self, name: str, *, role: AuthRole, exclude_id: str = "") -> str:
        candidate = self._clean(name)
        if not candidate:
            return self._build_default_name_locked(role, exclude_id=exclude_id)
        if self._has_name_locked(candidate, role=role, exclude_id=exclude_id):
            raise ValueError("This name is already in use, please choose a more distinct name")
        return candidate

    @classmethod
    def _validate_quota_hierarchy(cls, item: dict[str, object]) -> None:
        """Within the same service, shorter cycle limits cannot exceed longer cycle limits.

        unlimited means that tier is not subject to constraints; e.g. when total is unlimited, monthly can be set arbitrarily.
        However, if both monthly and total are limited, setting monthly larger than total makes no sense and confuses users/frontend.
        """

        def check(
            smaller_kind: QuotaKind,
            larger_kind: QuotaKind,
            smaller_label: str,
            larger_label: str,
        ) -> None:
            if bool(item.get(f"{smaller_kind}_unlimited", False)):
                return
            if bool(item.get(f"{larger_kind}_unlimited", False)):
                return
            smaller_quota = cls._coerce_int(item.get(f"{smaller_kind}_quota"), 0)
            larger_quota = cls._coerce_int(item.get(f"{larger_kind}_quota"), 0)
            if smaller_quota > larger_quota:
                raise ValueError(f"{smaller_label} cannot be greater than {larger_label}")

        check("image_daily", "image_monthly", "Image daily limit", "Image monthly limit")
        check("image_daily", "image_total", "Image daily limit", "Image total quota")
        check("image_monthly", "image_total", "Image monthly limit", "Image total quota")
        check("chat_daily", "chat_monthly", "Chat daily limit", "Chat monthly limit")
        check("chat_daily", "chat_total", "Chat daily limit", "Chat total quota")
        check("chat_monthly", "chat_total", "Chat monthly limit", "Chat total quota")

    def create_key(
        self,
        *,
        role: AuthRole,
        name: str = "",
        key: str = "",
        image_daily_quota: int = 0,
        image_daily_unlimited: bool = True,
        image_monthly_quota: int = 0,
        image_monthly_unlimited: bool = True,
        image_total_quota: int = 0,
        image_total_unlimited: bool = False,
        chat_daily_quota: int = 0,
        chat_daily_unlimited: bool = True,
        chat_monthly_quota: int = 0,
        chat_monthly_unlimited: bool = True,
        chat_total_quota: int = 0,
        chat_total_unlimited: bool = True,
        account_tier: AccountTier | str = "free",
    ) -> tuple[dict[str, object], str]:
        with self._lock:
            self._reload_locked()
            normalized_name = self._build_name_locked(name, role=role)
            custom_key = self._clean(key)
            if custom_key:
                # Custom key uses the same validation as "change key in edit": non-empty, no admin key conflict, no duplicate user keys.
                key_hash = self._build_key_hash_locked(custom_key)
                raw_key = custom_key
            else:
                while True:
                    raw_key = f"sk-{secrets.token_urlsafe(24)}"
                    try:
                        key_hash = self._build_key_hash_locked(raw_key)
                        break
                    except ValueError:
                        continue
            is_admin = role == "admin"
            item = {
                "id": uuid.uuid4().hex[:12],
                "name": normalized_name,
                "role": role,
                "key_hash": key_hash,
                # admin does not store plaintext: admin auth uses config.auth_key, not auth_keys.json.
                "key": "" if is_admin else raw_key,
                "account_tier": self._normalize_account_tier(account_tier, role=role),
                "enabled": True,
                "created_at": _now_iso(),
                "last_used_at": None,
                "image_daily_quota": 0 if is_admin else self._coerce_int(image_daily_quota, 0),
                "image_daily_used": 0,
                "image_daily_unlimited": True if is_admin else bool(image_daily_unlimited),
                "image_daily_reset_at": _today_key(),
                "image_monthly_quota": 0 if is_admin else self._coerce_int(image_monthly_quota, 0),
                "image_monthly_used": 0,
                "image_monthly_unlimited": True if is_admin else bool(image_monthly_unlimited),
                "image_monthly_reset_at": _this_month_key(),
                "image_total_quota": 0 if is_admin else self._coerce_int(image_total_quota, 0),
                "image_total_used": 0,
                "image_total_unlimited": True if is_admin else bool(image_total_unlimited),
                "chat_daily_quota": 0 if is_admin else self._coerce_int(chat_daily_quota, 0),
                "chat_daily_used": 0,
                "chat_daily_unlimited": True if is_admin else bool(chat_daily_unlimited),
                "chat_daily_reset_at": _today_key(),
                "chat_monthly_quota": 0 if is_admin else self._coerce_int(chat_monthly_quota, 0),
                "chat_monthly_used": 0,
                "chat_monthly_unlimited": True if is_admin else bool(chat_monthly_unlimited),
                "chat_monthly_reset_at": _this_month_key(),
                "chat_total_quota": 0 if is_admin else self._coerce_int(chat_total_quota, 0),
                "chat_total_used": 0,
                "chat_total_unlimited": True if is_admin else bool(chat_total_unlimited),
            }
            if not is_admin:
                self._validate_quota_hierarchy(item)
            self._items.append(item)
            self._save()
            return self._public_item(item), raw_key

    def update_key(
        self,
        key_id: str,
        updates: dict[str, object],
        *,
        role: AuthRole | None = None,
    ) -> dict[str, object] | None:
        normalized_id = self._clean(key_id)
        if not normalized_id:
            return None
        with self._lock:
            self._reload_locked()
            for index, item in enumerate(self._items):
                if item.get("id") != normalized_id:
                    continue
                if role is not None and item.get("role") != role:
                    return None
                next_item = dict(item)
                next_role = "admin" if str(next_item.get("role") or "").strip().lower() == "admin" else "user"
                if "name" in updates and updates.get("name") is not None:
                    next_item["name"] = self._build_name_locked(
                        str(updates.get("name") or ""),
                        role=next_role,
                        exclude_id=normalized_id,
                    )
                if "enabled" in updates and updates.get("enabled") is not None:
                    next_item["enabled"] = bool(updates.get("enabled"))
                if "key" in updates and updates.get("key") is not None:
                    raw_candidate = self._clean(str(updates.get("key") or ""))
                    next_item["key_hash"] = self._build_key_hash_locked(raw_candidate, exclude_id=normalized_id)
                    next_item["key"] = "" if next_role == "admin" else raw_candidate
                if next_role == "user":
                    if "account_tier" in updates and updates.get("account_tier") is not None:
                        next_item["account_tier"] = self._normalize_account_tier(
                            updates.get("account_tier"),
                            role=next_role,
                        )
                    should_validate_quota = self._has_quota_config_updates(updates)
                    self._apply_quota_updates_locked(next_item, updates)
                    if should_validate_quota:
                        self._validate_quota_hierarchy(next_item)
                else:
                    # admin forces all tiers to be unlimited, related counters are always zeroed to prevent external malicious writes.
                    for kind in (*_IMAGE_KINDS, *_CHAT_KINDS):
                        next_item[f"{kind}_quota"] = 0
                        next_item[f"{kind}_used"] = 0
                        next_item[f"{kind}_unlimited"] = True
                    next_item["account_tier"] = "premium"
                self._items[index] = next_item
                self._save()
                return self._public_item(next_item)
        return None

    @classmethod
    def _apply_quota_updates_locked(cls, target: dict[str, object], updates: dict[str, object]) -> None:
        """Write the quota-related fields passed in update_key to target, keeping admin path unaffected.
        Every tier quota and unlimited are passed through literally; reset_<kind>_used zeroes the corresponding used count and refreshes reset_at.
        Legacy reset_used is equivalent to reset_image_total_used to avoid errors on legacy admin clients during release.
        """
        for kind in (*_IMAGE_KINDS, *_CHAT_KINDS):
            quota_key = f"{kind}_quota"
            unlimited_key = f"{kind}_unlimited"
            if quota_key in updates and updates.get(quota_key) is not None:
                target[quota_key] = cls._coerce_int(updates.get(quota_key), 0)
            if unlimited_key in updates and updates.get(unlimited_key) is not None:
                target[unlimited_key] = bool(updates.get(unlimited_key))
            reset_key = f"reset_{kind}_used"
            if updates.get(reset_key):
                target[f"{kind}_used"] = 0
                if _is_daily_kind(kind):
                    target[f"{kind}_reset_at"] = _today_key()
                elif _is_monthly_kind(kind):
                    target[f"{kind}_reset_at"] = _this_month_key()
        if updates.get("reset_used"):
            # Legacy frontend protocol; maps to image total quota counter.
            target["image_total_used"] = 0

    @staticmethod
    def _has_quota_config_updates(updates: dict[str, object]) -> bool:
        for kind in (*_IMAGE_KINDS, *_CHAT_KINDS):
            if f"{kind}_quota" in updates or f"{kind}_unlimited" in updates:
                return True
        return False

    def get_by_id(self, key_id: str) -> dict[str, object] | None:
        normalized_id = self._clean(key_id)
        if not normalized_id:
            return None
        with self._lock:
            for index, item in enumerate(self._items):
                if item.get("id") != normalized_id:
                    continue
                # Run periodic reset when reading a single item as well, so that when frontend fetches its own identity, it sees current balances.
                next_item = dict(item)
                if self._apply_period_reset(next_item):
                    self._items[index] = next_item
                    try:
                        self._save()
                    except Exception:
                        pass
                return self._public_item(next_item)
        return None

    def _consume_kinds_locked(
        self,
        key_id: str,
        amount: int,
        kinds: tuple[QuotaKind, ...],
        block_label_map: dict[str, str],
    ) -> dict[str, object]:
        """Deduct a set of kinds in a locked context (rejections if any tier is insufficient).
        Admins are directly released; the returned structure aligns with semantics on both image and chat sides."""
        delta = max(0, int(amount or 0))
        if not key_id or delta == 0:
            return {"ok": True, "remaining": None, "unlimited": True, "reason": ""}
        for index, item in enumerate(self._items):
            if item.get("id") != key_id:
                continue
            role = str(item.get("role") or "").strip().lower()
            if role == "admin":
                return {"ok": True, "remaining": None, "unlimited": True, "reason": ""}
            next_item = dict(item)
            self._apply_period_reset(next_item)
            blocked: list[str] = []
            snapshots: list[tuple[QuotaKind, int, int, bool]] = []
            for kind in kinds:
                quota = self._coerce_int(next_item.get(f"{kind}_quota"), 0)
                used = self._coerce_int(next_item.get(f"{kind}_used"), 0)
                unlimited = bool(next_item.get(f"{kind}_unlimited", False))
                snapshots.append((kind, quota, used, unlimited))
                # unlimited only bypasses the quota limit validation; used is still accumulated as usual,
                # ensuring that when an admin switches to a limit later, historical usage data for "daily ⊂ monthly ⊂ total" is not lost.
                if unlimited:
                    continue
                if max(0, quota - used) < delta:
                    blocked.append(kind)
            if blocked:
                return {
                    "ok": False,
                    "blocked": blocked,
                    "unlimited": False,
                    "reason": _block_reason(blocked, block_label_map),
                    # Legacy protocol field: the image side entrance reads remaining to decide toast content.
                    "remaining": _remaining_snapshot(next_item, kinds),
                }
            # Validation passed: all tiers (including unlimited) add delta to used,
            # so that daily / monthly / total used counts maintain "inclusion relationship", not missed because a tier is unlimited.
            for kind, quota, used, unlimited in snapshots:
                next_item[f"{kind}_used"] = used + delta
            self._items[index] = next_item
            try:
                self._save()
            except Exception:
                self._items[index] = item
                raise
            return {
                "ok": True,
                "unlimited": False,
                "reason": "",
                "remaining": _remaining_snapshot(next_item, kinds),
            }
        return {"ok": False, "remaining": 0, "unlimited": False, "reason": "Key does not exist"}

    def _refund_kinds_locked(
        self,
        key_id: str,
        amount: int,
        kinds: tuple[QuotaKind, ...],
    ) -> dict[str, object]:
        delta = max(0, int(amount or 0))
        if not key_id or delta == 0:
            return {"ok": True, "remaining": None, "unlimited": True, "reason": ""}
        for index, item in enumerate(self._items):
            if item.get("id") != key_id:
                continue
            role = str(item.get("role") or "").strip().lower()
            if role == "admin":
                return {"ok": True, "remaining": None, "unlimited": True, "reason": ""}
            next_item = dict(item)
            self._apply_period_reset(next_item)
            changed = False
            for kind in kinds:
                # Symmetric with _consume_kinds_locked: unlimited tier also accumulated used at that time,
                # refunds must symmetrically deduct it back, otherwise used count will monotonically rise.
                used = self._coerce_int(next_item.get(f"{kind}_used"), 0)
                if used <= 0:
                    continue
                next_item[f"{kind}_used"] = max(0, used - delta)
                changed = True
            if not changed:
                return {"ok": True, "unlimited": False, "reason": "", "remaining": _remaining_snapshot(next_item, kinds)}
            self._items[index] = next_item
            try:
                self._save()
            except Exception:
                self._items[index] = item
                raise
            return {
                "ok": True,
                "unlimited": False,
                "reason": "",
                "remaining": _remaining_snapshot(next_item, kinds),
            }
        return {"ok": False, "remaining": 0, "unlimited": False, "reason": "Key does not exist"}

    def consume_image_quota(self, key_id: str, amount: int) -> dict[str, object]:
        """Deduct image quota of user key (daily / monthly / total deducted simultaneously).
        admin fully bypassed; direct rejection if any tier has insufficient remainder (API layer returns 402)."""
        normalized_id = self._clean(key_id)
        with self._lock:
            return self._consume_kinds_locked(normalized_id, amount, _IMAGE_KINDS, _IMAGE_KIND_LABEL)

    def refund_image_quota(self, key_id: str, amount: int) -> dict[str, object]:
        """Symmetrically refund all three image tiers when upstream image generation genuinely fails."""
        normalized_id = self._clean(key_id)
        with self._lock:
            return self._refund_kinds_locked(normalized_id, amount, _IMAGE_KINDS)

    # Compatible with legacy names (used in imports by image_task_service or other modules).
    consume_quota = consume_image_quota
    refund_quota = refund_image_quota

    def consume_chat_quota(self, key_id: str, amount: int = 1) -> dict[str, object]:
        """Deduct chat quota of user key (daily / monthly / total deducted simultaneously)."""
        normalized_id = self._clean(key_id)
        with self._lock:
            return self._consume_kinds_locked(normalized_id, amount, _CHAT_KINDS, _CHAT_KIND_LABEL)

    def refund_chat_quota(self, key_id: str, amount: int = 1) -> dict[str, object]:
        normalized_id = self._clean(key_id)
        with self._lock:
            return self._refund_kinds_locked(normalized_id, amount, _CHAT_KINDS)

    def reveal_key(self, key_id: str, *, role: AuthRole | None = None) -> dict[str, object] | None:
        """Read raw plaintext key for admin backend; only valid for user role.
        Returns {"key": str, "key_visible": bool}: key_visible=False if legacy data does not store plaintext,
        frontend prompts admin to proceed with "reset key" workflow."""
        normalized_id = self._clean(key_id)
        if not normalized_id:
            return None
        with self._lock:
            self._reload_locked()
            for item in self._items:
                if item.get("id") != normalized_id:
                    continue
                if role is not None and item.get("role") != role:
                    return None
                if str(item.get("role") or "").strip().lower() != "user":
                    return None
                plain = self._clean(item.get("key"))
                return {"key": plain, "key_visible": bool(plain)}
        return None

    def regenerate_key(self, key_id: str, *, role: AuthRole | None = None, key: str = "") -> tuple[dict[str, object], str] | None:
        """Used for legacy data "reset and echo": replace with new key (saves plaintext + hash), old key immediately invalidated.
        admin role is not allowed to use this path. If key is provided, use custom value, otherwise auto-generate."""
        normalized_id = self._clean(key_id)
        if not normalized_id:
            return None
        with self._lock:
            self._reload_locked()
            for index, item in enumerate(self._items):
                if item.get("id") != normalized_id:
                    continue
                if role is not None and item.get("role") != role:
                    return None
                if str(item.get("role") or "").strip().lower() != "user":
                    return None
                custom_key = self._clean(key)
                if custom_key:
                    key_hash = self._build_key_hash_locked(custom_key, exclude_id=normalized_id)
                    raw_key = custom_key
                else:
                    while True:
                        raw_key = f"sk-{secrets.token_urlsafe(24)}"
                        try:
                            key_hash = self._build_key_hash_locked(raw_key, exclude_id=normalized_id)
                            break
                        except ValueError:
                            continue
                next_item = dict(item)
                next_item["key_hash"] = key_hash
                next_item["key"] = raw_key
                self._items[index] = next_item
                self._save()
                return self._public_item(next_item), raw_key
        return None

    def delete_key(self, key_id: str, *, role: AuthRole | None = None) -> bool:
        normalized_id = self._clean(key_id)
        if not normalized_id:
            return False
        with self._lock:
            self._reload_locked()
            before = len(self._items)
            self._items = [
                item
                for item in self._items
                if not (item.get("id") == normalized_id and (role is None or item.get("role") == role))
            ]
            if len(self._items) == before:
                return False
            self._save()
            return True

    def authenticate(self, raw_key: str) -> dict[str, object] | None:
        candidate = self._clean(raw_key)
        if not candidate:
            return None
        candidate_hash = _hash_key(candidate)
        with self._lock:
            for index, item in enumerate(self._items):
                if not bool(item.get("enabled", True)):
                    continue
                stored_hash = self._clean(item.get("key_hash"))
                if not stored_hash or not hmac.compare_digest(stored_hash, candidate_hash):
                    continue
                next_item = dict(item)
                now = datetime.now(timezone.utc)
                next_item["last_used_at"] = now.isoformat()
                self._items[index] = next_item
                item_id = self._clean(next_item.get("id"))
                last_flush_at = self._last_used_flush_at.get(item_id)
                if last_flush_at is None or (now - last_flush_at).total_seconds() >= 60:
                    try:
                        self._save()
                        self._last_used_flush_at[item_id] = now
                    except Exception:
                        pass
                return self._public_item(next_item)
        return None


_IMAGE_KIND_LABEL = {
    "image_daily": "Daily image quota",
    "image_monthly": "Monthly image quota",
    "image_total": "Total image quota",
}

_CHAT_KIND_LABEL = {
    "chat_daily": "Daily chat quota",
    "chat_monthly": "Monthly chat quota",
    "chat_total": "Total chat quota",
}


def _block_reason(blocked: list[str], label_map: dict[str, str]) -> str:
    labels = [label_map.get(kind, kind) for kind in blocked]
    return ", ".join(labels) + " used up, please contact admin to add quota and try again"


def _remaining_snapshot(item: dict[str, object], kinds: tuple[QuotaKind, ...]) -> dict[str, int | None]:
    """Snapshot of current remaining limits for specified kinds, for real-time frontend display."""
    snapshot: dict[str, int | None] = {}
    for kind in kinds:
        quota = AuthService._coerce_int(item.get(f"{kind}_quota"), 0)
        used = AuthService._coerce_int(item.get(f"{kind}_used"), 0)
        unlimited = bool(item.get(f"{kind}_unlimited", False))
        snapshot[kind] = None if unlimited else max(0, quota - used)
    return snapshot


auth_service = AuthService(config.get_storage_backend())
