import type { Metadata } from "next";
import AdminNav from "@/components/admin/AdminNav";
import RequestAlerts from "@/components/admin/RequestAlerts";

export const metadata: Metadata = {
  title: "관리자 · 빌드메이트",
  robots: { index: false, follow: false },
};

export default function AdminLayout({ children }: LayoutProps<"/admin">) {
  return (
    <>
      <AdminNav />
      {children}
      <RequestAlerts />
    </>
  );
}
