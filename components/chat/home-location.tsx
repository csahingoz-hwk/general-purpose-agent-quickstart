"use client";

import { MapPinIcon } from "lucide-react";
import { useState } from "react";
import useSWR from "swr";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useUiLocale } from "@/hooks/use-ui-locale";
import type { HomeLocation } from "@/lib/temporal";
import { fetcher } from "@/lib/utils";

const endpoint = `${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/api/location`;

export function HomeLocationPanel() {
  const { copy } = useUiLocale();
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
        setMessage(copy.locationNotFoundError);
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
      setMessage(copy.locationUnsupportedError);
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
      () => setMessage(copy.locationPermissionDeniedError),
      { maximumAge: 600_000, timeout: 10_000 }
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-[13px] text-muted-foreground">{copy.homeLabel}</p>
      <p className="flex items-start gap-2 text-[17px] leading-snug text-foreground">
        <MapPinIcon aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
        <span>{home?.label ?? copy.noCitySaved}</span>
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
          aria-label={copy.homeCityAriaLabel}
          className="h-11"
          onChange={(event) => setCity(event.target.value)}
          placeholder={copy.homeCityPlaceholder}
          value={city}
        />
        <Button
          className="h-11"
          disabled={busy || !city.trim()}
          size="sm"
          type="submit"
        >
          {copy.save}
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
        {copy.useCurrentLocation}
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
          {copy.clearSavedLocation}
        </Button>
      )}
      {message && (
        <output className="block text-sm text-foreground">{message}</output>
      )}
    </div>
  );
}
