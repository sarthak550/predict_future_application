import { SignInForm } from "@/components/auth/sign-in-form";

export default function SignInPage({
  searchParams
}: {
  searchParams?: { error?: string; callbackUrl?: string; call?: string };
}) {
  const initialErrorMessage =
    searchParams?.error === "suspended"
      ? "This account is suspended. Contact an administrator."
      : "";

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#f5f7fb] bg-grid bg-[size:40px_40px] px-4">
      <SignInForm
        initialErrorMessage={initialErrorMessage}
        callbackUrl={searchParams?.callbackUrl}
        call={searchParams?.call}
      />
    </div>
  );
}
