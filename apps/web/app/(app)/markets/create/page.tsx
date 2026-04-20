import { CreateMarketForm } from "@/components/markets/create-market-form";
import { requireUser } from "@/lib/auth";
import { getUserGroups } from "@/lib/groups/service";
import { evaluateTrustedHostEligibility } from "@/lib/markets/policies";
import { MarketVisibility } from "@prisma/client";

export default async function CreateMarketPage({
  searchParams
}: {
  searchParams?: {
    visibility?: string;
    groupId?: string;
  };
}) {
  const user = await requireUser();
  const groups = await getUserGroups(user.id);
  const initialGroupId =
    searchParams?.groupId && groups.some((group) => group.id === searchParams.groupId)
      ? searchParams.groupId
      : "";
  const initialVisibility =
    searchParams?.visibility === "private" ? MarketVisibility.PRIVATE : MarketVisibility.PUBLIC;
  const trustedHostEligibility = evaluateTrustedHostEligibility({
    user,
    stats: user.stats
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-semibold text-ink-900">Create a prediction</h1>
        <p className="mt-2 text-sm text-ink-500">
          Start with the audience first: submit a public forecast for moderation or open a private group prediction right away.
        </p>
      </div>
      <CreateMarketForm
        initialGroups={groups}
        initialGroupId={initialGroupId}
        initialVisibility={initialVisibility}
        trustedHostEligibility={trustedHostEligibility}
      />
    </div>
  );
}
