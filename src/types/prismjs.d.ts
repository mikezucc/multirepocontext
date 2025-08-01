declare module 'prismjs' {
  export function highlight(code: string, grammar: any, language: string): string;
  export function highlightElement(element: Element): void;
  export function highlightAll(): void;
  export const languages: any;
}