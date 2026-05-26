import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/**
 * Merge Tailwind class strings, de-duplicating conflicting utilities.
 * This is the canonical helper for all @caia/ui components and any
 * downstream consumer that needs to compose Tailwind classes.
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
