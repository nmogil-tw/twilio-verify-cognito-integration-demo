import {
  SecretsManagerClient,
  GetSecretValueCommand,
} from "@aws-sdk/client-secrets-manager";
import { awsClientConfig } from "./aws-config";

let cache: Record<string, string> | null = null;

const client = new SecretsManagerClient(awsClientConfig());

async function fetchSecret(name: string): Promise<string> {
  const res = await client.send(
    new GetSecretValueCommand({ SecretId: name }),
  );
  return res.SecretString ?? "";
}

export async function getSecret(key: string): Promise<string> {
  if (process.env.USE_SECRETS_MANAGER !== "true") {
    const envVal = process.env[key];
    if (!envVal) throw new Error(`Missing env var: ${key}`);
    return envVal;
  }

  if (!cache) {
    const [twilioRaw, proofRaw] = await Promise.all([
      fetchSecret("myapp/twilio"),
      fetchSecret("myapp/verify"),
    ]);
    const twilio = JSON.parse(twilioRaw);
    const proof = JSON.parse(proofRaw);
    cache = {
      TWILIO_AUTH_TOKEN: twilio.TWILIO_AUTH_TOKEN,
      VERIFY_PROOF_SECRET: proof.VERIFY_PROOF_SECRET,
    };
  }

  const val = cache[key];
  if (!val) throw new Error(`Secret not found: ${key}`);
  return val;
}
