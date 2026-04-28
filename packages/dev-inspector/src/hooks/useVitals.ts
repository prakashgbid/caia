import { useState, useEffect } from 'react';

export interface VitalMetric {
  name: string;
  value: number;
  rating: 'good' | 'needs-improvement' | 'poor';
}

function getRating(name: string, value: number): VitalMetric['rating'] {
  if (name === 'LCP') {
    if (value <= 2500) return 'good';
    if (value <= 4000) return 'needs-improvement';
    return 'poor';
  }
  if (name === 'INP') {
    if (value <= 200) return 'good';
    if (value <= 500) return 'needs-improvement';
    return 'poor';
  }
  if (name === 'CLS') {
    if (value <= 0.1) return 'good';
    if (value <= 0.25) return 'needs-improvement';
    return 'poor';
  }
  return 'good';
}

export function useVitals() {
  const [vitals, setVitals] = useState<Record<string, VitalMetric>>({});

  useEffect(() => {
    let cancelled = false;

    import('web-vitals').then(({ onLCP, onINP, onCLS }) => {
      if (cancelled) return;

      function handleMetric(metric: { name: string; value: number }): void {
        if (cancelled) return;
        setVitals(prev => ({
          ...prev,
          [metric.name]: {
            name: metric.name,
            value: metric.value,
            rating: getRating(metric.name, metric.value),
          },
        }));
      }

      onLCP(handleMetric);
      onINP(handleMetric);
      onCLS(handleMetric);
    }).catch(() => {
      // web-vitals unavailable
    });

    return () => { cancelled = true; };
  }, []);

  return vitals;
}
