"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  type ConsentPreferences,
  DEFAULT_PREFERENCES,
  ACCEPT_ALL,
  REJECT_ALL,
  loadPreferences,
  savePreferences,
  shouldAutoReject,
} from "./helpers";

interface ConsentContextValue {
  preferences: ConsentPreferences;
  bannerVisible: boolean;
  modalVisible: boolean;
  acceptAll: () => void;
  rejectAll: () => void;
  saveCustom: (prefs: ConsentPreferences) => void;
  openBanner: () => void;
  openModal: () => void;
  closeModal: () => void;
}

const ConsentContext = createContext<ConsentContextValue | null>(null);

export function ConsentProvider({ children }: { children: ReactNode }) {
  const [preferences, setPreferences] = useState<ConsentPreferences>(DEFAULT_PREFERENCES);
  const [bannerVisible, setBannerVisible] = useState(false);
  const [modalVisible, setModalVisible] = useState(false);
  const [initialised, setInitialised] = useState(false);

  useEffect(() => {
    const stored = loadPreferences();
    if (stored) {
      setPreferences(stored);
      setBannerVisible(false);
    } else if (shouldAutoReject()) {
      const rejected = REJECT_ALL;
      setPreferences(rejected);
      savePreferences(rejected);
      setBannerVisible(false);
    } else {
      setBannerVisible(true);
    }
    setInitialised(true);
  }, []);

  const applyAndSave = useCallback((prefs: ConsentPreferences) => {
    setPreferences(prefs);
    savePreferences(prefs);
    setBannerVisible(false);
    setModalVisible(false);
  }, []);

  const acceptAll = useCallback(() => applyAndSave(ACCEPT_ALL), [applyAndSave]);
  const rejectAll = useCallback(() => applyAndSave(REJECT_ALL), [applyAndSave]);
  const saveCustom = useCallback((prefs: ConsentPreferences) => applyAndSave(prefs), [applyAndSave]);

  const openBanner = useCallback(() => setBannerVisible(true), []);
  const openModal = useCallback(() => { setBannerVisible(false); setModalVisible(true); }, []);
  const closeModal = useCallback(() => setModalVisible(false), []);

  const value = useMemo<ConsentContextValue>(
    () => ({ preferences, bannerVisible, modalVisible, acceptAll, rejectAll, saveCustom, openBanner, openModal, closeModal }),
    [preferences, bannerVisible, modalVisible, acceptAll, rejectAll, saveCustom, openBanner, openModal, closeModal]
  );

  // Suppress hydration flash by not rendering children until client initialised
  if (!initialised) return <>{children}</>;

  return (
    <ConsentContext.Provider value={value}>
      {children}
    </ConsentContext.Provider>
  );
}

const NOOP = () => {};
const DEFAULT_CONTEXT: ConsentContextValue = {
  preferences: DEFAULT_PREFERENCES,
  bannerVisible: false,
  modalVisible: false,
  acceptAll: NOOP,
  rejectAll: NOOP,
  saveCustom: NOOP,
  openBanner: NOOP,
  openModal: NOOP,
  closeModal: NOOP,
};

export function useConsent(): ConsentContextValue {
  const ctx = useContext(ConsentContext);
  return ctx ?? DEFAULT_CONTEXT;
}
