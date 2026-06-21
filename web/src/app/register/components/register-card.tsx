"use client";

import { useEffect, useRef, useState } from "react";
import {
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  LoaderCircle,
  Play,
  Plus,
  RotateCcw,
  Save,
  Settings2,
  Square,
  Terminal,
  Trash2,
  UserPlus,
  Wrench,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

import { useSettingsStore } from "../../settings/store";

export function RegisterCard() {
  const config = useSettingsStore((state) => state.registerConfig);
  const isLoading = useSettingsStore((state) => state.isLoadingRegister);
  const isSaving = useSettingsStore((state) => state.isSavingRegister);
  const setProxy = useSettingsStore((state) => state.setRegisterProxy);
  const setTotal = useSettingsStore((state) => state.setRegisterTotal);
  const setThreads = useSettingsStore((state) => state.setRegisterThreads);
  const setMode = useSettingsStore((state) => state.setRegisterMode);
  const setTargetQuota = useSettingsStore((state) => state.setRegisterTargetQuota);
  const setTargetAvailable = useSettingsStore((state) => state.setRegisterTargetAvailable);
  const setCheckInterval = useSettingsStore((state) => state.setRegisterCheckInterval);
  const setFixedPassword = useSettingsStore((state) => state.setRegisterFixedPassword);
  const setMailField = useSettingsStore((state) => state.setRegisterMailField);
  const addProvider = useSettingsStore((state) => state.addRegisterProvider);
  const updateProvider = useSettingsStore((state) => state.updateRegisterProvider);
  const deleteProvider = useSettingsStore((state) => state.deleteRegisterProvider);
  const save = useSettingsStore((state) => state.saveRegister);
  const toggle = useSettingsStore((state) => state.toggleRegister);
  const reset = useSettingsStore((state) => state.resetRegister);
  const repairAbnormal = useSettingsStore((state) => state.repairAbnormalRegisterAccounts);

  const [configOpen, setConfigOpen] = useState(false);
  const configSectionRef = useRef<HTMLElement | null>(null);
  const logViewportRef = useRef<HTMLDivElement | null>(null);
  const logs = config?.logs || [];

  // After expanding, scroll the bottom of the config panel into view. Wait one frame for the DOM to render,
  // otherwise scrollIntoView gets the position from before expansion.
  useEffect(() => {
    if (!configOpen) return;
    const raf = requestAnimationFrame(() => {
      configSectionRef.current?.scrollIntoView({ block: "end", behavior: "smooth" });
    });
    return () => cancelAnimationFrame(raf);
  }, [configOpen]);

  useEffect(() => {
    const viewport = logViewportRef.current;
    if (!viewport) return;
    viewport.scrollTop = viewport.scrollHeight;
  }, [logs.length]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center rounded-xl border border-border bg-card p-10">
        <LoaderCircle className="size-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!config) return null;

  const stats = config.stats || { success: 0, fail: 0, done: 0, running: 0, threads: config.threads };
  const providers = config.mail.providers || [];
  const isRepairingAbnormal = config.enabled && stats.job_kind === "repair_abnormal";

  const targetTotal =
    config.mode === "quota"
      ? Number(config.target_quota || 0)
      : config.mode === "available"
        ? Number(config.target_available || 0)
        : Number(config.total || 0);
  const currentValue =
    config.mode === "quota"
      ? Number(stats.current_quota || 0)
      : config.mode === "available"
        ? Number(stats.current_available || 0)
        : Number(stats.success || 0);
  const progress = targetTotal > 0 ? Math.min(100, Math.round((currentValue / targetTotal) * 100)) : 0;
  const modeLabel = config.mode === "quota" ? "Quota" : config.mode === "available" ? "Available" : "Registered";

  const kpis: { label: string; value: string | number; tone?: "ok" | "warn" | "error" | "muted" }[] = [
    { label: "Success", value: stats.success, tone: "ok" },
    { label: "Failed", value: stats.fail, tone: stats.fail > 0 ? "error" : "muted" },
    { label: "Done", value: stats.done },
    { label: "Threads", value: `${stats.running}/${stats.threads}` },
    { label: "Avg", value: `${stats.avg_seconds || 0}s` },
    { label: "Elapsed", value: `${stats.elapsed_seconds || 0}s` },
    { label: "Rate", value: `${stats.success_rate || 0}%`, tone: (stats.success_rate || 0) >= 80 ? "ok" : "warn" },
    { label: "Quota", value: stats.current_quota || 0, tone: "muted" },
  ];
  const updateProviderType = (index: number, type: string) => {
    updateProvider(index, {
      type,
      enable: true,
      ...(type === "cloudflare_temp_email" ? { api_base: "", admin_password: "", domain: [] } : {}),
      ...(type === "tempmail_lol" ? { api_key: "", domain: [] } : {}),
      ...(type === "moemail" ? { api_base: "", api_key: "", domain: [] } : {}),
      ...(type === "inbucket" ? { api_base: "", domain: [], random_subdomain: true } : {}),
      ...(type === "duckmail" ? { api_key: "", default_domain: "duckmail.sbs" } : {}),
      ...(type === "gptmail" ? { api_key: "", default_domain: "" } : {}),
      ...(type === "yyds_mail" ? { api_base: "https://maliapi.215.im/v1", api_key: "", domain: [], subdomain: "", wildcard: false } : {}),
      ...(type === "cloudmail" ? { api_base: "", admin_email: "", admin_password: "", domain: [] } : {}),
    });
  };

  return (
    <div className="space-y-3">
      <section className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
        <div className="flex flex-col gap-4 border-b border-border bg-gradient-to-br from-card to-secondary/40 p-5 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <span
              className={cn(
                "relative grid size-10 place-items-center rounded-lg border",
                config.enabled
                  ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                  : "border-border bg-secondary text-muted-foreground",
              )}
            >
              {config.enabled ? (
                <>
                  <span className="absolute inset-0 animate-ping rounded-lg bg-emerald-400/20" />
                  <span className="relative size-2 rounded-full bg-emerald-500" />
                </>
              ) : (
                <span className="size-2 rounded-full bg-muted-foreground/50" />
              )}
            </span>
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <span
                  className={cn(
                    "font-data text-[10px] font-bold tracking-[0.22em] uppercase",
                    config.enabled ? "text-emerald-600" : "text-muted-foreground",
                  )}
                >
                  {config.enabled ? "Running" : "Idle"}
                </span>
                <span className="h-px w-6 bg-border" />
                <span className="font-data text-[10px] font-medium tracking-wider text-muted-foreground uppercase">
                  Mode · {config.mode === "total" ? "Total" : config.mode === "quota" ? "Quota" : "Available"}
                </span>
              </div>
              <div className="flex items-baseline gap-2">
                <span className="font-data tabular-nums text-[28px] font-semibold leading-none tracking-tight text-foreground">
                  {currentValue}
                </span>
                <span className="font-data tabular-nums text-[16px] font-medium text-muted-foreground">
                  / {targetTotal || "∞"}
                </span>
                <span className="ml-1 font-data text-[11px] font-medium text-muted-foreground">{modeLabel}</span>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button
              className={cn(
                "h-10 cursor-pointer rounded-lg px-5 text-[13px] font-medium transition",
                config.enabled
                  ? "bg-rose-500 text-white shadow-sm shadow-rose-500/30 hover:bg-rose-600"
                  : "bg-foreground text-background shadow-sm hover:bg-foreground/90",
              )}
              onClick={() => void toggle()}
              disabled={isSaving}
            >
              {isSaving ? (
                <LoaderCircle className="size-4 animate-spin" />
              ) : config.enabled ? (
                <Square className="size-4 fill-current" />
              ) : (
                <Play className="size-4 fill-current" />
              )}
              {config.enabled ? "Stop" : "Start"}
            </Button>
            <Button
              variant="outline"
              className={cn(
                "h-10 cursor-pointer rounded-lg border-border px-3",
                isRepairingAbnormal
                  ? "border-rose-200 bg-rose-50 text-rose-600 hover:bg-rose-100"
                  : "bg-background text-foreground",
              )}
              onClick={() => void repairAbnormal()}
              disabled={isSaving || (config.enabled && !isRepairingAbnormal)}
              title={isRepairingAbnormal ? "Stop Repair" : "Repair Abnormal Accounts"}
            >
              {isSaving ? (
                <LoaderCircle className="size-4 animate-spin" />
              ) : isRepairingAbnormal ? (
                <Square className="size-4 fill-current" />
              ) : (
                <Wrench className="size-4" />
              )}
              {isRepairingAbnormal ? "Stop Repair" : "Repair Abnormal"}
            </Button>
            <Button
              variant="outline"
              className="h-10 cursor-pointer rounded-lg border-border bg-background px-3 text-foreground"
              onClick={() => void reset()}
              disabled={isSaving || config.enabled}
              title="Reset"
            >
              <RotateCcw className="size-4" />
            </Button>
          </div>
        </div>

        <div className="px-5 pt-4">
          <div className="relative h-1.5 overflow-hidden rounded-full bg-secondary">
            <div
              className={cn(
                "absolute inset-y-0 left-0 rounded-full transition-all duration-500",
                config.enabled
                  ? "bg-gradient-to-r from-emerald-400 to-emerald-500"
                  : "bg-gradient-to-r from-muted-foreground/40 to-muted-foreground/60",
              )}
              style={{ width: `${progress}%` }}
            />
          </div>
          <div className="mt-1.5 flex items-center justify-between font-data text-[10px] font-medium tracking-wider text-muted-foreground uppercase">
            <span>Progress</span>
            <span className="tabular-nums">{progress}%</span>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-px overflow-hidden bg-border md:grid-cols-4 lg:grid-cols-8">
          {kpis.map((kpi) => (
            <div key={kpi.label} className="flex flex-col gap-1 bg-card px-4 py-3">
              <span className="font-data text-[10px] font-semibold tracking-[0.16em] text-muted-foreground uppercase">
                {kpi.label}
              </span>
              <span
                className={cn(
                  "font-data tabular-nums text-[18px] font-semibold leading-tight",
                  kpi.tone === "ok" && "text-emerald-600",
                  kpi.tone === "error" && "text-rose-500",
                  kpi.tone === "warn" && "text-amber-600",
                  kpi.tone === "muted" && "text-muted-foreground",
                  !kpi.tone && "text-foreground",
                )}
              >
                {kpi.value}
              </span>
            </div>
          ))}
        </div>
      </section>

      {!config.enabled ? (
        <div className="flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          <AlertTriangle className="size-4 shrink-0" />
          <span>Save configuration before starting. The config panel is at the bottom and can be collapsed/expanded.</span>
        </div>
      ) : null}

      <section className="overflow-hidden rounded-xl border border-border bg-[oklch(0.18_0.018_260)] shadow-sm">
        <div className="flex items-center justify-between border-b border-white/10 bg-black/20 px-4 py-2.5">
          <div className="flex items-center gap-2">
            <Terminal className="size-3.5 text-emerald-400" />
            <span className="font-data text-[10px] font-old tracking-[0.22em] text-white/70 uppercase">
              Live Console
            </span>
            <span className="ml-1 font-data text-[10px] tabular-nums text-white/40">{logs.length} lines</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="size-2 rounded-full bg-rose-400/80" />
            <span className="size-2 rounded-full bg-amber-400/80" />
            <span className="size-2 rounded-full bg-emerald-400/80" />
          </div>
        </div>
        <div ref={logViewportRef} className="h-[calc(100vh-540px)] min-h-[280px] overflow-y-auto px-4 py-3 font-data text-[12px] leading-[1.65]">
          {logs.length === 0 ? (
            <div className="flex h-full items-center justify-center text-white/30">
              <span>$ waiting for events...</span>
            </div>
          ) : (
            logs.map((item, index) => (
                <div
                  key={`${item.time}-${index}`}
                  className={cn(
                    "flex gap-3 transition hover:bg-white/5",
                    item.level === "red" && "text-rose-300",
                    item.level === "green" && "text-emerald-300",
                    item.level === "yellow" && "text-amber-300",
                    !item.level || item.level === "info" ? "text-white/80" : "",
                  )}
                >
                  <span className="shrink-0 text-white/30">{new Date(item.time).toLocaleTimeString()}</span>
                  <span className="min-w-0 break-words">{item.text}</span>
                </div>
              ))
          )}
        </div>
      </section>

      <section
        ref={configSectionRef}
        className="overflow-hidden rounded-xl border border-border bg-card shadow-sm"
      >
        <div
          role="button"
          tabIndex={0}
          aria-expanded={configOpen}
          className="flex w-full cursor-pointer items-center justify-between gap-3 px-5 py-3.5 transition hover:bg-secondary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
          onClick={() => setConfigOpen((prev) => !prev)}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              setConfigOpen((prev) => !prev);
            }
          }}
        >
          <div className="flex items-center gap-3">
            <span className="grid size-8 place-items-center rounded-lg border border-border bg-secondary">
              <Settings2 className="size-4 text-foreground" />
            </span>
            <div className="text-left">
              <div className="font-data text-[10px] font-semibold tracking-[0.18em] text-muted-foreground uppercase">
                Configuration
              </div>
              <div className="text-[14px] font-semibold text-foreground">Register Config · {providers.length} provider</div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              className="h-9 cursor-pointer rounded-lg border-border bg-background px-3 text-[12px] text-foreground"
              onClick={(event) => {
                event.stopPropagation();
                void save();
              }}
              disabled={isSaving || config.enabled}
            >
              {isSaving ? <LoaderCircle className="size-4 animate-spin" /> : <Save className="size-4" />}
              Save
            </Button>
            {configOpen ? (
              <ChevronDown className="size-4 text-muted-foreground" />
            ) : (
              <ChevronRight className="size-4 text-muted-foreground" />
            )}
          </div>
        </div>
        {configOpen ? (
        <section className="space-y-4 border-t border-border p-5">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="grid size-9 place-items-center rounded-lg border border-border bg-secondary">
                <UserPlus className="size-4 text-foreground" />
              </div>
              <div>
                <div className="font-data text-[10px] font-semibold tracking-[0.18em] text-muted-foreground uppercase">Configuration</div>
                <h2 className="text-[15px] font-semibold tracking-tight text-foreground">Register Config</h2>
              </div>
            </div>
            <Button className="h-9 cursor-pointer rounded-lg bg-foreground px-4 text-background hover:bg-foreground/90" onClick={() => void save()} disabled={isSaving || config.enabled}>
              {isSaving ? <LoaderCircle className="size-4 animate-spin" /> : <Save className="size-4" />}
              Save Config
            </Button>
          </div>

          <div className="grid gap-3 md:grid-cols-3">
            <div className="space-y-1.5">
              <label className="font-data text-[10px] font-semibold tracking-[0.16em] text-muted-foreground uppercase">Register Mode</label>
              <Select value={config.mode || "total"} onValueChange={(value) => setMode(value as "total" | "quota" | "available")} disabled={config.enabled}>
                <SelectTrigger className="h-10 rounded-lg border-border bg-background">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="total">Total Count</SelectItem>
                  <SelectItem value="quota">Pool Remaining Quota</SelectItem>
                  <SelectItem value="available">Available Accounts</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <label className="font-data text-[10px] font-semibold tracking-[0.16em] text-muted-foreground uppercase">Total Count</label>
              <Input value={String(config.total)} onChange={(event) => setTotal(event.target.value)} className="h-10 rounded-lg border-border bg-background font-data tabular-nums" disabled={config.enabled || config.mode !== "total"} />
            </div>
            <div className="space-y-1.5">
              <label className="font-data text-[10px] font-semibold tracking-[0.16em] text-muted-foreground uppercase">Threads</label>
              <Input value={String(config.threads)} onChange={(event) => setThreads(event.target.value)} className="h-10 rounded-lg border-border bg-background font-data tabular-nums" disabled={config.enabled} />
            </div>
            <div className="space-y-1.5">
              <label className="font-data text-[10px] font-semibold tracking-[0.16em] text-muted-foreground uppercase">Proxy</label>
              <Input value={config.proxy} onChange={(event) => setProxy(event.target.value)} placeholder="http://127.0.0.1:7890" className="h-10 rounded-lg border-border bg-background font-data text-[13px]" disabled={config.enabled} />
            </div>
            <div className="space-y-1.5">
              <label className="font-data text-[10px] font-semibold tracking-[0.16em] text-muted-foreground uppercase">Target Remaining Quota</label>
              <Input value={String(config.target_quota || "")} onChange={(event) => setTargetQuota(event.target.value)} className="h-10 rounded-lg border-border bg-background font-data tabular-nums" disabled={config.enabled || config.mode !== "quota"} />
            </div>
            <div className="space-y-1.5">
              <label className="font-data text-[10px] font-semibold tracking-[0.16em] text-muted-foreground uppercase">Target Available Accounts</label>
              <Input value={String(config.target_available || "")} onChange={(event) => setTargetAvailable(event.target.value)} className="h-10 rounded-lg border-border bg-background font-data tabular-nums" disabled={config.enabled || config.mode !== "available"} />
            </div>
            <div className="space-y-1.5">
              <label className="font-data text-[10px] font-semibold tracking-[0.16em] text-muted-foreground uppercase">Check Interval (sec)</label>
              <Input value={String(config.check_interval || "")} onChange={(event) => setCheckInterval(event.target.value)} className="h-10 rounded-lg border-border bg-background font-data tabular-nums" disabled={config.enabled || config.mode === "total"} />
            </div>
            <div className="space-y-1.5">
              <label className="font-data text-[10px] font-semibold tracking-[0.16em] text-muted-foreground uppercase">Fixed Password</label>
              <Input type="password" value={String(config.fixed_password || "")} onChange={(event) => setFixedPassword(event.target.value)} placeholder="Leave empty = random" className="h-10 rounded-lg border-border bg-background font-data text-[13px]" disabled={config.enabled} autoComplete="new-password" />
            </div>
          </div>

          <div className="space-y-3 border-t border-border pt-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="font-data text-[10px] font-semibold tracking-[0.18em] text-muted-foreground uppercase">Mail Providers</div>
                <h3 className="text-[14px] font-semibold text-foreground">Mail Config</h3>
              </div>
              <Button type="button" variant="outline" className="h-9 cursor-pointer rounded-lg border-border bg-background px-3 text-foreground" onClick={addProvider} disabled={config.enabled}>
                <Plus className="size-4" />
                Add
              </Button>
            </div>

            <div className="grid gap-3 md:grid-cols-3">
              <div className="space-y-1.5">
                <label className="font-data text-[10px] font-semibold tracking-[0.16em] text-muted-foreground uppercase">Request Timeout</label>
                <Input value={String(config.mail.request_timeout || "")} onChange={(event) => setMailField("request_timeout", event.target.value)} className="h-10 rounded-lg border-border bg-background font-data tabular-nums" disabled={config.enabled} />
              </div>
              <div className="space-y-1.5">
                <label className="font-data text-[10px] font-semibold tracking-[0.16em] text-muted-foreground uppercase">Verification Code Timeout</label>
                <Input value={String(config.mail.wait_timeout || "")} onChange={(event) => setMailField("wait_timeout", event.target.value)} className="h-10 rounded-lg border-border bg-background font-data tabular-nums" disabled={config.enabled} />
              </div>
              <div className="space-y-1.5">
                <label className="font-data text-[10px] font-semibold tracking-[0.16em] text-muted-foreground uppercase">Poll Interval</label>
                <Input value={String(config.mail.wait_interval || "")} onChange={(event) => setMailField("wait_interval", event.target.value)} className="h-10 rounded-lg border-border bg-background font-data tabular-nums" disabled={config.enabled} />
              </div>
            </div>

            <div className="space-y-3">
              {providers.map((provider, index) => {
                const type = String(provider.type || "tempmail_lol");
                const domains = Array.isArray(provider.domain) ? provider.domain.map(String).join("\n") : "";
                return (
                  <div key={index} className="space-y-3 rounded-lg border border-border bg-secondary/30 p-3">
                    <div className="flex items-center justify-between gap-3">
                      <label className="flex items-center gap-2.5 text-sm text-foreground">
                        <Checkbox checked={Boolean(provider.enable)} onCheckedChange={(checked) => updateProvider(index, { enable: Boolean(checked) })} disabled={config.enabled} />
                        <span>Enable</span>
                      </label>
                      <button type="button" className="cursor-pointer rounded-md p-1.5 text-muted-foreground transition hover:bg-rose-50 hover:text-rose-500 disabled:opacity-50" onClick={() => deleteProvider(index)} disabled={config.enabled || providers.length <= 1} title="Delete provider">
                        <Trash2 className="size-4" />
                      </button>
                    </div>

                    <div className="grid gap-3 md:grid-cols-2">
                      <div className="space-y-1.5">
                        <label className="font-data text-[10px] font-semibold tracking-[0.16em] text-muted-foreground uppercase">Type</label>
                        <Select value={type} onValueChange={(value) => updateProviderType(index, value)} disabled={config.enabled}>
                          <SelectTrigger className="h-10 rounded-lg border-border bg-background">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="cloudflare_temp_email">cloudflare_temp_email</SelectItem>
                            <SelectItem value="tempmail_lol">tempmail_lol</SelectItem>
                            <SelectItem value="moemail">moemail</SelectItem>
                            <SelectItem value="inbucket">inbucket_mail</SelectItem>
                            <SelectItem value="duckmail">duckmail</SelectItem>
                            <SelectItem value="gptmail">gptmail (untested)</SelectItem>
                            <SelectItem value="yyds_mail">yyds_mail</SelectItem>
                            <SelectItem value="cloudmail">cloudmail</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      {type === "cloudflare_temp_email" || type === "moemail" || type === "inbucket" || type === "yyds_mail" || type === "cloudmail" ? (
                        <>
                          <div className="space-y-1.5">
                            <label className="font-data text-[10px] font-semibold tracking-[0.16em] text-muted-foreground uppercase">API Base</label>
                            <Input value={String(provider.api_base || "")} onChange={(event) => updateProvider(index, { api_base: event.target.value })} placeholder={type === "cloudmail" ? "https://your-cloudmail.com/api" : ""} className="h-10 rounded-lg border-border bg-background font-data text-[13px]" disabled={config.enabled} />
                          </div>
                          {type === "cloudflare_temp_email" ? (
                            <div className="space-y-1.5">
                              <label className="font-data text-[10px] font-semibold tracking-[0.16em] text-muted-foreground uppercase">Admin Password</label>
                              <Input value={String(provider.admin_password || "")} onChange={(event) => updateProvider(index, { admin_password: event.target.value })} className="h-10 rounded-lg border-border bg-background font-data text-[13px]" disabled={config.enabled} />
                            </div>
                          ) : null}
                          {type === "cloudmail" ? (
                            <>
                              <div className="space-y-1.5">
                                <label className="font-data text-[10px] font-semibold tracking-[0.16em] text-muted-foreground uppercase">Admin Email</label>
                                <Input value={String(provider.admin_email || "")} onChange={(event) => updateProvider(index, { admin_email: event.target.value })} placeholder="admin@example.com" className="h-10 rounded-lg border-border bg-background font-data text-[13px]" disabled={config.enabled} />
                              </div>
                              <div className="space-y-1.5">
                                <label className="font-data text-[10px] font-semibold tracking-[0.16em] text-muted-foreground uppercase">Admin Password</label>
                                <Input type="password" value={String(provider.admin_password || "")} onChange={(event) => updateProvider(index, { admin_password: event.target.value })} className="h-10 rounded-lg border-border bg-background font-data text-[13px]" disabled={config.enabled} />
                              </div>
                            </>
                          ) : null}
                        </>
                      ) : null}
                      {type === "inbucket" ? (
                        <label className="flex items-center gap-2.5 pt-7 text-sm text-foreground">
                          <Checkbox checked={Boolean(provider.random_subdomain ?? true)} onCheckedChange={(checked) => updateProvider(index, { random_subdomain: Boolean(checked) })} disabled={config.enabled} />
                          <span>Enable random subdomain</span>
                        </label>
                      ) : null}
                      {type === "tempmail_lol" || type === "moemail" || type === "duckmail" || type === "gptmail" || type === "yyds_mail" ? (
                        <div className="space-y-1.5">
                          <label className="font-data text-[10px] font-semibold tracking-[0.16em] text-muted-foreground uppercase">API Key</label>
                          <Input value={String(provider.api_key || "")} onChange={(event) => updateProvider(index, { api_key: event.target.value })} className="h-10 rounded-lg border-border bg-background font-data text-[13px]" disabled={config.enabled} />
                        </div>
                      ) : null}
                      {type === "duckmail" || type === "gptmail" ? (
                        <div className="space-y-1.5">
                          <label className="font-data text-[10px] font-semibold tracking-[0.16em] text-muted-foreground uppercase">Default Domain</label>
                          <Input value={String(provider.default_domain || "")} onChange={(event) => updateProvider(index, { default_domain: event.target.value })} placeholder={type === "duckmail" ? "duckmail.sbs" : ""} className="h-10 rounded-lg border-border bg-background font-data text-[13px]" disabled={config.enabled} />
                        </div>
                      ) : null}
                      {type === "yyds_mail" ? (
                        <>
                          <div className="space-y-1.5">
                            <label className="font-data text-[10px] font-semibold tracking-[0.16em] text-muted-foreground uppercase">Subdomain</label>
                            <Input value={String(provider.subdomain || "")} onChange={(event) => updateProvider(index, { subdomain: event.target.value })} className="h-10 rounded-lg border-border bg-background font-data text-[13px]" disabled={config.enabled} />
                          </div>
                          <label className="flex items-center gap-2.5 pt-7 text-sm text-foreground">
                            <Checkbox checked={Boolean(provider.wildcard)} onCheckedChange={(checked) => updateProvider(index, { wildcard: Boolean(checked) })} disabled={config.enabled} />
                            <span>Wildcard</span>
                          </label>
                        </>
                      ) : null}
                    </div>

                    {type === "tempmail_lol" || type === "cloudflare_temp_email" || type === "moemail" || type === "inbucket" || type === "yyds_mail" || type === "cloudmail" ? (
                      <div className="space-y-1.5">
                        <label className="font-data text-[10px] font-semibold tracking-[0.16em] text-muted-foreground uppercase">{type === "inbucket" ? "Base Domain List" : "Domain"}</label>
                        <Textarea value={domains} onChange={(event) => updateProvider(index, { domain: event.target.value.split(/[\n,]/).map((item) => item.trim()).filter(Boolean) })} placeholder={type === "inbucket" ? "One base domain per line; random subdomains will be generated automatically" : type === "moemail" ? "One domain per line" : type === "cloudmail" ? "One domain per line, supports multi-domain rotation, prefix with @" : "One domain per line; leave empty to use service default domain"} className="min-h-20 rounded-lg border-border bg-background font-data text-[12px]" disabled={config.enabled} />
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          </div>

      </section>
        ) : null}
      </section>
    </div>
  );
}
