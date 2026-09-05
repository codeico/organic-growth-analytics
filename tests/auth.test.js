import { describe, expect, it, vi } from "vitest";
import {
  confirmMagicLink,
  getCurrentUser,
  sendMagicLink,
  verifyEmailCode,
} from "../src/lib/auth.js";

describe("sendMagicLink", () => {
  it("uses the local auth callback and normalized email", async () => {
    const signInWithOtp = vi.fn().mockResolvedValue({ error: null });

    await sendMagicLink(
      { auth: { signInWithOtp } },
      "  Creator@Example.com ",
      "https://app.example",
    );

    expect(signInWithOtp).toHaveBeenCalledWith({
      email: "creator@example.com",
      options: { emailRedirectTo: "https://app.example/auth/confirm" },
    });
  });

  it("signs in with the emailed code so installed PWAs never need the link", async () => {
    const verifyOtp = vi.fn().mockResolvedValue({ error: null });

    await verifyEmailCode(
      { auth: { verifyOtp } },
      " Creator@Example.com ",
      " 1234 5678 ",
    );

    expect(verifyOtp).toHaveBeenCalledWith({
      email: "creator@example.com",
      token: "12345678",
      type: "email",
    });
  });

  it("returns the server-validated user", async () => {
    const user = { id: "user-1", email: "creator@example.com" };
    const getUser = vi.fn().mockResolvedValue({ data: { user }, error: null });
    await expect(getCurrentUser({ auth: { getUser } })).resolves.toEqual(user);
  });

  it("uses the persisted session when validation cannot reach Supabase", async () => {
    const user = { id: "user-1", email: "creator@example.com" };
    const getUser = vi.fn().mockRejectedValue(new TypeError("Failed to fetch"));
    const getSession = vi.fn().mockResolvedValue({
      data: { session: { user } },
      error: null,
    });

    await expect(
      getCurrentUser({ auth: { getUser, getSession } }),
    ).resolves.toEqual(user);
  });

  it("falls back to the persisted session when validation cannot reach Supabase", async () => {
    const user = { id: "user-1", email: "creator@example.com" };
    const getUser = vi.fn().mockResolvedValue({
      data: { user: null },
      error: { status: 0, message: "Failed to fetch" },
    });
    const getSession = vi.fn().mockResolvedValue({
      data: { session: { user } },
      error: null,
    });

    const onOffline = vi.fn();
    await expect(
      getCurrentUser({ auth: { getUser, getSession } }, onOffline),
    ).resolves.toEqual(user);
    expect(onOffline).toHaveBeenCalledOnce();
  });

  it("reports back online once server validation succeeds again", async () => {
    const user = { id: "user-1", email: "creator@example.com" };
    const getUser = vi.fn().mockResolvedValue({ data: { user }, error: null });
    const onOffline = vi.fn();
    const onOnline = vi.fn();

    await expect(
      getCurrentUser({ auth: { getUser } }, onOffline, onOnline),
    ).resolves.toEqual(user);
    expect(onOnline).toHaveBeenCalledOnce();
    expect(onOffline).not.toHaveBeenCalled();
  });

  it("exchanges a PKCE code from the confirmation URL", async () => {
    const exchangeCodeForSession = vi.fn().mockResolvedValue({ error: null });

    await confirmMagicLink(
      { auth: { exchangeCodeForSession } },
      "https://app.example/auth/confirm?code=one-time-code",
    );

    expect(exchangeCodeForSession).toHaveBeenCalledWith("one-time-code");
  });

  it("verifies a token hash from a customized magic-link template", async () => {
    const verifyOtp = vi.fn().mockResolvedValue({ error: null });

    await confirmMagicLink(
      { auth: { verifyOtp } },
      "https://app.example/auth/confirm?token_hash=hash&type=email",
    );

    expect(verifyOtp).toHaveBeenCalledWith({
      token_hash: "hash",
      type: "email",
    });
  });
});
