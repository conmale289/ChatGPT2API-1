from __future__ import annotations

import hashlib
import json
import itertools
import time
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from typing import Any
from uuid import uuid4

from fastapi import HTTPException
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import JSONResponse, StreamingResponse

from services.config import DATA_DIR
from utils.helper import anthropic_sse_stream, sse_json_stream

LOG_TYPE_CALL = "call"
LOG_TYPE_ACCOUNT = "account"


class LogService:
    def __init__(self, path: Path):
        self.path = path
        self.path.parent.mkdir(parents=True, exist_ok=True)

    @staticmethod
    def _legacy_id(raw_line: str, line_number: int) -> str:
        payload = f"{line_number}:{raw_line}".encode("utf-8", errors="ignore")
        return hashlib.sha1(payload).hexdigest()[:24]

    def _parse_line(self, raw_line: str, line_number: int) -> dict[str, Any] | None:
        try:
            item = json.loads(raw_line)
        except Exception:
            return None
        if not isinstance(item, dict):
            return None
        parsed = dict(item)
        parsed["id"] = str(parsed.get("id") or self._legacy_id(raw_line, line_number))
        return parsed

    @staticmethod
    def _serialize_item(item: dict[str, Any]) -> str:
        return json.dumps(item, ensure_ascii=False, separators=(",", ":"))

    @staticmethod
    def _matches_filters(item: dict[str, Any], *, type: str = "", start_date: str = "", end_date: str = "") -> bool:
        t = str(item.get("time") or "")
        day = t[:10]
        if type and item.get("type") != type:
            return False
        if start_date and day < start_date:
            return False
        if end_date and day > end_date:
            return False
        return True

    def add(self, type: str, summary: str = "", detail: dict[str, Any] | None = None, **data: Any) -> None:
        item = {
            "id": uuid4().hex,
            "time": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
            "type": type,
            "summary": summary,
            "detail": detail or data,
        }
        with self.path.open("a", encoding="utf-8") as file:
            file.write(self._serialize_item(item) + "\n")

    def list(self, type: str = "", start_date: str = "", end_date: str = "", limit: int = 200) -> list[dict[str, Any]]:
        if not self.path.exists():
            return []
        items: list[dict[str, Any]] = []
        lines = self.path.read_text(encoding="utf-8").splitlines()
        for line_number in range(len(lines) - 1, -1, -1):
            item = self._parse_line(lines[line_number], line_number)
            if item is None:
                continue
            if not self._matches_filters(item, type=type, start_date=start_date, end_date=end_date):
                continue
            items.append(item)
            if len(items) >= limit:
                break
        return items

    def delete(self, ids: list[str]) -> dict[str, int]:
        target_ids = {str(item or "").strip() for item in ids if str(item or "").strip()}
        if not self.path.exists() or not target_ids:
            return {"removed": 0}
        lines = self.path.read_text(encoding="utf-8").splitlines()
        kept_lines: list[str] = []
        removed = 0
        for line_number, raw_line in enumerate(lines):
            item = self._parse_line(raw_line, line_number)
            if item is None:
                kept_lines.append(raw_line)
                continue
            if str(item.get("id") or "") in target_ids:
                removed += 1
                continue
            kept_lines.append(self._serialize_item(item))
        content = "\n".join(kept_lines)
        if content:
            content += "\n"
        self.path.write_text(content, encoding="utf-8")
        return {"removed": removed}


log_service = LogService(DATA_DIR / "logs.jsonl")


def _collect_urls(value: object) -> list[str]:
    urls: list[str] = []
    if isinstance(value, dict):
        for key, item in value.items():
            if key == "url" and isinstance(item, str):
                urls.append(item)
            elif key == "urls" and isinstance(item, list):
                urls.extend(str(url) for url in item if isinstance(url, str))
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
    if len(normalized) <= limit:
        return normalized
    return normalized[: limit - 1].rstrip() + "…"


def _image_error_response(exc: Exception) -> JSONResponse:
    message = str(exc)
    if "no available image quota" in message.lower():
        return JSONResponse(
            status_code=429,
            content={
                "error": {
                    "message": "no available image quota",
                    "type": "insufficient_quota",
                    "param": None,
                    "code": "insufficient_quota",
                }
            },
        )
    if hasattr(exc, "to_openai_error") and hasattr(exc, "status_code"):
        return JSONResponse(status_code=int(exc.status_code), content=exc.to_openai_error())
    return JSONResponse(
        status_code=502,
        content={
            "error": {
                "message": message,
                "type": "server_error",
                "param": None,
                "code": "upstream_error",
            }
        },
    )


def _next_item(items):
    try:
        return True, next(items)
    except StopIteration:
        return False, None


@dataclass
class LoggedCall:
    identity: dict[str, object]
    endpoint: str
    model: str
    summary: str
    started: float = field(default_factory=time.time)
    request_text: str = ""
    # Refund callback when upstream genuinely fails. Injected by the route layer after consume_user_quota.
    # First argument = refund amount (typically = entrance deduction amount).
    # Failures include:
    #   - Dict path ImageGenerationError / general Exception
    #   - Stream path first chunk fetch exception
    #   - Stream mid-way output failure (self.stream finally's failed=True branch)
    # HTTPException is not refunded—this is typically a business error raised actively by the route layer (params / auth).
    # The business logic fails fast before deduction, so this should not theoretically be reached; kept as a defensive raise.
    on_failure: "Callable[[int], None] | None" = None
    # How much to refund on failure. Typically = entrance deduction amount.
    failure_refund_amount: int = 1

    def _refund(self) -> None:
        cb = self.on_failure
        if cb is None:
            return
        try:
            cb(int(self.failure_refund_amount))
        except Exception:
            # Do not throw on refund failure - the main flow is already returning an error response, layering another error would be worse
            pass

    async def run(self, handler, *args, sse: str = "openai"):
        from services.protocol.conversation import ImageGenerationError

        try:
            result = await run_in_threadpool(handler, *args)
        except ImageGenerationError as exc:
            self.log("Call failed", status="failed", error=str(exc))
            self._refund()
            return _image_error_response(exc)
        except HTTPException as exc:
            self.log("Call failed", status="failed", error=str(exc.detail))
            raise
        except Exception as exc:
            self.log("Call failed", status="failed", error=str(exc))
            self._refund()
            raise HTTPException(status_code=502, detail={"error": str(exc)}) from exc

        if isinstance(result, dict):
            self.log("Call completed", result)
            return result

        sender = anthropic_sse_stream if sse == "anthropic" else sse_json_stream
        try:
            has_first, first = await run_in_threadpool(_next_item, result)
        except ImageGenerationError as exc:
            self.log("Call failed", status="failed", error=str(exc))
            self._refund()
            return _image_error_response(exc)
        except HTTPException as exc:
            self.log("Call failed", status="failed", error=str(exc.detail))
            raise
        except Exception as exc:
            self.log("Call failed", status="failed", error=str(exc))
            self._refund()
            raise HTTPException(status_code=502, detail={"error": str(exc)}) from exc
        if not has_first:
            self.log("Streaming call completed")
            return StreamingResponse(sender(()), media_type="text/event-stream")
        return StreamingResponse(sender(self.stream(itertools.chain([first], result))), media_type="text/event-stream")

    def stream(self, items):
        urls: list[str] = []
        # Streaming image: manually collect data of result chunks, call ownership mapping at end.
        # Done here instead of api/ai.py because that only writes ownership in dict paths,
        # skipping StreamingResponse path (which Android client uses).
        image_result_data: list[dict[str, Any]] = []
        failed = False
        try:
            for item in items:
                urls.extend(_collect_urls(item))
                if isinstance(item, dict) and item.get("object") == "image.generation.result":
                    data = item.get("data")
                    if isinstance(data, list):
                        image_result_data.extend(d for d in data if isinstance(d, dict))
                yield item
        except Exception as exc:
            failed = True
            self.log("Streaming call failed", status="failed", error=str(exc), urls=urls)
            self._refund()
            raise
        finally:
            if not failed:
                self.log("Streaming call completed", urls=urls)
                if image_result_data:
                    # Delayed import to avoid circular dependency between services
                    from services.image_owners_service import record_owner_for_result
                    from services.image_prompts_service import record_prompt_for_result
                    try:
                        record_owner_for_result(self.identity, image_result_data)
                    except Exception:
                        # Writing owner failure does not affect the streaming response itself
                        pass
                    try:
                        # request_text is the raw prompt text passed when LoggedCall is constructed,
                        # consistent with /v1/images/generations / edits entries in ai.py.
                        # Marked as image edits if endpoint contains "edits"/"edit", which forces empty
                        # prompt on gallery publish (image edits instruction has no reuse value to others without reference image).
                        ep = (self.endpoint or "").lower()
                        is_edit = "edits" in ep or "edit" in ep
                        record_prompt_for_result(
                            self.request_text, image_result_data, is_edit=is_edit
                        )
                    except Exception:
                        pass

    def log(self, suffix: str, result: object = None, status: str = "success", error: str = "",
            urls: list[str] | None = None) -> None:
        detail = {
            "key_id": self.identity.get("id"),
            "key_name": self.identity.get("name"),
            "role": self.identity.get("role"),
            "endpoint": self.endpoint,
            "model": self.model,
            "started_at": datetime.fromtimestamp(self.started).strftime("%Y-%m-%d %H:%M:%S"),
            "ended_at": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
            "duration_ms": int((time.time() - self.started) * 1000),
            "status": status,
        }
        request_excerpt = _request_excerpt(self.request_text)
        if request_excerpt:
            detail["request_text"] = request_excerpt
        if error:
            detail["error"] = error
        collected_urls = [*(urls or []), *_collect_urls(result)]
        if collected_urls:
            detail["urls"] = list(dict.fromkeys(collected_urls))
        log_service.add(LOG_TYPE_CALL, f"{self.summary}{suffix}", detail)
