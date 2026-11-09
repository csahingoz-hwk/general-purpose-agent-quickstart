import { auth } from "@/app/(auth)/auth";
import { getUserHomeLocation, setUserHomeLocation } from "@/lib/db/queries";
import { browserLocation, geocodeCity, reverseGeocode } from "@/lib/location";
import { type HomeLocation, validTimeZone } from "@/lib/temporal";

const noStore = { headers: { "Cache-Control": "private, no-store" } };

export async function GET() {
  const session = await auth();
  if (!session?.user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const home = await getUserHomeLocation({ userId: session.user.id });
  return Response.json({ home }, noStore);
}

/** Saves a user-chosen city, or coordinates the browser released after an explicit tap. */
export async function PUT(request: Request) {
  const session = await auth();
  if (!session?.user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const body = await request.json().catch(() => null);
  let home: HomeLocation | null = null;
  if (typeof body?.city === "string") {
    const found = await geocodeCity(body.city);
    home = found ? { ...found, source: "city" as const } : null;
  } else if (body?.fromBrowser === true) {
    home = browserLocation(
      body.latitude,
      body.longitude,
      validTimeZone(body.timeZone)
    );
    if (home) {
      // Only the rounded (~1 km) coordinates leave the server for the place name.
      const place = await reverseGeocode(home.latitude, home.longitude);
      if (place) {
        home = { ...home, label: place.label, country: place.country };
      }
    }
  }
  if (!home) {
    return Response.json({ error: "location_invalid" }, { status: 400 });
  }
  await setUserHomeLocation({ userId: session.user.id, homeLocation: home });
  return Response.json({ home }, noStore);
}

export async function DELETE() {
  const session = await auth();
  if (!session?.user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  await setUserHomeLocation({ userId: session.user.id, homeLocation: null });
  return Response.json({ home: null }, noStore);
}
