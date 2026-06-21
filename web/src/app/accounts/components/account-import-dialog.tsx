"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, type ChangeEvent } from "react";
import {
  ArrowLeft,
  Bot,
  ExternalLink,
  FileJson,
  FileText,
  Files,
  KeyRound,
  LoaderCircle,
  ServerCog,
  Upload,
} from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { createAccounts, type Account, type AccountImportRecord } from "@/lib/api";
import { cn } from "@/lib/utils";

type ImportMethod = "menu" | "token" | "session" | "cpa";
type AccountSourceType = "web" | "codex";

type AccountImportDialogProps = {
  disabled?: boolean;
  onImported: (items: Account[]) => void;
};

type PendingCpaImport = {
  tokens: string[];
  records: AccountImportRecord[];
  parsedFileCount: number;
  errorCount: number;
};

const sessionUrl = "https://chatgpt.com/api/auth/session";

function splitTokens(value: string) {
  return value
    .split(/\r?\n/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function getSessionAccessToken(value: unknown) {
  const token = (value as { accessToken?: unknown })?.accessToken;
  return typeof token === "string" ? token.trim() : "";
}

function getCpaAccessToken(value: unknown) {
  const payload = value as { access_token?: unknown; accessToken?: unknown };
  const token = payload?.access_token ?? payload?.accessToken;
  return typeof token === "string" ? token.trim() : "";
}

function readFileAsText(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(typeof reader.result === "string" ? reader.result : "");
    reader.onerror = () => reject(reader.error ?? new Error(`Failed to read file: ${file.name}`));
    reader.readAsText(file);
  });
}

function MethodCard({
  title,
  description,
  icon: Icon,
  onClick,
}: {
  title: string;
  description: string;
  icon: typeof KeyRound;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full rounded-2xl border border-stone-200 bg-white p-0 text-left transition hover:border-stone-300 hover:bg-stone-50"
    >
      <Card className="rounded-2xl border-0 bg-transparent shadow-none">
        <CardContent className="flex items-start gap-4 p-4">
          <div className="rounded-xl bg-stone-100 p-3 text-stone-700">
            <Icon className="size-5" />
          </div>
          <div className="space-y-1">
            <div className="text-sm font-semibold text-stone-900">{title}</div>
            <div className="text-sm leading-6 text-stone-500">{description}</div>
          </div>
        </CardContent>
      </Card>
    </button>
  );
}

export function AccountImportDialog({ disabled, onImported }: AccountImportDialogProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [method, setMethod] = useState<ImportMethod>("menu");
  const [tokenInput, setTokenInput] = useState("");
  const [sessionInput, setSessionInput] = useState("");
  const [sourceType, setSourceType] = useState<AccountSourceType>("web");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [pendingCpaImport, setPendingCpaImport] = useState<PendingCpaImport | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const txtInputRef = useRef<HTMLInputElement | null>(null);
  const cpaInputRef = useRef<HTMLInputElement | null>(null);

  const resetState = () => {
    setMethod("menu");
    setTokenInput("");
    setSessionInput("");
    setSourceType("web");
    setPendingCpaImport(null);
    setConfirmOpen(false);
  };

  const handleOpenChange = (nextOpen: boolean) => {
    setOpen(nextOpen);
    if (!nextOpen) {
      resetState();
    }
  };

  const submitTokens = async (
    tokens: string[],
    successText?: string,
    overrideSourceType?: AccountSourceType,
    accountRecords: AccountImportRecord[] = [],
  ) => {
    const normalizedTokens = tokens.map((item) => item.trim()).filter(Boolean);
    const normalizedRecords = accountRecords.filter((item) => getCpaAccessToken(item));

    if (normalizedTokens.length === 0 && normalizedRecords.length === 0) {
      toast.error("Please provide at least one valid Token");
      return;
    }

    setIsSubmitting(true);
    try {
      const data = await createAccounts(normalizedTokens, overrideSourceType ?? sourceType, normalizedRecords);
      onImported(data.items);
      setOpen(false);
      resetState();

      if ((data.errors?.length ?? 0) > 0) {
        const firstError = data.errors?.[0]?.error;
        toast.error(
          `${successText ?? "Import complete"}, added ${data.added ?? 0}, refreshed ${data.refreshed ?? 0}, failed ${data.errors?.length ?? 0}${firstError ? `, first error: ${firstError}` : ""}`,
        );
      } else {
        toast.success(
          `${successText ?? "Import complete"}, added ${data.added ?? 0}, skipped ${data.skipped ?? 0} duplicates, account info auto-refreshed`,
        );
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to import accounts";
      toast.error(message);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleImportTokenText = async () => {
    await submitTokens(splitTokens(tokenInput), "Access Token import complete");
  };

  const handleTxtSelected = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";

    if (!file) {
      return;
    }

    try {
      const content = await readFileAsText(file);
      const tokens = splitTokens(content);

      if (tokens.length === 0) {
        toast.error("No valid Tokens found in TXT file");
        return;
      }

      setTokenInput((prev) => {
        const next = [...splitTokens(prev), ...tokens];
        return next.join("\n");
      });
      toast.success(`Read ${tokens.length} Tokens from ${file.name}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to read TXT file";
      toast.error(message);
    }
  };

  const handleImportSessionJson = async () => {
    if (!sessionInput.trim()) {
      toast.error("Please paste the complete Session JSON first");
      return;
    }

    try {
      const payload = JSON.parse(sessionInput) as unknown;
      const token = getSessionAccessToken(payload);

      if (!token) {
        toast.error("No accessToken found in Session JSON");
        return;
      }

      await submitTokens([token], "Session JSON import complete", "web");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to parse Session JSON";
      toast.error(message);
    }
  };

  const handleCpaSelected = async (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []);
    event.target.value = "";

    if (files.length === 0) {
      return;
    }

    try {
      const results = await Promise.all(
        files.map(async (file) => {
          const raw = await readFileAsText(file);
          const parsed = JSON.parse(raw) as unknown;
          const token = getCpaAccessToken(parsed);
          const record =
            parsed && typeof parsed === "object"
              ? ({ ...(parsed as Record<string, unknown>), cpa_file_name: file.name } as AccountImportRecord)
              : null;
          return {
            token,
            record,
          };
        }),
      );

      const tokens = results.map((item) => item.token).filter((item): item is string => Boolean(item));
      const records = results
        .map((item) => item.record)
        .filter((item): item is AccountImportRecord => Boolean(item && getCpaAccessToken(item)));
      const parsedFileCount = records.length;
      const errorCount = results.length - parsedFileCount;

      if (parsedFileCount === 0) {
        toast.error("No usable access_token found in these CPA JSON files");
        return;
      }

      setPendingCpaImport({
        tokens,
        records,
        parsedFileCount,
        errorCount,
      });
      setConfirmOpen(true);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to read CPA JSON files";
      toast.error(message);
    }
  };

  const renderMethodBody = () => {
    if (method === "token") {
      const tokenCount = splitTokens(tokenInput).length;

      return (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <button
              type="button"
              onClick={() => setMethod("menu")}
              className="inline-flex items-center gap-1 text-sm text-stone-500 transition hover:text-stone-800"
            >
              <ArrowLeft className="size-4" />
              Back to import methods
            </button>
            <span className="text-xs text-stone-400">Detected {tokenCount} Tokens</span>
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium text-stone-700">Access Token List</label>
            <Textarea
              placeholder="One Access Token per line..."
              value={tokenInput}
              onChange={(event) => setTokenInput(event.target.value)}
              className="min-h-56 resize-none rounded-xl border-stone-200"
            />
          </div>
          <div className="grid grid-cols-2 gap-2">
            {([
              { value: "web", label: "Web", desc: "Standard ChatGPT Web image generation" },
              { value: "codex", label: "Codex", desc: "Codex Responses high resolution" },
            ] as const).map((item) => {
              const active = sourceType === item.value;
              return (
                <button
                  key={item.value}
                  type="button"
                  onClick={() => setSourceType(item.value)}
                  className={cn(
                    "rounded-xl border p-3 text-left transition",
                    active
                      ? "border-stone-900 bg-stone-950 text-white"
                      : "border-stone-200 bg-white text-stone-700 hover:border-stone-300",
                  )}
                >
                  <div className="flex items-center gap-2 text-sm font-semibold">
                    {item.value === "codex" ? <Bot className="size-4" /> : <KeyRound className="size-4" />}
                    {item.label}
                  </div>
                  <div className={cn("mt-1 text-xs", active ? "text-white/65" : "text-stone-500")}>
                    {item.desc}
                  </div>
                </button>
              );
            })}
          </div>
          <div className="rounded-2xl border border-dashed border-stone-200 bg-stone-50 p-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="space-y-1">
                <div className="text-sm font-medium text-stone-800">Import from TXT file</div>
                <div className="text-sm leading-6 text-stone-500">Supports `.txt` files with one Token per line.</div>
              </div>
              <Button
                type="button"
                variant="outline"
                className="rounded-xl border-stone-200 bg-white"
                onClick={() => txtInputRef.current?.click()}
                disabled={isSubmitting}
              >
                <FileText className="size-4" />
                Select TXT
              </Button>
            </div>
          </div>
          <input
            ref={txtInputRef}
            type="file"
            accept=".txt,text/plain"
            className="hidden"
            onChange={(event) => void handleTxtSelected(event)}
          />
        </div>
      );
    }

    if (method === "session") {
      return (
        <div className="space-y-4">
          <button
            type="button"
            onClick={() => setMethod("menu")}
            className="inline-flex items-center gap-1 text-sm text-stone-500 transition hover:text-stone-800"
          >
            <ArrowLeft className="size-4" />
            Back to import methods
          </button>
          <div className="rounded-2xl border border-stone-200 bg-stone-50 p-4 text-sm leading-6 text-stone-600">
            Open
            {" "}
            <a
              href={sessionUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 font-medium text-stone-900 underline underline-offset-4"
            >
              {sessionUrl}
              <ExternalLink className="size-3.5" />
            </a>
            , copy the complete JSON returned by the page, and the system will automatically extract the `accessToken` for import.
          </div>
          <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm leading-6 text-amber-900">
            <div className="font-medium">Risk Warning</div>
            <div>
              Do not use your main account. Use less frequently used alt accounts to avoid ban risks. This project assumes no responsibility for account bans.
            </div>
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium text-stone-700">Session JSON</label>
            <Textarea
              placeholder='Paste complete JSON, e.g. an object containing "accessToken"...'
              value={sessionInput}
              onChange={(event) => setSessionInput(event.target.value)}
              className="min-h-56 resize-none rounded-xl border-stone-200 font-mono text-xs"
            />
          </div>
        </div>
      );
    }

    if (method === "cpa") {
      return (
        <div className="space-y-4">
          <button
            type="button"
            onClick={() => setMethod("menu")}
            className="inline-flex items-center gap-1 text-sm text-stone-500 transition hover:text-stone-800"
          >
            <ArrowLeft className="size-4" />
            Back to import methods
          </button>
          <div className="rounded-2xl border border-dashed border-stone-200 bg-stone-50 p-5">
            <div className="space-y-2">
              <div className="text-sm font-medium text-stone-800">Select multiple local CPA JSON files</div>
              <div className="text-sm leading-6 text-stone-500">
                Each file should be a JSON object. The system will retain `access_token`, `refresh_token`, `id_token` and other credential fields.
              </div>
            </div>
            <Button
              type="button"
              className="mt-4 rounded-xl bg-stone-950 text-white hover:bg-stone-800"
              onClick={() => cpaInputRef.current?.click()}
              disabled={isSubmitting}
            >
              <Files className="size-4" />
              Select Multiple JSON Files
            </Button>
          </div>
          <input
            ref={cpaInputRef}
            type="file"
            accept=".json,application/json"
            multiple
            className="hidden"
            onChange={(event) => void handleCpaSelected(event)}
          />
          {pendingCpaImport ? (
            <div className="rounded-2xl border border-stone-200 bg-white p-4 text-sm leading-6 text-stone-600">
              Last read found {pendingCpaImport.parsedFileCount} Tokens
              {pendingCpaImport.errorCount > 0 ? `, ${pendingCpaImport.errorCount} files failed to extract` : ""}.
            </div>
          ) : null}
        </div>
      );
    }

    return (
      <div className="space-y-3">
        <MethodCard
          title="Import Access Token"
          description="Paste directly with one per line, or read from a TXT file with one per line."
          icon={KeyRound}
          onClick={() => setMethod("token")}
        />
        <MethodCard
          title="Import Session JSON"
          description="Copy the complete JSON from chatgpt.com session endpoint to auto-extract accessToken."
          icon={FileJson}
          onClick={() => setMethod("session")}
        />
        <MethodCard
          title="Import CPA JSON Files"
          description="Select multiple local JSON files at once, reading access_token from each object."
          icon={Files}
          onClick={() => setMethod("cpa")}
        />
        <MethodCard
          title="Import from Remote CPA Server"
          description="Go to settings to configure the remote CPA server before importing."
          icon={Files}
          onClick={() => {
            setOpen(false);
            resetState();
            router.push("/settings");
          }}
        />
        <MethodCard
          title="Import from Sub2API Server"
          description="Go to settings to configure the Sub2API server, then select OpenAI accounts to import."
          icon={ServerCog}
          onClick={() => {
            setOpen(false);
            resetState();
            router.push("/settings");
          }}
        />
      </div>
    );
  };

  const footerDisabled = disabled || isSubmitting;

  return (
    <>
      <Dialog open={open} onOpenChange={handleOpenChange}>
        <Button
          className="h-10 rounded-xl bg-stone-950 px-4 text-white hover:bg-stone-800"
          onClick={() => setOpen(true)}
          disabled={disabled}
        >
          <Upload className="size-4" />
          Import
        </Button>
        <DialogContent showCloseButton={false} className="rounded-2xl p-6">
          <DialogHeader className="gap-2">
            <DialogTitle>
              {method === "menu"
                ? "Import Accounts"
                : method === "token"
                  ? "Import Access Token"
                  : method === "session"
                    ? "Import Session JSON"
                    : "Import CPA JSON"}
            </DialogTitle>
            <DialogDescription className="text-sm leading-6">
              {method === "menu"
                ? "Choose an import method. After successful import, email, type, and quota will be automatically fetched."
                : method === "token"
                  ? "Paste manually or import from TXT file, one Token per line."
                  : method === "session"
                    ? "Paste the complete Session JSON and the system will auto-extract the accessToken."
                    : "Read multiple local JSON files at once with a confirmation step before submission."}
            </DialogDescription>
          </DialogHeader>

          {renderMethodBody()}

          <DialogFooter className="pt-2">
            <Button
              variant="secondary"
              className="h-10 rounded-xl bg-stone-100 px-5 text-stone-700 hover:bg-stone-200"
              onClick={() => setOpen(false)}
              disabled={footerDisabled}
            >
              Cancel
            </Button>
            {method === "token" ? (
              <Button
                className="h-10 rounded-xl bg-stone-950 px-5 text-white hover:bg-stone-800"
                onClick={() => void handleImportTokenText()}
                disabled={footerDisabled}
              >
                {isSubmitting ? <LoaderCircle className="size-4 animate-spin" /> : null}
                Import Token
              </Button>
            ) : null}
            {method === "session" ? (
              <Button
                className="h-10 rounded-xl bg-stone-950 px-5 text-white hover:bg-stone-800"
                onClick={() => void handleImportSessionJson()}
                disabled={footerDisabled}
              >
                {isSubmitting ? <LoaderCircle className="size-4 animate-spin" /> : null}
                Import JSON
              </Button>
            ) : null}
            {method === "cpa" ? (
              <Button
                className={cn(
                  "h-10 rounded-xl bg-stone-950 px-5 text-white hover:bg-stone-800",
                  !pendingCpaImport ? "hidden" : "",
                )}
                onClick={() => setConfirmOpen(true)}
                disabled={footerDisabled || !pendingCpaImport}
              >
                Review Import
              </Button>
            ) : null}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent className="rounded-2xl p-6">
          <DialogHeader className="gap-2">
            <DialogTitle>Confirm CPA Token Import</DialogTitle>
            <DialogDescription className="text-sm leading-6">
              {pendingCpaImport
                ? `Detected ${pendingCpaImport.parsedFileCount} accounts. Confirm import?`
                : "No importable accounts found yet."}
              {pendingCpaImport?.errorCount
                ? `, ${pendingCpaImport.errorCount} files failed to extract.`
                : ""}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="pt-2">
            <Button
              variant="secondary"
              className="h-10 rounded-xl bg-stone-100 px-5 text-stone-700 hover:bg-stone-200"
              onClick={() => setConfirmOpen(false)}
              disabled={isSubmitting}
            >
              Back
            </Button>
            <Button
              className="h-10 rounded-xl bg-stone-950 px-5 text-white hover:bg-stone-800"
              onClick={() =>
                void submitTokens(
                  pendingCpaImport?.tokens ?? [],
                  "CPA JSON import complete",
                  "web",
                  pendingCpaImport?.records ?? [],
                )
              }
              disabled={isSubmitting || !pendingCpaImport}
            >
              {isSubmitting ? <LoaderCircle className="size-4 animate-spin" /> : null}
              Confirm Import
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
