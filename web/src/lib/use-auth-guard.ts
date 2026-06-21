"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import {
  getCachedAuthSession,
  getValidatedAuthSession,
  hasValidatedAuthSession,
} from "@/lib/auth-session";
import {
  getDefaultRouteForRole,
  type AuthRole,
  type StoredAuthSession,
} from "@/store/auth";

type UseAuthGuardResult = {
  isCheckingAuth: boolean;
  session: StoredAuthSession | null;
};

export function useAuthGuard(allowedRoles?: AuthRole[]): UseAuthGuardResult {
  const router = useRouter();
  // On first visit with no cache → show spinner; on subsequent route changes that hit cache,
  // synchronously provide session with isCheckingAuth=false, avoiding a loading flash on every page.
  const initialCached = hasValidatedAuthSession() ? getCachedAuthSession() : null;
  const initialChecking = !hasValidatedAuthSession();
  const [session, setSession] = useState<StoredAuthSession | null>(initialCached);
  const [isCheckingAuth, setIsCheckingAuth] = useState(initialChecking);
  const allowedRolesKey = (allowedRoles || []).join(",");

  useEffect(() => {
    let active = true;
    const roleList = allowedRolesKey ? (allowedRolesKey.split(",") as AuthRole[]) : [];

    // On cache hit, synchronously handle redirect/role check without touching isCheckingAuth.
    if (hasValidatedAuthSession()) {
      const cached = getCachedAuthSession();
      if (!cached) {
        router.replace("/login");
      } else if (roleList.length > 0 && !roleList.includes(cached.role)) {
        router.replace(getDefaultRouteForRole(cached.role));
      }
    }

    // Regardless of cache hit, silently re-validate in the background:
    //  - First visit: dismiss spinner and write to state once result arrives;
    //  - Subsequent navigations: only update state if result changed, no spinner flash.
    const load = async () => {
      const storedSession = await getValidatedAuthSession();
      if (!active) return;

      if (!storedSession) {
        setSession(null);
        setIsCheckingAuth(false);
        router.replace("/login");
        return;
      }

      if (roleList.length > 0 && !roleList.includes(storedSession.role)) {
        setSession(storedSession);
        setIsCheckingAuth(false);
        router.replace(getDefaultRouteForRole(storedSession.role));
        return;
      }

      setSession(storedSession);
      setIsCheckingAuth(false);
    };

    void load();
    return () => {
      active = false;
    };
  }, [allowedRolesKey, router]);

  return { isCheckingAuth, session };
}

export function useRedirectIfAuthenticated() {
  const router = useRouter();
  const [isCheckingAuth, setIsCheckingAuth] = useState(!hasValidatedAuthSession());

  useEffect(() => {
    let active = true;

    // Cache hit: if already logged in, redirect immediately.
    if (hasValidatedAuthSession()) {
      const cached = getCachedAuthSession();
      if (cached) {
        router.replace(getDefaultRouteForRole(cached.role));
      }
    }

    const load = async () => {
      const storedSession = await getValidatedAuthSession();
      if (!active) return;

      if (storedSession) {
        router.replace(getDefaultRouteForRole(storedSession.role));
        return;
      }

      setIsCheckingAuth(false);
    };

    void load();
    return () => {
      active = false;
    };
  }, [router]);

  return { isCheckingAuth };
}
