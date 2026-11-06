import { AuthCard } from "@/components/auth/auth-card";
import { LoginForm } from "./login-form";

export default function LoginPage() {
  return (
    <AuthCard title="pswrsh 로그인" description="계정으로 로그인합니다. 저장된 호스트는 그다음 볼트 패스프레이즈로 엽니다.">
      <LoginForm />
    </AuthCard>
  );
}
