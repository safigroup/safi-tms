import { VerifyTokenGate } from "@/lib/components/VerifyTokenGate";

export default function AcceptInvitePage() {
  return (
    <VerifyTokenGate
      type="invite"
      invalidMessage="This invite link is invalid or has expired — ask an admin to send a new one."
    />
  );
}
