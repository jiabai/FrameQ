import frameqMark from "../../assets/frameq-mark.svg";

export function FrameQMark({ className }: { className?: string }) {
  return <img className={className} src={frameqMark} alt="" aria-hidden="true" draggable={false} />;
}
