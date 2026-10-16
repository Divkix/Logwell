import { z } from "zod";

// The CSP (vite.config.ts) has no 'unsafe-eval'. Without jitless, Zod 4 probes `new Function`
// whenever it builds an object schema, and browsers report that as a CSP violation even though
// Zod catches the throw. Kit evaluates this module before any page module builds a schema.
z.config({ jitless: true });
