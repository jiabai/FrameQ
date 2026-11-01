// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, expect, test } from "vitest";
import { useModalFocus } from "./useModalFocus";

afterEach(cleanup);

function Layer({ label }: { label: string }) {
  const ref = useModalFocus<HTMLElement>(true);
  return <div><section ref={ref} role="dialog" aria-label={label}><button type="button">{label}</button></section></div>;
}

function Layers({ first, second, third, alreadyInert = false }: {
  first: boolean; second: boolean; third: boolean; alreadyInert?: boolean;
}) {
  return <>
    <main data-testid="background" inert={alreadyInert}><button type="button">Background</button></main>
    {first ? <Layer label="Result" /> : null}
    {second ? <Layer label="Discard" /> : null}
    {third ? <Layer label="Generate" /> : null}
  </>;
}

test("keeps background inert while older closing layers leave before the active confirmation", () => {
  const view = render(<Layers first second={false} third={false} />);
  const background = view.getByTestId("background");
  expect(background.hasAttribute("inert")).toBe(true);
  view.rerender(<Layers first second third={false} />);
  view.rerender(<Layers first second third />);
  view.rerender(<Layers first={false} second third />);
  expect(background.hasAttribute("inert")).toBe(true);
  view.rerender(<Layers first={false} second={false} third />);
  expect(background.hasAttribute("inert")).toBe(true);
  view.rerender(<Layers first={false} second={false} third={false} />);
  expect(background.hasAttribute("inert")).toBe(false);
});

test("restores an originally inert background after overlapping modal owners close", () => {
  const view = render(<Layers first second third alreadyInert />);
  const background = view.getByTestId("background");
  view.rerender(<Layers first={false} second={false} third alreadyInert />);
  expect(background.hasAttribute("inert")).toBe(true);
  view.rerender(<Layers first={false} second={false} third={false} alreadyInert />);
  expect(background.hasAttribute("inert")).toBe(true);
});
