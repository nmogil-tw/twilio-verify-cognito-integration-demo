import { NextRequest, NextResponse } from "next/server";
import {
  startVerification,
  deliveredChannel,
  normalizePhone,
} from "@/lib/twilio";
import { tempCookieOptions } from "@/lib/cookies";

export async function POST(req: NextRequest) {
  try {
    const { phoneNumber: rawPhone } = await req.json();
    if (!rawPhone || typeof rawPhone !== "string") {
      return NextResponse.json(
        { error: "Phone number is required" },
        { status: 400 },
      );
    }

    // Canonicalize to clean E.164 so Twilio and Cognito key on the same value
    const phoneNumber = normalizePhone(rawPhone);

    // Send the OTP — Twilio Verify owns code generation, TTL and attempts.
    // Always starts on SMS; Verify auto-upgrades to RCS when supported.
    const verification = await startVerification(phoneNumber);

    const res = NextResponse.json({
      status: verification.status, // "pending"
      channel: deliveredChannel(verification), // "rcs" if upgraded, else "sms"
    });

    // Remember the number for the complete step
    res.cookies.set("verify_phone", phoneNumber, tempCookieOptions());

    return res;
  } catch (error) {
    console.error("Register start error:", error);
    return NextResponse.json(
      { error: "Could not send verification code" },
      { status: 500 },
    );
  }
}
