"use server";

import { redirect } from "next/navigation";
import { isGoogleSignInConfigured } from "@/lib/google-owner";
import { signIn } from "./auth";

export async function loginWithGoogle() {
  if (!isGoogleSignInConfigured()) {
    redirect("/login?error=Configuration");
  }
  await signIn("google", { redirectTo: "/" });
}

export type RegisterActionState = {
  status:
    | "idle"
    | "in_progress"
    | "success"
    | "failed"
    | "user_exists"
    | "invalid_data";
};

// No public signup. Only the verified configured owner can be provisioned.
export const register = async (
  _: RegisterActionState,
  _formData: FormData
): Promise<RegisterActionState> => ({ status: "failed" });
