import {
  approvedSocialOAuthRedirect,
  isApprovedSocialOAuthReturnDestination,
} from "./approved-social-redirect.ts";

export type OAuthAuthorizationDetails = {
  authorization_id?: string;
  redirect_url?: string;
  redirect_uri?: string;
  scope?: string;
};

export function hasPendingAuthorizationShape(
  details: OAuthAuthorizationDetails,
): boolean {
  return "authorization_id" in details;
}

export function pendingAuthorizationDetailsAreApproved(
  details: OAuthAuthorizationDetails,
  expectedAuthorizationId: string,
): boolean {
  return hasPendingAuthorizationShape(details) &&
    typeof details.authorization_id === "string" &&
    details.authorization_id === expectedAuthorizationId &&
    isApprovedSocialOAuthReturnDestination(details.redirect_uri);
}

export function priorConsentRedirect(
  details: OAuthAuthorizationDetails,
  currentMemberAccess: boolean,
): string {
  if (
    !currentMemberAccess ||
    hasPendingAuthorizationShape(details) ||
    JSON.stringify(Object.keys(details).sort()) !==
      JSON.stringify(["redirect_url"])
  ) {
    return "";
  }
  return approvedSocialOAuthRedirect(details.redirect_url);
}
