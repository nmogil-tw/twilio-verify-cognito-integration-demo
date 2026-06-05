import { NextRequest, NextResponse } from "next/server";
import { createRemoteJWKSet, jwtVerify } from "jose";

const region =
  process.env.APP_AWS_REGION ?? process.env.AWS_REGION ?? "eu-west-2";
const userPoolId = process.env.COGNITO_USER_POOL_ID ?? "";

let jwks: ReturnType<typeof createRemoteJWKSet> | null = null;

function getJWKS() {
  if (!jwks) {
    const url = new URL(
      `https://cognito-idp.${region}.amazonaws.com/${userPoolId}/.well-known/jwks.json`,
    );
    jwks = createRemoteJWKSet(url);
  }
  return jwks;
}

export async function middleware(req: NextRequest) {
  const token = req.cookies.get("access_token")?.value;

  if (!token) {
    console.log("Middleware: no access_token cookie");
    return NextResponse.redirect(new URL("/login", req.url));
  }

  try {
    await jwtVerify(token, getJWKS(), {
      issuer: `https://cognito-idp.${region}.amazonaws.com/${userPoolId}`,
    });
    console.log("Middleware: JWT verified OK");
    return NextResponse.next();
  } catch (e) {
    console.error("Middleware: JWT verification failed:", e);
    return NextResponse.redirect(new URL("/login", req.url));
  }
}

export const config = {
  matcher: ["/dashboard/:path*"],
};
