import { VerifyTokenGate } from "@/lib/components/VerifyTokenGate";

export default function ResetPasswordPage() {
  return (
    <VerifyTokenGate
      type="recovery"
      invalidMessage="This password reset link is invalid or has expired — request a new one."
    />
  );
}
