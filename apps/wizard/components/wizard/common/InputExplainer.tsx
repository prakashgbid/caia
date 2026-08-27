'use client';

/**
 * <InputExplainer> — helper text shown under a form input.
 *
 * Explains what to type / what the field is for. Optional example. Uses
 * muted-foreground so it doesn't compete with the input itself.
 */

interface Props {
  hint: string;
  example?: string;
}

export function InputExplainer({ hint, example }: Props): React.JSX.Element {
  return (
    <p className="text-xs text-muted-foreground mt-1.5 leading-relaxed">
      {hint}
      {example && (
        <>
          {' '}
          <span className="text-foreground/70">e.g. &ldquo;{example}&rdquo;</span>
        </>
      )}
    </p>
  );
}
