import {
  CognitoIdentityProviderClient,
  AdminCreateUserCommand,
  AdminSetUserPasswordCommand,
  AdminInitiateAuthCommand,
  AdminRespondToAuthChallengeCommand,
} from "@aws-sdk/client-cognito-identity-provider";
import crypto from "crypto";
import { awsClientConfig } from "./aws-config";

const client = new CognitoIdentityProviderClient(awsClientConfig());

const userPoolId = () => process.env.COGNITO_USER_POOL_ID!;
const clientId = () => process.env.COGNITO_CLIENT_ID!;

/**
 * Create a Cognito user keyed on their phone number (E.164).
 * In a real production deployment the user already exists and is keyed
 * on whatever identifier the portal uses; here we provision on first sight so
 * the demo is self-contained.
 */
export async function createCognitoUser(phoneNumber: string) {
  try {
    // Step 1: Create user (suppress invitation message)
    await client.send(
      new AdminCreateUserCommand({
        UserPoolId: userPoolId(),
        Username: phoneNumber,
        MessageAction: "SUPPRESS",
        UserAttributes: [
          { Name: "phone_number", Value: phoneNumber },
          { Name: "phone_number_verified", Value: "true" },
        ],
      }),
    );

    // Step 2: Set permanent random password to avoid FORCE_CHANGE_PASSWORD
    await client.send(
      new AdminSetUserPasswordCommand({
        UserPoolId: userPoolId(),
        Username: phoneNumber,
        Password: crypto.randomUUID() + "Aa1!",
        Permanent: true,
      }),
    );
  } catch (e: any) {
    if (e.name === "UsernameExistsException") return;
    throw e;
  }
}

export async function initiateCustomAuth(username: string) {
  const res = await client.send(
    new AdminInitiateAuthCommand({
      UserPoolId: userPoolId(),
      ClientId: clientId(),
      AuthFlow: "CUSTOM_AUTH",
      AuthParameters: {
        USERNAME: username,
      },
    }),
  );
  return res;
}

export async function respondToCustomChallenge(
  session: string,
  username: string,
  answer: string,
) {
  const res = await client.send(
    new AdminRespondToAuthChallengeCommand({
      UserPoolId: userPoolId(),
      ClientId: clientId(),
      ChallengeName: "CUSTOM_CHALLENGE",
      Session: session,
      ChallengeResponses: {
        USERNAME: username,
        ANSWER: answer,
      },
    }),
  );
  return res;
}
