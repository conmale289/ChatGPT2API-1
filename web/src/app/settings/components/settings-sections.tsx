"use client";

import { LoaderCircle, PlugZap } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { testProxy, type ProxyTestResult } from "@/lib/api";

import { useSettingsStore } from "../store";

/**
 * 6 section components centralized here:
 *   - Each only renders its section's fields, sharing store logic
 *   - No save button — saving is unified through FloatingSaveBar
 *   - Visuals use only grid + inputs, no Card wrapping per section (avoids Card-in-Card-in-Card)
 *
 * Shared style constants extracted to avoid dozens of repeated classNames.
 */
const INPUT_CLASS = "h-10 rounded-xl border-stone-200 bg-white";
const LABEL_CLASS = "text-sm text-stone-700";
const HELP_CLASS = "text-xs text-stone-500";
const TILE_CLASS = "rounded-xl border border-stone-200 bg-white px-4 py-3";

/* ───────────────────────── Account ───────────────────────── */

export function AccountSection() {
  const config = useSettingsStore((s) => s.config);
  const setRefreshAccountIntervalMinute = useSettingsStore((s) => s.setRefreshAccountIntervalMinute);
  const setAutoRemoveInvalidAccounts = useSettingsStore((s) => s.setAutoRemoveInvalidAccounts);
  const setAutoRemoveRateLimitedAccounts = useSettingsStore((s) => s.setAutoRemoveRateLimitedAccounts);

  return (
    <div className="grid gap-4 md:grid-cols-2">
      <div className="space-y-2 md:col-span-2">
        <label className={LABEL_CLASS}>Account Refresh Interval (minutes)</label>
        <Input
          value={String(config?.refresh_account_interval_minute || "")}
          onChange={(e) => setRefreshAccountIntervalMinute(e.target.value)}
          placeholder="5"
          className={INPUT_CLASS + " md:max-w-xs"}
        />
        <p className={HELP_CLASS}>Controls the automatic account refresh frequency.</p>
      </div>
      <label className={`flex items-center gap-3 ${TILE_CLASS} text-sm text-stone-700`}>
        <Checkbox
          checked={Boolean(config?.auto_remove_invalid_accounts)}
          onCheckedChange={(c) => setAutoRemoveInvalidAccounts(Boolean(c))}
        />
        Auto-remove invalid accounts
      </label>
      <label className={`flex items-center gap-3 ${TILE_CLASS} text-sm text-stone-700`}>
        <Checkbox
          checked={Boolean(config?.auto_remove_rate_limited_accounts)}
          onCheckedChange={(c) => setAutoRemoveRateLimitedAccounts(Boolean(c))}
        />
        Auto-remove rate-limited accounts
      </label>
    </div>
  );
}

/* ───────────────────────── Network ───────────────────────── */

export function NetworkSection() {
  const [isTestingProxy, setIsTestingProxy] = useState(false);
  const [proxyTestResult, setProxyTestResult] = useState<ProxyTestResult | null>(null);
  const config = useSettingsStore((s) => s.config);
  const setProxy = useSettingsStore((s) => s.setProxy);

  const handleTestProxy = async () => {
    const candidate = String(config?.proxy || "").trim();
    if (!candidate) {
      toast.error("Please enter a proxy address first");
      return;
    }
    setIsTestingProxy(true);
    setProxyTestResult(null);
    try {
      const data = await testProxy(candidate);
      setProxyTestResult(data.result);
      if (data.result.ok) {
        toast.success(`Proxy available (${data.result.latency_ms} ms, HTTP ${data.result.status})`);
      } else {
        toast.error(`Proxy unavailable: ${data.result.error ?? "unknown error"}`);
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Proxy test failed");
    } finally {
      setIsTestingProxy(false);
    }
  };

  return (
    <div className="space-y-3">
      <label className={LABEL_CLASS}>Global Proxy</label>
      <Input
        value={String(config?.proxy || "")}
        onChange={(e) => {
          setProxy(e.target.value);
          setProxyTestResult(null);
        }}
        placeholder="http://127.0.0.1:7890"
        className={INPUT_CLASS}
      />
      <p className={HELP_CLASS}>Leave empty to disable proxy. Proxy affects both image generation requests and upstream OpenAI forwarding.</p>
      {proxyTestResult ? (
        <div
          className={`rounded-xl border px-3 py-2 text-xs leading-6 ${
            proxyTestResult.ok
              ? "border-emerald-200 bg-emerald-50 text-emerald-800"
              : "border-rose-200 bg-rose-50 text-rose-800"
          }`}
        >
          {proxyTestResult.ok
            ? `Proxy available: HTTP ${proxyTestResult.status}, took ${proxyTestResult.latency_ms} ms`
            : `Proxy unavailable: ${proxyTestResult.error ?? "unknown error"} (took ${proxyTestResult.latency_ms} ms)`}
        </div>
      ) : null}
      <div className="flex justify-end">
        <Button
          type="button"
          variant="outline"
          className="h-9 rounded-xl border-stone-200 bg-white px-4 text-stone-700"
          onClick={() => void handleTestProxy()}
          disabled={isTestingProxy}
        >
          {isTestingProxy ? <LoaderCircle className="size-4 animate-spin" /> : <PlugZap className="size-4" />}
          Test Proxy
        </Button>
      </div>
    </div>
  );
}

/* ───────────────────────── Images ───────────────────────── */

export function ImageSection() {
  const config = useSettingsStore((s) => s.config);
  const setBaseUrl = useSettingsStore((s) => s.setBaseUrl);
  const setImageRetentionDays = useSettingsStore((s) => s.setImageRetentionDays);
  const setCleanupProtectGallery = useSettingsStore((s) => s.setCleanupProtectGallery);
  const setCleanupProtectUserImages = useSettingsStore((s) => s.setCleanupProtectUserImages);
  const setImagePollTimeoutSecs = useSettingsStore((s) => s.setImagePollTimeoutSecs);
  const setImageAccountConcurrency = useSettingsStore((s) => s.setImageAccountConcurrency);

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <label className={LABEL_CLASS}>Image Access URL</label>
        <Input
          value={String(config?.base_url || "")}
          onChange={(e) => setBaseUrl(e.target.value)}
          placeholder="https://example.com"
          className={INPUT_CLASS}
        />
        <p className={HELP_CLASS}>Used as the prefix for generated result URLs. Leave empty to auto-detect from request host.</p>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-2">
          <label className={LABEL_CLASS}>Image Poll Timeout (seconds)</label>
          <Input
            value={String(config?.image_poll_timeout_secs || "")}
            onChange={(e) => setImagePollTimeoutSecs(e.target.value)}
            placeholder="120"
            className={INPUT_CLASS}
          />
          <p className={HELP_CLASS}>Maximum time to wait for upstream image results.</p>
        </div>
        <div className="space-y-2">
          <label className={LABEL_CLASS}>Per-Account Image Concurrency</label>
          <Input
            value={String(config?.image_account_concurrency || "")}
            onChange={(e) => setImageAccountConcurrency(e.target.value)}
            placeholder="3"
            className={INPUT_CLASS}
          />
          <p className={HELP_CLASS}>Limits the number of concurrent image requests per account.</p>
        </div>
      </div>

      <div className="space-y-3 rounded-xl border border-stone-200 bg-stone-50/60 p-4">
        <div className="space-y-2">
          <label className={LABEL_CLASS}>Local Retention Days</label>
          <Input
            value={String(config?.image_retention_days || "")}
            onChange={(e) => setImageRetentionDays(e.target.value)}
            placeholder="30"
            className={INPUT_CLASS + " md:max-w-xs"}
          />
          <p className={HELP_CLASS}>
            Auto-delete local images older than this many days. The two protection switches below are enabled by default to prevent cleanup from deleting images still in use, causing broken gallery tiles or user work disappearing.
          </p>
        </div>
        <label className={`flex items-start gap-3 ${TILE_CLASS} text-sm text-stone-700`}>
          <Checkbox
            checked={Boolean(config?.cleanup_protect_gallery ?? true)}
            onCheckedChange={(c) => setCleanupProtectGallery(Boolean(c))}
          />
          <div className="space-y-1">
            <div className="font-medium">Protect gallery-published images</div>
            <div className="text-xs leading-5 text-stone-500">
              Publishing to gallery indicates the user considers the image worth keeping. Disabling this may cause gallery tiles to break when PNGs are deleted.
            </div>
          </div>
        </label>
        <label className={`flex items-start gap-3 ${TILE_CLASS} text-sm text-stone-700`}>
          <Checkbox
            checked={Boolean(config?.cleanup_protect_user_images ?? true)}
            onCheckedChange={(c) => setCleanupProtectUserImages(Boolean(c))}
          />
          <div className="space-y-1">
            <div className="font-medium">Protect user "My Works"</div>
            <div className="text-xs leading-5 text-stone-500">
              Retains all images with an associated auth key. Anonymous / admin-generated images without attribution are still cleaned by mtime. Disabling this deletes all expired images indiscriminately.
            </div>
          </div>
        </label>
      </div>
    </div>
  );
}

/* ───────────────────────── Content Safety ───────────────────────── */

export function SecuritySection() {
  const config = useSettingsStore((s) => s.config);
  const setGlobalSystemPrompt = useSettingsStore((s) => s.setGlobalSystemPrompt);
  const setSensitiveWordsText = useSettingsStore((s) => s.setSensitiveWordsText);

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <label className={LABEL_CLASS}>Global System Prompt</label>
        <Textarea
          value={String(config?.global_system_prompt || "")}
          onChange={(e) => setGlobalSystemPrompt(e.target.value)}
          placeholder="E.g.: First check if the user prompt is compliant; refuse requests involving illegal, pornographic, violent, or hateful content."
          className="min-h-28 rounded-xl border-stone-200 bg-white font-mono text-xs shadow-none"
        />
        <p className={HELP_CLASS}>
          Injected as a system message with every request. Can be used for prompt review, unified model behavior constraints, or fixed role settings.
        </p>
      </div>
      <div className="space-y-2">
        <label className={LABEL_CLASS}>Sensitive Words</label>
        <Textarea
          value={(config?.sensitive_words || []).join("\n")}
          onChange={(e) => setSensitiveWordsText(e.target.value)}
          placeholder="One per line, reject on match"
          className="min-h-28 rounded-xl border-stone-200 bg-white font-mono text-xs shadow-none"
        />
        <p className={HELP_CLASS}>When a user request contains any sensitive word, it is immediately rejected without forwarding to image generation accounts.</p>
      </div>
    </div>
  );
}

/* ───────────────────────── AI Review ───────────────────────── */

export function AIReviewSection() {
  const config = useSettingsStore((s) => s.config);
  const setAIReviewField = useSettingsStore((s) => s.setAIReviewField);

  return (
    <div className="space-y-4">
      <label className="flex items-center gap-3 text-sm text-stone-700">
        <Checkbox
          checked={Boolean(config?.ai_review?.enabled)}
          onCheckedChange={(c) => setAIReviewField("enabled", Boolean(c))}
        />
        Enable AI Review
      </label>
      <p className="text-xs leading-6 text-stone-500">
        When enabled, requests are reviewed by the AI model before reaching image generation accounts. Rejected prompts are blocked, reducing the risk of policy violations triggering account restrictions or bans.
      </p>
      <div className="grid gap-4 md:grid-cols-3">
        <div className="space-y-2">
          <label className={LABEL_CLASS}>Base URL</label>
          <Input
            value={String(config?.ai_review?.base_url || "")}
            onChange={(e) => setAIReviewField("base_url", e.target.value)}
            placeholder="https://api.openai.com"
            className={INPUT_CLASS}
          />
        </div>
        <div className="space-y-2">
          <label className={LABEL_CLASS}>API Key</label>
          <Input
            value={String(config?.ai_review?.api_key || "")}
            onChange={(e) => setAIReviewField("api_key", e.target.value)}
            placeholder="sk-..."
            className={INPUT_CLASS}
          />
        </div>
        <div className="space-y-2">
          <label className={LABEL_CLASS}>Model</label>
          <Input
            value={String(config?.ai_review?.model || "")}
            onChange={(e) => setAIReviewField("model", e.target.value)}
            placeholder="gpt-4o-mini"
            className={INPUT_CLASS}
          />
        </div>
      </div>
      <div className="space-y-2">
        <label className={LABEL_CLASS}>Review Prompt</label>
        <Textarea
          value={String(config?.ai_review?.prompt || "")}
          onChange={(e) => setAIReviewField("prompt", e.target.value)}
          placeholder="Determine if the user request is allowed. Only respond with ALLOW or REJECT."
          className="min-h-24 rounded-xl border-stone-200 bg-white text-xs shadow-none"
        />
      </div>
    </div>
  );
}

/* ───────────────────────── Logs ───────────────────────── */

export function LogSection() {
  const config = useSettingsStore((s) => s.config);
  const setLogLevel = useSettingsStore((s) => s.setLogLevel);
  const logLevelOptions = ["debug", "info", "warning", "error"];

  return (
    <div className="space-y-3">
      <label className={LABEL_CLASS}>Console Log Level</label>
      <p className={HELP_CLASS}>When none selected, defaults to info / warning / error.</p>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {logLevelOptions.map((level) => (
          <label
            key={level}
            className={`flex items-center gap-2 ${TILE_CLASS} text-sm capitalize text-stone-700`}
          >
            <Checkbox
              checked={Boolean(config?.log_levels?.includes(level))}
              onCheckedChange={(c) => setLogLevel(level, Boolean(c))}
            />
            {level}
          </label>
        ))}
      </div>
    </div>
  );
}
