from __future__ import annotations

from pathlib import Path
from threading import Event, Thread

from fastapi import HTTPException, Request

from services.account_service import account_service
from services.auth_service import auth_service
from services.config import config
from services.protocol.conversation import normalize_image_resolution
from utils.helper import split_image_model

BASE_DIR = Path(__file__).resolve().parents[1]
WEB_DIST_DIR = BASE_DIR / "web_dist"
PAID_PLAN_TYPES = ("Pro", "Plus", "Team")


def _normalize_plan_type(value: object) -> str:
    raw = str(value or "").strip().lower().replace("-", "_").replace(" ", "_")
    compact = raw.replace("_", "")
    return {
        "free": "free",
        "plus": "Plus",
        "pro": "Pro",
        "team": "Team",
        "business": "Team",
    }.get(compact, "")


def extract_bearer_token(authorization: str | None) -> str:
    scheme, _, value = str(authorization or "").partition(" ")
    if scheme.lower() != "bearer" or not value.strip():
        return ""
    return value.strip()


def _legacy_admin_identity(token: str) -> dict[str, object] | None:
    auth_key = str(config.auth_key or "").strip()
    if auth_key and token == auth_key:
        return {"id": "admin", "name": "Admin", "role": "admin"}
    return None


def require_identity(authorization: str | None) -> dict[str, object]:
    token = extract_bearer_token(authorization)
    identity = _legacy_admin_identity(token) or auth_service.authenticate(token)
    if identity is None:
        raise HTTPException(status_code=401, detail={"error": "Invalid or expired key, please log in again"})
    return identity


def require_auth_key(authorization: str | None) -> None:
    require_identity(authorization)


def require_admin(authorization: str | None) -> dict[str, object]:
    identity = require_identity(authorization)
    if identity.get("role") != "admin":
        raise HTTPException(status_code=403, detail={"error": "Administrator permissions are required to perform this action"})
    return identity


def resolve_image_base_url(request: Request) -> str:
    return config.base_url or f"{request.url.scheme}://{request.headers.get('host', request.url.netloc)}"


def raise_image_quota_error(exc: Exception) -> None:
    message = str(exc)
    if "no available image quota" in message.lower():
        raise HTTPException(status_code=429, detail={"error": "no available image quota"}) from exc
    raise HTTPException(status_code=502, detail={"error": message}) from exc


def can_use_paid_image_accounts(identity: dict[str, object]) -> bool:
    role = str(identity.get("role") or "").strip().lower()
    if role == "admin":
        return True
    if bool(identity.get("can_use_paid_image_accounts")) or bool(identity.get("can_use_high_resolution")):
        return True
    tier = str(identity.get("account_tier") or "").strip().lower()
    return tier in {"premium", "advanced", "paid", "plus", "pro", "team", "enterprise", "vip"}


def image_allowed_plan_types(identity: dict[str, object]) -> tuple[str, ...] | None:
    role = str(identity.get("role") or "").strip().lower()
    if role == "admin":
        return None
    if can_use_paid_image_accounts(identity):
        return PAID_PLAN_TYPES
    return ("free",)


def enforce_text_account_policy(identity: dict[str, object], plan_type: str | None) -> str | None:
    requested = str(plan_type or "").strip()
    role = str(identity.get("role") or "").strip().lower()
    if role == "admin":
        return requested or None
    if can_use_paid_image_accounts(identity):
        if not requested:
            return None
        normalized = _normalize_plan_type(requested)
        if normalized not in PAID_PLAN_TYPES:
            raise HTTPException(status_code=403, detail={"error": "Current user permissions only allow using Plus / Pro accounts"})
        return normalized
    if not requested:
        return "free"
    if _normalize_plan_type(requested) != "free":
        raise HTTPException(status_code=403, detail={"error": "Current user permissions only allow using Free accounts"})
    return "free"


def text_allowed_plan_types(identity: dict[str, object]) -> tuple[str, ...] | None:
    role = str(identity.get("role") or "").strip().lower()
    if role == "admin":
        return None
    if can_use_paid_image_accounts(identity):
        return PAID_PLAN_TYPES
    return ("free",)


def apply_image_account_policy(identity: dict[str, object], payload: dict[str, object]) -> dict[str, object]:
    """Apply server-side account pool constraints on image drawing requests based on user key level.
    Disabling 2K/4K on frontend is only UI experience; this is the hard limit to prevent F12 / direct API calls."""
    allowed = image_allowed_plan_types(identity)
    if allowed is None:
        return payload

    model_plan_type, base_model = split_image_model(payload.get("model"))
    requested_plan_type = _normalize_plan_type(payload.get("plan_type"))
    if can_use_paid_image_accounts(identity):
        if requested_plan_type and requested_plan_type not in allowed:
            raise HTTPException(status_code=403, detail={"error": "Current user permissions only allow using Plus / Pro accounts"})
        normalized_model_plan = _normalize_plan_type(model_plan_type)
        if normalized_model_plan and normalized_model_plan not in allowed:
            raise HTTPException(status_code=403, detail={"error": "Current user permissions only allow using Plus / Pro accounts"})
        if requested_plan_type:
            payload["plan_type"] = requested_plan_type
    else:
        if normalize_image_resolution(payload.get("resolution")) in {"2k", "4k"}:
            raise HTTPException(status_code=403, detail={"error": "Current user permissions do not support 2K/4K drawing"})
        if model_plan_type or base_model == "codex-gpt-image-2":
            raise HTTPException(status_code=403, detail={"error": "Current user permissions only allow using Free drawing accounts"})
        payload["plan_type"] = "free"
    payload["allowed_plan_types"] = allowed
    return payload


def consume_user_quota(identity: dict[str, object], amount: int) -> None:
    """Deduct drawing quota of user key at the drawing entry. Admins or unlimited users are allowed directly;
    regular users with insufficient quota get 402 directly, so frontend disables buttons and prompts to contact admin for more quota."""
    role = str(identity.get("role") or "").strip().lower()
    item_id = str(identity.get("id") or "").strip()
    if role == "admin" or not item_id or item_id == "admin":
        return
    result = auth_service.consume_image_quota(item_id, max(1, int(amount or 1)))
    if not result.get("ok"):
        reason = str(result.get("reason") or "Insufficient drawing quota")
        raise HTTPException(status_code=402, detail={"error": reason})


def refund_user_quota(identity: dict[str, object], amount: int) -> None:
    """Refund pre-deducted drawing quota when upstream fails.
    Symmetric to [consume_user_quota]: admin or unlimited users do direct noop.
 
    Invocation is limited to 'upstream actual failure' branches (content_policy / 5xx / upstream timeout / task cancellation).
    User input errors (400 / text moderation fail) go down the fail-fast path, which raises before deduction,
    so it won't reach here -- no need to distinguish reasons here.
    Any exceptions are swallowed: refund failure should not affect the error response itself.
    """
    role = str(identity.get("role") or "").strip().lower()
    item_id = str(identity.get("id") or "").strip()
    if role == "admin" or not item_id or item_id == "admin":
        return
    try:
        auth_service.refund_image_quota(item_id, max(1, int(amount or 1)))
    except Exception:
        # Do not throw on refund failure - the main flow is already returning an error response, layering another error would be worse
        pass


def consume_user_chat_quota(identity: dict[str, object], amount: int = 1) -> None:
    """Deduct conversation quota at the chat entry (deducted from daily/monthly/total simultaneously).
    Admins are allowed directly; if any category is insufficient, raises 402 directly to let the frontend disable the send button and prompt the user."""
    role = str(identity.get("role") or "").strip().lower()
    item_id = str(identity.get("id") or "").strip()
    if role == "admin" or not item_id or item_id == "admin":
        return
    result = auth_service.consume_chat_quota(item_id, max(1, int(amount or 1)))
    if not result.get("ok"):
        reason = str(result.get("reason") or "Insufficient chat quota")
        raise HTTPException(status_code=402, detail={"error": reason})


def refund_user_chat_quota(identity: dict[str, object], amount: int = 1) -> None:
    """Refund pre-deducted conversation quota when upstream actually fails (connection fail / upstream 5xx).
    Any exceptions are swallowed: refund failure should not affect the error response itself."""
    role = str(identity.get("role") or "").strip().lower()
    item_id = str(identity.get("id") or "").strip()
    if role == "admin" or not item_id or item_id == "admin":
        return
    try:
        auth_service.refund_chat_quota(item_id, max(1, int(amount or 1)))
    except Exception:
        pass


def sanitize_cpa_pool(pool: dict | None) -> dict | None:
    if not isinstance(pool, dict):
        return None
    return {key: value for key, value in pool.items() if key != "secret_key"}


def sanitize_cpa_pools(pools: list[dict]) -> list[dict]:
    return [sanitized for pool in pools if (sanitized := sanitize_cpa_pool(pool)) is not None]


def sanitize_sub2api_server(server: dict | None) -> dict | None:
    if not isinstance(server, dict):
        return None
    sanitized = {key: value for key, value in server.items() if key not in {"password", "api_key"}}
    sanitized["has_api_key"] = bool(str(server.get("api_key") or "").strip())
    return sanitized


def sanitize_sub2api_servers(servers: list[dict]) -> list[dict]:
    return [sanitized for server in servers if (sanitized := sanitize_sub2api_server(server)) is not None]


def start_limited_account_watcher(stop_event: Event) -> Thread:
    interval_seconds = config.refresh_account_interval_minute * 60

    def worker() -> None:
        while not stop_event.is_set():
            try:
                limited_tokens = account_service.list_limited_tokens()
                if limited_tokens:
                    print(f"[account-limited-watcher] checking {len(limited_tokens)} limited accounts")
                    account_service.refresh_accounts(limited_tokens)
            except Exception as exc:
                print(f"[account-limited-watcher] fail {exc}")
            stop_event.wait(interval_seconds)

    thread = Thread(target=worker, name="limited-account-watcher", daemon=True)
    thread.start()
    return thread


def resolve_web_asset(requested_path: str) -> Path | None:
    if not WEB_DIST_DIR.exists():
        return None
    clean_path = requested_path.strip("/")
    base_dir = WEB_DIST_DIR.resolve()
    candidates = [base_dir / "index.html"] if not clean_path else [
        base_dir / Path(clean_path),
        base_dir / clean_path / "index.html",
        base_dir / f"{clean_path}.html",
    ]
    for candidate in candidates:
        try:
            candidate.resolve().relative_to(base_dir)
        except ValueError:
            continue
        if candidate.is_file():
            return candidate
    return None
