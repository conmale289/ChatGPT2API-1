from __future__ import annotations

import threading
import time
import uuid
from typing import Any

from services.config import config
from services.content_filter import check_request
from services.image_edits_service import is_edit as _rel_is_edit

# Gallery item storage schema (each item is a dict saved into storage.gallery_items)
#
# {
#   "id": "<uuid hex>",
#   "image_rel": "2026/05/21/abc.png",
#   "publisher_id": "<auth key id or 'admin'>",
#   "publisher_name": "<display name>",
#   "prompt": "<Nullable. Force empty for image-to-image edits because edits without reference images have no reuse value>",
#   "model": "gpt-image-2",
#   "size": "1:1",
#   "width": 0,                # Optional, used for frontend waterfall layout calculation
#   "height": 0,
#   "is_edit": false,          # true = produced by image-to-image, frontend shows instruction template instead of prompt
#   "created_at": 1716277200,  # epoch seconds
#   "status": "visible" | "hidden",
# }
#
# Using flat dict instead of ORM model, matching accounts/auth_keys; list filtering/sorting is done
# in memory at service layer. Gallery items count is expected to be much smaller than total image count, single file/table can handle it.


_lock = threading.RLock()


def _now_ts() -> int:
    return int(time.time())


def _new_id() -> str:
    return uuid.uuid4().hex


def _normalize(item: dict[str, Any]) -> dict[str, Any]:
    """Normalize keys and coerce types of gallery items loaded from storage to avoid repeated None checks."""
    if not isinstance(item, dict):
        return {}
    return {
        "id": str(item.get("id") or "").strip(),
        "image_rel": str(item.get("image_rel") or "").strip().lstrip("/"),
        "publisher_id": str(item.get("publisher_id") or "").strip(),
        "publisher_name": str(item.get("publisher_name") or "").strip(),
        "prompt": str(item.get("prompt") or ""),
        "model": str(item.get("model") or "").strip(),
        "size": str(item.get("size") or "").strip(),
        "width": int(item.get("width") or 0) if isinstance(item.get("width"), (int, float)) else 0,
        "height": int(item.get("height") or 0) if isinstance(item.get("height"), (int, float)) else 0,
        "is_edit": bool(item.get("is_edit")),
        "created_at": int(item.get("created_at") or 0) if isinstance(item.get("created_at"), (int, float)) else 0,
        "status": str(item.get("status") or "visible").strip().lower() or "visible",
    }


def _load_all() -> list[dict[str, Any]]:
    raw = config.get_storage_backend().load_gallery_items() or []
    return [_normalize(item) for item in raw if isinstance(item, dict) and item.get("id")]


def _save_all(items: list[dict[str, Any]]) -> None:
    config.get_storage_backend().save_gallery_items(items)


def _public_view(
    item: dict[str, Any],
    image_base_url: str,
    *,
    viewer_id: str = "",
) -> dict[str, Any]:
    """Format image_rel into absolute URL for public output so frontend doesn't need to know the /images prefix;
    publisher_id is not exposed to non-owners to prevent brute-forcing key IDs (only display name returned).

    viewer_id: ID of the current requestor; used to derive is_mine boolean to tell the frontend
    "I published this one" (so it can display the unpublish button) without leaking publisher_id.
    """
    rel = item.get("image_rel") or ""
    url = f"{image_base_url.rstrip('/')}/images/{rel}" if rel else ""
    pid = (item.get("publisher_id") or "").strip()
    vid = (viewer_id or "").strip()
    return {
        "id": item.get("id"),
        "url": url,
        "image_rel": rel,
        "prompt": item.get("prompt"),
        "model": item.get("model"),
        "size": item.get("size"),
        "width": item.get("width"),
        "height": item.get("height"),
        "is_edit": bool(item.get("is_edit")),
        "publisher_name": item.get("publisher_name"),
        "created_at": item.get("created_at"),
        "status": item.get("status"),
        "is_mine": bool(vid) and pid == vid,
    }


def publish(
    *,
    image_rel: str,
    publisher_id: str,
    publisher_name: str,
    prompt: str,
    model: str = "",
    size: str = "",
    width: int = 0,
    height: int = 0,
) -> dict[str, Any]:
    """Publish a new gallery item. Returns existing record if the same (publisher_id, image_rel) is already published,
    preventing duplicate entries from double-clicks or retries.

    Synchronously filters sensitive words. AI review is not performed here (high traffic volume, must not block publish);
    AI review will be run asynchronously by a background workflow when status=visible (optional, not implemented yet).
    """
    rel = (image_rel or "").strip().lstrip("/")
    if not rel:
        raise ValueError("image_rel is required")
    pid = (publisher_id or "").strip()
    if not pid:
        raise ValueError("publisher_id is required")
    # prompt can be empty - image-to-image / legacy data without prompt / active user deletion are all valid.
    # Frontend client (web /works, mobile history) provides an optional dialog to fill it, but the final choice
    # is up to the user, backend does not enforce non-empty.
    text = (prompt or "").strip()

    # Image Edits (image-to-image): prompt is an edit instruction relative to the reference image, which has no
    # reuse value for other users without seeing the original reference ("change to light color" is useless text without reference).
    # Thus, if rel is found in the image_edits set, prompt is cleared on publish, and the frontend displays a
    # "Prompt relies on reference image and cannot be reused" message card.
    is_edit_flag = False
    try:
        is_edit_flag = _rel_is_edit(rel)
    except Exception:
        is_edit_flag = False
    if is_edit_flag:
        text = ""

    # Throw HTTPException(400) if sensitive words are matched, let router propagate it.
    # Skip sensitive word check when prompt is empty.
    if text:
        check_request(text)

    with _lock:
        items = _load_all()
        for existing in items:
            if existing["publisher_id"] == pid and existing["image_rel"] == rel:
                # Duplicate publish of the same image by the same owner: update fields (user might have changed prompt),
                # and restore status to visible (in case it was unpublished before).
                existing.update(
                    {
                        "prompt": text,
                        "model": (model or "").strip(),
                        "size": (size or "").strip(),
                        "width": int(width or 0),
                        "height": int(height or 0),
                        "is_edit": is_edit_flag,
                        "status": "visible",
                    }
                )
                _save_all(items)
                return existing

        new_item = {
            "id": _new_id(),
            "image_rel": rel,
            "publisher_id": pid,
            "publisher_name": (publisher_name or "").strip() or "Anonymous",
            "prompt": text,
            "model": (model or "").strip(),
            "size": (size or "").strip(),
            "width": int(width or 0),
            "height": int(height or 0),
            "is_edit": is_edit_flag,
            "created_at": _now_ts(),
            "status": "visible",
        }
        items.append(new_item)
        _save_all(items)
        return new_item


def unpublish(item_id: str, *, requester_id: str, is_admin: bool) -> bool:
    """User retracts / Admin deletes. Owner can delete own item; admin can delete any item.
    Returns True if successfully deleted, False otherwise (not exists / unauthorized)."""
    iid = (item_id or "").strip()
    if not iid:
        return False
    with _lock:
        items = _load_all()
        idx = next((i for i, it in enumerate(items) if it["id"] == iid), -1)
        if idx < 0:
            return False
        target = items[idx]
        if not is_admin and target["publisher_id"] != requester_id:
            return False
        items.pop(idx)
        _save_all(items)
        return True


def admin_set_status(item_id: str, status: str) -> bool:
    """Admin soft-remove / restore. status: visible | hidden.
    Returns True if changed, False otherwise (not exists / status unchanged)."""
    iid = (item_id or "").strip()
    next_status = (status or "").strip().lower()
    if not iid or next_status not in ("visible", "hidden"):
        return False
    with _lock:
        items = _load_all()
        idx = next((i for i, it in enumerate(items) if it["id"] == iid), -1)
        if idx < 0:
            return False
        if items[idx]["status"] == next_status:
            return False
        items[idx]["status"] = next_status
        _save_all(items)
        return True


def list_feed(
    *,
    cursor: str | None,
    limit: int,
    image_base_url: str,
    include_hidden: bool = False,
    viewer_id: str = "",
) -> dict[str, Any]:
    """Cursor pagination: sorted by created_at desc, id desc.
    cursor = "<created_at>:<id>", the next page is fetched using the last item's cursor from the current page.

    Compared to offset pagination: won't skip/duplicate entries on list additions/deletions; admin can
    frequently hide items while maintaining stable pagination.

    viewer_id: ID of the current requester, passed to _public_view to derive is_mine.
    """
    items = _load_all()
    if not include_hidden:
        items = [it for it in items if it["status"] == "visible"]
    items.sort(key=lambda it: (it["created_at"], it["id"]), reverse=True)

    start_idx = 0
    if cursor:
        # If cursor parsing fails, treat it as no cursor so the user can start from the beginning
        try:
            ts_str, cid = cursor.split(":", 1)
            ts = int(ts_str)
            for i, it in enumerate(items):
                if (it["created_at"], it["id"]) < (ts, cid):
                    start_idx = i
                    break
            else:
                start_idx = len(items)
        except Exception:
            start_idx = 0

    page_size = max(1, min(int(limit or 20), 100))
    page = items[start_idx : start_idx + page_size]
    next_cursor = ""
    if start_idx + page_size < len(items) and page:
        last = page[-1]
        next_cursor = f"{last['created_at']}:{last['id']}"

    return {
        "items": [_public_view(it, image_base_url, viewer_id=viewer_id) for it in page],
        "next_cursor": next_cursor,
    }


def get_item(
    item_id: str,
    image_base_url: str,
    *,
    include_hidden: bool = False,
    viewer_id: str = "",
) -> dict[str, Any] | None:
    iid = (item_id or "").strip()
    if not iid:
        return None
    for it in _load_all():
        if it["id"] != iid:
            continue
        if not include_hidden and it["status"] != "visible":
            return None
        return _public_view(it, image_base_url, viewer_id=viewer_id)
    return None


def is_published(*, image_rel: str, publisher_id: str) -> dict[str, Any] | None:
    """Used in "My Work" cards: check if current user has published this image to the gallery.
    Returns the raw record (including status) so the frontend can differentiate between visible/hidden to display
    "Published" or "Removed"."""
    rel = (image_rel or "").strip().lstrip("/")
    pid = (publisher_id or "").strip()
    if not rel or not pid:
        return None
    for it in _load_all():
        if it["publisher_id"] == pid and it["image_rel"] == rel:
            return it
    return None


def is_published_batch(
    *,
    image_rels: list[str],
    publisher_id: str,
    check_any_publisher: bool = False,
) -> dict[str, dict[str, Any]]:
    """Batch check which image_rels have been published to the gallery.

    Default (check_any_publisher=False) filters strictly by publisher_id: used to seed publishStates on
    "My Work" page reload, avoiding sending N single requests which would exhaust browser concurrency limit.

    check_any_publisher=True: ignores publisher_id, matching any image published by any user. Used in admin
    images management page: admin is managing images from any user and only cares if the image is visible
    in the gallery, regardless of who published it. publisher_id can be empty in this mode.

    If the same rel is published by multiple people (theoretically possible, blocked by auth, but handled defensively),
    returns the latest record (first by created_at desc) to provide the newest state to frontend.

    Returns dict[rel] = record; unpublished rels are not present in keys.
    Returns {} if input list is empty (short-circuiting).
    """
    pid = (publisher_id or "").strip()
    if not check_any_publisher and not pid:
        return {}
    if not image_rels:
        return {}
    # Normalize input: strip + lstrip("/") to match publish logic
    wanted = {(r or "").strip().lstrip("/") for r in image_rels}
    wanted.discard("")
    if not wanted:
        return {}
    candidates: list[dict[str, Any]] = []
    for it in _load_all():
        if not check_any_publisher and it["publisher_id"] != pid:
            continue
        if it["image_rel"] in wanted:
            candidates.append(it)
    # If multiple users published the same image, take the newest one
    candidates.sort(key=lambda it: (it["created_at"], it["id"]), reverse=True)
    out: dict[str, dict[str, Any]] = {}
    for it in candidates:
        rel = it["image_rel"]
        if rel not in out:
            out[rel] = it
    return out
