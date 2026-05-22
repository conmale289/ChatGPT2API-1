# Android 客户端对接文档

面向 [Draw](https://github.com/RemotePinee) 安卓客户端的后端 API 集成指南。所有 `/v1/*` 接口与 OpenAI 官方协议兼容，可直接复用 OpenAI 安卓 SDK 的请求结构。

> 本文档跟随后端代码同步演进。如果发现接口与代码不一致，以代码为准并提 issue。

---

## 一、环境基线

下表是写文档时验证过的版本组合，安卓项目按这套来不会踩坑。

| 项 | 版本 |
|---|---|
| Android Studio | Ladybug 2024.2.1 及以上 |
| JDK | 21 |
| Kotlin | 2.0+ |
| Compose Compiler | 由 `org.jetbrains.kotlin.plugin.compose` 插件管理 |
| Compose BOM | `2026.03.01` |
| compileSdk / targetSdk | 36 |
| minSdk | 26 (Android 8.0) |
| Gradle | 8.7+ |
| AGP | 8.5+ |

后端环境：

| 项 | 版本 |
|---|---|
| Python | 3.13 |
| 包管理 | uv |
| Web 框架 | FastAPI |
| 后端 repo | https://github.com/RemotePinee/ChatGPT2API |
| API 版本 | 见 `VERSION` 文件 |

---

## 二、推荐安卓依赖

```kotlin
dependencies {
    // Compose
    implementation(platform("androidx.compose:compose-bom:2026.03.01"))
    implementation("androidx.compose.ui:ui")
    implementation("androidx.compose.material3:material3")
    implementation("androidx.compose.material:material-icons-extended")
    implementation("androidx.activity:activity-compose:1.13.0")
    implementation("androidx.navigation:navigation-compose:2.9.7")

    // 网络层（OpenAI 兼容协议直接用 Retrofit + OkHttp 即可）
    implementation("com.squareup.retrofit2:retrofit:3.0.0")
    implementation("com.squareup.retrofit2:converter-gson:3.0.0")
    implementation("com.squareup.okhttp3:okhttp:5.3.2")
    implementation("com.squareup.okhttp3:logging-interceptor:5.3.2")

    // 异步
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.10.2")

    // 图片加载
    implementation("io.coil-kt:coil-compose:2.7.0")

    // 本地存储
    val roomVersion = "2.8.4"
    implementation("androidx.room:room-runtime:$roomVersion")
    implementation("androidx.room:room-ktx:$roomVersion")
    ksp("androidx.room:room-compiler:$roomVersion")
    implementation("androidx.datastore:datastore-preferences:1.1.1")
}
```

---

## 三、鉴权

所有 `/v1/*` 接口都要带 `Authorization: Bearer <token>`。token 有两种来源：

| 来源 | 说明 | 推荐场景 |
|---|---|---|
| 管理员 auth_key | 部署后端时在 `config.json` 里设置的 `auth-key`，全权限 | 自部署、个人用 |
| 用户密钥 | 管理员在后台 `/api/auth/users` 创建的 `sk-...` 形式密钥，可设额度 | 给别人发用 |

后端识别这两种来自同一个 header，AP 端无需区分。

### 配置入口

AP 首启引导页 / 设置页让用户输入两项：

```
后端地址 (Base URL)：例如 https://api.example.com  或 http://192.168.1.10:8000
访问密钥 (Auth Key)：admin auth_key 或 sk-... 用户密钥
```

存储建议：

- Base URL → DataStore Preferences（明文）
- Auth Key → DataStore Preferences（**建议过 EncryptedSharedPreferences 或 Tink 加密**）

### 401 处理

任意接口返回 401 都意味着密钥无效或被吊销，AP 端要：

1. 清掉本地保存的 auth_key（base url 保留）
2. 跳回登录/设置页

---

## 四、AP 端用得到的接口清单

### 1. 拉模型列表

```http
GET /v1/models
Authorization: Bearer <token>
```

**响应（200）**：

```json
{
  "object": "list",
  "data": [
    { "id": "gpt-image-2", "object": "model", "owned_by": "chatgpt2api" },
    { "id": "codex-gpt-image-2", "object": "model", "owned_by": "chatgpt2api" }
  ]
}
```

**实现要点**：

- AP 端只关心**画图模型**，过滤 `id` 包含 `image` 的项即可
- 文档发版时已知的画图模型：`gpt-image-2`、`codex-gpt-image-2`
- 列表会随上游 ChatGPT Web 变化，**不要在 AP 端硬编码**

---

### 2. 文生图

```http
POST /v1/images/generations
Authorization: Bearer <token>
Content-Type: application/json
```

**请求体**：

```json
{
  "prompt": "一只穿宇航服的猫，蹲在月球表面",
  "model": "gpt-image-2",
  "n": 1,
  "size": "1:1",
  "response_format": "url",
  "stream": false
}
```

| 字段 | 类型 | 必需 | 说明 |
|---|---|---|---|
| `prompt` | string | ✓ | 至少 1 字符 |
| `model` | string |   | 默认 `gpt-image-2` |
| `n` | int |   | 1-4，默认 1。**会按 n 整体扣额度** |
| `size` | string |   | 支持 `1:1` `16:9` `9:16` `4:3` `3:4`，其它字符串会原样注入 prompt |
| `response_format` | string |   | `url` 或 `b64_json`，默认 `b64_json`。**安卓端强烈建议 `url`**（解 b64 慢且耗内存） |
| `stream` | bool |   | 见下文流式说明 |

**非流式响应（200）**：

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

如果上游拒绝（内容策略命中等），返回 OpenAI 标准错误：

```json
{
  "error": {
    "message": "Image generation was rejected by upstream policy.",
    "type": "invalid_request_error",
    "code": "content_policy_violation"
  }
}
```

---

### 3. 图生图（编辑）

```http
POST /v1/images/edits
Authorization: Bearer <token>
Content-Type: multipart/form-data
```

**multipart 字段**：

| 字段 | 类型 | 必需 | 说明 |
|---|---|---|---|
| `image` | file | ✓ | 单图传 `image`；多图重复传 `image[]` 字段 |
| `prompt` | string | ✓ | |
| `model` | string |   | 默认 `gpt-image-2` |
| `n` | int |   | 1-4 |
| `size` | string |   | 同上 |
| `response_format` | string |   | 同上 |
| `stream` | string |   | `true`/`false` |

响应结构跟 `/v1/images/generations` 一致。

**OkHttp + Retrofit 写法**：

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
        @Part("response_format") responseFormat: RequestBody,
    ): ImageGenerationResponse
}
```

---

### 4. 流式生成（SSE）

请求里带 `"stream": true` 后，响应类型变为 `text/event-stream`。每一帧 `data:` 后跟一段 JSON。

**事件类型有三种**，靠 `object` 字段区分：

#### 4.1 进度事件

```json
{
  "object": "image.generation.chunk",
  "created": 1779256269,
  "model": "gpt-image-2",
  "index": 1,
  "total": 1,
  "progress_text": "正在生成...",
  "upstream_event_type": "conversation.delta",
  "data": []
}
```

UI 展示：进度条/进度文案。`index` / `total` 表示"第几张/共几张"，多图模式下连续推送。

#### 4.2 文本事件（含上游拒绝信息）

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

收到后等同于"上游拒绝/失败"，AP 端把 `message` 直接展示给用户。

#### 4.3 结果事件

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

收到这个事件就把图渲染出来。流可能会推多个 result（n>1 的情况），按 `index` 累积。

#### 4.4 终结

最后会有一帧：

```
data: [DONE]
```

或直接关闭连接。AP 端收到 `[DONE]` 字面值或连接关闭都算正常结束。

#### 4.5 OkHttp + Flow 解析样板

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

### 5. 拉自己的额度

```http
GET /api/auth/me
Authorization: Bearer <token>
Cache-Control: no-store
```

> 注意路径是 `/api/auth/me`，不是 `/v1/...`。这是后端自己的接口，不是 OpenAI 兼容。

**响应**：

```json
{
  "identity": {
    "id": "abc123",
    "name": "用户A",
    "role": "user",
    "quota": 100,
    "used": 23,
    "remaining": 77,
    "unlimited": false
  }
}
```

`role` = `admin` 或 token 是 admin 的 auth_key 时，返回的 `unlimited: true`、`remaining: null`，AP 端按"无限额度"展示。

**调用时机**：

- AP 启动后调一次，存到 ViewModel
- 每次画图成功后再调一次刷新

---

## 五、错误码与重试

| HTTP | 含义 | AP 端建议 |
|---|---|---|
| 200 | 成功 | |
| 400 | 参数错误（如 prompt 为空、size 不合法、image 缺失） | 提示具体 `error` 字段，不重试 |
| 401 | 密钥无效 | 清密钥跳登录页 |
| 402 | **额度不足** | 弹窗提示"额度不足，请联系管理员" |
| 429 | 号池没有可用配额（所有上游账户都被限流） | 提示"服务繁忙，稍后重试"，可定时重试 |
| 502 | 上游 ChatGPT Web 异常或网络错误 | 自动重试 1 次，仍失败弹错 |

错误响应统一格式：

```json
{ "detail": { "error": "具体错误信息" } }
```

或（部分接口）：

```json
{ "error": { "message": "...", "type": "...", "code": "..." } }
```

AP 端解析时两种都要兼容。

---

## 六、图片 URL 生命周期

后端把图存在 `data/images/` 下，按 `YYYY/MM/DD/` 分目录。**图片有过期时间**，由 `config.json` 里 `image_retention_days` 控制（默认 30 天）。

AP 端策略：

1. **生成成功后立刻把图下载到本地**（用户相册或 AP 私有目录）
2. **历史记录里只存本地路径**，不依赖远程 URL
3. **远程 URL 仅作为生成后短期回显**，不缓存到 Room

不这么做的话，30 天后历史记录里的图全部 404。

---

## 七、AP 端推荐架构

```
app/
├── data/
│   ├── api/
│   │   ├── DrawApi.kt              # Retrofit 接口
│   │   ├── SseClient.kt            # OkHttp + Flow 流式
│   │   └── dto/                    # ImageGenerationRequest / Response 等
│   ├── repository/
│   │   ├── DrawRepository.kt       # 业务封装
│   │   ├── HistoryRepository.kt    # 历史记录
│   │   └── AuthRepository.kt       # base url + token
│   ├── db/                          # Room
│   └── prefs/                       # DataStore
├── domain/                          # 业务模型（与 dto 解耦）
├── ui/
│   ├── compose/
│   │   ├── login/                   # 输入 base url + auth key
│   │   ├── generate/                # 主生成页
│   │   ├── history/                 # 历史记录
│   │   └── settings/                # 设置（base url、登出）
│   ├── components/                   # 可复用 Composable
│   └── theme/
└── di/                                # 简单的 manual DI 即可，不必 Hilt
```

---

## 八、需要后端配合的优化点

| 优先级 | 内容 | 现状 |
|---|---|---|
| P0 | `/v1/images/*` 默认 `response_format=url` | 当前默认是 `b64_json`，AP 端必须显式传 `url` |
| P1 | `/api/auth/me` 已加 `Cache-Control: no-store` | 已实现 |
| P2 | 流式事件加上 `error` 单独事件类型 | 暂未实现，目前用 `image.generation.message` 复用 |
| P3 | 提供 `/v1/images/sizes` 查询模型支持的尺寸 | 暂未实现，AP 端硬编码即可 |

---

## 九、常用调试命令

后端起服务（开发）：

```bash
uv run main.py
# 默认监听 http://127.0.0.1:8000
```

curl 自测：

```bash
# 拉模型列表
curl -H "Authorization: Bearer YOUR_KEY" http://127.0.0.1:8000/v1/models

# 文生图（非流式）
curl -X POST http://127.0.0.1:8000/v1/images/generations \
  -H "Authorization: Bearer YOUR_KEY" \
  -H "Content-Type: application/json" \
  -d '{"prompt":"a cat","n":1,"response_format":"url"}'

# 文生图（流式）
curl -N -X POST http://127.0.0.1:8000/v1/images/generations \
  -H "Authorization: Bearer YOUR_KEY" \
  -H "Content-Type: application/json" \
  -d '{"prompt":"a cat","n":1,"response_format":"url","stream":true}'

# 拉额度
curl -H "Authorization: Bearer YOUR_KEY" http://127.0.0.1:8000/api/auth/me
```

---

## 十、常见问题

**Q：AP 端选了模型 `gpt-5` 但回复始终是 mini？**
A：`/v1/chat/completions` 这条线被上游 ChatGPT Web 的反爬策略限制，免费账号会被强制路由到轻量模型。**Draw AP 只关心画图，不需要文本对话**，无需关注此问题。

**Q：图片生成中途没有进度，结果直接出来了？**
A：上游 SSE 事件分布不固定，有时全程只推一个 result。AP 端不要假定一定会有 progress 事件。

**Q：n>1 时 result 一次返回还是分多次？**
A：流式模式下每张图触发一个 result（`index` 不同）；非流式模式整体一次返回 `data: [...]`。

**Q：上传图片大小限制？**
A：后端没硬限制，但建议 AP 端压到 4MB 以内，否则上行慢且容易触发上游限流。

---

## 修订记录

| 日期 | 版本 | 改动 |
|---|---|---|
| 2026-05-20 | v1.2.1 | 初版 |
