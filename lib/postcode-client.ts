// 다음(카카오) 우편번호 서비스 — 도로명 주소 검색 (API 키 불필요). 브라우저에서만 쓴다.
// 처음 쓸 때만 스크립트를 불러온다.
type PostcodeData = { roadAddress: string; jibunAddress: string; userSelectedType: string; buildingName: string };
type DaumWindow = { daum?: { Postcode: new (o: { oncomplete: (d: PostcodeData) => void; width: string; height: string }) => { embed: (el: HTMLElement) => void } } };

export function loadPostcode(): Promise<void> {
  if ((window as unknown as DaumWindow).daum?.Postcode) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const el = document.createElement("script");
    el.src = "https://t1.daumcdn.net/mapjsapi/bundle/postcode/prod/postcode.v2.js";
    el.async = true;
    el.onload = () => resolve();
    el.onerror = () => reject(new Error("주소 검색을 불러오지 못했어요."));
    document.head.appendChild(el);
  });
}

/** box 안에 주소 검색 창을 띄우고, 주소를 고르면 onPick(도로명 주소 + (건물명)) 을 부른다. */
export function embedPostcode(box: HTMLElement, onPick: (address: string) => void): boolean {
  const Post = (window as unknown as DaumWindow).daum?.Postcode;
  if (!Post) return false;
  box.innerHTML = "";
  new Post({
    width: "100%",
    height: "100%",
    oncomplete: d => {
      const road = d.userSelectedType !== "J"; // R 도로명 / J 지번
      const base = road ? d.roadAddress : d.jibunAddress;
      onPick(base + (road && d.buildingName ? ` (${d.buildingName})` : ""));
    },
  }).embed(box);
  return true;
}
