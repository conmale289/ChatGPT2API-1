# Feature Status

This document is compiled based on the current implementation of the repository to help users quickly understand which features are already available, which are being refined, and which are pending implementation.

| Feature | Status | Description |
|:----------------------------------------|:--:|:--------------------------------------------------------------|
| OpenAI compatible `POST /v1/images/generations` | ✅  | Supported, used for image generation, and can return multiple images via `n`. |
| OpenAI compatible `POST /v1/images/edits` | ✅  | Supported, allows uploading images for editing. |
| `POST /v1/chat/completions` for image workflow | ✅  | Supported for image-related requests. |
| `POST /v1/responses` for image workflow | ✅  | Supported for image generation tool calls. |
| `GET /v1/models` endpoint | ✅  | Currently returns `gpt-image-2`, `codex-gpt-image-2`, `auto`, `gpt-5`, `gpt-5-1`, `gpt-5-2`, `gpt-5-3`, `gpt-5-3-mini`, `gpt-5-mini`. |
| Generating multiple images simultaneously | ✅  | Supported, both backend and frontend can perform multi-image generation. |
| Frontend image workbench | ✅  | Supported for image generation, image editing, model selection, history, and viewing high-res images. |
| Frontend image input / reference image interaction | ✅  | Supported for reference image uploading, previewing, removing, and edit mode workflows. |
| Codex drawing API reverse engineering | ✅  | Supported, only available for `Plus` / `Team` / `Pro` subscriptions, with the model alias `codex-gpt-image-2`; can be mapped back to `gpt-image-2` in other scenarios if needed. This is the Codex reverse engineered link to distinguish from official web drawing. A single account usually supports both official and Codex image generation quotas. |
| Cherry Studio integration | ✅  | Supported as a drawing interface integration for Cherry Studio. |
| New API integration | ✅  | Supported for New API integration. |
| Account pool management | ✅  | Supported for listing, filtering, batch operations, exporting, manual editing, refreshing, and deleting. |
| Account quota refresh & recovery time sync | ✅  | Supported for account info refreshing, rate-limited accounts are automatically checked. When image generation encounters 429 / `rate_limit_exceeded` / `usage_limit_reached`, it is marked and recovered according to the reset header. |
| Invalid Token auto cleanup | ✅  | Supported for automatically removing invalid tokens. |
| CPA connection management | ✅  | Supported for adding, modifying, querying, and deleting CPA connections. |
| CPA file browsing & on-demand import | ✅  | Supported for reading remote file lists, filtering, selecting, and importing into the local account pool. |
| CPA import progress tracking | ✅  | Supported for showing import progress and polling for updates. |
| `sub2api` connection management & account browsing | ✅  | Supported for adding, modifying, deleting sub2api servers, group querying, and reading OpenAI OAuth account lists. |
| `sub2api` import | ✅  | Supported for selecting OpenAI OAuth accounts in `sub2api`, batch pulling `access_token` to import into the local account pool, and showing import progress. |
| Docker self-hosted deployment | ✅  | Supported for Docker Compose deployment and provides multi-architecture images. |
| Multi-reference image capability in compatible endpoints | ✅  | Implemented, supports passing multiple reference images in compatible endpoints. |
| Advanced token scheduling strategy | ⚠️ | Currently has basic polling and rate-limit refresh mechanisms; more complex scheduling strategies are being refined. |
| Deployment instructions for Render / Vercel etc. | ⚠️ | Currently focuses mainly on Docker deployment; deployment methods on other platforms are not fully documented yet. |
| `/v1/complete` text completion & streaming output | ✅  | Implemented. |
| Streaming output support | ✅  | Implemented. |
| Image aspect ratio parameters | ✅  | Supported for `size=1:1/16:9/9:16/4:3/3:4`, injecting corresponding composition prompts. |
| Image resolution parameters | ✅  | Supported for `resolution=1k/2k/4k`. 2K / 4K routes go via Codex high-res, selected by `Pro` → `Plus` → `Team` account pools, maintaining permission validation. |
| Server-side image URL caching | ✅  | Implemented. |
| Config & backup | ✅ | Global `auth-key`, user-level keys (including drawing quota + chat daily/monthly/total quota) and admin/user two-tier permissions. |
| User key tiers | ✅ | User keys support normal / premium tiers; normal users can only use the free account pool and 1K drawing, while premium users can use Plus / Team / Pro and 2K / 4K. |
| User key quota granularity | ✅ | User keys support six independent quotas: drawing daily/monthly/total + chat daily/monthly/total; any tier can check "unlimited"; daily/monthly quotas automatically reset based on the server's local natural day/month. |
| Tabular user key management | ✅ | User key page changed to a table view, supporting fuzzy search by name (250ms debounce) and pagination of 10 / 20 / 50 / 100. |
| Independent routing for user keys | ✅ | User key management is isolated to the `/keys` page (accessible via "User Keys" in the top bar, only visible to admins), split from the settings page to avoid clutter. |
| Plaintext recovery for user keys | ✅ | User keys are stored with both plaintext and hash in `auth_keys.json`; admins can click the eye icon in the key list to view/copy the original key; for legacy data storing only hashes, "Reset and generate new key" is supported, immediately invalidating the old key. |
| Quota usage accumulation hierarchy | ✅ | A single drawing/chat deduction accumulates used amount across daily/monthly/total simultaneously (even if marked "unlimited"), ensuring consistency of "daily ⊂ monthly ⊂ total"; switching to limited quotas later will not lose historical usage data. |
| `rt_token` refresh | ❌  | Pending implementation. |
| Proxy configuration feature | ✅  | Supported for web-based configuration of global HTTP / HTTPS / SOCKS5 / SOCKS5H proxy, applied to all outbound requests. |
| Anthropic protocol support | ❌  | Pending implementation. |
