import { NextRequest, NextResponse } from "next/server";
import { startVerification, VerifyChannel } from "@/lib/twilio";
import { tempCookieOptions } from "@/lib/cookies";

export async function POST(req: NextRequest) {
  try {
    const { phoneNumber, channel } = await req.json();
    if (!phoneNumber) {
      return NextResponse.json(
        { error: "Phone number is required" },
        { status: 400 },
      );
    }

    const verifyChannel: VerifyChannel = channel === "rcs" ? "rcs" : "sms";

    // Send the login OTP
    const verification = await startVerification(phoneNumber, verifyChannel);

    const res = NextResponse.json({
      status: verification.status, // "pending"
      channel: verifyChannel,
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
