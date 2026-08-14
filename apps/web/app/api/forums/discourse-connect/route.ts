import { handleForumsDiscourseConnect } from "@/lib/forums/discourse-connect-handler";
import { loadForumsMember } from "@/lib/forums/discourse-connect-member";
import { SITE_ORIGIN } from "@/lib/public-urls";
import { SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from "@/lib/supabase/config";

export async function POST(request: Request) {
  return handleForumsDiscourseConnect(
    request,
    {
      enabled: process.env.MOCHIRII_FORUMS_DISCOURSE_CONNECT_ENABLED === "true",
      secret: process.env.MOCHIRII_FORUMS_DISCOURSE_CONNECT_SECRET || "",
      websiteOrigin: SITE_ORIGIN,
    },
    {
      loadMember: (token) => loadForumsMember({
        token,
        supabaseUrl: SUPABASE_URL,
        publishableKey: SUPABASE_PUBLISHABLE_KEY,
      }),
    },
  );
}
