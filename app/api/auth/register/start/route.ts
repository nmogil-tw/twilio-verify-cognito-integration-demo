import { NextRequest, NextResponse } from "next/server";
import { startVerification, VerifyChannel } from "@/lib/twilio";
import { tempCookieOptions } from "@/lib/cookies";

export async function POST(req: NextRequest) {
  try {
    const { phoneNumber, channel } = await req.json();
    if (!phoneNumber || typeof phoneNumber !== "string") {
      return NextResponse.json(
        { error: "Phone number is required" },
        { status: 400 },
      );
    }

    const verifyChannel: VerifyChannel = channel === "rcs" ? "rcs" : "sms";

    // Send the OTP — Twilio Verify owns code generation, TTL and attempts
    const verification = await startVerification(phoneNumber, verifyChannel);

    const res = NextResponse.json({
      status: verification.status, // "pending"
      channel: verifyChannel,
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
