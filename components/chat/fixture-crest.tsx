"use client";

import Image from "next/image";
import { useState } from "react";

function initials(name: string): string {
  const letters = name
    .split(/\s+/)
    .slice(0, 2)
    .map((word) => word.charAt(0))
    .join("");
  return letters.toLocaleUpperCase("tr") || "?";
}

export function Crest({ name, src }: { name: string; src: string | null }) {
  const [failed, setFailed] = useState(false);
  if (!src || failed) {
    return (
      <span
        aria-hidden="true"
        className="grid size-11 shrink-0 place-items-center rounded-full bg-[var(--bot-tint)] font-semibold text-[13px] text-[var(--bot-accent)]"
      >
        {initials(name)}
      </span>
    );
  }
  return (
    <Image
      alt={name}
      className="size-11 shrink-0 rounded-full bg-[var(--bot-tint)] object-contain"
      height={44}
      onError={() => setFailed(true)}
      src={src}
      unoptimized
      width={44}
    />
  );
}
