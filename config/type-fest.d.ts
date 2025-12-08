// Minimal stub to satisfy @crxjs/vite-plugin type dependency
declare module 'type-fest' {
  // Determine if a type is a string literal (best-effort approximation)
  export type IsStringLiteral<T> = T extends string ? (string extends T ? false : true) : false;
}
