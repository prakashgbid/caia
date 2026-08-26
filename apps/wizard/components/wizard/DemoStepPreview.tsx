export const dynamic = 'force-dynamic';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@caia/ui';

export interface DemoPreviewProps {
  step: string;
  stepNumber: number;
  title: string;
  description: string;
  features: string[];
  nextStep: string;
}

export function DemoStepPreview({ step, stepNumber, title, description, features, nextStep }: DemoPreviewProps): React.JSX.Element {
  return (
    <Card data-testid={"wizard-step-" + step + "-demo-preview"}>
      <CardHeader>
        <CardTitle>Step {stepNumber} — {title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent>
        <div style={{ marginTop: 12, marginBottom: 20 }}>
          <div style={{ display: 'inline-block', padding: '4px 10px', borderRadius: 12, background: '#1e40af', color: '#dbeafe', fontSize: 12, fontWeight: 600 }}>DEMO PREVIEW</div>
          <p style={{ marginTop: 12, color: '#94a3b8', fontSize: 14 }}>
            This step is running in demo mode. In production, this stage produces the following outputs:
          </p>
          <ul style={{ marginTop: 10, paddingLeft: 20, color: '#cbd5e1', fontSize: 14, lineHeight: 1.6 }}>
            {features.map((f, i) => <li key={i}>{f}</li>)}
          </ul>
          <p style={{ marginTop: 20, color: '#94a3b8', fontSize: 14 }}>
            Click <strong>{nextStep} →</strong> above to continue the tour, or use the step tabs to jump around.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
