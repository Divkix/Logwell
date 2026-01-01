import { requireAuth } from '$lib/server/utils/auth-guard';
import type { LayoutServerLoad } from './$types';

/**
 * Server-side layout load function for the protected (app) route group.
 * All routes under (app)/ require authentication.
 *
 * @throws Redirect to /login if not authenticated
 */
export const load: LayoutServerLoad = async (event) => {
  const { user, session } = await requireAuth(event);

  return {
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
    },
    session: {
      id: session.id,
      expiresAt: session.expiresAt,
    },
  };
};
