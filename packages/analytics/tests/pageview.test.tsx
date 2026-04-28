import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import React from "react";
import { ConsentProvider, useConsent } from "../src/consent/ConsentProvider";
import { ConsentBanner } from "../src/consent/ConsentBanner";

// Minimal next/navigation mock
vi.mock("next/navigation", () => ({
  usePathname: () => "/",
}));

beforeEach(() => {
  localStorage.clear();
  document.cookie = "pokerzeno.consent=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;";
  Object.defineProperty(navigator, "doNotTrack", { value: null, configurable: true, writable: true });
  Object.defineProperty(navigator, "globalPrivacyControl", { value: undefined, configurable: true, writable: true });
});

function TestConsumerStatus() {
  const { preferences, bannerVisible } = useConsent();
  return (
    <div>
      <span data-testid="analytics-status">{preferences.analytics}</span>
      <span data-testid="banner-visible">{String(bannerVisible)}</span>
    </div>
  );
}

function Wrapper({ children }: { children: React.ReactNode }) {
  return (
    <ConsentProvider>
      {children}
      <ConsentBanner />
    </ConsentProvider>
  );
}

describe("ConsentBanner", () => {
  it("shows banner when no stored consent", async () => {
    render(
      <Wrapper>
        <TestConsumerStatus />
      </Wrapper>
    );
    await waitFor(() => {
      expect(screen.queryByTestId("consent-banner")).toBeTruthy();
    });
  });

  it("hides banner after 'Accept all' click", async () => {
    render(
      <Wrapper>
        <TestConsumerStatus />
      </Wrapper>
    );
    await waitFor(() => screen.getByTestId("consent-accept"));
    fireEvent.click(screen.getByTestId("consent-accept"));
    await waitFor(() => {
      expect(screen.queryByTestId("consent-banner")).toBeFalsy();
    });
    expect(screen.getByTestId("analytics-status").textContent).toBe("granted");
  });

  it("sets analytics to denied after 'Essential only' click", async () => {
    render(
      <Wrapper>
        <TestConsumerStatus />
      </Wrapper>
    );
    await waitFor(() => screen.getByTestId("consent-reject"));
    fireEvent.click(screen.getByTestId("consent-reject"));
    await waitFor(() => {
      expect(screen.queryByTestId("consent-banner")).toBeFalsy();
    });
    expect(screen.getByTestId("analytics-status").textContent).toBe("denied");
  });

  it("persists consent to localStorage on accept", async () => {
    render(<Wrapper><TestConsumerStatus /></Wrapper>);
    await waitFor(() => screen.getByTestId("consent-accept"));
    fireEvent.click(screen.getByTestId("consent-accept"));
    const stored = JSON.parse(localStorage.getItem("pokerzeno.consent") ?? "{}");
    expect(stored.analytics).toBe("granted");
  });

  it("does not show banner when consent already stored", async () => {
    localStorage.setItem("pokerzeno.consent", JSON.stringify({ analytics: "granted", marketing: "denied", functional: "granted" }));
    render(<Wrapper><TestConsumerStatus /></Wrapper>);
    await waitFor(() => {
      expect(screen.queryByTestId("consent-banner")).toBeFalsy();
    });
  });

  it("auto-rejects when doNotTrack is '1'", async () => {
    Object.defineProperty(navigator, "doNotTrack", { value: "1", configurable: true });
    render(<Wrapper><TestConsumerStatus /></Wrapper>);
    await waitFor(() => {
      expect(screen.queryByTestId("consent-banner")).toBeFalsy();
      expect(screen.getByTestId("analytics-status").textContent).toBe("denied");
    });
  });

  it("opens customise modal", async () => {
    render(<Wrapper><TestConsumerStatus /></Wrapper>);
    await waitFor(() => screen.getByTestId("consent-customise"));
    fireEvent.click(screen.getByTestId("consent-customise"));
    await waitFor(() => {
      expect(screen.getByRole("dialog", { name: /cookie preferences/i })).toBeTruthy();
    });
  });

  it("is keyboard accessible — banner has dialog role", async () => {
    render(<Wrapper><TestConsumerStatus /></Wrapper>);
    await waitFor(() => {
      const dialog = screen.queryByRole("dialog", { name: /cookie consent/i });
      expect(dialog).toBeTruthy();
    });
  });
});
