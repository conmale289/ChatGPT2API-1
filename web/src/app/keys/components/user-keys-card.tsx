"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  Ban,
  CalendarClock,
  CalendarDays,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Copy,
  Eye,
  Image as ImageIcon,
  Infinity as InfinityIcon,
  KeyRound,
  LoaderCircle,
  MessageSquare,
  Pencil,
  Plus,
  RefreshCw,
  RotateCcw,
  Search,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  createUserKey,
  deleteUserKey,
  fetchUserKeyPlaintext,
  fetchUserKeys,
  regenerateUserKey,
  updateUserKey,
  type AccountTier,
  type UserKey,
  type UserKeyCreatePayload,
  type UserKeyUpdatePayload,
} from "@/lib/api";
import { cn } from "@/lib/utils";

// Module-level cache: the component re-mounts on route changes; hitting cache provides existing items,
// preventing the card from collapsing to a spinner starting from isLoading=true / items=[] every time settings page opens.
let cachedItems: UserKey[] | null = null;

type ImageQuotaKind = "image_daily" | "image_monthly" | "image_total";
type ChatQuotaKind = "chat_daily" | "chat_monthly" | "chat_total";
type QuotaKind = ImageQuotaKind | ChatQuotaKind;

type QuotaMeta = {
  kind: QuotaKind;
  label: string;
  shortLabel: string;
  hint: string;
  icon: typeof ImageIcon;
  quotaField: keyof UserKey;
  usedField: keyof UserKey;
  unlimitedField: keyof UserKey;
  remainingField: keyof UserKey;
  quotaPayload: QuotaSharedPayloadKey;
  unlimitedPayload: QuotaSharedPayloadKey;
  resetPayload: QuotaResetPayloadKey;
};

type QuotaSharedPayloadKey = keyof Pick<
  UserKeyCreatePayload,
  | "image_daily_quota"
  | "image_daily_unlimited"
  | "image_monthly_quota"
  | "image_monthly_unlimited"
  | "image_total_quota"
  | "image_total_unlimited"
  | "chat_daily_quota"
  | "chat_daily_unlimited"
  | "chat_monthly_quota"
  | "chat_monthly_unlimited"
  | "chat_total_quota"
  | "chat_total_unlimited"
>;
type QuotaResetPayloadKey = keyof Pick<
  UserKeyUpdatePayload,
  | "reset_image_daily_used"
  | "reset_image_monthly_used"
  | "reset_image_total_used"
  | "reset_chat_daily_used"
  | "reset_chat_monthly_used"
  | "reset_chat_total_used"
>;

const IMAGE_QUOTA_KINDS: QuotaMeta[] = [
  {
    kind: "image_daily",
    label: "Image Daily Quota",
    shortLabel: "D",
    hint: "Auto-resets daily at 00:00",
    icon: CalendarDays,
    quotaField: "image_daily_quota",
    usedField: "image_daily_used",
    unlimitedField: "image_daily_unlimited",
    remainingField: "image_daily_remaining",
    quotaPayload: "image_daily_quota",
    unlimitedPayload: "image_daily_unlimited",
    resetPayload: "reset_image_daily_used",
  },
  {
    kind: "image_monthly",
    label: "Image Monthly Quota",
    shortLabel: "M",
    hint: "Auto-resets on the 1st of each month at 00:00",
    icon: CalendarClock,
    quotaField: "image_monthly_quota",
    usedField: "image_monthly_used",
    unlimitedField: "image_monthly_unlimited",
    remainingField: "image_monthly_remaining",
    quotaPayload: "image_monthly_quota",
    unlimitedPayload: "image_monthly_unlimited",
    resetPayload: "reset_image_monthly_used",
  },
  {
    kind: "image_total",
    label: "Image Total Quota",
    shortLabel: "T",
    hint: "Permanent count, requires admin to add more",
    icon: ImageIcon,
    quotaField: "image_total_quota",
    usedField: "image_total_used",
    unlimitedField: "image_total_unlimited",
    remainingField: "image_total_remaining",
    quotaPayload: "image_total_quota",
    unlimitedPayload: "image_total_unlimited",
    resetPayload: "reset_image_total_used",
  },
];

const CHAT_QUOTA_KINDS: QuotaMeta[] = [
  {
    kind: "chat_daily",
    label: "Chat Daily Quota",
    shortLabel: "D",
    hint: "Auto-resets daily at 00:00",
    icon: CalendarDays,
    quotaField: "chat_daily_quota",
    usedField: "chat_daily_used",
    unlimitedField: "chat_daily_unlimited",
    remainingField: "chat_daily_remaining",
    quotaPayload: "chat_daily_quota",
    unlimitedPayload: "chat_daily_unlimited",
    resetPayload: "reset_chat_daily_used",
  },
  {
    kind: "chat_monthly",
    label: "Chat Monthly Quota",
    shortLabel: "M",
    hint: "Auto-resets on the 1st of each month at 00:00",
    icon: CalendarClock,
    quotaField: "chat_monthly_quota",
    usedField: "chat_monthly_used",
    unlimitedField: "chat_monthly_unlimited",
    remainingField: "chat_monthly_remaining",
    quotaPayload: "chat_monthly_quota",
    unlimitedPayload: "chat_monthly_unlimited",
    resetPayload: "reset_chat_monthly_used",
  },
  {
    kind: "chat_total",
    label: "Chat Total Quota",
    shortLabel: "T",
    hint: "Permanent count, requires admin to add more",
    icon: MessageSquare,
    quotaField: "chat_total_quota",
    usedField: "chat_total_used",
    unlimitedField: "chat_total_unlimited",
    remainingField: "chat_total_remaining",
    quotaPayload: "chat_total_quota",
    unlimitedPayload: "chat_total_unlimited",
    resetPayload: "reset_chat_total_used",
  },
];

const ALL_QUOTA_KINDS: QuotaMeta[] = [...IMAGE_QUOTA_KINDS, ...CHAT_QUOTA_KINDS];

type CreateFormState = Record<QuotaKind, { quota: string; unlimited: boolean }>;
type EditFormState = Record<
  QuotaKind,
  { quota: string; mode: "add" | "set"; unlimited: boolean; resetUsed: boolean }
>;
type QuotaValidationState = Record<QuotaKind, { quota: number; unlimited: boolean }>;

function defaultCreateForm(): CreateFormState {
  return {
    image_daily: { quota: "", unlimited: true },
    image_monthly: { quota: "", unlimited: true },
    image_total: { quota: "100", unlimited: false },
    chat_daily: { quota: "", unlimited: true },
    chat_monthly: { quota: "", unlimited: true },
    chat_total: { quota: "", unlimited: true },
  };
}

function buildEditForm(item: UserKey): EditFormState {
  return ALL_QUOTA_KINDS.reduce<EditFormState>((acc, meta) => {
    acc[meta.kind] = {
      quota: "",
      mode: "add",
      unlimited: Boolean(item[meta.unlimitedField]),
      resetUsed: false,
    };
    return acc;
  }, {} as EditFormState);
}

function validateQuotaHierarchy(values: QuotaValidationState): string | null {
  const checks: Array<[QuotaKind, QuotaKind, string, string]> = [
    ["image_daily", "image_monthly", "Image Daily Quota", "Image Monthly Quota"],
    ["image_daily", "image_total", "Image Daily Quota", "Image Total Quota"],
    ["image_monthly", "image_total", "Image Monthly Quota", "Image Total Quota"],
    ["chat_daily", "chat_monthly", "Chat Daily Quota", "Chat Monthly Quota"],
    ["chat_daily", "chat_total", "Chat Daily Quota", "Chat Total Quota"],
    ["chat_monthly", "chat_total", "Chat Monthly Quota", "Chat Total Quota"],
  ];
  for (const [smaller, larger, smallerLabel, largerLabel] of checks) {
    const smallerConf = values[smaller];
    const largerConf = values[larger];
    if (smallerConf.unlimited || largerConf.unlimited) continue;
    if (smallerConf.quota > largerConf.quota) {
      return `${smallerLabel} cannot exceed ${largerLabel}`;
    }
  }
  return null;
}

function formatDateTime(value?: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function readNumber(value: unknown): number {
  return Math.max(0, Math.floor(Number(value || 0)));
}

async function copyToClipboard(value: string) {
  try {
    await navigator.clipboard.writeText(value);
    toast.success("Copied to clipboard");
  } catch {
    toast.error("Copy failed, please copy manually");
  }
}

const PAGE_SIZE_OPTIONS = ["10", "20", "50", "100"] as const;
const ACCOUNT_TIER_OPTIONS: Array<{ value: AccountTier; label: string; hint: string }> = [
  { value: "free", label: "Standard", hint: "Uses free accounts only" },
  { value: "premium", label: "Premium", hint: "Can use Plus / Pro" },
];

function accountTierLabel(value?: string) {
  return value === "premium" ? "Premium" : "Standard";
}

export function UserKeysCard() {
  const didLoadRef = useRef(false);
  const [items, setItemsState] = useState<UserKey[]>(() => cachedItems ?? []);
  const [isLoading, setIsLoading] = useState(() => cachedItems === null);
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<(typeof PAGE_SIZE_OPTIONS)[number]>("10");

  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [name, setName] = useState("");
  const [customKey, setCustomKey] = useState("");
  const [accountTier, setAccountTier] = useState<AccountTier>("free");
  const [createForm, setCreateForm] = useState<CreateFormState>(defaultCreateForm);
  const [isCreating, setIsCreating] = useState(false);
  const [pendingIds, setPendingIds] = useState<Set<string>>(() => new Set());
  const [revealedKey, setRevealedKey] = useState("");
  const [deletingItem, setDeletingItem] = useState<UserKey | null>(null);
  const [editingItem, setEditingItem] = useState<UserKey | null>(null);
  const [editName, setEditName] = useState("");
  const [editKey, setEditKey] = useState("");
  const [editAccountTier, setEditAccountTier] = useState<AccountTier>("free");
  const [editForm, setEditForm] = useState<EditFormState | null>(null);

  const setItems = (next: UserKey[]) => {
    cachedItems = next;
    setItemsState(next);
  };

  const load = async (silent = false) => {
    if (!silent) setIsLoading(true);
    try {
      const data = await fetchUserKeys();
      setItems(data.items);
    } catch (error) {
      if (!silent) toast.error(error instanceof Error ? error.message : "Failed to load user keys");
    } finally {
      if (!silent) setIsLoading(false);
    }
  };

  useEffect(() => {
    if (didLoadRef.current) return;
    didLoadRef.current = true;
    // Silently refresh in background when cache is hit, avoiding flicker; show spinner on first visit.
    // load is a closure rebuilt on each render within the component scope, but only runs once on mount.
    // Intentionally omitting dependencies here, using ref to ensure it only runs once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    void load(cachedItems !== null);
  }, []);

  // Search debounce: 250ms is close to the optimal feel for SaaS tables; shorter would cause flickering during long name input.
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(query.trim().toLowerCase()), 250);
    return () => clearTimeout(timer);
  }, [query]);

  const filteredItems = useMemo(() => {
    if (!debouncedQuery) return items;
    return items.filter((item) => item.name.toLowerCase().includes(debouncedQuery));
  }, [items, debouncedQuery]);

  const pageCount = Math.max(1, Math.ceil(filteredItems.length / Number(pageSize)));
  const safePage = Math.min(page, pageCount);
  const startIndex = (safePage - 1) * Number(pageSize);
  const currentRows = filteredItems.slice(startIndex, startIndex + Number(pageSize));

  const paginationItems = useMemo(() => {
    const items: (number | "...")[] = [];
    const start = Math.max(1, safePage - 1);
    const end = Math.min(pageCount, safePage + 1);
    if (start > 1) items.push(1);
    if (start > 2) items.push("...");
    for (let current = start; current <= end; current += 1) items.push(current);
    if (end < pageCount - 1) items.push("...");
    if (end < pageCount) items.push(pageCount);
    return items;
  }, [pageCount, safePage]);

  const updateCreateField = (kind: QuotaKind, patch: Partial<CreateFormState[QuotaKind]>) => {
    setCreateForm((prev) => ({ ...prev, [kind]: { ...prev[kind], ...patch } }));
  };

  const updateEditField = (kind: QuotaKind, patch: Partial<EditFormState[QuotaKind]>) => {
    setEditForm((prev) => (prev ? { ...prev, [kind]: { ...prev[kind], ...patch } } : prev));
  };

  const handleCreate = async () => {
    // At least one tier must be usable: either unlimited or quota > 0; otherwise the user gets a key that "can do nothing".
    const hasAnyUsable = ALL_QUOTA_KINDS.some((meta) => {
      const conf = createForm[meta.kind];
      return conf.unlimited || readNumber(conf.quota) > 0;
    });
    if (!hasAnyUsable) {
      toast.error("Please enable at least one usable quota for image or chat");
      return;
    }
    const nextQuotaState = ALL_QUOTA_KINDS.reduce<QuotaValidationState>((acc, meta) => {
      const conf = createForm[meta.kind];
      acc[meta.kind] = {
        quota: conf.unlimited ? 0 : readNumber(conf.quota),
        unlimited: conf.unlimited,
      };
      return acc;
    }, {} as QuotaValidationState);
    const quotaError = validateQuotaHierarchy(nextQuotaState);
    if (quotaError) {
      toast.error(quotaError);
      return;
    }
    const payload: UserKeyCreatePayload = { name: name.trim(), account_tier: accountTier };
    const trimmedKey = customKey.trim();
    if (trimmedKey) payload.key = trimmedKey;
    const view = payload as Record<string, unknown>;
    ALL_QUOTA_KINDS.forEach((meta) => {
      const conf = createForm[meta.kind];
      view[meta.unlimitedPayload] = conf.unlimited;
      view[meta.quotaPayload] = conf.unlimited ? 0 : readNumber(conf.quota);
    });
    setIsCreating(true);
    try {
      const data = await createUserKey(payload);
      setItems(data.items);
      setRevealedKey(data.key);
      setName("");
      setCustomKey("");
      setAccountTier("free");
      setCreateForm(defaultCreateForm());
      setIsDialogOpen(false);
      toast.success("User key created");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to create user key");
    } finally {
      setIsCreating(false);
    }
  };

  const setItemPending = (id: string, isPending: boolean) => {
    setPendingIds((current) => {
      const next = new Set(current);
      if (isPending) next.add(id);
      else next.delete(id);
      return next;
    });
  };

  const handleToggle = async (item: UserKey) => {
    setItemPending(item.id, true);
    try {
      const data = await updateUserKey(item.id, { enabled: !item.enabled });
      setItems(data.items);
      toast.success(item.enabled ? "User key disabled" : "User key enabled");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to update user key");
    } finally {
      setItemPending(item.id, false);
    }
  };

  const handleDelete = async () => {
    if (!deletingItem) return;
    const item = deletingItem;
    setItemPending(item.id, true);
    try {
      const data = await deleteUserKey(item.id);
      setItems(data.items);
      setDeletingItem(null);
      toast.success("User key deleted");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to delete user key");
    } finally {
      setItemPending(item.id, false);
    }
  };

  const openEditDialog = (item: UserKey) => {
    setEditingItem(item);
    setEditName(item.name);
    setEditKey("");
    setEditAccountTier(item.account_tier ?? "free");
    setEditForm(buildEditForm(item));
  };

  const closeEditDialog = () => {
    setEditingItem(null);
    setEditKey("");
    setEditAccountTier("free");
    setEditForm(null);
  };

  const handleEdit = async () => {
    if (!editingItem || !editForm) return;
    const item = editingItem;
    const trimmedName = editName.trim();
    const trimmedKey = editKey.trim();
    const payload: UserKeyUpdatePayload = {};
    const view = payload as Record<string, unknown>;
    if (trimmedName !== item.name) payload.name = trimmedName;
    if (trimmedKey) payload.key = trimmedKey;
    if (editAccountTier !== (item.account_tier ?? "free")) payload.account_tier = editAccountTier;

    let quotaTouched = false;
    let quotaConfigTouched = false;
    const nextQuotaState = ALL_QUOTA_KINDS.reduce<QuotaValidationState>((acc, meta) => {
      acc[meta.kind] = {
        quota: readNumber(item[meta.quotaField]),
        unlimited: Boolean(item[meta.unlimitedField]),
      };
      return acc;
    }, {} as QuotaValidationState);
    // Aggregate fields where "unlimited" was unchecked but no new value was provided: report error uniformly to avoid silently setting quota to 0.
    const missingValueLabels: string[] = [];
    for (const meta of ALL_QUOTA_KINDS) {
      const conf = editForm[meta.kind];
      const currentUnlimited = Boolean(item[meta.unlimitedField]);
      const currentQuota = readNumber(item[meta.quotaField]);
      const inputRaw = conf.quota.trim();
      const inputNum = inputRaw === "" ? 0 : readNumber(inputRaw);

      // Calculate the final quota after save: for unlimited tiers, quota is semantically irrelevant, unified as 0;
      // otherwise based on add / set mode + whether a value was entered, resolve to specific quota number.
      // The key semantic here is "only check if the saved result actually changed", avoiding false positives in set mode when input equals current value.
      const nextUnlimited = conf.unlimited;
      let nextQuota = currentQuota;
      if (!conf.unlimited) {
        if (inputRaw === "") {
          // Empty: keep current; only warn when switching from unlimited to limited without a value.
          nextQuota = currentQuota;
        } else if (conf.mode === "add") {
          nextQuota = Math.max(0, currentQuota + inputNum);
        } else {
          nextQuota = inputNum;
        }
      }
      nextQuotaState[meta.kind] = {
        quota: nextUnlimited ? 0 : nextQuota,
        unlimited: nextUnlimited,
      };

      if (nextUnlimited && !currentUnlimited) {
        // Switch to unlimited: explicitly send unlimited=true; quota is ignored by backend, no need to send.
        view[meta.unlimitedPayload] = true;
        quotaTouched = true;
        quotaConfigTouched = true;
      } else if (!nextUnlimited && currentUnlimited) {
        // Switch to limited: must provide a specific value > 0, otherwise user gets 0 quota, immediately unusable.
        if (inputRaw === "" || nextQuota <= 0) {
          missingValueLabels.push(meta.label);
          continue;
        }
        view[meta.unlimitedPayload] = false;
        view[meta.quotaPayload] = nextQuota;
        quotaTouched = true;
        quotaConfigTouched = true;
      } else if (!nextUnlimited && nextQuota !== currentQuota) {
        // Same limited mode, quota actually changed; in set mode if input equals current value it falls through here and is ignored, as expected.
        view[meta.quotaPayload] = nextQuota;
        quotaTouched = true;
        quotaConfigTouched = true;
      }

      if (conf.resetUsed) {
        view[meta.resetPayload] = true;
        quotaTouched = true;
      }
    }

    if (missingValueLabels.length > 0) {
      toast.error(`${missingValueLabels.join(", ")}: a value greater than 0 is required when disabling "Unlimited"`);
      return;
    }
    if (quotaConfigTouched) {
      const quotaError = validateQuotaHierarchy(nextQuotaState);
      if (quotaError) {
        toast.error(quotaError);
        return;
      }
    }

    if (!payload.name && !payload.key && !payload.account_tier && !quotaTouched) {
      // Nothing actually changed: silently close without disturbing the user.
      // If set mode input matched the current value, it also falls here—this is expected behavior.
      closeEditDialog();
      return;
    }

    setItemPending(item.id, true);
    try {
      const data = await updateUserKey(item.id, payload);
      setItems(data.items);
      closeEditDialog();
      toast.success("User key updated");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to update user key");
    } finally {
      setItemPending(item.id, false);
    }
  };

  const handleCopy = (value: string) => {
    void copyToClipboard(value);
  };

  return (
    <>
      <Card className="rounded-2xl border-white/80 bg-white/90 shadow-sm">
        <CardContent className="space-y-5 p-6">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
            <div className="flex items-center gap-3">
              <div className="flex size-10 items-center justify-center rounded-xl bg-stone-100">
                <KeyRound className="size-5 text-stone-600" />
              </div>
              <div>
                <h2 className="text-lg font-semibold tracking-tight">User Key Management</h2>
                <p className="text-sm text-stone-500">
                  Image and chat each support daily, monthly, and total quotas; each tier can independently select "Unlimited".
                </p>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative min-w-[200px]">
                <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-stone-400" />
                <Input
                  value={query}
                  onChange={(event) => {
                    setQuery(event.target.value);
                    // Reset to first page when search criteria change, to avoid seeing a blank page when results are on page 1.
                    setPage(1);
                  }}
                  placeholder="Search by name"
                  className="h-9 w-full rounded-xl border-stone-200 bg-white/85 pl-10"
                />
              </div>
              <Button
                className="h-9 rounded-xl bg-stone-950 px-4 text-white hover:bg-stone-800"
                onClick={() => setIsDialogOpen(true)}
              >
                <Plus className="size-4" />
                Create User Key
              </Button>
            </div>
          </div>

          {revealedKey ? (
            <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-4 text-sm text-emerald-900">
              <div className="font-medium">New key is shown only once, please save it immediately:</div>
              <div className="mt-3 flex flex-col gap-3 rounded-lg border border-emerald-200 bg-white/80 p-3 md:flex-row md:items-center md:justify-between">
                <code className="break-all font-mono text-[13px]">{revealedKey}</code>
                <Button
                  type="button"
                  variant="outline"
                  className="h-9 rounded-xl border-emerald-200 bg-white px-4 text-emerald-700"
                  onClick={() => void handleCopy(revealedKey)}
                >
                  <Copy className="size-4" />
                  Copy
                </Button>
              </div>
            </div>
          ) : null}

          <div className="overflow-hidden rounded-xl border border-stone-200">
            {isLoading ? (
              <div className="flex items-center justify-center py-10">
                <LoaderCircle className="size-5 animate-spin text-stone-400" />
              </div>
            ) : (
              <>
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[1040px] text-left">
                    <thead className="border-b border-stone-200 bg-stone-50 text-[12px] font-medium text-stone-500">
                      <tr>
                        <th className="w-56 px-4 py-2.5 font-medium">Name</th>
                        <th className="w-24 px-4 py-2.5 font-medium">Status</th>
                        <th className="w-72 px-4 py-2.5 font-medium">Image Quota</th>
                        <th className="w-72 px-4 py-2.5 font-medium">Chat Quota</th>
                        <th className="w-36 px-4 py-2.5 font-medium">Created</th>
                        <th className="w-36 px-4 py-2.5 font-medium">Last Used</th>
                        <th className="w-32 px-4 py-2.5 text-right font-medium">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {currentRows.map((item) => (
                        <KeyRow
                          key={item.id}
                          item={item}
                          pending={pendingIds.has(item.id)}
                          onEdit={() => openEditDialog(item)}
                          onToggle={() => void handleToggle(item)}
                          onDelete={() => setDeletingItem(item)}
                          onAfterRegenerate={(nextItems, newKey) => {
                            setItems(nextItems);
                            setRevealedKey(newKey);
                          }}
                        />
                      ))}
                    </tbody>
                  </table>
                </div>

                {currentRows.length === 0 ? (
                  <div className="flex flex-col items-center justify-center gap-3 px-6 py-12 text-center">
                    <div className="rounded-xl bg-stone-100 p-3 text-stone-500">
                      <Search className="size-5" />
                    </div>
                    <div className="space-y-1">
                      <p className="text-sm font-medium text-stone-700">
                        {debouncedQuery ? "No matching keys" : "No user keys yet"}
                      </p>
                      <p className="text-sm text-stone-500">
                        {debouncedQuery
                          ? "Adjust your search keywords and try again."
                          : "Click the button in the top-right corner to create and distribute keys."}
                      </p>
                    </div>
                  </div>
                ) : null}

                <div className="flex flex-wrap items-center justify-between gap-3 border-t border-stone-200 px-4 py-3">
                  <div className="text-sm text-stone-500">
                    Showing {filteredItems.length === 0 ? 0 : startIndex + 1} -{" "}
                    {Math.min(startIndex + Number(pageSize), filteredItems.length)} of{" "}
                    {filteredItems.length} items
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Select
                      value={pageSize}
                      onValueChange={(value) => {
                        setPageSize(value as (typeof PAGE_SIZE_OPTIONS)[number]);
                        // Page N may not exist after changing page size, reset to page 1.
                        setPage(1);
                      }}
                    >
                      <SelectTrigger className="h-9 w-[108px] rounded-lg border-stone-200 bg-white text-sm leading-none">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {PAGE_SIZE_OPTIONS.map((option) => (
                          <SelectItem key={option} value={option}>
                            {option} / page
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Button
                      variant="outline"
                      size="icon"
                      className="size-9 rounded-lg border-stone-200 bg-white"
                      disabled={safePage <= 1}
                      onClick={() => setPage((prev) => Math.max(1, prev - 1))}
                    >
                      <ChevronLeft className="size-4" />
                    </Button>
                    {paginationItems.map((entry, index) =>
                      entry === "..." ? (
                        <span key={`ellipsis-${index}`} className="px-1 text-sm text-stone-400">
                          ...
                        </span>
                      ) : (
                        <Button
                          key={entry}
                          variant={entry === safePage ? "default" : "outline"}
                          className={cn(
                            "h-9 min-w-9 rounded-lg px-3",
                            entry === safePage
                              ? "bg-stone-950 text-white hover:bg-stone-800"
                              : "border-stone-200 bg-white text-stone-700",
                          )}
                          onClick={() => setPage(entry)}
                        >
                          {entry}
                        </Button>
                      ),
                    )}
                    <Button
                      variant="outline"
                      size="icon"
                      className="size-9 rounded-lg border-stone-200 bg-white"
                      disabled={safePage >= pageCount}
                      onClick={() => setPage((prev) => Math.min(pageCount, prev + 1))}
                    >
                      <ChevronRight className="size-4" />
                    </Button>
                  </div>
                </div>
              </>
            )}
          </div>
        </CardContent>
      </Card>

      <Dialog
        open={isDialogOpen}
        onOpenChange={(open) => {
          setIsDialogOpen(open);
          if (!open) {
            setName("");
            setCustomKey("");
            setAccountTier("free");
            setCreateForm(defaultCreateForm());
          }
        }}
      >
        <DialogContent className="w-[min(94vw,980px)] max-h-[90vh] gap-0 overflow-hidden rounded-[24px] bg-white p-0 sm:max-w-none">
          <DialogHeader className="border-b border-stone-200/80 bg-stone-50/70 px-6 py-5 pr-14 sm:px-7">
            <div className="flex items-start gap-4">
              <div className="grid size-11 shrink-0 place-items-center rounded-2xl border border-stone-200 bg-white text-stone-800 shadow-sm">
                <KeyRound className="size-5" />
              </div>
              <div className="min-w-0">
                <DialogTitle className="text-[22px] leading-7">Create User Key</DialogTitle>
                <DialogDescription className="mt-1 max-w-2xl text-sm leading-6 text-stone-500">
                  Configure user identity, account permissions, and independent quotas. A raw key shown only once will be generated after creation.
                </DialogDescription>
              </div>
            </div>
          </DialogHeader>
          <div className="max-h-[calc(90vh-154px)] overflow-y-auto px-6 py-5 sm:px-7">
            <div className="space-y-5">
              <section className="space-y-4">
                <SectionHeading title="Key Profile" hint="Name is for internal identification; leave custom key empty for auto-generation." />
                <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
                  <div className="space-y-2">
                    <label className="text-xs font-semibold tracking-wide text-stone-500 uppercase">Name</label>
                    <Input
                      value={name}
                      onChange={(event) => setName(event.target.value)}
                      placeholder="e.g. Designer A, Ops temporary account"
                      className="h-12 rounded-2xl border-stone-200 bg-white shadow-none"
                    />
                  </div>
                  <AccountTierSelect value={accountTier} onChange={setAccountTier} />
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-semibold tracking-wide text-stone-500 uppercase">Custom Key</label>
                  <Input
                    value={customKey}
                    onChange={(event) => setCustomKey(event.target.value)}
                    placeholder="Leave empty for auto-generation, e.g. sk-your-custom-user-key"
                    className="h-12 rounded-2xl border-stone-200 bg-white font-mono text-[13px] shadow-none"
                  />
                  <p className="text-xs leading-5 text-stone-500">
                    Will be created with this value; cannot duplicate admin keys or other user keys.
                  </p>
                </div>
              </section>
              <QuotaGroupCreate
                title="Image Quota"
                groupHint="Shared with the image workbench and /v1/images/*."
                kinds={IMAGE_QUOTA_KINDS}
                form={createForm}
                onChange={updateCreateField}
              />
              <QuotaGroupCreate
                title="Chat Quota"
                groupHint="Each POST /api/chat/stream request deducts 1."
                kinds={CHAT_QUOTA_KINDS}
                form={createForm}
                onChange={updateCreateField}
              />
            </div>
          </div>
          <DialogFooter className="border-t border-stone-200/80 bg-white px-6 py-4 sm:px-7">
            <Button
              type="button"
              variant="secondary"
              className="h-10 rounded-xl bg-stone-100 px-5 text-stone-700 hover:bg-stone-200"
              onClick={() => setIsDialogOpen(false)}
              disabled={isCreating}
            >
              Cancel
            </Button>
            <Button
              type="button"
              className="h-10 rounded-xl bg-stone-950 px-5 text-white hover:bg-stone-800"
              onClick={() => void handleCreate()}
              disabled={isCreating}
            >
              {isCreating ? <LoaderCircle className="size-4 animate-spin" /> : <Plus className="size-4" />}
              Create
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(deletingItem)} onOpenChange={(open) => (!open ? setDeletingItem(null) : null)}>
        <DialogContent className="rounded-2xl p-6">
          <DialogHeader className="gap-2">
            <DialogTitle>Delete User Key</DialogTitle>
            <DialogDescription className="text-sm leading-6">
              Are you sure you want to delete user key "{deletingItem?.name}"? Once deleted, this key will no longer be able to call the API.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              type="button"
              variant="secondary"
              className="h-10 rounded-xl bg-stone-100 px-5 text-stone-700 hover:bg-stone-200"
              onClick={() => setDeletingItem(null)}
              disabled={deletingItem ? pendingIds.has(deletingItem.id) : false}
            >
              Cancel
            </Button>
            <Button
              type="button"
              className="h-10 rounded-xl bg-rose-600 px-5 text-white hover:bg-rose-700"
              onClick={() => void handleDelete()}
              disabled={deletingItem ? pendingIds.has(deletingItem.id) : false}
            >
              {deletingItem && pendingIds.has(deletingItem.id) ? (
                <LoaderCircle className="size-4 animate-spin" />
              ) : (
                <Trash2 className="size-4" />
              )}
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(editingItem)} onOpenChange={(open) => (!open ? closeEditDialog() : null)}>
        <DialogContent className="w-[min(94vw,980px)] max-h-[90vh] gap-0 overflow-hidden rounded-[24px] bg-white p-0 sm:max-w-none">
          <DialogHeader className="border-b border-stone-200/80 bg-stone-50/70 px-6 py-5 pr-14 sm:px-7">
            <div className="flex items-start gap-4">
              <div className="grid size-11 shrink-0 place-items-center rounded-2xl border border-stone-200 bg-white text-stone-800 shadow-sm">
                <KeyRound className="size-5" />
              </div>
              <div className="min-w-0">
                <DialogTitle className="text-[22px] leading-7">Edit User Key</DialogTitle>
                <DialogDescription className="mt-1 max-w-2xl text-sm leading-6 text-stone-500">
                  Adjust identity, permissions, quotas, and dedicated key. Blank quota fields keep current values unchanged.
                </DialogDescription>
              </div>
            </div>
          </DialogHeader>
          <div className="max-h-[calc(90vh-154px)] overflow-y-auto px-6 py-5 sm:px-7">
            <div className="space-y-5">
              <section className="space-y-4">
                <SectionHeading title="Key Profile" hint={editingItem ? `ID ${editingItem.id}` : "Basic info"} />
                <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
                  <div className="space-y-2">
                    <label className="text-xs font-semibold tracking-wide text-stone-500 uppercase">Name</label>
                    <Input
                      value={editName}
                      onChange={(event) => setEditName(event.target.value)}
                      placeholder="e.g. Designer A, Ops temporary account"
                      className="h-12 rounded-2xl border-stone-200 bg-white shadow-none"
                    />
                  </div>
                  <AccountTierSelect value={editAccountTier} onChange={setEditAccountTier} />
                </div>
              </section>
              {editingItem && editForm ? (
                <>
                  <QuotaGroupEdit
                    title="Image Quota"
                    groupHint="Counted by number of images generated."
                    kinds={IMAGE_QUOTA_KINDS}
                    item={editingItem}
                    form={editForm}
                    onChange={updateEditField}
                  />
                  <QuotaGroupEdit
                    title="Chat Quota"
                    groupHint="Each POST /api/chat/stream request deducts 1."
                    kinds={CHAT_QUOTA_KINDS}
                    item={editingItem}
                    form={editForm}
                    onChange={updateEditField}
                  />
                </>
              ) : null}
              <section className="space-y-3">
                <SectionHeading title="Key Replacement" hint="Leave empty to keep current; old key is invalidated immediately after save." />
                <Input
                  value={editKey}
                  onChange={(event) => setEditKey(event.target.value)}
                  placeholder="e.g. sk-your-custom-user-key"
                  className="h-12 rounded-2xl border-stone-200 bg-white font-mono text-[13px] shadow-none"
                />
                <p className="text-xs leading-5 text-stone-500">
                  The system only stores hashes and will not display the current key.
                </p>
              </section>
            </div>
          </div>
          <DialogFooter className="border-t border-stone-200/80 bg-white px-6 py-4 sm:px-7">
            <Button
              type="button"
              variant="secondary"
              className="h-10 rounded-xl bg-stone-100 px-5 text-stone-700 hover:bg-stone-200"
              onClick={closeEditDialog}
              disabled={editingItem ? pendingIds.has(editingItem.id) : false}
            >
              Cancel
            </Button>
            <Button
              type="button"
              className="h-10 rounded-xl bg-stone-950 px-5 text-white hover:bg-stone-800"
              onClick={() => void handleEdit()}
              disabled={editingItem ? pendingIds.has(editingItem.id) : false}
            >
              {editingItem && pendingIds.has(editingItem.id) ? (
                <LoaderCircle className="size-4 animate-spin" />
              ) : (
                <Pencil className="size-4" />
              )}
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function KeyRow({
  item,
  pending,
  onEdit,
  onToggle,
  onDelete,
  onAfterRegenerate,
}: {
  item: UserKey;
  pending: boolean;
  onEdit: () => void;
  onToggle: () => void;
  onDelete: () => void;
  onAfterRegenerate: (items: UserKey[], newKey: string) => void;
}) {
  const [revealOpen, setRevealOpen] = useState(false);
  const [revealLoading, setRevealLoading] = useState(false);
  const [revealError, setRevealError] = useState("");
  const [plaintext, setPlaintext] = useState("");
  const [regenerating, setRegenerating] = useState(false);
  const [keyInput, setKeyInput] = useState("");
  const [confirmOpen, setConfirmOpen] = useState(false);

  const loadPlaintext = async () => {
    setRevealLoading(true);
    setRevealError("");
    try {
      const data = await fetchUserKeyPlaintext(item.id);
      if (data.key_visible && data.key) {
        setPlaintext(data.key);
        setKeyInput(data.key);
      } else {
        setPlaintext("");
        setKeyInput("");
        setRevealError("This is a legacy key — the backend only stored the hash. Change it to your desired value or click \"Generate New Key\"; the old key will be invalidated immediately.");
      }
    } catch (error) {
      setRevealError(error instanceof Error ? error.message : "Failed to read key");
    } finally {
      setRevealLoading(false);
    }
  };

  const trimmedInput = keyInput.trim();
  const useCustom = Boolean(trimmedInput) && trimmedInput !== plaintext;

  const handleRegenerate = async () => {
    if (regenerating) return;
    setRegenerating(true);
    try {
      const data = await regenerateUserKey(item.id, useCustom ? trimmedInput : undefined);
      onAfterRegenerate(data.items, data.key);
      setConfirmOpen(false);
      setRevealOpen(false);
      toast.success(useCustom ? "Replaced with custom key, old key invalidated" : "New key generated, old key invalidated");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to reset key");
    } finally {
      setRegenerating(false);
    }
  };

  return (
    <>
    <tr className="border-b border-stone-100 align-middle text-sm even:bg-stone-50/40 hover:bg-stone-50">
      <td className="px-4 py-3">
        <div className="flex min-w-0 items-center gap-2">
          <span className="truncate font-medium text-stone-800">{item.name}</span>
          <Badge
            variant={item.account_tier === "premium" ? "default" : "secondary"}
            className={cn(
              "shrink-0 rounded-md px-1.5 py-0 text-[10px]",
              item.account_tier === "premium" ? "bg-stone-900 text-white" : "bg-stone-100 text-stone-600",
            )}
          >
            {accountTierLabel(item.account_tier)}
          </Badge>
        </div>
        <div className="mt-0.5 font-data text-[11px] text-stone-400">ID {item.id}</div>
      </td>
      <td className="px-4 py-3">
        <Badge variant={item.enabled ? "success" : "secondary"} className="rounded-md">
          {item.enabled ? "Enabled" : "Disabled"}
        </Badge>
      </td>
      <td className="px-4 py-3">
        <QuotaGroupSummary kinds={IMAGE_QUOTA_KINDS} item={item} />
      </td>
      <td className="px-4 py-3">
        <QuotaGroupSummary kinds={CHAT_QUOTA_KINDS} item={item} />
      </td>
      <td className="px-4 py-3 font-data text-xs text-stone-700">{formatDateTime(item.created_at)}</td>
      <td className="px-4 py-3 font-data text-xs text-stone-500">{formatDateTime(item.last_used_at)}</td>
      <td className="px-4 py-3">
        <div className="flex items-center justify-end gap-0.5 text-stone-500">
          <Popover
            open={revealOpen}
            onOpenChange={(next) => {
              setRevealOpen(next);
              if (next) void loadPlaintext();
              // Intentionally not clearing keyInput / plaintext / revealError on close:
              // When clicking "Confirm Replace", pointerDown reaches Popover's onPointerDownOutside first (Dialog is another portal).
              // If keyInput is cleared here, the subsequent click runs with an empty keyInput closure,
              // causing key="" in the request body which makes the backend auto-generate. loadPlaintext will rewrite these states on next open.
            }}
          >
            <PopoverTrigger asChild>
              <button
                type="button"
                className="cursor-pointer rounded-md p-1.5 transition hover:bg-stone-100 hover:text-stone-800 disabled:opacity-50"
                disabled={pending}
                title="View key"
              >
                <Eye className="size-4" />
              </button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-[320px] space-y-3 text-sm">
              <div className="text-xs font-medium text-stone-500">{item.name} · Current Key</div>
              {revealLoading ? (
                <div className="flex items-center gap-2 text-stone-500">
                  <LoaderCircle className="size-4 animate-spin" />
                  Loading…
                </div>
              ) : (
                <>
                  {!plaintext && revealError ? (
                    <p className="text-xs leading-5 text-stone-600">{revealError}</p>
                  ) : null}
                  <Input
                    value={keyInput}
                    onChange={(event) => setKeyInput(event.target.value)}
                    placeholder={plaintext ? "" : "Leave empty to auto-generate a new key"}
                    className="h-9 rounded-lg border-stone-200 bg-white font-mono text-[12px]"
                  />
                  <div className="flex items-center justify-end gap-2">
                    {plaintext ? (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="h-8 rounded-lg border-stone-200 bg-white"
                        onClick={() => void copyToClipboard(keyInput || plaintext)}
                      >
                        <Copy className="size-3.5" />
                        Copy
                      </Button>
                    ) : null}
                    <Button
                      type="button"
                      size="sm"
                      className="h-8 rounded-lg bg-stone-950 text-white hover:bg-stone-800"
                      onClick={() => setConfirmOpen(true)}
                      disabled={regenerating}
                    >
                      {regenerating ? (
                        <LoaderCircle className="size-3.5 animate-spin" />
                      ) : (
                        <RefreshCw className="size-3.5" />
                      )}
                      {useCustom ? "Replace with this key" : "Reset"}
                    </Button>
                  </div>
                </>
              )}
            </PopoverContent>
          </Popover>
          <button
            type="button"
            className="cursor-pointer rounded-md p-1.5 transition hover:bg-stone-100 hover:text-stone-800 disabled:opacity-50"
            onClick={onEdit}
            disabled={pending}
            title="Edit"
          >
            {pending ? <LoaderCircle className="size-4 animate-spin" /> : <Pencil className="size-4" />}
          </button>
          <button
            type="button"
            className="cursor-pointer rounded-md p-1.5 transition hover:bg-stone-100 hover:text-stone-800 disabled:opacity-50"
            onClick={onToggle}
            disabled={pending}
            title={item.enabled ? "Disable" : "Enable"}
          >
            {item.enabled ? <Ban className="size-4" /> : <CheckCircle2 className="size-4" />}
          </button>
          <button
            type="button"
            className="cursor-pointer rounded-md p-1.5 transition hover:bg-rose-50 hover:text-rose-600 disabled:opacity-50"
            onClick={onDelete}
            disabled={pending}
            title="Delete"
          >
            <Trash2 className="size-4" />
          </button>
        </div>
      </td>
    </tr>
    <Dialog open={confirmOpen} onOpenChange={(open) => (!open && !regenerating ? setConfirmOpen(false) : null)}>
      <DialogContent className="rounded-2xl p-6 sm:max-w-[440px]">
        <DialogHeader className="gap-2">
          <DialogTitle>{useCustom ? "Replace with Custom Key" : "Reset Key"}</DialogTitle>
          <DialogDescription className="text-sm leading-6">
            {useCustom ? (
              <>
                Are you sure you want to replace the key for "{item.name}" with the value below? The old key will be invalidated immediately.
                <span className="mt-3 block rounded-lg border border-stone-200 bg-stone-50 px-3 py-2 font-mono text-[12px] break-all text-stone-800">
                  {trimmedInput}
                </span>
              </>
            ) : (
              <>Are you sure you want to reset the key for "{item.name}"? The old key will be invalidated immediately, and users will need to switch to the new key.</>
            )}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button
            type="button"
            variant="secondary"
            className="h-10 rounded-xl bg-stone-100 px-5 text-stone-700 hover:bg-stone-200"
            onClick={() => setConfirmOpen(false)}
            disabled={regenerating}
          >
            Cancel
          </Button>
          <Button
            type="button"
            className="h-10 rounded-xl bg-stone-950 px-5 text-white hover:bg-stone-800"
            onClick={() => void handleRegenerate()}
            disabled={regenerating}
          >
            {regenerating ? <LoaderCircle className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
            {useCustom ? "Confirm Replace" : "Confirm Reset"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
    </>
  );
}

function SectionHeading({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-2">
      <h3 className="text-sm font-semibold text-stone-900">{title}</h3>
      {hint ? <p className="text-xs leading-5 text-stone-500">{hint}</p> : null}
    </div>
  );
}

function AccountTierSelect({
  value,
  onChange,
}: {
  value: AccountTier;
  onChange: (value: AccountTier) => void;
}) {
  return (
    <div className="space-y-2">
      <label className="text-xs font-semibold tracking-wide text-stone-500 uppercase">Account Tier</label>
      <div className="grid grid-cols-2 gap-2 rounded-2xl border border-stone-200 bg-stone-50 p-1">
        {ACCOUNT_TIER_OPTIONS.map((option) => {
          const selected = value === option.value;
          return (
            <button
              key={option.value}
              type="button"
              onClick={() => onChange(option.value)}
              className={cn(
                "flex min-h-11 cursor-pointer flex-col items-start justify-center rounded-xl px-3 text-left transition",
                selected
                  ? "bg-white text-stone-950 shadow-sm ring-1 ring-stone-200"
                  : "text-stone-500 hover:bg-white/70 hover:text-stone-800",
              )}
            >
              <span className="flex items-center gap-1.5 text-sm font-semibold">
                {selected ? <CheckCircle2 className="size-3.5 text-emerald-600" /> : null}
                {option.label}
              </span>
              <span className="mt-0.5 line-clamp-1 text-[11px] leading-4">{option.hint}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function QuotaGroupSummary({ kinds, item }: { kinds: QuotaMeta[]; item: UserKey }) {
  return (
    <div className="space-y-1">
      {kinds.map((meta) => {
        const unlimited = Boolean(item[meta.unlimitedField]);
        const quota = readNumber(item[meta.quotaField]);
        const used = readNumber(item[meta.usedField]);
        const remaining = unlimited ? null : Math.max(0, quota - used);
        const exhausted = !unlimited && remaining === 0;
        return (
          <div
            key={meta.kind}
            className="flex items-center justify-between gap-2 font-data text-[11.5px] text-stone-600"
          >
            <span className="inline-flex w-7 shrink-0 items-center justify-center rounded bg-stone-100 px-1 py-0.5 text-[10px] font-semibold tracking-wide text-stone-500">
              {meta.shortLabel}
            </span>
            {unlimited ? (
              <span className="ml-auto inline-flex items-center gap-1.5 tabular-nums">
                <span className="text-stone-700">Used {used}</span>
                <span className="inline-flex items-center gap-1 rounded-md bg-violet-50 px-1.5 py-0.5 text-[11px] font-medium text-violet-700">
                  <InfinityIcon className="size-3" />
                  Unlimited
                </span>
              </span>
            ) : exhausted ? (
              <span className="ml-auto rounded-md bg-rose-50 px-1.5 py-0.5 text-[11px] font-medium text-rose-700">
                Exhausted
              </span>
            ) : (
              <span className="ml-auto tabular-nums">
                <span className="text-stone-700">
                  {used}/{quota}
                </span>
                <span className="ml-1 text-stone-400">Left {remaining}</span>
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}

function QuotaGroupCreate({
  title,
  groupHint,
  kinds,
  form,
  onChange,
}: {
  title: string;
  groupHint: string;
  kinds: QuotaMeta[];
  form: CreateFormState;
  onChange: (kind: QuotaKind, patch: Partial<CreateFormState[QuotaKind]>) => void;
}) {
  const GroupIcon = kinds.some((meta) => meta.kind.startsWith("image")) ? ImageIcon : MessageSquare;

  return (
    <section className="overflow-hidden rounded-[20px] border border-stone-200 bg-white">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-stone-200/80 bg-stone-50/70 px-4 py-3">
        <div className="flex items-center gap-2.5">
          <span className="grid size-9 place-items-center rounded-xl border border-stone-200 bg-white text-stone-700">
            <GroupIcon className="size-4" />
          </span>
          <div>
            <div className="text-sm font-semibold text-stone-900">{title}</div>
            <div className="text-xs leading-5 text-stone-500">{groupHint}</div>
          </div>
        </div>
      </div>
      <div className="divide-y divide-stone-100">
        {kinds.map((meta) => {
          const Icon = meta.icon;
          const conf = form[meta.kind];
          return (
            <div
              key={meta.kind}
              className="grid gap-3 px-4 py-3.5 sm:grid-cols-[minmax(210px,1fr)_minmax(150px,200px)_132px] sm:items-center"
            >
              <div className="flex min-w-0 items-start gap-3">
                <span className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-xl bg-stone-100 text-stone-600">
                  <Icon className="size-4" />
                </span>
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-stone-900">{meta.label}</div>
                  <div className="mt-0.5 text-xs leading-5 text-stone-500">{meta.hint}</div>
                </div>
              </div>
              <Input
                type="number"
                min={0}
                value={conf.quota}
                onChange={(event) => onChange(meta.kind, { quota: event.target.value })}
                disabled={conf.unlimited}
                placeholder="e.g. 100"
                className="h-11 rounded-xl border-stone-200 bg-stone-50/60 font-data tabular-nums shadow-none disabled:bg-stone-100"
              />
              <label
                className={cn(
                  "flex h-11 cursor-pointer items-center justify-between gap-2 rounded-xl border px-3 text-xs font-medium transition",
                  conf.unlimited
                    ? "border-stone-900 bg-stone-900 text-white"
                    : "border-stone-200 bg-stone-50 text-stone-600 hover:bg-stone-100",
                )}
              >
                <Checkbox
                  checked={conf.unlimited}
                  onCheckedChange={(checked) => onChange(meta.kind, { unlimited: Boolean(checked) })}
                  className={cn(conf.unlimited ? "border-white bg-white text-stone-900" : "bg-white")}
                />
                <span>Unlimited</span>
                {conf.unlimited ? <InfinityIcon className="size-3.5" /> : null}
              </label>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function QuotaGroupEdit({
  title,
  groupHint,
  kinds,
  item,
  form,
  onChange,
}: {
  title: string;
  groupHint: string;
  kinds: QuotaMeta[];
  item: UserKey;
  form: EditFormState;
  onChange: (kind: QuotaKind, patch: Partial<EditFormState[QuotaKind]>) => void;
}) {
  const GroupIcon = kinds.some((meta) => meta.kind.startsWith("image")) ? ImageIcon : MessageSquare;

  return (
    <section className="overflow-hidden rounded-[20px] border border-stone-200 bg-white">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-stone-200/80 bg-stone-50/70 px-4 py-3">
        <div className="flex items-center gap-2.5">
          <span className="grid size-9 place-items-center rounded-xl border border-stone-200 bg-white text-stone-700">
            <GroupIcon className="size-4" />
          </span>
          <div>
            <div className="text-sm font-semibold text-stone-900">{title}</div>
            <div className="text-xs leading-5 text-stone-500">{groupHint}</div>
          </div>
        </div>
      </div>
      <div className="divide-y divide-stone-100">
        {kinds.map((meta) => (
          <EditQuotaCell
            key={meta.kind}
            meta={meta}
            item={item}
            value={form[meta.kind]}
            onChange={(patch) => onChange(meta.kind, patch)}
          />
        ))}
      </div>
    </section>
  );
}

function EditQuotaCell({
  meta,
  item,
  value,
  onChange,
}: {
  meta: QuotaMeta;
  item: UserKey;
  value: EditFormState[QuotaKind];
  onChange: (patch: Partial<EditFormState[QuotaKind]>) => void;
}) {
  const Icon = meta.icon;
  const currentUnlimited = Boolean(item[meta.unlimitedField]);
  const currentQuota = readNumber(item[meta.quotaField]);
  const currentUsed = readNumber(item[meta.usedField]);
  const currentRemaining = currentUnlimited ? null : Math.max(0, currentQuota - currentUsed);
  const inputNum = readNumber(value.quota);
  const previewNext = value.mode === "add" ? currentQuota + inputNum : inputNum;
  const hasPreview = !value.unlimited && value.quota.trim() !== "";

  return (
    <div className="grid gap-3 px-4 py-3.5 md:grid-cols-[minmax(190px,0.72fr)_minmax(0,1.28fr)] md:items-center">
      <div className="flex min-w-0 items-start gap-3">
        <span className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-xl bg-stone-100 text-stone-600">
          <Icon className="size-4" />
        </span>
        <div className="min-w-0">
          <div className="text-sm font-semibold text-stone-900">{meta.label}</div>
          <div className="mt-0.5 font-data text-xs leading-5 tabular-nums text-stone-500">
            {currentUnlimited ? (
              <>Used {currentUsed} · Currently unlimited</>
            ) : (
              <>
                Used {currentUsed} / Current {currentQuota}
                <span className="ml-1 text-stone-400">Left {currentRemaining}</span>
              </>
            )}
          </div>
        </div>
      </div>
      <div className="flex min-w-0 max-w-full flex-wrap items-start justify-start gap-2 md:flex-nowrap md:justify-end">
        {!value.unlimited ? (
          <div className="inline-flex h-10 min-w-[124px] flex-[0_1_136px] rounded-xl border border-stone-200 bg-stone-50 p-1 text-xs">
            <button
              type="button"
              onClick={() => onChange({ mode: "add", quota: "" })}
              className={cn(
                "min-w-14 flex-1 cursor-pointer rounded-lg px-3 transition",
                value.mode === "add"
                  ? "bg-white text-stone-900 shadow-sm"
                  : "text-stone-500 hover:text-stone-700",
              )}
            >
              Add
            </button>
            <button
              type="button"
              onClick={() => onChange({ mode: "set", quota: String(currentQuota) })}
              className={cn(
                "min-w-14 flex-1 cursor-pointer rounded-lg px-3 transition",
                value.mode === "set"
                  ? "bg-white text-stone-900 shadow-sm"
                  : "text-stone-500 hover:text-stone-700",
              )}
            >
              Set
            </button>
          </div>
        ) : null}
        <div className="min-w-[132px] flex-[1_1_170px] space-y-1">
          <Input
            type="number"
            min={0}
            value={value.quota}
            onChange={(event) => onChange({ quota: event.target.value })}
            disabled={value.unlimited}
            placeholder={value.mode === "add" ? "Amount to add" : "New limit"}
            className="h-10 rounded-xl border-stone-200 bg-stone-50/60 font-data tabular-nums shadow-none disabled:bg-stone-100"
          />
          {hasPreview ? (
            <p className="font-data text-[11px] leading-4 tabular-nums text-stone-500">
              After save <span className="font-semibold text-stone-800">{previewNext}</span>
            </p>
          ) : null}
        </div>
        <label
          className={cn(
            "flex h-10 w-[104px] shrink-0 cursor-pointer items-center justify-between gap-2 rounded-xl border px-3 text-xs font-medium whitespace-nowrap transition",
            value.unlimited
              ? "border-stone-900 bg-stone-900 text-white"
              : "border-stone-200 bg-stone-50 text-stone-600 hover:bg-stone-100",
          )}
        >
          <Checkbox
            checked={value.unlimited}
            onCheckedChange={(checked) => onChange({ unlimited: Boolean(checked) })}
            className={cn(value.unlimited ? "border-white bg-white text-stone-900" : "bg-white")}
          />
          <span>Unlimited</span>
          {value.unlimited ? <InfinityIcon className="size-3.5" /> : null}
        </label>
        <button
          type="button"
          onClick={() => onChange({ resetUsed: !value.resetUsed })}
          aria-label={value.resetUsed ? "Reset used quota on save" : "Reset used quota"}
          title={value.resetUsed ? "Reset used quota on save" : "Reset used quota"}
          className={cn(
            "inline-flex size-10 shrink-0 cursor-pointer items-center justify-center rounded-xl border text-xs font-medium transition",
            value.resetUsed
              ? "border-emerald-200 bg-emerald-50 text-emerald-700"
              : "border-stone-200 bg-white text-stone-600 hover:bg-stone-50",
          )}
        >
          <RotateCcw className="size-3.5" />
        </button>
      </div>
    </div>
  );
}
