"use server";

import { createGalleryModerationProcessor } from "./moderation-processor.ts";
import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from "../supabase/config";

const processSubmission = createGalleryModerationProcessor();

export async function moderateProcessedGallery(input: {
  accessToken: string;
  submissionId: string;
  action: "approved" | "thumbnail";
  reason?: string;
}) {
  return processSubmission(input, {
    supabaseUrl: SUPABASE_URL,
    publishableKey: SUPABASE_PUBLISHABLE_KEY,
    processorSecret: process.env.GALLERY_MEDIA_PROCESSOR_SECRET || "",
  });
}
