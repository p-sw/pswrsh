"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { isCryptoAvailable, onVaultEvent, restoreVault, type VaultData } from "@/lib/vault";

export type HostDraft = {
  id: string | null;
  name: string;
  hostname: string;
  port: string;
  username: string;
  authType: "password" | "key" | "interactive";
  password: string;
  keyId: string;
  /** Open the host form again when the shell mounts. */
  resume: boolean;
  /** The keys page should return a chosen key to the host form. */
  picking: boolean;
};

// The CryptoKey stays in a ref, not in React state. State would keep it on the
// alternate fiber after a logout or a wipe drops it. A full reload remounts this provider:
// the ref starts empty and restoreVault fills it from the key this browser saved.
// There is no lock button; the key is dropped only by logout, wipe, or a key that no
// longer opens the account's vault (see restoreVault).
export type OpenVault = { key: CryptoKey; data: VaultData };

export type PendingAttach = { id: string; label: string; hostId: string };

/** A fresh object per request, so a consumer can tell a repeat request from a re-run effect. */
export type PendingOpen = { hostId: string };

type VaultContextValue = {
  vaultRef: RefObject<OpenVault | null>;
  unlocked: boolean;
  /** True until the saved key has been tried. Pages wait for it before asking for the passphrase. */
  restoring: boolean;
  data: VaultData | null;
  unlock: (opened: OpenVault) => void;
  syncData: (data: VaultData) => void;
  draft: HostDraft | null;
  setDraft: (draft: HostDraft | null) => void;
  pendingAttach: PendingAttach | null;
  requestAttach: (id: string, label: string, hostId: string) => void;
  clearAttach: () => void;
  /** Host the connection list asked to open as a new connection. */
  pendingOpen: PendingOpen | null;
  requestOpen: (hostId: string) => void;
  clearOpen: () => void;
};

const VaultContext = createContext<VaultContextValue | null>(null);

export function VaultProvider({ children }: { children: ReactNode }) {
  const vaultRef = useRef<OpenVault | null>(null);
  const [unlocked, setUnlocked] = useState(false);
  const [restoring, setRestoring] = useState(true);
  const [data, setData] = useState<VaultData | null>(null);
  const [draft, setDraft] = useState<HostDraft | null>(null);
  const [pendingAttach, setPendingAttach] = useState<PendingAttach | null>(null);
  const [pendingOpen, setPendingOpen] = useState<PendingOpen | null>(null);

  const unlock = useCallback((opened: OpenVault) => {
    vaultRef.current = opened;
    setData(opened.data);
    setUnlocked(true);
  }, []);

  const syncData = useCallback((next: VaultData) => {
    if (vaultRef.current) vaultRef.current.data = next;
    setData(next);
  }, []);

  const requestAttach = useCallback((id: string, label: string, hostId: string) => {
    setPendingAttach({ id, label, hostId });
  }, []);

  const clearAttach = useCallback(() => setPendingAttach(null), []);

  const requestOpen = useCallback((hostId: string) => setPendingOpen({ hostId }), []);

  const clearOpen = useCallback(() => setPendingOpen(null), []);

  useEffect(() => {
    if (!isCryptoAvailable()) {
      setRestoring(false);
      return;
    }
    let cancelled = false;
    restoreVault()
      .then((opened) => {
        if (!cancelled && opened && !vaultRef.current) unlock(opened);
      })
      .catch(() => undefined)
      .finally(() => {
        if (!cancelled) setRestoring(false);
      });
    return () => {
      cancelled = true;
    };
  }, [unlock]);

  useEffect(() => {
    if (!isCryptoAvailable()) return;
    return onVaultEvent((event) => {
      if (event === "changed") return;
      vaultRef.current = null;
      setData(null);
      setUnlocked(false);
      setDraft(null);
      setPendingAttach(null);
      setPendingOpen(null);
    });
  }, []);

  return (
    <VaultContext.Provider
      value={{
        vaultRef,
        unlocked,
        restoring,
        data,
        unlock,
        syncData,
        draft,
        setDraft,
        pendingAttach,
        requestAttach,
        clearAttach,
        pendingOpen,
        requestOpen,
        clearOpen,
      }}
    >
      {children}
    </VaultContext.Provider>
  );
}

export function useVault() {
  const value = useContext(VaultContext);
  if (!value) throw new Error("vault provider missing");
  return value;
}
