"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { isCryptoAvailable, onVaultEvent, type VaultData } from "@/lib/vault";

// The CryptoKey stays in a ref, not in React state. State would keep it on the
// alternate fiber after a lock. A full reload remounts this provider and the ref starts empty.
export type OpenVault = { key: CryptoKey; data: VaultData };

type VaultContextValue = {
  vaultRef: RefObject<OpenVault | null>;
  unlocked: boolean;
  unlock: (opened: OpenVault) => void;
  syncData: (data: VaultData) => void;
};

const VaultContext = createContext<VaultContextValue | null>(null);

export function VaultProvider({ children }: { children: ReactNode }) {
  const vaultRef = useRef<OpenVault | null>(null);
  const [unlocked, setUnlocked] = useState(false);

  const unlock = useCallback((opened: OpenVault) => {
    vaultRef.current = opened;
    setUnlocked(true);
  }, []);

  const syncData = useCallback((data: VaultData) => {
    if (vaultRef.current) vaultRef.current.data = data;
  }, []);

  useEffect(() => {
    if (!isCryptoAvailable()) return;
    return onVaultEvent((event) => {
      if (event === "changed") return;
      vaultRef.current = null;
      setUnlocked(false);
    });
  }, []);

  return (
    <VaultContext.Provider value={{ vaultRef, unlocked, unlock, syncData }}>{children}</VaultContext.Provider>
  );
}

export function useVault() {
  const value = useContext(VaultContext);
  if (!value) throw new Error("vault provider missing");
  return value;
}
