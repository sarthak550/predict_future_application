import { AuthLegalFooter } from "@/components/auth/auth-legal-footer";
import { SignInForm } from "@/components/auth/sign-in-form";

export default function SignInPage({
  searchParams
}: {
  searchParams?: { error?: string; callbackUrl?: string; call?: string };
}) {
  // Computed server-side (not read by the client form) so a visitor never sees
  // a "Continue with Google" button that's guaranteed to 500 because the
  // founder hasn't finished the Google Cloud Console setup yet (S74-T5).
  const googleConfigured = Boolean(process.env.GOOGLE_CLIENT_ID);

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-[#f5f7fb] bg-grid bg-[size:40px_40px] px-4 py-10">
      <SignInForm
        googleConfigured={googleConfigured}
        error={searchParams?.error}
        callbackUrl={searchParams?.callbackUrl}
        call={searchParams?.call}
      />
      <AuthLegalFooter />
    </div>
  );
}
