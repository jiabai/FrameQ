export function getGreetingPeriod(hour: number): "morning" | "afternoon" | "evening" {
  if (hour >= 6 && hour < 12) return "morning";
  if (hour >= 12 && hour < 18) return "afternoon";
  return "evening";
}
