import type { VerifyAuthChallengeResponseTriggerEvent } from "aws-lambda";
import { createHmac, timingSafeEqual } from "crypto";

function verifyProofToken(token: string, secret: string): string | null {
  const parts = token.split(":");
  if (parts.length !== 3) return null;

  const [userId, expStr, sig] = parts;
  const exp = Number(expStr);
  if (Number.isNaN(exp)) return null;

  if (exp < Math.floor(Date.now() / 1000)) return null;

  const payload = `${userId}:${expStr}`;
  const expected = createHmac("sha256", secret).update(payload).digest("hex");

  const sigBuf = Buffer.from(sig, "hex");
  const expectedBuf = Buffer.from(expected, "hex");
  if (sigBuf.length !== expectedBuf.length) return null;
  if (!timingSafeEqual(sigBuf, expectedBuf)) return null;

  return userId;
}

export const handler = async (
  event: VerifyAuthChallengeResponseTriggerEvent,
): Promise<VerifyAuthChallengeResponseTriggerEvent> => {
  try {
    const token = event.request.challengeAnswer;
    const secret = process.env.VERIFY_PROOF_SECRET!;
    const userId = verifyProofToken(token, secret);

    console.log("DEBUG:", JSON.stringify({
      userName: event.userName,
      userId,
      tokenPrefix: token?.substring(0, 50),
      match: userId === event.userName,
    }));

    event.response.answerCorrect =
      userId !== null && userId === event.userName;
  } catch (e) {
    console.error("Verify error:", e);
    event.response.answerCorrect = false;
  }

  return event;
};
