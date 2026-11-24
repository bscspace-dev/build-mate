import type { MetadataRoute } from "next";

// 홈 화면에 앱처럼 추가할 수 있게 한다 (아이폰은 이렇게 추가해야 푸시 알림을 받을 수 있다)
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "빌드메이트",
    short_name: "빌드메이트",
    start_url: "/admin",
    display: "standalone",
    background_color: "#ffffff",
    theme_color: "#2563eb",
    icons: [{ src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" }],
  };
}
