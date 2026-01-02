import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// biome-ignore lint/suspicious/noExplicitAny: Required for conditional type check on arbitrary children prop
export type WithoutChildren<T> = T extends { children?: any } ? Omit<T, 'children'> : T;
// biome-ignore lint/suspicious/noExplicitAny: Required for conditional type check on arbitrary child prop
type WithoutChild<T> = T extends { child?: any } ? Omit<T, 'child'> : T;
export type WithoutChildrenOrChild<T> = WithoutChildren<WithoutChild<T>>;
export type WithElementRef<T, U extends HTMLElement = HTMLElement> = T & { ref?: U | null };
