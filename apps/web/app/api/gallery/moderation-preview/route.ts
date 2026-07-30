import {
  handleGalleryModerationPreviewRequest,
  opaqueGalleryPreviewDenied,
} from "@/lib/gallery/moderation-preview-route";
import {
  SUPABASE_PROJECT_REF,
  SUPABASE_PUBLISHABLE_KEY,
  SUPABASE_URL,
} from "@/lib/supabase/config";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 30;

export async function POST(request: Request) {
  return handleGalleryModerationPreviewRequest(request, {
    publishableKey: SUPABASE_PUBLISHABLE_KEY,
    supabaseProjectRef: SUPABASE_PROJECT_REF,
    supabaseUrl: SUPABASE_URL,
  });
}

export async function GET() { return opaqueGalleryPreviewDenied(); }
export async function HEAD() { return opaqueGalleryPreviewDenied(); }
export async function OPTIONS() { return opaqueGalleryPreviewDenied(); }
export async function DELETE() { return opaqueGalleryPreviewDenied(); }
export async function PUT() { return opaqueGalleryPreviewDenied(); }
export async function PATCH() { return opaqueGalleryPreviewDenied(); }
