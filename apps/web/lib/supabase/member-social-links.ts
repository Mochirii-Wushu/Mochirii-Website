import {
  MEMBER_SOCIAL_LINK_LIMIT,
  normalizeMemberSocialLinkInput,
  type MemberSocialLinkProvider,
} from "@/lib/member-social-links/profile-links-core";
import { getCurrentUser } from "./auth";
import { requireReadyBrowserSupabaseClient } from "./client";
import {
  createError,
  createResult,
  failedResult,
  okResult,
  type MemberSocialLink,
} from "./types";

type CreateMemberSocialLinkPayload = {
  provider: MemberSocialLinkProvider;
  displayLabel?: string;
  profileUrl: string;
  isVisible?: boolean;
};

async function requireCurrentUserId() {
  const result = await getCurrentUser();
  const userId = result.data?.user?.id;
  if (!result.ok || !userId) throw new Error("Sign in before managing profile links.");
  return userId;
}

export async function listMyMemberSocialLinks() {
  try {
    const client = await requireReadyBrowserSupabaseClient();
    const userId = await requireCurrentUserId();
    const { data, error, status, statusText } = await client
      .from("member_social_links")
      .select("id,user_id,provider,display_label,profile_url,sort_order,is_visible,created_at,updated_at")
      .eq("user_id", userId)
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: true });

    if (error) {
      return createResult<MemberSocialLink[]>({
        ok: false,
        status,
        statusText,
        data: null,
        error: createError("Profile links could not be loaded."),
      });
    }

    return okResult((Array.isArray(data) ? data : []) as MemberSocialLink[]);
  } catch (error) {
    return failedResult<MemberSocialLink[]>(error);
  }
}

export async function listVisibleMemberSocialLinks(userId: string) {
  try {
    const client = await requireReadyBrowserSupabaseClient();
    await requireCurrentUserId();
    const cleanUserId = String(userId || "").trim();
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(cleanUserId)) {
      throw new Error("A valid member identifier is required.");
    }

    const { data, error, status, statusText } = await client
      .from("member_social_links")
      .select("id,user_id,provider,display_label,profile_url,sort_order,is_visible,created_at,updated_at")
      .eq("user_id", cleanUserId)
      .eq("is_visible", true)
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: true });

    if (error) {
      return createResult<MemberSocialLink[]>({
        ok: false,
        status,
        statusText,
        data: null,
        error: createError("Shared profile links could not be loaded."),
      });
    }

    return okResult((Array.isArray(data) ? data : []) as MemberSocialLink[]);
  } catch (error) {
    return failedResult<MemberSocialLink[]>(error);
  }
}

export async function createMemberSocialLink(payload: CreateMemberSocialLinkPayload) {
  try {
    const client = await requireReadyBrowserSupabaseClient();
    await requireCurrentUserId();
    const current = await listMyMemberSocialLinks();
    if (!current.ok) return current;
    const links = current.data || [];
    if (links.length >= MEMBER_SOCIAL_LINK_LIMIT) throw new Error(`You can save up to ${MEMBER_SOCIAL_LINK_LIMIT} profile links.`);

    const normalized = normalizeMemberSocialLinkInput(payload);
    const { data, error, status, statusText } = await client
      .rpc("create_member_social_link", {
        link_provider: normalized.provider,
        link_display_label: normalized.displayLabel,
        link_profile_url: normalized.profileUrl,
        link_is_visible: payload.isVisible === true,
      })
      .single();

    if (error) {
      return createResult<MemberSocialLink>({
        ok: false,
        status,
        statusText,
        data: null,
        error: createError("Profile link could not be added."),
      });
    }

    return okResult(data as MemberSocialLink, "Profile link added.");
  } catch (error) {
    return failedResult<MemberSocialLink>(error);
  }
}

export async function updateMemberSocialLinkVisibility(id: string, isVisible: boolean) {
  try {
    const client = await requireReadyBrowserSupabaseClient();
    const userId = await requireCurrentUserId();
    const { data, error, status, statusText } = await client
      .from("member_social_links")
      .update({ is_visible: isVisible })
      .eq("id", id)
      .eq("user_id", userId)
      .select("id,user_id,provider,display_label,profile_url,sort_order,is_visible,created_at,updated_at")
      .maybeSingle();

    if (error || !data) {
      return createResult<MemberSocialLink>({
        ok: false,
        status: status || 404,
        statusText: statusText || "Not Found",
        data: null,
        error: createError(error ? "Profile-link visibility could not be updated." : "Profile link was not found."),
      });
    }

    return okResult(data as MemberSocialLink, isVisible ? "Profile link shared with verified guild members." : "Profile link hidden.");
  } catch (error) {
    return failedResult<MemberSocialLink>(error);
  }
}

export async function reorderMemberSocialLinks(orderedIds: string[]) {
  try {
    const client = await requireReadyBrowserSupabaseClient();
    await requireCurrentUserId();
    const ids = [...new Set(orderedIds.map((id) => String(id || "").trim()).filter(Boolean))];
    if (
      !ids.length
      || ids.length > MEMBER_SOCIAL_LINK_LIMIT
      || ids.length !== orderedIds.length
      || ids.some((id) => !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id))
    ) throw new Error("A valid profile-link order is required.");

    const { data, error } = await client.rpc("reorder_member_social_links", { link_ids: ids });
    if (error || !Array.isArray(data) || data.length !== ids.length) throw error || new Error("Profile-link order could not be saved.");

    return okResult(data as MemberSocialLink[], "Profile-link order saved.");
  } catch (error) {
    return failedResult<MemberSocialLink[]>(error);
  }
}

export async function deleteMemberSocialLink(id: string) {
  try {
    const client = await requireReadyBrowserSupabaseClient();
    const userId = await requireCurrentUserId();
    const { error, status, statusText, count } = await client
      .from("member_social_links")
      .delete({ count: "exact" })
      .eq("id", id)
      .eq("user_id", userId);

    if (error || count !== 1) {
      return createResult<string>({
        ok: false,
        status: status || 404,
        statusText: statusText || "Not Found",
        data: null,
        error: createError(error ? "Profile link could not be removed." : "Profile link was not found."),
      });
    }

    return okResult(id, "Profile link removed.");
  } catch (error) {
    return failedResult<string>(error);
  }
}
