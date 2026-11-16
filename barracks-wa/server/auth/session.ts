import { cookies, headers } from "next/headers";
import type { NextResponse } from "next/server";
import { pool } from "@/server/db/pool";
import {
  createSession,
  deleteSession,
  findUserBySessionToken,
  SESSION_COOKIE_NAME,
  touchSession,
} from "@/server/services/session.service";
import type { PublicUser } from "@/server/services/user.service";

const sessionCookieOptions = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax" as const,
  path: "/",
};

export async function getSessionToken(): Promise<string | undefined> {
  const cookieStore = await cookies();
  return cookieStore.get(SESSION_COOKIE_NAME)?.value;
}

export async function getCurrentUser(): Promise<PublicUser | null> {
  const token = await getSessionToken();

  if (!token) {
    return null;
  }

  const user = await findUserBySessionToken(pool, token);
  if (user) {
    // The browser reports how long the user has been idle; without it the
    // request itself counts as activity.
    const reported = Number((await headers()).get("x-idle-seconds"));
    await touchSession(pool, token, Number.isFinite(reported) ? reported : 0);
  }
  return user;
}

export async function startSession(
  response: NextResponse,
  userId: number,
): Promise<void> {
  const { token } = await createSession(pool, userId);

  // A browser-session cookie: the server ends the session after 30 idle
  // minutes, and closing the browser drops the cookie.
  response.cookies.set({
    ...sessionCookieOptions,
    name: SESSION_COOKIE_NAME,
    value: token,
  });
}

export async function endSession(response: NextResponse): Promise<void> {
  try {
    const token = await getSessionToken();

    if (token) {
      await deleteSession(pool, token);
    }
  } finally {
    clearSessionCookie(response);
  }
}

export function clearSessionCookie(response: NextResponse): void {
  response.cookies.set({
    ...sessionCookieOptions,
    name: SESSION_COOKIE_NAME,
    value: "",
    expires: new Date(0),
    maxAge: 0,
  });
}
