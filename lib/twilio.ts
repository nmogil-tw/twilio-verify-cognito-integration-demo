import { getSecret } from "./secrets";

/**
 * Twilio Verify channels used by this demo.
 * SMS is the default; RCS gives an IP-based, branded delivery with read
 * receipts and falls back automatically when the device/carrier can't receive
 * it (Verify handles capability detection service-side).
 */
export type VerifyChannel = "sms" | "rcs";

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
 * Start a verification — sends an OTP to the phone number on the chosen
 * channel. Twilio generates the code, owns the TTL and attempt counting.
 *
 * POST /v2/Services/{ServiceSid}/Verifications
 * Returns an object whose `status` is "pending" on success.
 */
export async function startVerification(to: string, channel: VerifyChannel) {
  const data = await twilioFetch(`${servicePath()}/Verifications`, {
    To: to,
    Channel: channel,
  });
  // data.sid = Verification SID (VE...), data.status = "pending"
  return data;
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
