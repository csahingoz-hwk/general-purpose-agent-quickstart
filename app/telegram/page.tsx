import { redirect } from "next/navigation";
import { Suspense } from "react";
import { auth } from "@/app/(auth)/auth";

async function Content() {
  if (!(await auth())) {
    redirect("/login");
  }
  return (
    <p className="p-6">
      Telegram execution and webhook setup are disabled pending security review.
    </p>
  );
}
export default function Page() {
  return (
    <Suspense fallback={null}>
      <Content />
    </Suspense>
  );
}
