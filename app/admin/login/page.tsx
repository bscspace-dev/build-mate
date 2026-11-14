import { redirect } from "next/navigation";

// 관리자도 메인 화면(/)에서 같은 로그인 창으로 로그인한다. 예전 주소로 들어와도 메인으로 보낸다.
export default function AdminLoginRedirect() {
  redirect("/");
}
