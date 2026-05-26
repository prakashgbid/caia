'use client';

/**
 * ContactForm — client-side form that POSTs to /api/contact.
 *
 * Composed from @caia/ui form primitives (Input, Label, FormField,
 * FormDescription, FormErrorMessage, Button). No third-party form lib
 * — validation is a small set of inline checks per the operator brief
 * (simple form pointing at a forms endpoint stub).
 */

import * as React from 'react';
import {
  Button,
  FormDescription,
  FormErrorMessage,
  FormField,
  Input,
  Label,
  Card,
  CardContent,
} from '@caia/ui';

type Status =
  | { kind: 'idle' }
  | { kind: 'submitting' }
  | { kind: 'success' }
  | { kind: 'error'; message: string };

interface FormErrors {
  name?: string;
  email?: string;
  message?: string;
}

function validate(data: { name: string; email: string; message: string }): FormErrors {
  const errs: FormErrors = {};
  if (data.name.trim().length < 2) errs.name = 'Please enter your name.';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email))
    errs.email = 'Please enter a valid email.';
  if (data.message.trim().length < 10)
    errs.message = 'Tell us a little more — at least 10 characters.';
  return errs;
}

export function ContactForm() {
  const [name, setName] = React.useState('');
  const [email, setEmail] = React.useState('');
  const [message, setMessage] = React.useState('');
  const [errors, setErrors] = React.useState<FormErrors>({});
  const [status, setStatus] = React.useState<Status>({ kind: 'idle' });

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const data = { name, email, message };
    const errs = validate(data);
    setErrors(errs);
    if (Object.keys(errs).length > 0) return;

    setStatus({ kind: 'submitting' });
    try {
      const res = await fetch('/api/contact', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error(`status_${res.status}`);
      setStatus({ kind: 'success' });
      setName('');
      setEmail('');
      setMessage('');
    } catch (err) {
      setStatus({
        kind: 'error',
        message: 'Something went wrong. Please try again or email hello@chiefaia.com.',
      });
    }
  }

  if (status.kind === 'success') {
    return (
      <Card data-testid="contact-success">
        <CardContent className="space-y-2 p-6">
          <p className="text-lg font-semibold text-foreground">Thanks — we got it.</p>
          <p className="text-sm text-muted-foreground">
            We&apos;ll reply within a business day at the email you provided.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardContent className="p-6">
        <form className="space-y-6" onSubmit={onSubmit} noValidate>
          <FormField>
            <Label htmlFor="contact-name">Name</Label>
            <Input
              id="contact-name"
              name="name"
              autoComplete="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              aria-invalid={Boolean(errors.name)}
              aria-describedby={errors.name ? 'contact-name-error' : undefined}
              required
            />
            <FormErrorMessage id="contact-name-error">
              {errors.name}
            </FormErrorMessage>
          </FormField>

          <FormField>
            <Label htmlFor="contact-email">Email</Label>
            <Input
              id="contact-email"
              name="email"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              aria-invalid={Boolean(errors.email)}
              aria-describedby={errors.email ? 'contact-email-error' : undefined}
              required
            />
            <FormErrorMessage id="contact-email-error">
              {errors.email}
            </FormErrorMessage>
          </FormField>

          <FormField>
            <Label htmlFor="contact-message">How can we help?</Label>
            <textarea
              id="contact-message"
              name="message"
              rows={5}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              aria-invalid={Boolean(errors.message)}
              aria-describedby={
                errors.message ? 'contact-message-error' : 'contact-message-help'
              }
              required
              className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
            />
            <FormDescription id="contact-message-help">
              Briefly describe what you&apos;re building or what you&apos;d like to discuss.
            </FormDescription>
            <FormErrorMessage id="contact-message-error">
              {errors.message}
            </FormErrorMessage>
          </FormField>

          {status.kind === 'error' ? (
            <FormErrorMessage>{status.message}</FormErrorMessage>
          ) : null}

          <Button
            type="submit"
            disabled={status.kind === 'submitting'}
            data-testid="contact-submit"
          >
            {status.kind === 'submitting' ? 'Sending…' : 'Send message'}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
