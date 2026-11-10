"use client";

import { MapPinIcon } from "lucide-react";
import { useState } from "react";
import useSWR from "swr";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { HomeLocation } from "@/lib/temporal";
import { fetcher } from "@/lib/utils";

const endpoint = `${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/api/location`;

export function HomeLocationPanel() {
  const { data, mutate } = useSWR<{ home: HomeLocation | null }>(
    endpoint,
    fetcher,
    { revalidateOnFocus: false }
  );
  const [city, setCity] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const home = data?.home ?? null;

  async function save(body: object) {
    setBusy(true);
    setMessage(null);
    try {
      const response = await fetch(endpoint, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!response.ok) {
        setMessage("Could not find that place. Try a nearby city.");
        return;
      }
      setCity("");
      await mutate();
    } finally {
      setBusy(false);
    }
  }

  function useBrowserLocation() {
    if (!("geolocation" in navigator)) {
      setMessage("This browser cannot share its location.");
      return;
    }
    // Only runs from this explicit tap; the browser then asks for permission.
    navigator.geolocation.getCurrentPosition(
      (position) =>
        save({
          fromBrowser: true,
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        }),
      () => setMessage("Location permission was not given. Nothing was saved."),
      { maximumAge: 600_000, timeout: 10_000 }
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-[13px] text-muted-foreground">Home</p>
      <p className="flex items-start gap-2 text-[17px] leading-snug text-foreground">
        <MapPinIcon aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
        <span>{home?.label ?? "No city saved"}</span>
      </p>
      <form
        className="flex gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          if (city.trim()) {
            save({ city: city.trim() });
          }
        }}
      >
        <Input
          aria-label="Home city"
          className="h-11"
          onChange={(event) => setCity(event.target.value)}
          placeholder="e.g. London, İstanbul"
          value={city}
        />
        <Button
          className="h-11"
          disabled={busy || !city.trim()}
          size="sm"
          type="submit"
        >
          Save
        </Button>
      </form>
      <Button
        className="h-11 w-full"
        disabled={busy}
        onClick={useBrowserLocation}
        size="sm"
        type="button"
        variant="outline"
      >
        Use my current location
      </Button>
      {home && (
        <Button
          className="h-11 w-full"
          disabled={busy}
          onClick={async () => {
            await fetch(endpoint, { method: "DELETE" });
            await mutate();
          }}
          size="sm"
          type="button"
          variant="ghost"
        >
          Clear saved location
        </Button>
      )}
      {message && (
        <output className="block text-sm text-foreground">{message}</output>
      )}
    </div>
  );
}
