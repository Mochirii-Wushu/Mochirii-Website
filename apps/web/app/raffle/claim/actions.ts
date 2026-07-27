"use server";

import { revalidatePath } from "next/cache";
import { performRaffleClaimMutation } from "@/lib/supabase/server-auth";

function claimId(formData: FormData) {
  const value = formData.get("claim_id");
  return typeof value === "string" ? value : "";
}

export async function claimElectronicReward(formData: FormData) {
  await performRaffleClaimMutation({
    action: "claim",
    claimId: claimId(formData),
    rewardChoice: "digital_choice",
  });
  revalidatePath("/raffle/claim");
}

export async function claimInGameReward(formData: FormData) {
  await performRaffleClaimMutation({
    action: "claim",
    claimId: claimId(formData),
    rewardChoice: "in_game",
  });
  revalidatePath("/raffle/claim");
}

export async function declineRaffleReward(formData: FormData) {
  await performRaffleClaimMutation({
    action: "decline",
    claimId: claimId(formData),
  });
  revalidatePath("/raffle/claim");
}
