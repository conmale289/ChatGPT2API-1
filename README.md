<h1 align="center">
  <img src="assets/logo.png" alt="ChatGPT2API" width="72" height="72" />
  <br />
  ChatGPT2API
</h1>


<p align="center">ChatGPT2API mainly reverses and encapsulates the capabilities of the ChatGPT official website, providing OpenAI-compatible image APIs / proxies for ChatGPT image generation, image editing, and multi-image composite editing scenarios. It also integrates an online image studio, account pool management, various account import methods, and Docker self-hosting deployment capabilities.</p>

<p align="center">
  <img src="assets/hero.png" alt="ChatGPT2API" width="100%" />
</p>

> [!NOTE]
> This project is a secondary development version based on [basketikun/chatgpt2api](https://github.com/basketikun/chatgpt2api), mainly enhancing and refactoring the frontend UI/UX, registrar, log management, and image management modules.
>
> - Original project: https://github.com/basketikun/chatgpt2api
> - Thanks to the original author for the reverse engineering work and open-source contributions. If you only need stable core capabilities, you can use the original project directly.

> [!WARNING]
> Disclaimer:
>
> This project involves reverse engineering research on ChatGPT official website interfaces for text generation, image generation, and image editing. It is intended solely for personal learning, technical research, and non-commercial technical exchange.
>
> - It is strictly prohibited to use this project for any commercial purposes, profitable usage, batch operations, automated abuse, or large-scale calling.
> - It is strictly prohibited to use this project to disrupt market order, engage in malicious competition, arbitrage, resell related services, or perform any behavior violating OpenAI Terms of Service or local laws and regulations.
> - It is strictly prohibited to use this project to generate, disseminate, or assist in generating illegal, violent, pornographic, or minor-related content, or for fraudulent, scamming, harassment, or other illegal or improper purposes.
> - Users shall bear all risks, including but not limited to account restrictions, temporary bans, or permanent bans, as well as legal liabilities resulting from non-compliant usage.
> - Using this project is deemed as your full understanding and agreement to all contents of this disclaimer; any consequences caused by abuse, non-compliant, or illegal use shall be borne by the user themselves.

> [!IMPORTANT]
> This project is implemented based on reverse engineering research of ChatGPT official website capabilities, and there is a risk of account restrictions, temporary bans, or permanent bans. Please do not use your own important, commonly used, or high-value accounts for testing.

## Quick Start

Released images support `linux/amd64` and `linux/arm64`. The version matching the architecture will be automatically pulled on x86 servers and Apple Silicon / ARM Linux devices.

### Docker Run

```bash
git clone https://github.com/RemotePinee/ChatGPT2API.git
cd ChatGPT2API
docker compose up -d
```

Please set the `auth-key` in `config.json` before starting, or override it in `docker-compose.yml` via `CHATGPT2API_AUTH_KEY`.

- Web Panel: `http://localhost:3000`
- API Address: `http://localhost:3000/v1`
- Data Directory: `./data`

### Local Development

Start backend:

```bash
git clone https://github.com/RemotePinee/ChatGPT2API.git
cd ChatGPT2API
uv sync
uv run main.py
```

Start frontend:

```bash
cd ChatGPT2API/web
bun install
bun run dev
```

### Storage Backend Configuration

Supports switching storage methods via the `STORAGE_BACKEND` environment variable:

- `json` - Local JSON file (default)
- `sqlite` - Local SQLite database
- `postgres` - External PostgreSQL (requires `DATABASE_URL` configuration)
- `git` - Git private repository (requires `GIT_REPO_URL` and `GIT_TOKEN` configuration)

Example: Using PostgreSQL

```yaml
environment:
  - STORAGE_BACKEND=postgres
  - DATABASE_URL=postgresql://user:password@host:5432/dbname
```

## Features

### API Compatibility

- Compatible with `POST /v1/images/generations` image generation interface (text-to-image)
- Compatible with `POST /v1/images/edits` image editing interface
- Compatible with `POST /v1/chat/completions` (OpenAI Chat Completions)
- Compatible with `POST /v1/responses` (OpenAI Responses)
- Compatible with `POST /v1/messages` (Anthropic Messages)
- `GET /v1/models` syncs upstream available models in real-time (such as `gpt-5`, `gpt-5-mini`, `auto`, etc., depending on your account's actual permissions), and attaches local image model aliases `gpt-image-2` and `codex-gpt-image-2`
- The `model` field in text interfaces (`/v1/chat/completions`, `/v1/responses`, `/v1/messages`) is passed directly to the upstream; the range of available models is determined by the account's permissions on the ChatGPT web side
- Image interfaces only recognize `gpt-image-2` (mapped to the upstream `gpt-5-3` slug) and `codex-gpt-image-2` (using the Codex image channel). Other model names used on the image interface will fall back to `auto`
- Image interfaces support `size` aspect ratio parameters (`1:1`, `16:9`, `9:16`, `4:3`, `3:4`) and `resolution` definition parameters (`1k`, `2k`, `4k`)
- `resolution=2k/4k` will prioritize the Codex high-definition path and filter accounts based on the available pool: `Pro` -> `Plus` -> `Team`. If the high-definition path fails, it will not automatically downgrade to standard 1K
- Supports returning multiple generated results at once via `n` (backend limit 1-4)
- Supports reverse engineering of Codex drawing interfaces, available only for `Plus` / `Team` / `Pro` subscriptions, with the model alias `codex-gpt-image-2`. It shares accounts with the official website drawing but has an independent quota

### Online Image Studio

- Built-in online image workbench, supporting text-to-image, image editing, and multi-image composite editing
- Supports two image models: `gpt-image-2` and `codex-gpt-image-2`
- Supports 1K / 2K / 4K resolution selection. Free users are automatically locked to 1K, while premium users can use 2K / 4K
- Edit mode supports reference image upload
- Frontend supports multi-image generation interaction
- Locally saves image session history, supporting viewing, deleting, and clearing
- Supports server-side caching of image URLs

### Account Pool Management

- Automatically refreshes account email, type, quota, and recovery time
- Polls available accounts to execute image generation and image editing
- Automatically removes invalid tokens when encountering token expiration errors
- Automatically marks an account as rate-limited when encountering image generation 429 / `rate_limit_exceeded` / `usage_limit_reached`, and restores it automatically according to the upstream reset header
- Periodically checks rate-limited accounts and automatically refreshes them
- Supports searching, filtering, batch refreshing, exporting, manual editing, and cleaning accounts
- Supports four import methods: local CPA JSON file import, remote CPA server import, `sub2api` server import, and `access_token` direct import
- Supports configuring the `sub2api` server on the settings page to filter and batch import OpenAI OAuth accounts from it

### Registrar (Account Creator)

- Built-in ChatGPT email registration pipeline
- Supports starting, stopping, and resetting registration tasks
- SSE real-time streaming of registration progress and logs

### Log Management

- System logs can be filtered by type and date range
- Supports filtering by `debug` / `info` / `warning` / `error` levels
- Real-time refreshing and history viewing

### Image Management

- Server-side cached image browsing and downloading
- Tag management and filtering
- Query by date range
- Single image deletion and batch cleaning

### Configuration and Backup

- Global `auth-key` + user-level key two-tier permission system (admin / user). User keys can be set to normal / premium levels
- Normal users can only use the free account pool and 1K image generation; premium users can use the Plus / Team / Pro account pool and 2K / 4K high-definition image generation
- Multiple storage backends: `json` / `sqlite` / `postgres` / `git`
- Global HTTP / HTTPS / SOCKS5 / SOCKS5H proxy
- Cloudflare R2 automatic backup (can be encrypted, optional retention)
- Global system prompt, sensitive word filtering, optional AI auto-moderation

## Android Client

Provides a matching Android client **Draw**, which is deeply integrated with this backend, covering text-to-image, image-to-image, gallery, work management, and other scenarios.

> [!NOTE]
> The Android client is released closed-source, provided only as an APK download in [Releases](https://github.com/RemotePinee/ChatGPT2API/releases); this repository does not contain its source code. The backend API is completely open-source, and you are welcome to implement your own client based on [`docs/android-integration.md`](docs/android-integration.md).

### Download and Installation

1. Download the latest `Draw-vX.Y.Z.apk` from the [Releases](https://github.com/RemotePinee/ChatGPT2API/releases) page
2. Install and launch it. For the first-time entry, fill in:
   - **Backend Address**: Your deployed ChatGPT2API instance address (e.g., `https://api.example.com`)
   - **Access Key**: Administrator root key (`auth-key` in `config.json`) or a user key created in the settings page

### Main Capabilities

- Text-to-image / image-to-image, supporting reference images, style presets, ratio and count selection
- Supports 1K / 2K / 4K resolution selection, and displays normal / premium user status based on user key permissions
- Public Gallery: Browse community works, one-click reuse prompts, and withdraw self-published works
- My Works: Local cache + cloud ownership merging, images are not lost when reinstalling / changing devices
- Background Generation: The task continues running after the popup is closed, with global Toast notifications upon completion
- Automatically refreshes available quota, and automatically jumps back to the login page when the key expires or the backend is unreachable

### Compatibility

| Item | Requirement |
|---|---|
| Minimum Android Version | 8.0 (API 26) |
| Backend Version | Recommended backend version close to the client release date; requires at least supporting `/v1/images/*`, `/api/gallery/*`, `/api/me/images`, and other interfaces |
| Network | When the client uses HTTPS, it is recommended to wrap the backend with a reverse proxy; HTTP is only recommended for local network debugging |

## Screenshots

Account Pool Management:

![accounts](assets/accounts.png)

Image Studio:

![image-studio](assets/image-studio.png)

Registrar:

![register](assets/register.png)

Log Management:

![logs](assets/logs.png)

Image Management:

![image-manager](assets/image-manager.png)

## API

All AI interfaces require the request header:

```http
Authorization: Bearer <auth-key>
```

<details>
<summary><code>GET /v1/models</code></summary>
<br>

Returns the list of currently exposed image models.

```bash
curl http://localhost:8000/v1/models \
  -H "Authorization: Bearer <auth-key>"
```

<details>
<summary>Description</summary>
<br>

| Field | Description |
|:-----|:-----------------------------------------------------------------------------------------------------------|
| Returned Models | `gpt-image-2`, `codex-gpt-image-2`, `auto`, `gpt-5`, `gpt-5-1`, `gpt-5-2`, `gpt-5-3`, `gpt-5-3-mini`, `gpt-5-mini` |
| Integration Scenarios | Can be integrated with Cherry Studio, New API, and other upstreams or clients |

<br>
</details>
</details>

<details>
<summary><code>POST /v1/images/generations</code></summary>
<br>

OpenAI-compatible image generation interface, used for text-to-image.

```bash
curl http://localhost:8000/v1/images/generations \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <auth-key>" \
  -d '{
    "model": "gpt-image-2",
    "prompt": "a cat floating in space",
    "n": 1,
    "size": "1:1",
    "resolution": "1k",
    "response_format": "b64_json"
  }'
```

<details>
<summary>Field Description</summary>
<br>

| Field | Description |
|:------------------|:---------------------------------------------------|
| `model` | Image model, the current available value is subject to the result returned by `/v1/models`, recommend using `gpt-image-2` |
| `prompt` | Image generation prompt |
| `n` | Generation count, current backend limit is `1-4` |
| `size` | Aspect ratio, supports `1:1`, `16:9`, `9:16`, `4:3`, `3:4` |
| `resolution` | Resolution, supports `1k`, `2k`, `4k`; `2k/4k` requires premium user permissions and available Plus/Team/Pro accounts |
| `response_format` | The current request model includes this field, default value is `b64_json` |

<br>
</details>
</details>

<details>
<summary><code>POST /v1/images/edits</code></summary>
<br>

OpenAI-compatible image editing interface, used to upload images and generate edited results.

```bash
curl http://localhost:8000/v1/images/edits \
  -H "Authorization: Bearer <auth-key>" \
  -F "model=gpt-image-2" \
  -F "prompt=Change this image to cyberpunk night scene style" \
  -F "n=1" \
  -F "size=9:16" \
  -F "resolution=1k" \
  -F "image=@./input.png"
```

<details>
<summary>Field Description</summary>
<br>

| Field | Description |
|:---------|:------------------------------------|
| `model` | Image model, `gpt-image-2` |
| `prompt` | Image editing prompt |
| `n` | Generation count, current backend limit is `1-4` |
| `size` | Aspect ratio, supports `1:1`, `16:9`, `9:16`, `4:3`, `3:4` |
| `resolution` | Resolution, supports `1k`, `2k`, `4k`; `2k/4k` requires premium user permissions |
| `image` | The image file to edit, upload using multipart/form-data |

<br>
</details>
</details>

<details>
<summary><code>POST /v1/chat/completions</code></summary>
<br>

Chat Completions compatible interface tailored for image scenarios, not a full general chat proxy.

```bash
curl http://localhost:8000/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <auth-key>" \
  -d '{
    "model": "gpt-image-2",
    "messages": [
      {
        "role": "user",
        "content": "Generate a cyberpunk cat on a rainy Tokyo street at night"
      }
    ],
    "n": 1
  }'
```

<details>
<summary>Field Description</summary>
<br>

| Field | Description |
|:-----------|:------------------|
| `model` | Image model, processed according to the image generation scenario by default |
| `messages` | Messages array, must be content related to image requests |
| `n` | Generation count, parsed as image count in current implementation |
| `stream` | Implemented, but still testing |

<br>
</details>
</details>

<details>
<summary><code>POST /v1/responses</code></summary>
<br>

Responses API compatible interface tailored for image generation tool calling, not a full general Responses API proxy.

```bash
curl http://localhost:8000/v1/responses \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <auth-key>" \
  -d '{
    "model": "gpt-5",
    "input": "Generate a futuristic city skyline image",
    "tools": [
      {
        "type": "image_generation"
      }
    ]
  }'
```

<details>
<summary>Field Description</summary>
<br>

| Field | Description |
|:---------|:------------------------------|
| `model` | This model field is echoed in the response, but image generation currently still uses image generation compatible logic |
| `input` | Input content, must be able to parse out image generation prompt |
| `tools` | Must include `image_generation` tool request |
| `stream` | Implemented, but still testing |

<br>
</details>
</details>

## Friendly Links

- [LINUX DO - The new ideal community](https://linux.do/)
