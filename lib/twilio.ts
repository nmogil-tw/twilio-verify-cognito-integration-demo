import { getSecret } from "./secrets";

/**
 * The channel a verification was actually *delivered* on.
 *
 * Note: RCS is NOT a channel you request. Verify's "RCS Upgrade" (on by
 * default) transparently upgrades an `sms` verification to RCS when the
 * recipient's device supports it and an approved RCS sender exists, falling
 * back to SMS otherwise — all service-side. So we always START on `sms` and
 * read back which channel Verify chose from `send_code_attempts`.
 * `channel=rcs` and `channel=auto` are rejected (HTTP 400, error 60200) on a
 * standard service.
 */
export type VerifyChannel = "sms" | "rcs";

/**
 * Normalize a user-typed phone number to clean E.164.
 * Strips spaces, hyphens, parens and dots (e.g. "+44 7878 941747" →
 * "+447878941747"). Twilio Verify tolerates the formatting, but Cognito's
 * AdminCreateUser username rejects spaces — and both must key on the SAME
 * canonical value, so we normalize once at the entry point.
 */
export function normalizePhone(input: string): string {
  return input.replace(/[\s\-().]/g, "");
}

const BASE = "https://verify.twilio.com";

async function twilioFetch(path: string, params: Record<string, string>) {
  const accountSid = process.env.TWILIO_ACCOUNT_SID!;
  const authToken = await getSecret("TWILIO_AUTH_TOKEN");

  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: {
      // Verify's REST API expects form-encoded bodies
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization:
        "Basic " + Buffer.from(`${accountSid}:${authToken}`).toString("base64"),
    },
    body: new URLSearchParams(params).toString(),
  });

  if (!res.ok) {
    const errBody = await res.text().catch(() => "");
    console.error("Twilio API error response:", errBody);
    const err = JSON.parse(errBody || "{}");
    throw new Error(
      `Twilio API error ${res.status}: ${err.message || res.statusText}`,
    );
  }

  return res.json();
}

function servicePath() {
  return `/v2/Services/${process.env.TWILIO_VERIFY_SERVICE_SID!}`;
}

/**
 * Start a verification — sends an OTP. Twilio generates the code, owns the TTL
 * and attempt counting. We always request the `sms` channel; Verify's RCS
 * Upgrade decides at delivery time whether to send over RCS or SMS.
 *
 * POST /v2/Services/{ServiceSid}/Verifications
 * Returns an object whose `status` is "pending" on success. The channel that
 * was actually used is in `send_code_attempts[last].channel`.
 */
export async function startVerification(to: string) {
  const data = await twilioFetch(`${servicePath()}/Verifications`, {
    To: to,
    Channel: "sms",
  });
  // data.sid = Verification SID (VE...), data.status = "pending"
  return data;
}

/**
 * Read which channel Verify actually delivered on from a Verifications
 * response. Returns "rcs" if the last attempt was upgraded to RCS, else "sms".
 */
export function deliveredChannel(verification: any): VerifyChannel {
  const attempts = verification?.send_code_attempts;
  const last = Array.isArray(attempts) ? attempts[attempts.length - 1] : null;
  return last?.channel === "rcs" ? "rcs" : "sms";
}

/**
 * Check the OTP the user typed in.
 *
 * POST /v2/Services/{ServiceSid}/VerificationCheck
 * Returns an object whose `status` is "approved" when the code is correct.
 */
export async function checkVerification(to: string, code: string) {
  const data = await twilioFetch(`${servicePath()}/VerificationCheck`, {
    To: to,
    Code: code,
  });
  // data.status = "approved" | "pending" | "canceled"
  return data;
}
