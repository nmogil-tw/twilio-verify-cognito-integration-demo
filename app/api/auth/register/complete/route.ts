import { NextRequest, NextResponse } from "next/server";
import { checkVerification } from "@/lib/twilio";
import {
  createCognitoUser,
  initiateCustomAuth,
  respondToCustomChallenge,
} from "@/lib/cognito";
import { issueProofToken } from "@/lib/verify-proof";
import { getSecret } from "@/lib/secrets";
import {
  authCookieOptions,
  refreshCookieOptions,
  deleteCookieOptions,
} from "@/lib/cookies";

export async function POST(req: NextRequest) {
  try {
    const { code } = await req.json();
    const phoneNumber = req.cookies.get("verify_phone")?.value;

    if (!phoneNumber || !code) {
      return NextResponse.json(
        { error: "Missing verification data" },
        { status: 400 },
      );
    }

    // Check the OTP the user typed with Twilio Verify
    const result = await checkVerification(phoneNumber, code);

    if (result.status !== "approved") {
      return NextResponse.json(
        { error: "Invalid or expired code" },
        { status: 401 },
      );
    }

    // Create Cognito user (phone number as username)
    await createCognitoUser(phoneNumber);

    // Initiate Cognito Custom Auth
    const authRes = await initiateCustomAuth(phoneNumber);
    if (!authRes.Session) {
      return NextResponse.json(
        { error: "Authentication failed" },
        { status: 500 },
      );
    }

    // Use Cognito's internal USERNAME (UUID) for the proof token
    const cognitoUsername = authRes.ChallengeParameters?.USERNAME ?? phoneNumber;
    const secret = await getSecret("VERIFY_PROOF_SECRET");
    const proofToken = issueProofToken(cognitoUsername, secret);

    const challengeRes = await respondToCustomChallenge(
      authRes.Session,
      cognitoUsername,
      proofToken,
    );

    const tokens = challengeRes.AuthenticationResult;
    console.log("Cognito auth success:", {
      cognitoUsername,
      hasAccessToken: !!tokens?.AccessToken,
      hasIdToken: !!tokens?.IdToken,
      hasRefreshToken: !!tokens?.RefreshToken,
      tokenType: tokens?.TokenType,
    });
    if (!tokens?.AccessToken || !tokens.IdToken) {
      return NextResponse.json(
        { error: "Authentication failed" },
        { status: 500 },
      );
    }

    const res = NextResponse.json({ success: true });

    // Set auth cookies
    res.cookies.set("access_token", tokens.AccessToken, authCookieOptions());
    res.cookies.set("id_token", tokens.IdToken, authCookieOptions());
    if (tokens.RefreshToken) {
      res.cookies.set(
        "refresh_token",
        tokens.RefreshToken,
        refreshCookieOptions(),
      );
    }

    // Clear temp cookies
    res.cookies.set("verify_phone", "", deleteCookieOptions());

    return res;
  } catch (error) {
    console.error("Register complete error:", error);
    return NextResponse.json(
      { error: "Registration failed" },
      { status: 500 },
    );
  }
}
