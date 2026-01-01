import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

/**
 * Login page server load function
 * Redirects authenticated users to the dashboard
 */
export const load: PageServerLoad = async ({ locals }) => {
  // If user is already authenticated, redirect to dashboard
  if (locals.user && locals.session) {
    throw redirect(303, '/');
  }

  return {};
};
