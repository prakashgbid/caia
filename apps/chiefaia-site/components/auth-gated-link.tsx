/**
 * AuthGatedLink — a link that runs the STOL-5003 mock-auth check on click.
 *
 * Signed in (mock)  -> navigate to `target`.
 * Signed out (mock) -> navigate to `/sign-in?returnTo=<target>`.
 *
 * Renders a real <Link> to the target so JS-off / crawler behaviour is a
 * plain navigation (the /dashboard pages gate themselves client-side too).
 */

'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { isMockLoggedIn } from '../lib/mock-auth';

export function AuthGatedLink({
  target,
  className,
  children,
  ...rest
}: {
  target: string;
  className?: string;
  children: React.ReactNode;
} & Omit<React.ComponentProps<typeof Link>, 'href' | 'className' | 'children'>) {
  const router = useRouter();

  return (
    <Link
      href={target}
      className={className}
      onClick={(event) => {
        event.preventDefault();
        if (isMockLoggedIn()) {
          router.push(target);
        } else {
          router.push(`/sign-in?returnTo=${encodeURIComponent(target)}`);
        }
      }}
      {...rest}
    >
      {children}
    </Link>
  );
}
