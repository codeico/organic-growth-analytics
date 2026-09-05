import { describe, expect, it, vi } from "vitest";
import {
  confirmMagicLink,
  getCurrentUser,
  sendMagicLink,
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

  it("returns the server-validated user", async () => {
    const user = { id: "user-1", email: "creator@example.com" };
    const getUser = vi.fn().mockResolvedValue({ data: { user }, error: null });
    await expect(getCurrentUser({ auth: { getUser } })).resolves.toEqual(user);
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
