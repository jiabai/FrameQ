import frameqMark from "../../assets/app-mark.svg";

export function AppMark({ className }: { className?: string }) {
  return <img className={className} src={frameqMark} alt="" aria-hidden="true" draggable={false} />;
}
