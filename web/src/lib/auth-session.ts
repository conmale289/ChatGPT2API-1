"use client";

import { login } from "@/lib/api";
import {
  clearStoredAuthSession,
  getStoredAuthSession,
  setStoredAuthSession,
  type StoredAuthSession,
} from "@/store/auth";

/**
 * Module-level session cache.
 *
 * Why needed: every page protected by useAuthGuard calls getValidatedAuthSession() on mount,
 * which fires a login() network request. Until validation returns, useAuthGuard holds
 * isCheckingAuth=true and the page shows a spinner — resulting in a flash of loading indicator
 * on every route change before real content appears.
 *
 * Cache strategy:
 *  - getCachedAuthSession() synchronously returns the last validated result (cache hit skips spinner).
 *  - getValidatedAuthSession() still does a network re-validation and refreshes the cache.
 *  - login / logout / 401 interceptor proactively clears the cache.
 */
let cachedSession: StoredAuthSession | null = null;
let hasValidatedOnce = false;
let validatedAt = 0;
let pendingValidation: Promise<StoredAuthSession | null> | null = null;

const AUTH_VALIDATION_TTL_MS = 30_000;

export function getCachedAuthSession(): StoredAuthSession | null {
  return cachedSession;
}

export function hasValidatedAuthSession(): boolean {
  return hasValidatedOnce;
}

export function primeAuthSessionCache(session: StoredAuthSession | null) {
  cachedSession = session;
  hasValidatedOnce = true;
  validatedAt = Date.now();
}

export function clearAuthSessionCache() {
  cachedSession = null;
  hasValidatedOnce = false;
  validatedAt = 0;
  pendingValidation = null;
}

export async function getValidatedAuthSession(): Promise<StoredAuthSession | null> {
  if (hasValidatedOnce && Date.now() - validatedAt < AUTH_VALIDATION_TTL_MS) {
    return cachedSession;
  }
  if (pendingValidation) {
    return pendingValidation;
  }

  pendingValidation = validateAuthSession();
  try {
    return await pendingValidation;
  } finally {
    pendingValidation = null;
  }
}

async function validateAuthSession(): Promise<StoredAuthSession | null> {
  const storedSession = await getStoredAuthSession();
  if (!storedSession) {
    primeAuthSessionCache(null);
    return null;
  }

  try {
    const data = await login(storedSession.key);
    const nextSession: StoredAuthSession = {
      key: storedSession.key,
      role: data.role,
      subjectId: data.subject_id,
      name: data.name,
    };
    await setStoredAuthSession(nextSession);
    primeAuthSessionCache(nextSession);
    return nextSession;
  } catch {
    await clearStoredAuthSession();
    primeAuthSessionCache(null);
    return null;
  }
}
