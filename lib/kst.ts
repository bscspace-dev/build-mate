// 한국 시간(KST, UTC+9) 기준 오늘 날짜 (YYYY-MM-DD). 서버는 UTC 라서 자정(00:00) 판단은 이걸로 한다.
export const todayKst = (): string => new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
