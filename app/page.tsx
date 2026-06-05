import Link from "next/link";

export default function Home() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 p-8">
      <h1 className="text-4xl font-bold">OTP Login Demo</h1>
      <p className="text-lg text-gray-600">
        Phone-number sign-in with one-time codes over SMS or RCS, powered by
        Twilio Verify and AWS Cognito.
      </p>
      <div className="flex gap-4">
        <Link
          href="/register"
          className="rounded-lg bg-blue-600 px-6 py-3 text-white hover:bg-blue-700"
        >
          Create account
        </Link>
        <Link
          href="/login"
          className="rounded-lg border border-gray-300 px-6 py-3 hover:bg-gray-100"
        >
          Log in
        </Link>
      </div>
    </main>
  );
}
