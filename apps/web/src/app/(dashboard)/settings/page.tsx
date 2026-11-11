import ProfileView from "./profile-view";

import { getMemberContext } from "@/lib/member/context";

/** /settings: the person's own account, with the firm they are in for leaving it. */
export default async function SettingsPage() {
  const context = await getMemberContext().catch(() => null);
  const firm = context?.firm ? { name: context.firm.name, owner: context.firm.role === "owner" } : null;
  return <ProfileView firm={firm} />;
}
