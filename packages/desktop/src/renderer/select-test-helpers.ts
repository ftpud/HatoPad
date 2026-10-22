import { fireEvent, screen } from "@testing-library/react";

/** Exercise the custom dropdown through the same clicks used in the UI. */
export function chooseSelect(control: HTMLElement, value: string | number) {
  if (control.getAttribute("aria-expanded") !== "true") fireEvent.click(control);
  const option = screen.getAllByRole("option").find((item) => item.getAttribute("data-value") === String(value));
  if (!option) throw new Error(`Missing dropdown choice: ${value}`);
  fireEvent.click(option);
}
