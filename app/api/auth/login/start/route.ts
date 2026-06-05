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
    if (!rawPhone) {
      return NextResponse.json(
        { error: "Phone number is required" },
        { status: 400 },
      );
    }

    // Canonicalize to clean E.164 so Twilio and Cognito key on the same value
    const phoneNumber = normalizePhone(rawPhone);

    // Send the login OTP. Always starts on SMS; Verify auto-upgrades to RCS
    // when the device supports it.
    const verification = await startVerification(phoneNumber);

    const res = NextResponse.json({
      status: verification.status, // "pending"
      channel: deliveredChannel(verification), // "rcs" if upgraded, else "sms"
    });

    res.cookies.set("verify_phone", phoneNumber, tempCookieOptions());

    return res;
  } catch (error) {
    console.error("Login start error:", error);
    return NextResponse.json(
      { error: "Could not send verification code" },
      { status: 500 },
    );
  }
}
