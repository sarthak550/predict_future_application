import { AuthLegalFooter } from "@/components/auth/auth-legal-footer";
import { SignUpForm } from "@/components/auth/sign-up-form";

export default function SignUpPage({
  searchParams
}: {
  searchParams?: { callbackUrl?: string; call?: string };
}) {
  const googleConfigured = Boolean(process.env.GOOGLE_CLIENT_ID);

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-[#f5f7fb] bg-grid bg-[size:40px_40px] px-4 py-10">
      <SignUpForm
        googleConfigured={googleConfigured}
        callbackUrl={searchParams?.callbackUrl}
        call={searchParams?.call}
      />
      <AuthLegalFooter />
    </div>
  );
}
