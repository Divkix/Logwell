// See https://svelte.dev/docs/kit/types#app.d.ts
// for information about these interfaces
declare global {
  namespace App {
    // interface Error {}
    interface Locals {
      user?: import('./lib/server/auth').User;
      session?: import('./lib/server/auth').Session;
      // Optional db client for testing (dependency injection)
      db?: import('drizzle-orm/pglite').PgliteDatabase<typeof import('./lib/server/db/schema')>;
    }
    // interface PageData {}
    // interface PageState {}
    // interface Platform {}
  }

  const __APP_VERSION__: string;
}

export {};
