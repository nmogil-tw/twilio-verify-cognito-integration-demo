# SETUP.md — Build & Deploy Guide

## Prerequisites

- Node.js 20+
- AWS CLI (configured)
- Twilio account with a Verify Service
- AWS account (Cognito, App Runner, Secrets Manager available)

---

## 1. Local environment setup

```bash
# Install dependencies
npm install

# Create the env file
cp .env.local.example .env.local
```

Edit `.env.local` and set the following:

| Variable                    | Description                                  |
| --------------------------- | -------------------------------------------- |
| `TWILIO_ACCOUNT_SID`        | Twilio Account SID                           |
| `TWILIO_AUTH_TOKEN`         | Twilio Auth Token                            |
| `TWILIO_VERIFY_SERVICE_SID` | Twilio Verify Service SID                    |
| `COGNITO_USER_POOL_ID`      | Cognito User Pool ID                         |
| `COGNITO_CLIENT_ID`         | Cognito app client ID                        |
| `VERIFY_PROOF_SECRET`       | HMAC signing secret (generated below)        |
| `APP_AWS_REGION`            | AWS region (e.g. `eu-west-2`)                |
| `APP_AWS_PROFILE`           | Local dev only: named CLI profile for AWS creds |

> `APP_AWS_REGION` / `APP_AWS_PROFILE` are intentionally `APP_`-prefixed so an ambient shell `AWS_PROFILE` / `AWS_REGION` (e.g. an SSO profile) can't override which account the app uses. In production (App Runner) omit `APP_AWS_PROFILE` and the SDK uses the instance role. See `lib/aws-config.ts`.

### Generating VERIFY_PROOF_SECRET

A random string you generate yourself:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

**Important:** the **same value** must be set on the verify Lambda's environment variable (step 3-3).

---

## 2. Create the AWS Cognito user pool

### 2-1. Create the user pool

```bash
aws cognito-idp create-user-pool \
  --pool-name verify-otp-pool \
  --schema '[{"Name":"phone_number","Required":true,"Mutable":true}]' \
  --username-attributes phone_number \
  --region eu-west-2
```

Note the returned `UserPool.Id`.

**Note:** with `username-attributes phone_number`, Cognito's internal `userName` is a UUID (not the phone number). The HMAC proof token uses this UUID.

**Note:** do **not** add `--auto-verified-attributes phone_number` — Cognito then demands its own SMS/SNS configuration (`SMS configuration is required when phone_number is selected for auto verification`). In this architecture Twilio Verify owns the OTP; the app sets `phone_number_verified=true` itself in `createCognitoUser`, so Cognito never needs to send SMS.

### 2-2. Create the app client

```bash
aws cognito-idp create-user-pool-client \
  --user-pool-id <USER_POOL_ID> \
  --client-name verify-otp-client \
  --explicit-auth-flows ALLOW_CUSTOM_AUTH ALLOW_REFRESH_TOKEN_AUTH \
  --no-generate-secret \
  --region eu-west-2
```

Note the returned `UserPoolClient.ClientId`.

**Important:** allow only `ALLOW_CUSTOM_AUTH` and `ALLOW_REFRESH_TOKEN_AUTH`. Do not add SRP or password auth flows.

---

## 3. Deploy the Lambda triggers

### 3-1. Build the Lambdas

```bash
cd lambda
npm init -y
npm install @types/aws-lambda typescript
npx tsc
```

### 3-2. Create the Lambda functions

Create three Lambda functions:

| Function name           | File                                   | Trigger type                   |
| ----------------------- | -------------------------------------- | ------------------------------ |
| `define-auth-challenge` | `lambda/dist/define-auth-challenge.js` | Define Auth Challenge          |
| `create-auth-challenge` | `lambda/dist/create-auth-challenge.js` | Create Auth Challenge          |
| `verify-auth-challenge` | `lambda/dist/verify-auth-challenge.js` | Verify Auth Challenge Response |

```bash
# Build the ZIP packages
cd lambda/dist
zip define-auth-challenge.zip define-auth-challenge.js
zip create-auth-challenge.zip create-auth-challenge.js
zip verify-auth-challenge.zip verify-auth-challenge.js
```

```bash
# Create each Lambda function
aws lambda create-function \
  --function-name define-auth-challenge \
  --runtime nodejs20.x \
  --handler define-auth-challenge.handler \
  --zip-file fileb://define-auth-challenge.zip \
  --role <LAMBDA_EXECUTION_ROLE_ARN> \
  --region eu-west-2
```

(Repeat for `create-auth-challenge` and `verify-auth-challenge`.)

### 3-3. verify-auth-challenge environment variable

Set the **same value** as the `VERIFY_PROOF_SECRET` generated in step 1:

```bash
aws lambda update-function-configuration \
  --function-name verify-auth-challenge \
  --environment "Variables={VERIFY_PROOF_SECRET=<YOUR_SECRET>}" \
  --region eu-west-2
```

### 3-4. Wire the Cognito triggers

Get the Lambda ARNs:

```bash
aws lambda get-function --function-name define-auth-challenge --query 'Configuration.FunctionArn' --output text
aws lambda get-function --function-name create-auth-challenge --query 'Configuration.FunctionArn' --output text
aws lambda get-function --function-name verify-auth-challenge --query 'Configuration.FunctionArn' --output text
```

Attach the triggers to Cognito (`--lambda-config` is JSON):

```bash
aws cognito-idp update-user-pool \
  --user-pool-id <USER_POOL_ID> \
  --lambda-config '{
    "DefineAuthChallenge": "<DEFINE_LAMBDA_ARN>",
    "CreateAuthChallenge": "<CREATE_LAMBDA_ARN>",
    "VerifyAuthChallengeResponse": "<VERIFY_LAMBDA_ARN>"
  }' \
  --region eu-west-2
```

### 3-5. Grant Cognito permission to invoke each Lambda

Run for all three functions:

```bash
aws lambda add-permission \
  --function-name define-auth-challenge \
  --statement-id cognito-trigger \
  --action lambda:InvokeFunction \
  --principal cognito-idp.amazonaws.com \
  --source-arn arn:aws:cognito-idp:eu-west-2:<ACCOUNT_ID>:userpool/<USER_POOL_ID>

aws lambda add-permission \
  --function-name create-auth-challenge \
  --statement-id cognito-trigger \
  --action lambda:InvokeFunction \
  --principal cognito-idp.amazonaws.com \
  --source-arn arn:aws:cognito-idp:eu-west-2:<ACCOUNT_ID>:userpool/<USER_POOL_ID>

aws lambda add-permission \
  --function-name verify-auth-challenge \
  --statement-id cognito-trigger \
  --action lambda:InvokeFunction \
  --principal cognito-idp.amazonaws.com \
  --source-arn arn:aws:cognito-idp:eu-west-2:<ACCOUNT_ID>:userpool/<USER_POOL_ID>
```

`<ACCOUNT_ID>` is your 12-digit AWS account ID:

```bash
aws sts get-caller-identity --query 'Account' --output text
```

---

## 4. Configure the Twilio Verify Service

### 4-1. Create the service

```bash
curl -X POST 'https://verify.twilio.com/v2/Services' \
  -u "$TWILIO_ACCOUNT_SID:$TWILIO_AUTH_TOKEN" \
  -H 'Content-Type: application/x-www-form-urlencoded' \
  --data-urlencode 'FriendlyName=OTP Login Demo'
```

Set the returned SID (`VA...`) as `TWILIO_VERIFY_SERVICE_SID` in `.env.local`.

### 4-2. Enable the channels

- **SMS** is enabled by default on a new Verify Service.
- **RCS**: RCS is **not** a channel you request — Verify's **RCS Upgrade** (on by default) automatically upgrades an `sms` verification to RCS when the recipient's device supports it, falling back to SMS otherwise. For branded RCS delivery, link an **approved RCS sender** (Twilio Console → Messaging → RCS); onboarding (Google verification) is similar to WhatsApp and takes time. Requesting `Channel=rcs` (or `Channel=auto`) directly returns HTTP 400 / error 60200 on a standard service.

### 4-3. Verify your credentials

1. Log in to the [Twilio Console](https://console.twilio.com/).
2. Copy the **Account SID** and **Auth Token**.

### 4-4. Verify API endpoints used

This app calls the REST API directly (form-encoded), no SDK in the request path:

| Purpose         | Endpoint                                              | Content-Type                        |
| --------------- | ----------------------------------------------------- | ----------------------------------- |
| Send OTP        | `POST /v2/Services/{SID}/Verifications`               | application/x-www-form-urlencoded   |
| Check OTP       | `POST /v2/Services/{SID}/VerificationCheck`           | application/x-www-form-urlencoded   |

`Verifications` takes `To` (E.164 phone number) and `Channel` (always `sms` — Verify upgrades to RCS automatically; read the delivered channel from `send_code_attempts` in the response). `VerificationCheck` takes `To` and `Code`. A successful check returns `status: "approved"`.

> **Testing delivery without a local SIM:** for demos you can use Twilio [test credentials / magic numbers](https://www.twilio.com/docs/verify/api/test-verification-numbers) to exercise the API flow, and the [Verify Fraud Guard / logs in the Console](https://www.twilio.com/docs/verify) to see attempts. Real cross-border delivery testing (e.g. a Thailand number) still needs a reachable handset on that carrier — confirm the current best practice with your Twilio SE.

---

## 5. Secrets Manager (production)

```bash
# Twilio Auth Token
aws secretsmanager create-secret \
  --name myapp/twilio \
  --secret-string '{"TWILIO_AUTH_TOKEN":"<YOUR_TOKEN>"}' \
  --region eu-west-2

# Verify Proof Secret
aws secretsmanager create-secret \
  --name myapp/verify \
  --secret-string '{"VERIFY_PROOF_SECRET":"<YOUR_SECRET>"}' \
  --region eu-west-2
```

---

## 6. Run the local dev server

```bash
npm run dev
```

Open http://localhost:3000.

- Locally the cookie `Secure` flag is dropped automatically (`NODE_ENV !== production`).
- Use a real phone number you control (in E.164, e.g. `+447700900123`) or a Verify test number.

---

## 7. Production deploy (App Runner)

### 7-1. Build the Docker image

```bash
docker build -t verify-otp-cognito .
```

### 7-2. Push to ECR

```bash
# Create the ECR repository
aws ecr create-repository --repository-name verify-otp-cognito --region eu-west-2

# Log in
aws ecr get-login-password --region eu-west-2 | \
  docker login --username AWS --password-stdin <ACCOUNT_ID>.dkr.ecr.eu-west-2.amazonaws.com

# Tag & push
docker tag verify-otp-cognito:latest <ACCOUNT_ID>.dkr.ecr.eu-west-2.amazonaws.com/verify-otp-cognito:latest
docker push <ACCOUNT_ID>.dkr.ecr.eu-west-2.amazonaws.com/verify-otp-cognito:latest
```

### 7-3. Create the App Runner service

Create the service via the AWS console or CLI. Set these environment variables:

| Variable                    | Value                     |
| --------------------------- | ------------------------- |
| `APP_AWS_REGION`            | `eu-west-2`               |
| `TWILIO_ACCOUNT_SID`        | Twilio Account SID        |
| `TWILIO_VERIFY_SERVICE_SID` | Twilio Verify Service SID |
| `COGNITO_USER_POOL_ID`      | Cognito User Pool ID      |
| `COGNITO_CLIENT_ID`         | Cognito Client ID         |
| `USE_SECRETS_MANAGER`       | `true`                    |

(Omit `APP_AWS_PROFILE` in production — the App Runner instance role supplies credentials via the default provider chain.)

**Note:** `TWILIO_AUTH_TOKEN` and `VERIFY_PROOF_SECRET` come from Secrets Manager, so they don't need to be set as env vars.

### 7-4. App Runner IAM role

Grant the App Runner instance role:

- `secretsmanager:GetSecretValue` (`myapp/twilio`, `myapp/verify`)
- `cognito-idp:AdminCreateUser`
- `cognito-idp:AdminSetUserPassword`
- `cognito-idp:AdminInitiateAuth`
- `cognito-idp:AdminRespondToAuthChallenge`

---

## 8. Troubleshooting

### Verify returns an error sending the OTP

- Confirm the channel is enabled on the Verify Service (RCS in particular needs an approved sender).
- Confirm `To` is valid E.164.

### Code always rejected (`status != approved`)

- The code may have expired (default Verify TTL is 10 minutes) or exceeded max attempts — start a fresh verification.
- Confirm you're checking against the same `To` you sent to.

### Cognito `NotAuthorizedException: Incorrect username or password`

Check:

1. You're using `AdminRespondToAuthChallengeCommand` (the Admin version).
2. The proof token `userId` matches Cognito's internal `userName` (UUID).
3. The Lambda and `.env.local` have the same `VERIFY_PROOF_SECRET`.

Inspect the Lambda logs:

```bash
aws logs tail /aws/lambda/verify-auth-challenge --since 5m --region eu-west-2
```

### Cognito `UsernameExistsException`

Re-registering the same number. `createCognitoUser` already catches `UsernameExistsException` and skips.

---

## 9. Security checklist

Before deploying:

- [ ] `VERIFY_PROOF_SECRET` is not hard-coded in source
- [ ] `.env.local` and the Lambda use the same `VERIFY_PROOF_SECRET`
- [ ] Proof token TTL is ≤ 30 seconds
- [ ] Proof token `userId` uses Cognito's internal `userName` (UUID)
- [ ] Cognito app client has no auth flow other than `ALLOW_CUSTOM_AUTH` / `ALLOW_REFRESH_TOKEN_AUTH`
- [ ] All cookies are `HttpOnly; Secure; SameSite=Lax`
- [ ] `/dashboard` is unreachable without authentication
- [ ] Verify failure responses don't leak detail to the client
- [ ] `VerifyAuthChallengeResponse` Lambda checks the `userId` match
- [ ] Secrets Manager holds `myapp/twilio` and `myapp/verify`
- [ ] App Runner instance role has the required IAM permissions
- [ ] Verify Service has SMS (and, if used, RCS) channels enabled
