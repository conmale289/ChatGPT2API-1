# Android Client Integration Documentation

A backend API integration guide for the [Draw](https://github.com/RemotePinee) Android client. All `/v1/*` endpoints are compatible with the official OpenAI protocol, allowing direct reuse of request structures from the OpenAI Android SDK.

> This document evolves in sync with the backend code. If you find discrepancies between the API and the code, refer to the code and file an issue.

> [!NOTE]
> **Official APK is closed-source / Backend API is open-source.**
> - The officially maintained Draw Android client is only distributed as an APK in [Releases](https://github.com/RemotePinee/ChatGPT2API/releases); this repository does not contain its source code.
> - The backend API (including `/v1/*`, `/api/gallery/*`, `/api/me/images`, etc.) is fully open-source. This document is meant to support you in **implementing your own Android / iOS / Desktop client based on this API**.
> - If you are just an end-user, simply install the APK from Releases; you do not need to read this document.

---

## I. Environment Baseline

The table below lists the version combinations verified when this document was written. Following this set for Android projects will avoid issues.

| Item | Version |
|---|---|
| Android Studio | Ladybug 2024.2.1 and above |
| JDK | 21 |
| Kotlin | 2.0+ |
| Compose Compiler | Managed by `org.jetbrains.kotlin.plugin.compose` plugin |
| Compose BOM | `2026.03.01` |
| compileSdk / targetSdk | 36 |
| minSdk | 26 (Android 8.0) |
| Gradle | 8.7+ |
| AGP | 8.5+ |

Backend Environment:

| Item | Version |
|---|---|
| Python | 3.13 |
| Package Management | uv |
| Web Framework | FastAPI |
| Backend Repo | https://github.com/RemotePinee/ChatGPT2API |
| API Version | See `VERSION` file |

---

## II. Recommended Android Dependencies

```kotlin
dependencies {
    // Compose
    implementation(platform("androidx.compose:compose-bom:2026.03.01"))
    implementation("androidx.compose.ui:ui")
    implementation("androidx.compose.material3:material3")
    implementation("androidx.compose.material:material-icons-extended")
    implementation("androidx.activity:activity-compose:1.13.0")
    implementation("androidx.navigation:navigation-compose:2.9.7")

    // Networking (Retrofit + OkHttp is sufficient for OpenAI-compatible protocols)
    implementation("com.squareup.retrofit2:retrofit:3.0.0")
    implementation("com.squareup.retrofit2:converter-gson:3.0.0")
    implementation("com.squareup.okhttp3:okhttp:5.3.2")
    implementation("com.squareup.okhttp3:logging-interceptor:5.3.2")

    // Async
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.10.2")

    // Image Loading
    implementation("io.coil-kt:coil-compose:2.7.0")

    // Local Storage
    val roomVersion = "2.8.4"
    implementation("androidx.room:room-runtime:$roomVersion")
    implementation("androidx.room:room-ktx:$roomVersion")
    ksp("androidx.room:room-compiler:$roomVersion")
    implementation("androidx.datastore:datastore-preferences:1.1.1")
}
```

---

## III. Authentication

All `/v1/*` endpoints require the header `Authorization: Bearer <token>`. The token comes from one of two sources:

| Source | Description | Recommended Scenario |
|---|---|---|
| Admin auth_key | The `auth-key` configured in `config.json` when deploying the backend, granting full permissions | Self-hosted, personal use |
| User Key | A key in the format `sk-...` created by the admin in the dashboard at `/api/auth/users`, with configurable quotas | Sharing with other users |

The backend identifies both from the same header; the client application (AP) does not need to distinguish between them.

### Configuration Entry

The AP onboarding/settings page should prompt the user for two items:

```
Backend Address (Base URL): e.g., https://api.example.com or http://192.168.1.10:8000
Access Key (Auth Key): admin auth_key or sk-... user key
```

Storage recommendations:

- Base URL → DataStore Preferences (Plaintext)
- Auth Key → DataStore Preferences (**Recommended to encrypt using EncryptedSharedPreferences or Tink**)

### 401 Handling

Any endpoint returning 401 indicates that the key is invalid or revoked. The AP should:

1. Clear the locally stored auth_key (retain the base url)
2. Redirect back to the login/settings page

### Startup Health Check + Handling Unreachable Backend

On a cold start, the AP should proactively call `GET /api/auth/me` to check the login state, avoiding cases where users enter the home page with an expired key and are randomly kicked back to the login page by business endpoints. Recommended strategy (Draw's current implementation):

| Startup me() Result | Handling |
|---|---|
| 200 | Login state valid, enter home, cache identity in ViewModel |
| 401 | Synchronously clear key and jump to login page, prompt "Login expired" |
| IOException / connect failed / TLS failure | Treated as "Backend unreachable", clear key and jump to login page, prompt "Cannot connect to backend, please check the address or try again later" |
| 5xx / Other errors | Do not log out, let user enter home and use normally, any real issues will trigger the interceptor in subsequent requests |

**3-second Timeout Cap**: The health check should have a timeout ceiling (OkHttp's default 15s connectTimeout is too long and will freeze the splash screen). A timeout should be treated as "unreachable".

### Two Exceptions for Authentication Hooks

When a normal business request receives a 401 or IOException, the AP's `OkHttp Interceptor` globally intercepts it and triggers a forceLogout. However, two paths **should not** trigger this global logout:

1. **Checking key on login page** (where user typing errors are normal): Call a special version of `GET /api/auth/me` with a custom header `X-Draw-Skip-Unauth-Hook: 1`. The interceptor will skip the logout hook when it sees this header, letting the LoginViewModel report the error on the form.
2. **Image generation requests** (upstream rate limit / content rejection / 5xx are common): `/v1/images/generations` and `/v1/images/edits` also carry `X-Draw-Skip-Unauth-Hook: 1`. **Any error in the generation path should not kick the user out**. Errors are reported to the user via ViewModel's errorMessage / Toast.

> The backend does not recognize the `X-Draw-Skip-Unauth-Hook` header; it is strictly an internal marker for the AP interceptor. Other clients (such as the official OpenAI SDK) do not carry this header, and their behavior remains unchanged.

---

## IV. API List Useful for Client Application (AP)

### 1. Fetch Model List

```http
GET /v1/models
Authorization: Bearer <token>
```

**Response (200, Excerpt)**:

```json
{
  "object": "list",
  "data": [
    { "id": "gpt-image-2", "object": "model", "owned_by": "chatgpt2api" },
    { "id": "codex-gpt-image-2", "object": "model", "owned_by": "chatgpt2api" },
    { "id": "auto", "object": "model", "owned_by": "chatgpt2api" },
    { "id": "gpt-5", "object": "model", "owned_by": "chatgpt2api" },
    { "id": "gpt-5-mini", "object": "model", "owned_by": "chatgpt2api" }
  ]
}
```

**Key Implementation Points**:

- `/v1/models` returns **all** models available on the backend, covering both text conversation and drawing.
- The AP only cares about **drawing models**, which can be filtered using `id.contains("image")`. Currently, the matching ones are:
  - `gpt-image-2`: Default drawing channel (upstream `gpt-5-3` slug)
  - `codex-gpt-image-2`: Codex drawing channel, only available for Plus / Team / Pro subscriptions, sharing the account with the official web drawing but having an independent quota.
- Other models (`gpt-5` / `gpt-5-mini` / `auto` etc.) are text models. Passing them to `/v1/images/*` will trigger a backend fallback to `auto`—which is unpredictable and violates user selection expectations, so they should not be displayed in the AP dropdown.
- The list adapts to upstream ChatGPT Web changes. **Do not hardcode** the drawing models in the AP; rely on filtering IDs containing `image` to dynamically adapt to future drawing models.

---

### 2. Text-to-Image (Generations)

```http
POST /v1/images/generations
Authorization: Bearer <token>
Content-Type: application/json
```

**Request Body**:

```json
{
  "prompt": "An astronaut cat sitting on the surface of the moon",
  "model": "gpt-image-2",
  "n": 1,
  "size": "1:1",
  "response_format": "url",
  "stream": false
}
```

| Field | Type | Required | Description |
|---|---|---|---|
| `prompt` | string | ✓ | Minimum 1 character |
| `model` | string |   | Defaults to `gpt-image-2` |
| `n` | int |   | 1-4, default 1. Quota will be pre-deducted based on n; see "Quotas and Failed Quota Refunds" below |
| `size` | string |   | Supports `1:1`, `16:9`, `9:16`, `4:3`, `3:4`. Other strings will be injected as-is into the prompt |
| `resolution` | string |   | Supports `1k`, `2k`, `4k`. `2k` / `4k` require premium user keys; strictly validated on backend |
| `response_format` | string |   | `url` or `b64_json`, default `b64_json`. **Android is strongly advised to use `url`** (decoding b64 is slow and memory-intensive) |
| `stream` | bool |   | See streaming details below |

**Resolution & Account Pool Scheduling**:

- `resolution` empty or `1k`: Normal drawing path, using the corresponding account pool based on user permissions.
- `resolution=2k/4k`: Backend prioritizes the Codex high-resolution drawing path, selecting available accounts from the pool in the order `Pro` → `Plus` → `Team`.
- `4k + size=9:16` maps to `2160x3840`; `4k + size=16:9` maps to `3840x2160`; other aspect ratios follow the same long-edge mapping rules.
- If the Codex high-resolution path fails upstream, the backend returns an error and will not silently downgrade to 1K; the AP should report the error to the user.

**Non-Streaming Response (200)**:

```json
{
  "created": 1779256269,
  "data": [
    {
      "url": "https://your-backend/images/2026/05/20/1779256269_abc.png",
      "revised_prompt": "..."
    }
  ]
}
```

If the upstream rejects the request (content policy violation, etc.), an OpenAI-standard error is returned:

```json
{
  "error": {
    "message": "Image generation was rejected by upstream policy.",
    "type": "invalid_request_error",
    "code": "content_policy_violation"
  }
}
```

**Quotas and Failed Quota Refunds**:

- Entry deduction: Quota is pre-deducted based on the value of `n` when the `POST /v1/images/generations` request begins processing (skipped for admins / unlimited users).
- Refund on failure: If the upstream genuinely fails (content_policy / 5xx / upstream timeout / mid-stream disconnect), the backend automatically refunds the pre-deducted `n` quota.
- No refund on user error: Parameter validation errors (400) and content censorship hits (sensitive word match) go down the fail-fast path and raise an error before any deduction, so **no quota is deducted or refunded**.
- The AP does not need to implement any refund logic—it is entirely managed by the backend. However, calling `GET /api/auth/me` after a generation is recommended to refresh the local `remaining` quota count.

---

### 3. Image-to-Image (Edits)

```http
POST /v1/images/edits
Authorization: Bearer <token>
Content-Type: multipart/form-data
```

**multipart Fields**:

| Field | Type | Required | Description |
|---|---|---|---|
| `image` | file | ✓ | Pass a single file as `image`; pass multiple files by repeating the `image[]` field |
| `prompt` | string | ✓ | |
| `model` | string |   | Defaults to `gpt-image-2` |
| `n` | int |   | 1-4 |
| `size` | string |   | Same as above |
| `resolution` | string |   | Same as above, multipart field name is `resolution` |
| `response_format` | string |   | Same as above |
| `stream` | string |   | `true` or `false` |

The response structure is identical to `/v1/images/generations`.

**Quotas and Failed Quota Refunds**: Same as text-to-image—pre-deducted based on `n`, auto-refunded on genuine upstream failures, and skipped on parameter validation errors.

**OkHttp + Retrofit Code Sample**:

```kotlin
interface DrawApi {
    @Multipart
    @POST("v1/images/edits")
    suspend fun editImages(
        @Part image: MultipartBody.Part,
        @Part("prompt") prompt: RequestBody,
        @Part("model") model: RequestBody,
        @Part("n") n: RequestBody,
        @Part("size") size: RequestBody?,
        @Part("resolution") resolution: RequestBody?,
        @Part("response_format") responseFormat: RequestBody,
    ): ImageGenerationResponse
}
```

---

### 4. Streaming Generation (SSE)

When `"stream": true` is set in the request, the response content-type changes to `text/event-stream`. Each SSE `data:` line contains a JSON payload.

**Three Event Types** are distinguished by the `object` field:

#### 4.1 Progress Event

```json
{
  "object": "image.generation.chunk",
  "created": 1779256269,
  "model": "gpt-image-2",
  "index": 1,
  "total": 1,
  "progress_text": "Generating...",
  "upstream_event_type": "conversation.delta",
  "data": []
}
```

UI display: Progress bar or progress text. `index` / `total` represents "current image / total images", pushed sequentially in multi-image mode.

#### 4.2 Text Event (including upstream rejection info)

```json
{
  "object": "image.generation.message",
  "created": 1779256269,
  "model": "gpt-image-2",
  "index": 1,
  "total": 1,
  "message": "I cannot generate this image because..."
}
```

Received when the upstream fails or rejects the request; the AP should display the `message` directly to the user.

#### 4.3 Result Event

```json
{
  "object": "image.generation.result",
  "created": 1779256269,
  "model": "gpt-image-2",
  "index": 1,
  "total": 1,
  "data": [
    {
      "url": "https://your-backend/images/...",
      "revised_prompt": "..."
    }
  ]
}
```

Received when a generation completes successfully; the image should now be rendered. In multi-image mode (n > 1), multiple result events are pushed and should be accumulated by their `index`.

#### 4.4 Termination

The stream concludes with a final line:

```
data: [DONE]
```

or the connection simply closes. The AP should treat either `[DONE]` or connection closure as a successful completion.

#### 4.5 OkHttp + Flow Parsing Boilerplate

```kotlin
fun streamImageGeneration(request: ImageGenerationRequest): Flow<ImageEvent> = flow {
    val body = json.encodeToString(request).toRequestBody("application/json".toMediaType())
    val req = Request.Builder()
        .url("$baseUrl/v1/images/generations")
        .header("Authorization", "Bearer $token")
        .header("Accept", "text/event-stream")
        .post(body)
        .build()

    okHttpClient.newCall(req).execute().use { response ->
        if (!response.isSuccessful) throw HttpException(response)
        val source = response.body!!.source()
        while (!source.exhausted()) {
            val line = source.readUtf8Line() ?: break
            if (!line.startsWith("data:")) continue
            val payload = line.removePrefix("data:").trim()
            if (payload == "[DONE]") break
            val obj = json.parseToJsonElement(payload).jsonObject
            when (obj["object"]?.jsonPrimitive?.content) {
                "image.generation.chunk" -> emit(ImageEvent.Progress(...))
                "image.generation.message" -> emit(ImageEvent.Message(...))
                "image.generation.result" -> emit(ImageEvent.Result(...))
            }
        }
    }
}.flowOn(Dispatchers.IO)
```

---

### 5. Fetch Own Quota

```http
GET /api/auth/me
Authorization: Bearer <token>
Cache-Control: no-store
```

> Note that the path is `/api/auth/me`, not `/v1/...`. This is a custom backend endpoint, not an OpenAI-compatible one.

**Response**:

```json
{
  "identity": {
    "id": "abc123",
    "name": "User A",
    "role": "user",
    "account_tier": "premium",
    "can_use_paid_image_accounts": true,
    "can_use_high_resolution": true,
    "image_daily_quota": 20,
    "image_daily_used": 3,
    "image_daily_unlimited": false,
    "image_daily_remaining": 17,
    "image_monthly_quota": 200,
    "image_monthly_used": 31,
    "image_monthly_unlimited": false,
    "image_monthly_remaining": 169,
    "image_total_quota": 1000,
    "image_total_used": 122,
    "image_total_unlimited": false,
    "image_total_remaining": 878
  }
}
```

If `role` is `admin` or the token is the admin `auth_key`, all six quota tiers return `*_unlimited: true` and `*_remaining: null`. The AP should display this as "Unlimited Quota".

**User Tiers**:

| Field | Meaning |
|---|---|
| `account_tier=free` | Normal user. Restricted to the free account pool; the AP should disable 2K / 4K options |
| `account_tier=premium` | Premium user. Access to Plus / Team / Pro account pools and 2K / 4K drawing |
| `can_use_high_resolution=true` | Directly tells the AP whether to allow selecting 2K / 4K resolutions |

> UI restrictions are only for user experience. The backend strictly validates resolutions at `/v1/images/*`: even if a normal user modifies the request to `resolution=4k`, a 403 error is returned.

**Call Timings**:

- Call once upon AP launch and cache in ViewModel.
- Refresh after each successful image generation.
- Proactively check/refresh after generation failures, as the backend may have deducted and refunded quota, or the rate-limit state of the account pool may have changed.

---

### 6. Public Gallery

The gallery is a native backend feature: users can publish their generated images to a shared gallery, enabling others to browse, reuse prompts, or use them as reference images for edits. All endpoints require authentication (`require_identity`) and can be called by both admins and users. Write operations are restricted to the author or admins.

#### 6.1 GalleryItem Fields

Unified structure returned by all gallery endpoints:

```json
{
  "id": "abc123hex",
  "url": "https://your-backend/images/2026/05/21/foo.png",
  "image_rel": "2026/05/21/foo.png",
  "prompt": "Moscow Red Square on a snowy night, snowflakes falling",
  "model": "gpt-image-2",
  "size": "9:16",
  "width": 1024,
  "height": 1820,
  "publisher_name": "User A",
  "created_at": 1779256269,
  "status": "visible",
  "is_edit": false,
  "is_mine": true
}
```

| Field | Description |
|---|---|
| `id` | Server-generated uuid hex, acts as the primary key for detail / unpublish |
| `url` | Full HTTP(S) image URL, can be passed directly to Coil |
| `image_rel` | Relative path in `image_owners`, used to match owner for "Withdraw / Overwrite" actions |
| `width` / `height` | Used to calculate waterfall layout aspect ratio; defaults to 0 if not stored (AP falls back to 1:1) |
| `status` | `visible` / `hidden`. Normal users only see visible items; admins passing `?include_hidden=true` can see hidden items |
| `created_at` | Epoch time in **seconds** (not milliseconds); pay attention when calculating "X minutes ago" |
| `is_mine` | Whether the current requester is the publisher. Returns true if viewer_id matches publisher_id, preventing publisher_id exposure. Used to display "Withdraw Publication" to the author |
| `is_edit` | true indicates image-to-image edit output. The backend forces the `prompt` to empty upon publishing, as reference image instructions have no reuse value without the reference image. The AP should replace the prompt display with a placeholder notice and disable the copy prompt button |
| ⚠️ No `publisher_id` | Intentionally excluded to protect publisher anonymity |

#### 6.2 GET /api/gallery/feed — Gallery main feed

Cursor-based pagination. Call with `cursor=null` initially; pass the returned `next_cursor` on subsequent calls. `next_cursor=""` indicates the end of the feed.

```http
GET /api/gallery/feed?cursor=&limit=20
Authorization: Bearer <token>
```

| Query | Type | Description |
|---|---|---|
| `cursor` | string | Leave empty for initial call; pass `next_cursor` subsequently |
| `limit` | int | 1-100, default 20 |
| `include_hidden` | bool | **Only valid for admins**. Ignored for other users |

**Response**:

```json
{
  "items": [ { "id": "...", "url": "...", "..." } ],
  "next_cursor": "eyJ0Ijo..."
}
```

#### 6.3 GET /api/gallery/items/{id} — Single item details

```json
{ "item": { "id": "...", "url": "...", "..." } }
```

Returns 404 if the item does not exist or has been taken down. Returns 200 for admins even if the status is hidden.

#### 6.4 POST /api/gallery/publish — Publish to gallery

```http
POST /api/gallery/publish
Authorization: Bearer <token>
Content-Type: application/json

{
  "image_rel": "2026/05/21/foo.png",
  "prompt": "Moscow Red Square on a snowy night",
  "model": "gpt-image-2",
  "size": "9:16",
  "width": 1024,
  "height": 1820
}
```

| Field | Required | Description |
|---|---|---|
| `image_rel` | ✓ | Rel path in `image_owners` associated with own identity. Returns 403 if it belongs to someone else |
| `prompt` / `model` / `size` / `width` / `height` |   | Optional, but **highly recommended** to match the original generation parameters so others can reproduce it |

**Idempotence**: Repeatedly publishing the same `(publisher_id, image_rel)` returns the existing record instead of creating duplicates.

**Response**: `{ "item": { ... } }`, identical to `/items/{id}`.

#### 6.5 DELETE /api/gallery/items/{id} — Withdraw / Delete

Used by authors to withdraw their publication, and by admins to delete any item.

```http
DELETE /api/gallery/items/abc123hex
Authorization: Bearer <token>
```

The backend verifies if `publisher_id == requester_id` for withdrawals; admins bypass this. The original image (`image_owners`) is unaffected, remaining in "My Works"—withdrawing simply removes the record from the gallery.

#### 6.6 POST /api/gallery/items/{id}/hide / unhide — Admin soft take-down

```http
POST /api/gallery/items/abc123hex/hide
POST /api/gallery/items/abc123hex/unhide
Authorization: Bearer <admin-token>
```

Soft take-down: Does not delete the original file, just changes the status to `hidden`. Hidden items are omitted from the user feed, but visible in the admin dashboard when using `include_hidden=true`. If the publisher republishes the same image, the status automatically reverts to `visible`.

#### 6.7 GET /api/gallery/published?image_rel=... — Single query

Used by the "My Works" page to check if an image is already published, allowing the card menu to switch states between "Publish to Gallery" and "Published · Withdraw".

```json
{
  "published": true,
  "item": { "id": "abc123hex", "status": "visible" }
}
```

Returns `{ "published": false, "item": null }` if not published.

#### 6.8 POST /api/gallery/published/batch — Batch query

Called by "My Works" on reload to fetch the publish states for all visible items in a single call, avoiding N+1 parallel requests that could hit connection limits.

```http
POST /api/gallery/published/batch
Authorization: Bearer <token>
Content-Type: application/json

{ "image_rels": ["2026/05/21/a.png", "2026/05/21/b.png"] }
```

**Response** only contains matching keys for published rels; unpublished ones are omitted:

```json
{
  "items": {
    "2026/05/21/a.png": { "published": true, "id": "...", "status": "visible" }
  }
}
```

> Admins automatically query cross-user: admins checking images only care if they have been published by *anyone*, so the publisher filter is bypassed; normal users are restricted to their own `publisher_id`.

---

### 7. My Works (Cloud Aggregation)

```http
GET /api/me/images?start_date=2026-05-01&end_date=2026-05-31
Authorization: Bearer <token>
```

Returns all cloud images belonging to the current identity. **Purpose**: Call upon AP startup or when entering "My Works" to merge/de-duplicate with local Room history, restoring work when logging in on new devices.

| Query | Required | Description |
|---|---|---|
| `start_date` |   | `YYYY-MM-DD`, leave empty for no lower limit |
| `end_date` |   | `YYYY-MM-DD`, leave empty for no upper limit |

**Identity Filtering Logic**:

- Normal user key: Returns only images generated by self (filtered in `image_owners.json` by `identity.id`).
- Admin key: Automatically falls back to `__admin__`, aggregating all images generated by admin accounts (conceptually, "me" = admin role).
- No `owner` query parameter is exposed to prevent users from checking others' files.

**Response**:

```json
{
  "items": [
    {
      "rel": "2026/05/21/foo.png",
      "url": "https://your-backend/images/2026/05/21/foo.png",
      "thumb_url": "https://your-backend/images/2026/05/21/foo.thumb.webp",
      "date": "2026-05-21",
      "size_bytes": 1234567,
      "mtime": 1779256269,
      "owner": "<user_key_id>"
    }
  ],
  "groups": [
    { "date": "2026-05-21", "items": [ ... ] }
  ]
}
```

`groups` presents items grouped by date. If the AP wants to render list sections by date, it can use this structure directly; otherwise, simply parse the flat list in `items`.

---

## V. Error Codes and Retries

| HTTP | Meaning | Quota Refunded? | AP Recommendation |
|---|---|---|---|
| 200 | Success | n/a | |
| 400 | Parameter validation error (empty prompt, invalid size, missing image, non-existent image_rel, etc.) | No deduction | Display the error returned in the `error` field; do not retry |
| 401 | Invalid token | n/a | Clear key and redirect to login (except during generation, see interceptor exceptions) |
| 402 | **Insufficient Quota** | n/a | Prompt user to contact admin for quota; do not retry |
| 403 | Forbidden (publishing others' images, user calling admin APIs, normal user requesting 2K/4K, etc.) | n/a | Display the `error` message; do not retry |
| 404 | Gallery item non-existent / taken down | n/a | Remove the corresponding card from the feed |
| 429 | Rate limit reached (all accounts in pool rate-limited) | Refunded | Prompt "Service busy, try again later"; retry after delay |
| 502 | Upstream ChatGPT Web error or connection failure | Refunded | Retry once; if it fails again, display the error |
| IO Exception | Connection refused / DNS failure / TLS failure | n/a | On startup: clear key and redirect to login; on business requests: show error bar and preserve login state (do not kick user out during generation) |

**Quota Refund Rules Summary**:

- Entry deduction: Quota is pre-deducted by `n` when the request enters processing at `/v1/images/*` (admins / unlimited quota skipped).
- Upstream actual failure (5xx / 502 / content policy / mid-stream disconnect / task cancel) → Backend **automatically refunds** the quota.
- User error (400 / content censorship / auth fail) → Fail-fast path triggers before deduction; **no quota is deducted**.
- The AP does not need to handle refunds; but refreshing the local `remaining` quota count by calling `/api/auth/me` in the generation's `finally` block is recommended.

Error responses follow a unified format:

```json
{ "detail": { "error": "Detailed error message" } }
```

or (on certain endpoints):

```json
{ "error": { "message": "...", "type": "...", "code": "..." } }
```

The AP should support parsing both formats.

---

## VI. Image URL Lifecycle

The backend stores images under `data/images/`, structured by `YYYY/MM/DD/`. **Images expire and are cleaned up** based on `image_retention_days` in `config.json` (defaults to 30 days).

However, cleaning up strictly by modification time can lead to broken images in the gallery or missing history. Starting from v1.2.2, **two protection switches** are introduced and enabled by default:

| Configuration Key | Default | Impact |
|---|---|---|
| `cleanup_protect_gallery` | true | Images published to the gallery are exempt from cleanup |
| `cleanup_protect_user_images` | true | Images associated with a user key are exempt from cleanup. Anonymous/admin-generated images with no owner are still cleaned by age |

Admins can disable these switches in the settings panel to return to absolute time-based cleanup.

**AP Design Recommendations** (regardless of backend configuration):

1. **Download images to local storage immediately after generation** (either user gallery or app private folder)
2. **Store local file paths in history**, rather than depending on long-term remote URLs
3. **Use remote URLs only for immediate feedback after generation**, not as the primary source in Room database records

Why can we not rely entirely on backend protection switches? Two reasons:

- The admin might disable protection switches to free up storage; the AP should not assume they are always active.
- Users might switch devices or reinstall the app: local cache is lost, and while cloud images can be recovered via `/api/me/images`, this still assumes the remote PNG exists on the server.

---

## VII. Recommended AP Architecture

```
app/
├── data/
│   ├── api/
│   │   ├── DrawApi.kt              # Retrofit interface
│   │   ├── SseClient.kt            # OkHttp + Flow streaming client
│   │   └── dto/                    # ImageRequest / Response etc.
│   ├── repository/
│   │   ├── DrawRepository.kt       # Business operations wrapper
│   │   ├── HistoryRepository.kt    # Local history repository
│   │   └── AuthRepository.kt       # Base URL + token manager
│   ├── db/                          # Room DB
│   └── prefs/                       # DataStore
├── domain/                          # Business models (decoupled from DTOs)
├── ui/
│   ├── compose/
│   │   ├── login/                   # Server URL + auth key input
│   │   ├── generate/                # Drawing interface
│   │   ├── history/                 # History records list
│   │   └── settings/                # Preferences (Base URL, logout)
│   ├── components/                   # Reusable composables
│   └── theme/
└── di/                                # Simple dependency injection (manual DI is fine, Hilt not required)
```

---

## VIII. Optimization Points Requiring Backend Cooperation

| Priority | Feature | Status |
|---|---|---|
| P0 | `/v1/images/*` supports `response_format=url` | ✅ Implemented. The AP can explicitly request `url` to receive a full HTTP(S) URL |
| P1 | `/api/auth/me` includes `Cache-Control: no-store` | ✅ Implemented |
| P1 | Upstream failures / canceled tasks automatically refund quota | ✅ Implemented in v1.2.2. AP does not need to handle refunds manually |
| P1 | User key tiers (Normal vs Premium) | ✅ Implemented. Normal users restricted to free pool and 1K; premium users get Plus/Team/Pro and 2K/4K |
| P1 | `/v1/images/*` accepts `resolution=1k/2k/4k` | ✅ Implemented. 2K/4K queries choose Codex high-resolution route with backend validation |
| P1 | Account 429 rate limit automatic marking and recovery | ✅ Implemented. Bypasses account upon hitting 429 / `rate_limit_exceeded` / `usage_limit_reached` and recovers based on reset header |
| P1 | Images published to gallery / user works exempt from cleanup | ✅ Implemented in v1.2.2. Both protection switches enabled by default |
| P1 | `/api/gallery/published/batch` batch query | ✅ Implemented in v1.2.2, avoiding N+1 requests |
| P2 | Separate stream event type for `error` | Not implemented; currently reuse `image.generation.message` |
| P3 | Provide `/v1/images/sizes` to query supported aspect ratios | Not implemented; AP can hardcode `1:1`, `16:9`, `9:16`, `4:3`, `3:4` |
| P3 | Gallery feed supports tag / keyword filters | Not implemented; to be added when gallery size grows |

---

## IX. Frequently Used Debugging Commands

Start backend in development mode:

```bash
uv run main.py
# Default listener http://127.0.0.1:8000
```

Testing via curl:

```bash
# Fetch model list
curl -H "Authorization: Bearer YOUR_KEY" http://127.0.0.1:8000/v1/models

# Generate image (non-streaming)
curl -X POST http://127.0.0.1:8000/v1/images/generations \
  -H "Authorization: Bearer YOUR_KEY" \
  -H "Content-Type: application/json" \
  -d '{"prompt":"a cat","n":1,"size":"9:16","resolution":"1k","response_format":"url"}'

# 4K vertical image. Requires premium user key; selects from Pro / Plus / Team Codex pool
curl -X POST http://127.0.0.1:8000/v1/images/generations \
  -H "Authorization: Bearer YOUR_KEY" \
  -H "Content-Type: application/json" \
  -d '{"prompt":"A minimalist premium product poster","n":1,"size":"9:16","resolution":"4k","response_format":"url"}'

# Generate image (streaming)
curl -N -X POST http://127.0.0.1:8000/v1/images/generations \
  -H "Authorization: Bearer YOUR_KEY" \
  -H "Content-Type: application/json" \
  -d '{"prompt":"a cat","n":1,"response_format":"url","stream":true}'

# Fetch quota
curl -H "Authorization: Bearer YOUR_KEY" http://127.0.0.1:8000/api/auth/me
```

---

## X. FAQ

**Q: The client selects the `gpt-5` model, but the response is always from a mini model?**  
A: The `/v1/chat/completions` endpoint is subject to upstream anti-bot rules; free accounts are forced to route to light models. Since the Draw client is strictly for drawing, text conversation issues do not affect the main features.

**Q: Image generation finishes without any progress events?**  
A: The upstream SSE event frequency is not constant. Sometimes, only a final result event is pushed. The client should not assume a progress event will always be received.

**Q: When n > 1, are results returned together or separately?**  
A: In streaming mode, each image triggers a separate result event (with a different `index`); in non-streaming mode, all results are returned together in the `data: [...]` array.

**Q: What is the file size limit for uploads?**  
A: There is no strict limit enforced by the backend, but clients are recommended to compress images to under 4MB to avoid slow uploads and upstream rate limits.

---

## Revision History

| Date | Version | Description |
|---|---|---|
| 2026-05-22 | v1.2.2 | Added gallery endpoints (feed/publish/unpublish/published/batch) + `/api/me/images` section; added IOException / me() health check strategy and skip-unauth-hook header to Authentication section; introduced `cleanup_protect_gallery` and `cleanup_protect_user_images` protection switches; unified automatic quota refund on upstream failures/cancellation; added quota columns to the error codes table; clarified drawing models are restricted to `gpt-image-2` / `codex-gpt-image-2` |
| 2026-05-20 | v1.2.1 | Initial version |
