import { AuthCard } from "@/components/auth/auth-card";
import { EmailCodeFlow } from "@/components/auth/email-code-flow";

export default function SignupPage() {
  return (
    <AuthCard title="가입" description="이메일로 받은 코드로 주소를 확인한 뒤 비밀번호를 정합니다.">
      <EmailCodeFlow api="/api/signup" passwordLabel="비밀번호" submitLabel="가입하기" done="/" />
    </AuthCard>
  );
}
