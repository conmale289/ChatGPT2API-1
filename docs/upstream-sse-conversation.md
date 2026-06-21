# Upstream Conversation SSE Protocol Specification

Conversation SSE is the streaming response protocol for upstream conversation links. Each SSE `data:` line is typically a JSON payload, but can also be a protocol marker or end marker. Clients need to consume these payloads in order to maintain the current session state, text content, tool invocation state, and image result pointers.

## Basic Structure

Common payload examples:

```text
"v1"
{"type":"resume_conversation_token",...}
{"p":"","o":"add","v":{...}}
{"v":{...}}
{"p":"/message/content/parts/0","o":"append","v":"..."}
{"type":"server_ste_metadata","metadata":{...}}
[DONE]
```

Handling suggestions:

| Payload | Meaning | Handling Method |
|:--|:--|:--|
| `"v1"` | Protocol version marker | Can be logged, usually doesn't affect business logic |
| `[DONE]` | End of current SSE stream | Stop reading |
| JSON object | Event, message, or patch | Update conversation state by fields |
| JSON string | Short text patch or protocol marker | Process in context |
| Non-JSON content | Original content | Keep as raw event to avoid breaking the stream |

## Common Fields

| Field | Description |
|:--|:--|
| `type` | Upstream event type, e.g., `resume_conversation_token`, `input_message`, `message_marker`, `title_generation`, `server_ste_metadata` |
| `conversation_id` | Current conversation ID, available from multiple events |
| `p` | Patch path, e.g., `/message/content/parts/0` |
| `o` | Patch operation, e.g., `add`, `append`, `replace`, `patch` |
| `v` | Patch value, can be a string, array, or contain a complete message object |
| `c` | Message index or cursor, common in add events |
| `message.id` | Message ID |
| `message.author.role` | Message role, common values: `system`, `user`, `assistant`, `tool` |
| `message.content.content_type` | Content type, e.g., `text`, `multimodal_text`, `model_editable_context` |
| `message.content.parts` | Content parts, can contain text, image pointers, or multimodal objects |
| `message.status` | Message status, e.g., `in_progress`, `finished_successfully` |
| `message.end_turn` | Whether this ends the current turn |
| `metadata.tool_invoked` | Whether a tool was invoked in this turn |
| `metadata.turn_use_case` | Turn use case, e.g., `text`, `multimodal` |
| `metadata.async_task_type` | Async tool task type, typically `image_gen` for image generation |

## Session Start Event

The upstream typically returns a resume token or conversation token first:

```json
{
  "type": "resume_conversation_token",
  "kind": "topic",
  "token": "...",
  "conversation_id": "..."
}
```

This event is primarily used to identify the conversation and restore context. The business layer usually only needs to save the `conversation_id`; the `token` should not be exposed to downstream users.

## Message Add Scenario

A complete message can appear via `add` or events containing `v.message`:

```json
{
  "p": "",
  "o": "add",
  "v": {
    "message": {
      "author": {"role": "assistant"},
      "content": {"content_type": "text", "parts": [""]},
      "status": "in_progress"
    },
    "conversation_id": "..."
  },
  "c": 3
}
```

Such events are commonly used to create a new message. If the message role is `assistant`, subsequent text is usually appended via patches.

## Text Incremental Scenario

Text output usually consists of multiple patches:

```json
{"p":"/message/content/parts/0","o":"append","v":"Hello"}
{"v":" world"}
{"p":"","o":"patch","v":[
  {"p":"/message/content/parts/0","o":"append","v":"!"},
  {"p":"/message/status","o":"replace","v":"finished_successfully"},
  {"p":"/message/end_turn","o":"replace","v":true}
]}
```

Handling points:

| Pattern | Meaning |
|:--|:--|
| `p == "/message/content/parts/0"` and `o == "append"` | Append content to current text |
| `o == "replace"` | Replace target field with new value |
| `o == "patch"` and `v` is an array | Batch patches, must be processed in array order |
| Only `v` and `v` is a string | Likely a text increment omitting the path, should be processed within the current text stream |

## Input Message Scenario

User input appears as `input_message` or a normal `user` message. Image edit requests contain user-uploaded reference images:

```json
{
  "type": "input_message",
  "input_message": {
    "author": {"role": "user"},
    "content": {
      "content_type": "multimodal_text",
      "parts": [
        {"asset_pointer": "sediment://file_input"},
        "Edit prompt"
      ]
    }
  },
  "conversation_id": "..."
}
```

This type of `sediment://...` indicates an input attachment, not a generation result. Even if it can be downloaded, it should not be returned as an output image.

## Image Tool Success Scenario

When image generation or editing succeeds, a tool message typically appears from upstream:

```json
{
  "v": {
    "message": {
      "author": {"role": "tool"},
      "content": {
        "content_type": "multimodal_text",
        "parts": [
          {"asset_pointer": "file-service://file_result"},
          {"asset_pointer": "sediment://file_result"}
        ]
      },
      "metadata": {"async_task_type": "image_gen"}
    }
  },
  "conversation_id": "..."
}
```

An image pointer should only be treated as an output result if it simultaneously satisfies all of the following conditions:

| Condition | Description |
|:--|:--|
| `message.author.role == "tool"` | Source is a tool message |
| `metadata.async_task_type == "image_gen"` | Tool task is image generation |
| `asset_pointer` is `file-service://...` or `sediment://...` | Points to a resolvable image resource |

## Image Pointer Types

| Pointer | Common Source | Description |
|:--|:--|:--|
| `file-service://file_xxx` | Image tool output | Can be resolved via file download endpoint |
| `sediment://file_xxx` | Input attachment or image tool output | Source must be determined in combination with message role |
| `file_upload` | Upload placeholder | Usually should not be treated as output |

Do not determine it as an output image solely based on the presence of "file_" or "sediment://" in the string. You must combine this with message role and task type.

## Policy Rejection Scenario

When upstream rejects the request, no image tool message is generated; instead, a normal assistant text is returned:

```text
I can't assist with that request. If you have another type of modification...
```

Common accompanying events:

```json
{"type":"title_generation","title":"Request Denied","conversation_id":"..."}
```

```json
{
  "type": "server_ste_metadata",
  "metadata": {
    "tool_invoked": false,
    "turn_use_case": "multimodal",
    "did_prompt_contain_image": true
  },
  "conversation_id": "..."
}
```

Handling points:

| Condition | Action |
|:--|:--|
| Assistant rejection text present | Should return text message |
| `tool_invoked == false` | Indicates no actual tool results |
| No message with role=tool and async_task_type=image_gen | Output images should not be collected |
| Image pointer in user input message | Still treated only as input attachment |

## Moderation Scenario

Some requests may return moderation events:

```json
{
  "type": "moderation",
  "moderation_response": {
    "blocked": true
  },
  "conversation_id": "..."
}
```

If `blocked == true`, it should be considered blocked by policy. If there is subsequent assistant text, that text should be returned with priority; if there is no text, an appropriate error message can be returned.

## Marker and Title Events

Upstream returns some auxiliary events:

```json
{"type":"message_marker","marker":"user_visible_token","event":"first"}
{"type":"message_marker","marker":"last_token","event":"last"}
{"type":"title_generation","title":"...","conversation_id":"..."}
```

These events are typically used for frontend display, title generation, or streaming state markers, and do not represent actual text content or image results.

## Metadata Event

`server_ste_metadata` describes this turn's scheduling and tool state:

```json
{
  "type": "server_ste_metadata",
  "metadata": {
    "tool_invoked": true,
    "turn_use_case": "multimodal",
    "model_slug": "i-mini-m",
    "did_prompt_contain_image": true
  }
}
```

Common checks:

| Field | Description |
|:--|:--|
| `tool_invoked == true` | Upstream determined a tool was invoked this turn |
| `tool_invoked == false` | Upstream did not invoke any tool, common in rejections or plaintext responses |
| `turn_use_case == "text"` | Process as text response |
| `turn_use_case == "multimodal"` | Multimodal request, does not guarantee image output |
| `did_prompt_contain_image == true` | Input contains images, does not guarantee output contains images |

## Result Judgment After Ending

After the SSE stream ends, results can be judged in the following order:

1. If image tool output pointers have been collected, resolve and download the output images.
2. If there are no output image pointers but assistant text is present, and this turn was blocked or no tool was invoked, return a text message.
3. If there are no output image pointers but conversation_id is present, the complete conversation details can be queried to continue searching for image tool outputs.
4. When querying complete conversation details, still read only messages with role=tool and async_task_type=image_gen.
5. If there is neither an image result nor text, return an upstream exception or empty result error.

## Private Use Area (PUA) Cleanup

Upstream body text may contain embedded internal markup wrapped in U+E200..U+E203. While the browser UI renders these as cards or footnotes, they are invisible when passed through the OpenAI-compatible API, leaving behind garbled text like `entity[...]` or `citeturn0search0`. All cleanup is centralized in `services/protocol/chatgpt_markup.py`, invoked at the central hub by `iter_conversation_payloads`, benefiting chat completions, responses, anthropic, and `/api/chat/stream` protocols.

| Markup | Pattern | Handling Method |
|:--|:--|:--|
| Entity card | `entity["song","Ai Ya Ai Ya","BY2 Song"]` | Parse JSON array, replace with the second item as the name |
| Search citation | `citeturn0search2turn0search1` | Replaced by `[[N]](url)` using upstream `content_references` metadata; discarded if no link found |
| Isolated PUA character | Individual U+E200..U+E203 | Directly stripped |

`content_references` metadata is captured by recursively scanning the event tree, requiring no extra network requests. Common entry:

```json
{"v":{"message":{"metadata":{"content_references":[
  {"matched_text":"citeturn0search2",
   "items":[{"url":"https://example.com","title":"Example"}]}
]}}}}
```

**Streaming Safety**: `ConversationState` maintains both raw `text` and `clean_text`. After each patch frame, only the stable prefix "before the last ``" is cleaned. Unclosed tags are held until the next frame, preventing partial tags from leaking to the client. The `conversation.delta.delta` field is always the clean text increment.

## Video Reference Cards (Frontend Rendering)

After cleaning, video citations appear in the markdown as `[[N]](https://www.youtube.com/watch?v=...)`. The OpenAI-compatible protocol itself only handles text, and video cards are the responsibility of the frontend rendering layer; the backend remains unchanged.

The built-in web frontend of this project (`web/src/app/chat/page.tsx`) identifies video links through the components.a hook of ReactMarkdown, replacing `<a>` with a `VideoCard` component upon a match:

- Parsing logic: `parseVideoUrl` in `web/src/lib/video.ts`, supporting YouTube (`youtube.com/watch?v=`, `youtu.be/`, `/embed/`, `/shorts/`) and Bilibili (`bilibili.com/video/BV...`, `/video/av...`, and `b23.tv` short links).
- Thumbnail: YouTube directly constructs `https://img.youtube.com/vi/{id}/hqdefault.jpg` from video id; Bilibili resolves cover and title from backend via `/api/video/metadata`.
- Playback: Click to switch to the iframe of the corresponding site for inline playback.
- Duplicate video ID removal within same message: Renders card on first appearance, subsequent ones render as normal links.
- Non-video links (normal URLs) render normally as `<a>`, unaffected.

Other API clients (Cherry Studio, Android Draw, etc.) still receive the raw `[[N]](url)` and render it using their respective markdown capabilities, decoupled from the backend.
