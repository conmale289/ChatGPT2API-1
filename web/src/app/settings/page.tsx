"use client";

import { useEffect, useRef } from "react";
import { LoaderCircle } from "lucide-react";

import { useAuthGuard } from "@/lib/use-auth-guard";

import { BackupSettingsCard } from "./components/backup-settings-card";
import { CPAPoolDialog } from "./components/cpa-pool-dialog";
import { CPAPoolsCard } from "./components/cpa-pools-card";
import { FloatingSaveBar } from "./components/floating-save-bar";
import { ImportBrowserDialog } from "./components/import-browser-dialog";
import { Section } from "./components/section";
import { SettingsHeader } from "./components/settings-header";
import { SettingsTOC, type TOCItem } from "./components/settings-toc";
import {
  AccountSection,
  AIReviewSection,
  ImageSection,
  LogSection,
  NetworkSection,
  SecuritySection,
} from "./components/settings-sections";
import { Sub2APIConnections } from "./components/sub2api-connections";
import { useSettingsStore } from "./store";

/**
 * TOC order = page section order, no need for duplicate maintenance:
 *   - The main content area maps this list to render <Section>
 *   - The right TOC also uses this list
 */
const SECTIONS: Array<TOCItem & { description: string }> = [
  { id: "account", label: "Account & Identity", description: "Account refresh strategy and auto-maintenance toggles. For user key distribution, go to the \"User Keys\" page." },
  { id: "network", label: "Network", description: "Global proxy: affects both image generation requests and OpenAI upstream forwarding." },
  { id: "images", label: "Images", description: "Access URL, generation timeout, concurrency limit, expiry cleanup, and protection policies." },
  { id: "security", label: "Content Safety", description: "Sensitive words and global system prompt — review requests before they reach image generation accounts." },
  { id: "ai-review", label: "AI Review", description: "Use an independent model to evaluate user prompts for compliance; reject on match." },
  { id: "logs", label: "Logs", description: "Console output level. Enable debug only when troubleshooting." },
  { id: "backup", label: "Backup", description: "Cloudflare R2 auto-backup configuration, manual backup, and backup history." },
  { id: "cpa", label: "CPA Pool", description: "External CPA integration with selective remote account import to local pool." },
  { id: "sub2api", label: "sub2api", description: "Chain existing OpenAI-compatible services as sub2api multi-node upstreams." },
];

function SettingsDataController() {
  const didLoadRef = useRef(false);
  const initialize = useSettingsStore((state) => state.initialize);
  const loadPools = useSettingsStore((state) => state.loadPools);
  const loadBackups = useSettingsStore((state) => state.loadBackups);
  const pools = useSettingsStore((state) => state.pools);
  const backupState = useSettingsStore((state) => state.backupState);

  useEffect(() => {
    if (didLoadRef.current) return;
    didLoadRef.current = true;
    void initialize();
  }, [initialize]);

  useEffect(() => {
    const hasRunningJobs = pools.some((pool) => {
      const status = pool.import_job?.status;
      return status === "pending" || status === "running";
    });
    if (!hasRunningJobs) return;
    const timer = window.setInterval(() => {
      void loadPools(true);
    }, 1500);
    return () => window.clearInterval(timer);
  }, [loadPools, pools]);

  useEffect(() => {
    if (!backupState?.running) return;
    const timer = window.setInterval(() => {
      void loadBackups(true);
    }, 3000);
    return () => window.clearInterval(timer);
  }, [backupState?.running, loadBackups]);

  return null;
}

/**
 * Section content router: renders the corresponding component based on id.
 * The mapping is here instead of in the SECTIONS array because sections data
 * needs to be serializable for the TOC and cannot contain React components.
 */
function SectionBody({ id }: { id: string }) {
  switch (id) {
    case "account":
      return <AccountSection />;
    case "network":
      return <NetworkSection />;
    case "images":
      return <ImageSection />;
    case "security":
      return <SecuritySection />;
    case "ai-review":
      return <AIReviewSection />;
    case "logs":
      return <LogSection />;
    case "backup":
      return <BackupSettingsCard />;
    case "cpa":
      return <CPAPoolsCard />;
    case "sub2api":
      return <Sub2APIConnections />;
    default:
      return null;
  }
}

function SettingsPageContent() {
  const tocItems: TOCItem[] = SECTIONS.map(({ id, label }) => ({ id, label }));
  return (
    <>
      <SettingsDataController />
      <SettingsHeader />

      {/* Left main content + right anchor TOC: lg+ uses grid two-column layout, mobile TOC is hidden via its own hidden lg:block.
          gap-12: provides enough breathing room between main content and TOC.
          pb-24: reserves space for the bottom FloatingSaveBar so it doesn't cover the last section's inputs. */}
      <div className="mt-8 flex gap-12 pb-24">
        <main className="min-w-0 flex-1 space-y-12">
          {SECTIONS.map(({ id, label, description }) => (
            <Section key={id} id={id} title={label} description={description}>
              <SectionBody id={id} />
            </Section>
          ))}
        </main>
        <SettingsTOC items={tocItems} />
      </div>

      <CPAPoolDialog />
      <ImportBrowserDialog />
      <FloatingSaveBar />
    </>
  );
}

export default function SettingsPage() {
  const { isCheckingAuth, session } = useAuthGuard(["admin"]);

  if (isCheckingAuth || !session || session.role !== "admin") {
    return (
      <div className="flex min-h-[40vh] items-center justify-center">
        <LoaderCircle className="size-5 animate-spin text-stone-400" />
      </div>
    );
  }

  return <SettingsPageContent />;
}
