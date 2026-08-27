/**
 * Nested layout for /wizard/* — the customer-facing 7-step flow.
 * Renders the WizardShell (sticky header + sidebar stepper + footer)
 * around the current step's page content.
 */

import { WizardShell } from '../../components/shell/WizardShell';

export default function WizardLayout({ children }: { children: React.ReactNode }) {
  return <WizardShell>{children}</WizardShell>;
}
