import { AuthCard } from "@/components/auth/auth-card";
import { SetupForm } from "./setup-form";

export default function SetupPage() {
  return (
    <AuthCard
      title="pswrsh 셋업"
      description="관리자 계정과 메일 발송을 설정합니다. 테스트 메일이 성공해야 완료할 수 있습니다."
    >
      <SetupForm />
    </AuthCard>
  );
}
