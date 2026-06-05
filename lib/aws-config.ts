import { fromIni } from "@aws-sdk/credential-provider-ini";

/**
 * Shared AWS SDK client config.
 *
 * Region and credentials use APP_-prefixed env vars so an ambient shell
 * `AWS_PROFILE` / `AWS_REGION` (e.g. a corporate SSO profile exported in your
 * terminal) can't silently override which account the app talks to. In local
 * dev set APP_AWS_PROFILE in .env.local to pin a named CLI profile; in
 * production (App Runner) leave it unset and the SDK falls back to the
 * instance role via the default provider chain.
 */
export function awsClientConfig() {
  const region =
    process.env.APP_AWS_REGION ?? process.env.AWS_REGION ?? "eu-west-2";
  const profile = process.env.APP_AWS_PROFILE;

  return {
    region,
    ...(profile ? { credentials: fromIni({ profile }) } : {}),
  };
}
