from __future__ import annotations

import json
import mimetypes
import re
import threading
import time
from pathlib import Path
from typing import Any, Iterator

from fastapi import APIRouter, Header, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from api.support import (
    apply_image_account_policy,
    can_use_paid_image_accounts,
    consume_user_chat_quota,
    consume_user_quota,
    enforce_text_account_policy,
    refund_user_chat_quota,
    refund_user_quota,
    require_identity,
    text_allowed_plan_types,
)
from services.account_service import account_service
from services.chat_service import chat_service
from services.config import config
from services.image_owners_service import record_owner_for_result
from services.image_prompts_service import record_prompt_for_result
from services.log_service import LOG_TYPE_CALL, log_service
from services.protocol.conversation import (
    ConversationRequest,
    delete_conversation_safely,
    stream_chat_events,
    stream_image_outputs_with_pool,
)
from utils.helper import build_chat_image_markdown_content, extract_chat_prompt, is_supported_image_model


class ChatStreamRequest(BaseModel):
    model: str = "auto"
    messages: list[dict[str, Any]] = Field(default_factory=list)
    conversation_id: str | None = None
    force_switch_account: bool = False
    account_type: str | None = None


class ChatConversationUpsertRequest(BaseModel):
    id: str | None = None
    title: str = ""
    messages: list[dict[str, Any]] = Field(default_factory=list)
    upstream_conversation_id: str | None = None


_IMAGE_ACTION_RE = re.compile(
    r"(画|绘制|生成|做|设计|创作|制作).{0,20}(图|图片|图像|海报|头像|插画|壁纸|封面|logo|标志)"
    r"|(图|图片|图像|海报|头像|插画|壁纸|封面|logo|标志).{0,20}(画|绘制|生成|做|设计|创作|制作)",
    re.IGNORECASE,
)
_DRAW_ACTION_RE = re.compile(
    r"(^|[\s，。！？,.!?])(帮我|请|给我|帮|麻烦你)?(画|绘制)(一张|一幅|一个|个|张|幅|下|一下)?\S+",
    re.IGNORECASE,
)
_IMAGE_DISCUSSION_RE = re.compile(
    r"(怎么|如何|为什么|教程|步骤|方法|接口|api|API|代码|报错|失败|问题|原理|区别|能不能|可以吗|会不会|是什么|什么意思).{0,24}"
    r"(画|绘制|生成|做|设计|创作|制作|图|图片|图像|海报|头像|插画|壁纸|封面|logo|标志)"
    r"|(画图|绘图|生图|图片生成|图像生成|gpt-image|logo|头像).{0,24}"
    r"(怎么|如何|为什么|教程|步骤|方法|接口|api|API|代码|报错|失败|问题|原理|区别|能不能|可以吗|会不会|是什么|什么意思)",
    re.IGNORECASE,
)
_CHAT_IMAGE_MARKDOWN_RE = re.compile(r"!\[[^\]]*]\(([^)\s]+)\)")
_CHAT_IMAGE_REFERENCE_RE = re.compile(
    r"(这张|这幅|这个图|这图|上面|上图|刚刚|刚才|上一张|前一张|第一张|第二张|第三张|第1张|第2张|第3张|图片|图像|图里|画面|照片|猫那张|狗那张|头像那张|海报那张|logo那张)",
    re.IGNORECASE,
)
_CHAT_IMAGE_FOLLOWUP_RE = re.compile(
    r"(看|识别|分析|评价|描述|说说|改|修改|调整|优化|换|变成|继续|基于|参考|重画|二创|放大|修复|去掉|添加)",
    re.IGNORECASE,
)
_IMAGE_ORDINALS = {
    "第一张": 0,
    "第1张": 0,
    "第二张": 1,
    "第2张": 1,
    "第三张": 2,
    "第3张": 2,
}

# In-process (upstream_cid -> (account_token, recorded_at)).
# If saved immediately after user stream completion, it hits. Loss after process restart only loses the "sticky account" for this round;
# when the user inputs in the next round, chat_service will write a new token, enabling natural recovery.
# A 1-hour window is sufficient to cover common stream -> save intervals without stacking infinitely.
_TOKEN_CACHE_TTL_SECONDS = 3600
_token_cache: dict[str, tuple[str, float]] = {}
_token_cache_lock = threading.Lock()


def _remember_token(conversation_id: str, account_token: str) -> None:
    if not conversation_id or not account_token:
        return
    now = time.time()
    with _token_cache_lock:
        _token_cache[conversation_id] = (account_token, now)
        expired = [cid for cid, (_, ts) in _token_cache.items() if now - ts > _TOKEN_CACHE_TTL_SECONDS]
        for cid in expired:
            _token_cache.pop(cid, None)


def _peek_token(conversation_id: str) -> str:
    if not conversation_id:
        return ""
    now = time.time()
    with _token_cache_lock:
        item = _token_cache.get(conversation_id)
        if not item:
            return ""
        token, recorded_at = item
        if now - recorded_at > _TOKEN_CACHE_TTL_SECONDS:
            _token_cache.pop(conversation_id, None)
            return ""
        return token


def _sse(event: dict[str, Any]) -> str:
    return f"data: {json.dumps(event, ensure_ascii=False)}\n\n"


def _collect_urls(value: object) -> list[str]:
    urls: list[str] = []
    if isinstance(value, dict):
        for key, item in value.items():
            if key == "url" and isinstance(item, str):
                urls.append(item)
            else:
                urls.extend(_collect_urls(item))
    elif isinstance(value, list):
        for item in value:
            urls.extend(_collect_urls(item))
    return urls


def _request_excerpt(text: object, limit: int = 1000) -> str:
    value = str(text or "").strip()
    if not value:
        return ""
    normalized = " ".join(value.split())
    return normalized if len(normalized) <= limit else normalized[: limit - 1].rstrip() + "…"


def _log_chat_call(
    identity: dict[str, Any],
    *,
    summary: str,
    endpoint: str,
    model: str,
    started: float,
    request_text: str = "",
    result: object = None,
    status: str = "success",
    error: str = "",
) -> None:
    detail: dict[str, Any] = {
        "key_id": identity.get("id"),
        "key_name": identity.get("name"),
        "role": identity.get("role"),
        "endpoint": endpoint,
        "model": model,
        "started_at": time.strftime("%Y-%m-%d %H:%M:%S", time.localtime(started)),
        "ended_at": time.strftime("%Y-%m-%d %H:%M:%S"),
        "duration_ms": int((time.time() - started) * 1000),
        "status": status,
    }
    excerpt = _request_excerpt(request_text)
    if excerpt:
        detail["request_text"] = excerpt
    if error:
        detail["error"] = error
    urls = _collect_urls(result)
    if urls:
        detail["urls"] = list(dict.fromkeys(urls))
    if isinstance(result, dict):
        for key in ("referenced_chat_images",):
            if key in result:
                detail[key] = result[key]
    log_service.add(LOG_TYPE_CALL, summary, detail)


def _last_user_text(messages: list[dict[str, Any]]) -> str:
    for message in reversed(messages or []):
        if not isinstance(message, dict):
            continue
        if str(message.get("role") or "").strip().lower() != "user":
            continue
        content = message.get("content")
        if isinstance(content, str):
            return content.strip()
        if isinstance(content, list):
            parts: list[str] = []
            for item in content:
                if isinstance(item, dict):
                    text = str(item.get("text") or item.get("input_text") or "").strip()
                    if text:
                        parts.append(text)
            return "\n".join(parts).strip()
    return ""


def _extract_chat_image_urls(messages: list[dict[str, Any]]) -> list[str]:
    urls: list[str] = []
    for message in messages or []:
        if not isinstance(message, dict):
            continue
        if str(message.get("role") or "").strip().lower() != "assistant":
            continue
        content = message.get("content")
        text = content if isinstance(content, str) else ""
        if not text:
            continue
        for url in _CHAT_IMAGE_MARKDOWN_RE.findall(text):
            if "/images/" in url or url.startswith("data:image/"):
                urls.append(str(url).strip())
    return list(dict.fromkeys(urls))


def _is_chat_image_followup(text: str) -> bool:
    if not text:
        return False
    return bool(_CHAT_IMAGE_REFERENCE_RE.search(text) and _CHAT_IMAGE_FOLLOWUP_RE.search(text))


def _select_referenced_chat_images(text: str, urls: list[str], limit: int = 1) -> list[str]:
    if not urls or not _is_chat_image_followup(text):
        return []
    for marker, index in _IMAGE_ORDINALS.items():
        if marker in text and index < len(urls):
            return [urls[index]]
    if any(marker in text for marker in ("第一张", "第1张")) and urls:
        return [urls[0]]
    return urls[-limit:]


def _resolve_local_image_url(url: str) -> tuple[bytes, str] | None:
    value = str(url or "").strip()
    if not value:
        return None
    if value.startswith("data:image/") and "," in value:
        import base64

        header, _, data = value.partition(",")
        mime = header.split(";")[0].removeprefix("data:") or "image/png"
        return base64.b64decode(data), mime
    marker = "/images/"
    idx = value.find(marker)
    if idx < 0:
        return None
    rel = value[idx + len(marker):].split("?", 1)[0].split("#", 1)[0].strip().lstrip("/")
    if not rel:
        return None
    root = config.images_dir.resolve()
    path = (root / Path(rel)).resolve()
    if root not in path.parents or not path.is_file():
        return None
    mime = mimetypes.guess_type(path.name)[0] or "image/png"
    return path.read_bytes(), mime


def _messages_with_referenced_chat_images(body: ChatStreamRequest) -> tuple[list[dict[str, Any]], int]:
    messages = [dict(item) for item in (body.messages or []) if isinstance(item, dict)]
    text = _last_user_text(messages)
    urls = _select_referenced_chat_images(text, _extract_chat_image_urls(messages))
    if not urls:
        return messages, 0
    images: list[tuple[bytes, str]] = []
    for url in urls:
        resolved = _resolve_local_image_url(url)
        if resolved:
            images.append(resolved)
    if not images:
        return messages, 0
    for message in reversed(messages):
        if str(message.get("role") or "").strip().lower() != "user":
            continue
        content = message.get("content")
        text_content = content if isinstance(content, str) else _last_user_text([message])
        parts: list[dict[str, Any]] = [{"type": "text", "text": text_content}]
        for data, mime in images:
            parts.append({"type": "image", "data": data, "mime": mime})
        message["content"] = parts
        return messages, len(images)
    return messages, 0


def _is_image_intent(body: ChatStreamRequest) -> bool:
    model = str(body.model or "").strip()
    if is_supported_image_model(model):
        return True
    if model and model != "auto":
        return False
    text = _last_user_text(body.messages)
    if not text or _IMAGE_DISCUSSION_RE.search(text):
        return False
    return bool(_IMAGE_ACTION_RE.search(text) or _DRAW_ACTION_RE.search(text))


def _stream_image(body: ChatStreamRequest, identity: dict[str, Any], policy_payload: dict[str, object]) -> Iterator[str]:
    prompt = extract_chat_prompt({"messages": body.messages})
    if not prompt:
        yield _sse({"type": "error", "message": "prompt is required"})
        return
    selected_model = str(policy_payload.get("model") or (body.model if is_supported_image_model(body.model) else "gpt-image-2"))
    account_type = str(policy_payload.get("plan_type") or body.account_type or "").strip() or None
    started = time.time()
    delivered_any = False
    result_data: list[dict[str, Any]] = []
    try:
        outputs = stream_image_outputs_with_pool(ConversationRequest(
            prompt=prompt,
            model=selected_model,
            plan_type=account_type,
            allowed_plan_types=policy_payload.get("allowed_plan_types"),
            n=1,
            response_format="b64_json",
        ))
        for output in outputs:
            content = ""
            if output.kind == "result":
                result_data.extend(item for item in output.data if isinstance(item, dict))
                content = build_chat_image_markdown_content({"data": output.data})
            elif output.kind == "message":
                content = str(output.text or "").strip()
            if not content:
                continue
            delivered_any = True
            yield _sse({"type": "delta", "text": content})
        if not delivered_any:
            refund_user_quota(identity, 1)
            message = "Image generation returned no results. Please check backend logs or available drawing accounts."
            _log_chat_call(
                identity,
                summary="Chat image generation failed",
                endpoint="/api/chat/stream",
                model=selected_model,
                started=started,
                request_text=prompt,
                status="failed",
                error=message,
            )
            yield _sse({"type": "error", "message": message})
            return
        if result_data:
            record_owner_for_result(identity, result_data)
            record_prompt_for_result(prompt, result_data)
        _log_chat_call(
            identity,
            summary="Chat image generation completed",
            endpoint="/api/chat/stream",
            model=selected_model,
            started=started,
            request_text=prompt,
            result={"data": result_data},
        )
        yield _sse({"type": "done"})
    except Exception as exc:
        if not delivered_any:
            refund_user_quota(identity, 1)
        _log_chat_call(
            identity,
            summary="Chat image generation failed",
            endpoint="/api/chat/stream",
            model=selected_model,
            started=started,
            request_text=prompt,
            result={"data": result_data},
            status="failed",
            error=str(exc),
        )
        yield _sse({"type": "error", "message": str(exc)})


def _resolve_preferred_token(user_id: str, upstream_cid: str) -> str:
    """Sticky account for continuation: search in-process cache first, then fall back to chat_conversations persistence query.
    High cache hit rate, near-zero read IO; persistence fallback covers restart / cross-instance scenarios."""
    if not upstream_cid:
        return ""
    cached = _peek_token(upstream_cid)
    if cached:
        return cached
    return chat_service.find_token_by_upstream(user_id, upstream_cid)


def _stream(body: ChatStreamRequest, identity: dict[str, Any]) -> Iterator[str]:
    """Map internal conversation.* events thinly to SSE.
    Asynchronously DELETE upon termination regardless of upstream success or failure, avoiding leaving 'temporary chat' footprints under user accounts;
    simultaneously store (cid, token) in the token cache, to be backfilled when the frontend saves to DB, used for continuation across accounts.
    Open a new upstream cid for each round, sending history fully via messages; this does not conflict with the asynchronous DELETE after done,
    and avoids upstream 404 due to non-contiguous parent_message_id.
    One conversation quota is pre-deducted at the entry; refunded if the upstream actually fails (emits no text at all)."""
    user_id = str(identity.get("id") or "")
    request_messages, referenced_image_count = _messages_with_referenced_chat_images(body)
    request_text = _last_user_text(body.messages)
    request = ConversationRequest(model=body.model, messages=request_messages or None)
    upstream_cid_in = str(body.conversation_id or "").strip()
    account_type = str(body.account_type or "").strip() or None
    account_type = enforce_text_account_policy(identity, account_type)
    allowed_plan_types = text_allowed_plan_types(identity)
    preferred_token = "" if body.force_switch_account else _resolve_preferred_token(user_id, upstream_cid_in)
    excluded: set[str] = set()
    if body.force_switch_account:
        prev = _resolve_preferred_token(user_id, upstream_cid_in)
        if prev:
            excluded.add(prev)
    conversation_id = ""
    account_token = ""
    delivered_any = False
    started = time.time()
    response_text_parts: list[str] = []
    failed = False
    try:
        for event in stream_chat_events(
            request,
            preferred_token=preferred_token,
            excluded_tokens=excluded,
            plan_type=account_type,
            plan_types=allowed_plan_types,
        ):
            account_token = str(event.get("account_token") or account_token)
            cid = str(event.get("conversation_id") or "")
            if cid and cid != conversation_id:
                conversation_id = cid
                yield _sse({"type": "conversation.id", "conversation_id": cid})
            etype = str(event.get("type") or "")
            if etype == "conversation.delta":
                delta = str(event.get("delta") or "")
                if delta:
                    delivered_any = True
                    response_text_parts.append(delta)
                    yield _sse({"type": "delta", "text": delta})
            elif etype == "conversation.done":
                yield _sse({"type": "done"})
    except Exception as exc:
        failed = True
        if not delivered_any:
            refund_user_chat_quota(identity, 1)
        _log_chat_call(
            identity,
            summary="Chat failed",
            endpoint="/api/chat/stream",
            model=body.model,
            started=started,
            request_text=request_text,
            status="failed",
            error=str(exc),
        )
        yield _sse({"type": "error", "message": str(exc)})
    finally:
        if delivered_any and not failed:
            _log_chat_call(
                identity,
                summary="Chat completed",
                endpoint="/api/chat/stream",
                model=body.model,
                started=started,
                request_text=request_text,
                result={
                    "text": "".join(response_text_parts),
                    "referenced_chat_images": referenced_image_count,
                },
            )
        if account_token and conversation_id:
            _remember_token(conversation_id, account_token)
            threading.Thread(
                target=delete_conversation_safely,
                args=(account_token, conversation_id),
                name="chat-cleanup",
                daemon=True,
            ).start()


def create_router() -> APIRouter:
    router = APIRouter()

    @router.post("/api/chat/stream")
    async def chat_stream(body: ChatStreamRequest, authorization: str | None = Header(default=None)):
        identity = require_identity(authorization)
        if not body.messages:
            raise HTTPException(status_code=400, detail={"error": "messages is required"})
        if _is_image_intent(body):
            image_policy_payload: dict[str, object] = {
                "model": body.model if is_supported_image_model(body.model) else "gpt-image-2",
                "plan_type": body.account_type,
            }
            apply_image_account_policy(identity, image_policy_payload)
            consume_user_quota(identity, 1)
            return StreamingResponse(_stream_image(body, identity, image_policy_payload), media_type="text/event-stream")
        # Pre-deduct 1 conversation quota at the entry; returns 402 directly if any quota tier (daily/monthly/total) is insufficient.
        # Refunded internally by _stream if the upstream actually fails (emits no text at all).
        body.account_type = enforce_text_account_policy(identity, body.account_type)
        consume_user_chat_quota(identity, 1)
        return StreamingResponse(_stream(body, identity), media_type="text/event-stream")

    @router.get("/api/chat/account-types")
    async def list_chat_account_types(authorization: str | None = Header(default=None)):
        identity = require_identity(authorization)
        items = account_service.list_available_text_account_types()
        if not can_use_paid_image_accounts(identity):
            items = [item for item in items if str(item or "").strip().lower() == "free"]
        elif identity.get("role") != "admin":
            paid = {"plus", "pro", "team"}
            items = [item for item in items if str(item or "").strip().lower() in paid]
        return {"items": items}

    @router.get("/api/chat/conversations")
    async def list_conversations(authorization: str | None = Header(default=None)):
        identity = require_identity(authorization)
        items = chat_service.list_for_user(str(identity.get("id") or ""))
        return {"items": items}

    @router.post("/api/chat/conversations")
    async def upsert_conversation(
        body: ChatConversationUpsertRequest,
        authorization: str | None = Header(default=None),
    ):
        identity = require_identity(authorization)
        upstream_cid = str(body.upstream_conversation_id or "").strip()
        # Frontend cannot get the account_token; retrieve and backfill from _token_cache for continuation across accounts.
        upstream_token = _peek_token(upstream_cid) if upstream_cid else ""
        record = chat_service.upsert_for_user(
            str(identity.get("id") or ""),
            {
                "id": body.id,
                "title": body.title,
                "messages": body.messages,
                "upstream_conversation_id": upstream_cid,
                "upstream_account_token": upstream_token,
            },
        )
        return {"item": record}

    @router.delete("/api/chat/conversations/{conversation_id}")
    async def delete_conversation(
        conversation_id: str,
        authorization: str | None = Header(default=None),
    ):
        identity = require_identity(authorization)
        ok = chat_service.delete_for_user(str(identity.get("id") or ""), conversation_id)
        return {"ok": ok}

    return router
