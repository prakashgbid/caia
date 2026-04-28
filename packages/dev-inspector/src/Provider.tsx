'use client';

import React, { Suspense, useState, useEffect } from 'react';

export interface DevInspectorProviderProps {
  children: React.ReactNode;
}

// LazyPanel is only initialized in development — webpack dead-code-eliminates
// the entire block (and the import('./Panel') reference) in production builds.
let LazyPanel: React.ComponentType | null = null;
if (process.env.NODE_ENV === 'development') {
  LazyPanel = React.lazy(() => import('./Panel'));
}

export function DevInspectorProvider({ children }: DevInspectorProviderProps) {
  if (process.env.NODE_ENV !== 'development') {
    return <>{children}</>;
  }
  return <DevInspectorCore>{children}</DevInspectorCore>;
}

function DevInspectorCore({ children }: { children: React.ReactNode }) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  return (
    <>
      {children}
      {mounted && LazyPanel && (
        <Suspense fallback={null}>
          <LazyPanel />
        </Suspense>
      )}
    </>
  );
}
