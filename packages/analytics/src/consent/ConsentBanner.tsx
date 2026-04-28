"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useConsent } from "./ConsentProvider";
import type { ConsentPreferences } from "./helpers";

/** Focus-trap utility: cycles focus within a container. */
function useFocusTrap(ref: React.RefObject<HTMLElement | null>, active: boolean) {
  useEffect(() => {
    if (!active || !ref.current) return;
    const el = ref.current;
    const focusable = el.querySelectorAll<HTMLElement>(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
    );
    const first = focusable[0];
    const last = focusable[focusable.length - 1];

    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== "Tab") return;
      if (e.shiftKey) {
        if (document.activeElement === first) { e.preventDefault(); last?.focus(); }
      } else {
        if (document.activeElement === last) { e.preventDefault(); first?.focus(); }
      }
    }

    el.addEventListener("keydown", onKeyDown);
    first?.focus();
    return () => el.removeEventListener("keydown", onKeyDown);
  }, [active, ref]);
}

function CustomiseModal({
  onSave,
  onClose,
  initial,
}: {
  onSave: (p: ConsentPreferences) => void;
  onClose: () => void;
  initial: ConsentPreferences;
}) {
  const modalRef = useRef<HTMLDivElement>(null);
  useFocusTrap(modalRef, true);

  const [analytics, setAnalytics] = useState(initial.analytics === "granted");
  const [marketing, setMarketing] = useState(initial.marketing === "granted");
  const [functional, setFunctional] = useState(initial.functional === "granted");

  // Close on Escape
  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === "Escape") onClose(); }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  function save() {
    onSave({
      analytics: analytics ? "granted" : "denied",
      marketing: marketing ? "granted" : "denied",
      functional: functional ? "granted" : "denied",
    });
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Cookie preferences"
      className="fixed inset-0 z-[100] flex items-center justify-center p-4"
      style={{ background: "rgba(0,0,0,0.7)" }}
    >
      <div
        ref={modalRef}
        className="consent-modal"
        style={{
          background: "var(--consent-bg, #1a1a1a)",
          color: "var(--consent-text, #f0ede6)",
          border: "1px solid var(--consent-border, rgba(201,169,97,0.3))",
          borderRadius: "12px",
          padding: "24px",
          maxWidth: "480px",
          width: "100%",
          maxHeight: "90vh",
          overflowY: "auto",
        }}
      >
        <h2
          style={{ fontFamily: "serif", fontSize: "1.25rem", marginBottom: "16px", color: "var(--consent-accent, #c9a961)" }}
        >
          Cookie Preferences
        </h2>

        <p style={{ fontSize: "0.875rem", opacity: 0.8, marginBottom: "20px", lineHeight: 1.6 }}>
          We use cookies to improve your experience. You can manage your preferences below.
          Essential cookies are always active and cannot be disabled.
        </p>

        <div style={{ display: "flex", flexDirection: "column", gap: "16px", marginBottom: "24px" }}>
          {/* Essential — always on */}
          <label
            style={{ display: "flex", alignItems: "flex-start", gap: "12px", cursor: "not-allowed", opacity: 0.7 }}
          >
            <input type="checkbox" checked disabled aria-label="Essential cookies — always active" style={{ marginTop: "3px" }} />
            <div>
              <div style={{ fontWeight: 600, fontSize: "0.9rem" }}>Essential</div>
              <div style={{ fontSize: "0.8rem", opacity: 0.8 }}>Required for the site to function. Cannot be disabled.</div>
            </div>
          </label>

          {/* Functional */}
          <label style={{ display: "flex", alignItems: "flex-start", gap: "12px", cursor: "pointer" }}>
            <input
              type="checkbox"
              checked={functional}
              onChange={e => setFunctional(e.target.checked)}
              aria-label="Functional cookies"
              style={{ marginTop: "3px" }}
            />
            <div>
              <div style={{ fontWeight: 600, fontSize: "0.9rem" }}>Functional</div>
              <div style={{ fontSize: "0.8rem", opacity: 0.8 }}>Remember your preferences and settings.</div>
            </div>
          </label>

          {/* Analytics */}
          <label style={{ display: "flex", alignItems: "flex-start", gap: "12px", cursor: "pointer" }}>
            <input
              type="checkbox"
              checked={analytics}
              onChange={e => setAnalytics(e.target.checked)}
              aria-label="Analytics cookies"
              style={{ marginTop: "3px" }}
            />
            <div>
              <div style={{ fontWeight: 600, fontSize: "0.9rem" }}>Analytics</div>
              <div style={{ fontSize: "0.8rem", opacity: 0.8 }}>Help us understand how you use the site (Google Analytics 4).</div>
            </div>
          </label>

          {/* Marketing */}
          <label style={{ display: "flex", alignItems: "flex-start", gap: "12px", cursor: "pointer" }}>
            <input
              type="checkbox"
              checked={marketing}
              onChange={e => setMarketing(e.target.checked)}
              aria-label="Marketing cookies"
              style={{ marginTop: "3px" }}
            />
            <div>
              <div style={{ fontWeight: 600, fontSize: "0.9rem" }}>Marketing</div>
              <div style={{ fontSize: "0.8rem", opacity: 0.8 }}>Personalised content and ads (currently not in use).</div>
            </div>
          </label>
        </div>

        <div style={{ display: "flex", flexWrap: "wrap", gap: "12px", justifyContent: "flex-end" }}>
          <button
            onClick={onClose}
            style={{
              padding: "8px 16px",
              borderRadius: "6px",
              border: "1px solid var(--consent-border, rgba(201,169,97,0.3))",
              background: "transparent",
              color: "var(--consent-text, #f0ede6)",
              cursor: "pointer",
              fontSize: "0.875rem",
            }}
          >
            Cancel
          </button>
          <button
            onClick={save}
            style={{
              padding: "8px 20px",
              borderRadius: "6px",
              border: "none",
              background: "var(--consent-accent, #c9a961)",
              color: "#0b0b0b",
              cursor: "pointer",
              fontWeight: 600,
              fontSize: "0.875rem",
            }}
          >
            Save preferences
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * ConsentBanner — bottom-fixed GDPR/CCPA consent UI.
 *
 * Styling uses CSS custom properties so each site can theme it without
 * importing CSS from the package. Sites set:
 *   --consent-bg, --consent-text, --consent-accent, --consent-border
 *
 * WCAG 2.2 AA:
 *  - All interactive elements are keyboard-operable
 *  - Role/aria labels on all controls
 *  - Focus trapped in the modal
 *  - Minimum touch target 44×44px
 *  - Text contrast meets 4.5:1 (enforced via site CSS vars)
 */
export function ConsentBanner() {
  const { preferences, bannerVisible, modalVisible, acceptAll, rejectAll, saveCustom, openModal, closeModal } = useConsent();

  const bannerRef = useRef<HTMLDivElement>(null);
  useFocusTrap(bannerRef, bannerVisible);

  // Close on Escape (banner)
  useEffect(() => {
    if (!bannerVisible) return;
    function onKey(e: KeyboardEvent) { if (e.key === "Escape") rejectAll(); }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [bannerVisible, rejectAll]);

  if (!bannerVisible && !modalVisible) return null;

  return (
    <>
      {bannerVisible && (
        <div
          ref={bannerRef}
          role="dialog"
          aria-modal="true"
          aria-label="Cookie consent"
          aria-live="polite"
          data-testid="consent-banner"
          style={{
            position: "fixed",
            bottom: 0,
            left: 0,
            right: 0,
            zIndex: 9999,
            background: "var(--consent-bg, #1a1a1a)",
            color: "var(--consent-text, #f0ede6)",
            borderTop: "1px solid var(--consent-border, rgba(201,169,97,0.3))",
            padding: "16px 20px",
          }}
        >
          <div style={{ maxWidth: "1200px", margin: "0 auto", display: "flex", flexWrap: "wrap", alignItems: "center", gap: "16px" }}>
            <div style={{ flex: 1, minWidth: "240px" }}>
              <p style={{ margin: 0, fontSize: "0.875rem", lineHeight: 1.6 }}>
                We use cookies to analyse site usage and improve your experience.
                Cloudflare Web Analytics is always active (cookieless).{" "}
                <button
                  onClick={openModal}
                  style={{ background: "none", border: "none", padding: 0, color: "var(--consent-accent, #c9a961)", cursor: "pointer", textDecoration: "underline", fontSize: "inherit" }}
                  aria-label="Manage cookie preferences"
                >
                  Manage preferences
                </button>
              </p>
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: "8px", flexShrink: 0 }}>
              <button
                onClick={() => { acceptAll(); }}
                data-testid="consent-accept"
                style={{
                  padding: "10px 20px",
                  minWidth: "44px",
                  minHeight: "44px",
                  borderRadius: "6px",
                  border: "none",
                  background: "var(--consent-accent, #c9a961)",
                  color: "#0b0b0b",
                  cursor: "pointer",
                  fontWeight: 700,
                  fontSize: "0.875rem",
                  whiteSpace: "nowrap",
                }}
              >
                Accept all
              </button>
              <button
                onClick={() => { rejectAll(); }}
                data-testid="consent-reject"
                style={{
                  padding: "10px 20px",
                  minWidth: "44px",
                  minHeight: "44px",
                  borderRadius: "6px",
                  border: "1px solid var(--consent-border, rgba(201,169,97,0.3))",
                  background: "transparent",
                  color: "var(--consent-text, #f0ede6)",
                  cursor: "pointer",
                  fontSize: "0.875rem",
                  whiteSpace: "nowrap",
                }}
              >
                Essential only
              </button>
              <button
                onClick={openModal}
                data-testid="consent-customise"
                style={{
                  padding: "10px 20px",
                  minWidth: "44px",
                  minHeight: "44px",
                  borderRadius: "6px",
                  border: "1px solid var(--consent-border, rgba(201,169,97,0.3))",
                  background: "transparent",
                  color: "var(--consent-text, #f0ede6)",
                  cursor: "pointer",
                  fontSize: "0.875rem",
                  whiteSpace: "nowrap",
                }}
              >
                Customise
              </button>
            </div>
          </div>
        </div>
      )}

      {modalVisible && (
        <CustomiseModal
          onSave={saveCustom}
          onClose={closeModal}
          initial={preferences}
        />
      )}
    </>
  );
}
