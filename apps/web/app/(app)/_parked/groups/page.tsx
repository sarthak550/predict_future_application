import Link from "next/link";

import { CreateGroupForm } from "@/components/groups/create-group-form";
import { JoinGroupForm } from "@/components/groups/join-group-form";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { requireUser } from "@/lib/auth";
import { getUserGroups } from "@/lib/groups/service";

export default async function GroupsPage() {
  const user = await requireUser();
  const groups = await getUserGroups(user.id);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-semibold text-ink-900">Groups</h1>
        <p className="mt-2 text-sm text-ink-500">
          Create private circles for office pools, college rivalries, and friend-group predictions.
        </p>
      </div>

      <div className="grid gap-6 xl:grid-cols-[1.1fr_0.9fr]">
        <Card>
          <CardHeader>
            <CardTitle>Your groups</CardTitle>
            <CardDescription>Private predictions only appear for members of the selected group.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {groups.length === 0 ? (
              <EmptyState
                title="No groups yet"
                description="Create a group or join one with an invite code to start private prediction games."
              />
            ) : (
              groups.map((group) => (
                <Link key={group.id} href={`/groups/${group.id}`} className="block rounded-[24px] border border-ink-100 p-5 transition hover:border-ink-300 hover:bg-ink-50">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge>{group.role.toLowerCase()}</Badge>
                    <Badge variant="accent">{group.memberCount} members</Badge>
                    <Badge variant="accent">{group.marketCount} markets</Badge>
                  </div>
                  <p className="mt-3 text-lg font-semibold text-ink-900">{group.name}</p>
                  {group.description && <p className="mt-2 text-sm text-ink-500">{group.description}</p>}
                  <p className="mt-3 text-xs uppercase tracking-[0.2em] text-ink-400">Invite code: {group.inviteCode}</p>
                </Link>
              ))
            )}
          </CardContent>
        </Card>

        <div className="space-y-4">
          <CreateGroupForm />
          <JoinGroupForm />
        </div>
      </div>
    </div>
  );
}
