/**
 * Wizard Step 7 — Login gate. Mocked; grants LOGIN_REWARD tokens on any button.
 */

import { LoginPanel } from '../../../components/wizard/LoginPanel';

export const dynamic = 'force-dynamic';

export default function WizardLoginPage(): React.JSX.Element {
  return <LoginPanel />;
}
