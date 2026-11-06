import { AuthCard } from "@/components/auth/auth-card";
import { EmailCodeFlow } from "@/components/auth/email-code-flow";

export default function ForgotPage() {
  return (
    <AuthCard
      title="비밀번호 찾기"
      description="가입한 이메일로 코드를 받아 계정 비밀번호를 새로 정합니다. 볼트 패스프레이즈는 바뀌지 않습니다."
    >
      <EmailCodeFlow api="/api/reset" passwordLabel="새 비밀번호" submitLabel="비밀번호 바꾸기" done="/login" />
    </AuthCard>
  );
}
