"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Github } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";

import { clearAuthSessionCache, getValidatedAuthSession } from "@/lib/auth-session";
import { cn } from "@/lib/utils";
import { clearStoredAuthSession, type StoredAuthSession } from "@/store/auth";
import { QuotaPopover } from "@/components/quota-popover";

const adminNavItems = [
  { href: "/chat", label: "Chat" },
  { href: "/image", label: "Image" },
  { href: "/gallery", label: "Gallery" },
  { href: "/accounts", label: "Accounts" },
  { href: "/register", label: "Register" },
  { href: "/image-manager", label: "Image Manager" },
  { href: "/logs", label: "Logs" },
  { href: "/settings", label: "Settings" },
  { href: "/keys", label: "User Keys" },
];

const userNavItems = [
  { href: "/chat", label: "Chat" },
  { href: "/image", label: "Image" },
  { href: "/works", label: "My Works" },
  { href: "/gallery", label: "Gallery" },
];

// next.config.ts has trailingSlash: true, so usePathname returns "/image/",
// but nav item href is "/image". Strip trailing slash before comparing.
function normalizePath(value: string) {
  if (!value) return "/";
  const trimmed = value.replace(/\/+$/, "");
  return trimmed || "/";
}

type Rect = { left: number; width: number };

export function TopNav() {
  const pathname = usePathname();
  const router = useRouter();
  const [session, setSession] = useState<StoredAuthSession | null | undefined>(undefined);

  useEffect(() => {
    let active = true;

    const load = async () => {
      if (pathname === "/login") {
        if (!active) {
          return;
        }
        setSession(null);
        return;
      }

      const storedSession = await getValidatedAuthSession();
      if (!active) {
        return;
      }
      setSession(storedSession);
    };

    void load();
    return () => {
      active = false;
    };
  }, [pathname]);

  const handleLogout = async () => {
    await clearStoredAuthSession();
    clearAuthSessionCache();
    router.replace("/login");
  };

  // A sliding underline indicator: positioned under the active nav item by default,
  // slides to whichever item is hovered, returns to active on mouse leave.
  // Same pattern as Vercel / Linear / Apple.
  const navRef = useRef<HTMLElement | null>(null);
  const itemRefs = useRef<Map<string, HTMLAnchorElement | null>>(new Map());
  const [activeRect, setActiveRect] = useState<Rect | null>(null);
  const [hoverRect, setHoverRect] = useState<Rect | null>(null);
  // Don't transition until initial position is measured, to avoid the underline "flying" in from (0,0).
  const hasInitialPositionRef = useRef(false);
  const [enableTransition, setEnableTransition] = useState(false);

  const measure = (href: string): Rect | null => {
    const anchor = itemRefs.current.get(href);
    const nav = navRef.current;
    if (!anchor || !nav) return null;
    const navRect = nav.getBoundingClientRect();
    const rect = anchor.getBoundingClientRect();
    return {
      left: rect.left - navRect.left,
      width: rect.width,
    };
  };

  useEffect(() => {
    if (!session) {
      setActiveRect(null);
      hasInitialPositionRef.current = false;
      setEnableTransition(false);
      return;
    }
    const items = session.role === "admin" ? adminNavItems : userNavItems;
    const activeItem = items.find(
      (item) => normalizePath(item.href) === normalizePath(pathname || "/"),
    );
    if (!activeItem) {
      setActiveRect(null);
      return;
    }
    let raf = 0;
    const update = () => {
      const r = measure(activeItem.href);
      if (!r) return;
      setActiveRect(r);
      // After initial positioning is done, enable transition on the next frame,
      // so the initial snap is instant without a sliding ghost from 0.
      if (!hasInitialPositionRef.current) {
        hasInitialPositionRef.current = true;
        requestAnimationFrame(() => setEnableTransition(true));
      }
    };
    raf = requestAnimationFrame(update);
    window.addEventListener("resize", update);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", update);
    };
  }, [pathname, session]);

  if (pathname === "/login" || session === undefined || !session) {
    return null;
  }

  const navItems = session.role === "admin" ? adminNavItems : userNavItems;
  // When there's only one tab (e.g. regular user can only access image), skip rendering the nav bar.
  // A single "Image" tab in the middle looks like a placeholder; the logo already links to /image.
  const showNav = navItems.length > 1;
  const roleLabel = session.role === "admin" ? "Admin" : "User";
  const displayName = session.name.trim() || roleLabel;

  // Final indicator position: follows hover when hovering, otherwise follows active.
  // Inset 8px padding on each side to make the line slightly shorter than the text for refinement.
  const target = hoverRect ?? activeRect;
  const showIndicator = !!target;
  const indicatorLeft = target ? target.left + 8 : 0;
  const indicatorWidth = target ? Math.max(0, target.width - 16) : 0;

  return (
    <header className="fixed top-0 right-0 left-0 z-40 bg-background/25 backdrop-blur-[28px] backdrop-saturate-150">
      <div className="mx-auto flex h-12 max-w-[1440px] items-center gap-3 px-4 sm:h-14 sm:gap-4 sm:px-6 lg:px-8">
        <div className="flex shrink-0 items-center gap-2 sm:gap-3">
          <Link href="/chat" className="group flex shrink-0 -translate-y-[1px] items-center py-1">
            <span className="text-[20px] font-bold leading-none tracking-[-0.025em] text-foreground">
              Chat
            </span>
            <span className="text-[20px] font-extrabold leading-none tracking-[-0.025em] text-foreground">
              GPT
            </span>
            <span className="ml-[2px] font-data text-[13px] font-semibold leading-none text-muted-foreground/70">
              2
            </span>
            <span className="ml-[2px] font-data text-[16px] font-bold leading-none tracking-[0.02em] text-foreground/85">
              API
            </span>
          </Link>
          <span className="hidden h-5 w-px bg-border lg:block" />
          <a
            href="https://github.com/RemotePinee/ChatGPT2API"
            target="_blank"
            rel="noreferrer"
            className="hidden cursor-pointer items-center gap-1.5 rounded-md px-2 py-1 text-[13px] leading-none text-muted-foreground transition hover:bg-secondary hover:text-foreground lg:inline-flex"
            aria-label="GitHub repository"
          >
            <Github className="size-[15px] shrink-0" strokeWidth={2} />
            <span className="translate-y-[1px]">GitHub</span>
          </a>
        </div>
        {showNav ? (
        <nav
          ref={navRef}
          className="hide-scrollbar relative -mx-1 flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto px-1 sm:justify-center sm:gap-0.5 sm:overflow-visible sm:px-0"
          onMouseLeave={() => setHoverRect(null)}
        >
          {navItems.map((item) => {
            const active = normalizePath(item.href) === normalizePath(pathname || "/");
            return (
              <Link
                key={item.href}
                ref={(el) => {
                  if (el) itemRefs.current.set(item.href, el);
                  else itemRefs.current.delete(item.href);
                }}
                href={item.href}
                onMouseEnter={() => {
                  const r = measure(item.href);
                  if (r) setHoverRect(r);
                }}
                className={cn(
                  "relative shrink-0 cursor-pointer whitespace-nowrap px-3 py-1.5 text-[13px] font-medium leading-none transition-colors duration-200",
                  active ? "text-foreground" : "text-muted-foreground hover:text-foreground",
                )}
              >
                {item.label}
              </Link>
            );
          })}
          {/* Sliding underline indicator: translates with hover/active.
              Uses transform + width for GPU compositing instead of left;
              cubic-bezier(0.32, 0.72, 0, 1) is Apple's "heavy ease-out" curve,
              feels smoother than linear ease-out, like being magnetically pulled. */}
          <span
            aria-hidden
            className="pointer-events-none absolute h-[2px] rounded-full bg-foreground"
            style={{
              left: 0,
              bottom: -9,
              width: indicatorWidth,
              transform: `translateX(${indicatorLeft}px)`,
              opacity: showIndicator ? 1 : 0,
              transition: enableTransition
                ? "transform 380ms cubic-bezier(0.32, 0.72, 0, 1), width 380ms cubic-bezier(0.32, 0.72, 0, 1), opacity 200ms ease-out"
                : "opacity 200ms ease-out",
              willChange: "transform, width",
            }}
          />
        </nav>
        ) : (
          <div className="min-w-0 flex-1" aria-hidden />
        )}
        <div className="flex shrink-0 items-center justify-end gap-2">
          <span className="hidden items-center gap-1.5 rounded-md border border-border/70 bg-card px-2 py-1 text-[11px] leading-none text-muted-foreground lg:inline-flex">
            <span className="relative flex size-1.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60" />
              <span className="relative inline-flex size-1.5 rounded-full bg-emerald-500" />
            </span>
            <span className="font-data text-[10.5px] font-bold uppercase tracking-wider">Online</span>
          </span>
          <span className="hidden items-center gap-1.5 rounded-md border border-border/70 bg-card px-2 py-1 text-[11px] leading-none md:inline-flex">
            <span className="grid size-4 place-items-center rounded-[4px] bg-foreground text-[8px] font-bold text-background">
              {(displayName[0] || roleLabel[0] || "U").toUpperCase()}
            </span>
            <span className="hidden font-data font-bold text-foreground lg:inline">{displayName}</span>
            {displayName !== roleLabel ? (
              <>
                <span className="hidden text-muted-foreground/70 lg:inline">·</span>
                <span className="hidden font-bold text-muted-foreground lg:inline">{roleLabel}</span>
              </>
            ) : null}
            <QuotaPopover />
          </span>
          <button
            type="button"
            className="cursor-pointer rounded-md border border-transparent px-2 py-1 text-[13px] font-bold leading-none text-muted-foreground transition hover:border-border/70 hover:bg-card hover:text-foreground"
            onClick={() => void handleLogout()}
          >
            Logout
          </button>
        </div>
      </div>
    </header>
  );
}
