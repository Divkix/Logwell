import { redirect } from "@sveltejs/kit";
import type { PageServerLoad } from "./$types";

export const load: PageServerLoad = async ({ locals }) => {
  if (locals.user && locals.session) {
    throw redirect(303, "/");
  }

  return {};
};
