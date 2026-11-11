import React from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ParamEditor from "../components/ParamEditor";

const schema = [
  { name: "reading_id", type: "string" },
  { name: "humidity_pct", type: "float" },
];

test("field param is a select of the incoming schema", async () => {
  const onChange = jest.fn();
  render(<ParamEditor spec={{ name: "field", type: "field", required: true }} value="reading_id"
    schema={schema} onChange={onChange} inputId="f" />);
  const select = screen.getByLabelText("field");
  expect(select.tagName).toBe("SELECT");
  expect(screen.getByRole("option", { name: "humidity_pct · float" })).toBeInTheDocument();
  await userEvent.selectOptions(select, "humidity_pct");
  expect(onChange).toHaveBeenCalledWith("humidity_pct");
});

test("a field that no longer exists is shown as unavailable", () => {
  render(<ParamEditor spec={{ name: "field", type: "field", required: true }} value="gone"
    schema={schema} onChange={() => {}} inputId="f" />);
  expect(screen.getByRole("option", { name: "gone (not available here)" })).toBeInTheDocument();
  expect(screen.getByLabelText("field")).toHaveClass("is-invalid");
});

test("fields param adds and removes chips", async () => {
  const onChange = jest.fn();
  const { rerender } = render(<ParamEditor spec={{ name: "fields", type: "fields", required: true }}
    value={["reading_id"]} schema={schema} onChange={onChange} inputId="fs" />);
  await userEvent.selectOptions(screen.getByLabelText("Add field"), "humidity_pct");
  expect(onChange).toHaveBeenLastCalledWith(["reading_id", "humidity_pct"]);
  rerender(<ParamEditor spec={{ name: "fields", type: "fields", required: true }}
    value={["reading_id", "humidity_pct"]} schema={schema} onChange={onChange} inputId="fs" />);
  await userEvent.click(screen.getByRole("button", { name: "Remove reading_id" }));
  expect(onChange).toHaveBeenLastCalledWith(["humidity_pct"]);
});

test("optional number clears to undefined", async () => {
  const onChange = jest.fn();
  render(<ParamEditor spec={{ name: "max", type: "number", required: false }} value={100}
    schema={schema} onChange={onChange} inputId="n" />);
  await userEvent.clear(screen.getByLabelText(/max/));
  expect(onChange).toHaveBeenLastCalledWith(undefined);
});

test("short enums render as a segmented control", async () => {
  const onChange = jest.fn();
  render(<ParamEditor spec={{ name: "how", type: "enum", required: false, options: ["left", "inner"], default: "left" }}
    schema={schema} onChange={onChange} inputId="e" />);
  expect(screen.getByRole("radio", { name: "left" })).toHaveAttribute("aria-checked", "true");
  await userEvent.click(screen.getByRole("radio", { name: "inner" }));
  expect(onChange).toHaveBeenCalledWith("inner");
});

test("values editor tokenizes and types input", async () => {
  const seen = [];
  function Controlled() {
    const [v, setV] = React.useState([]);
    return <ParamEditor spec={{ name: "values", type: "values", required: true }} value={v}
      schema={schema} onChange={(next) => { seen.push(next); setV(next); }} inputId="v" />;
  }
  render(<Controlled />);
  await userEvent.type(screen.getByLabelText("values"), "icu, 3{enter}");
  expect(seen.at(-1)).toEqual(["icu", 3]);
  expect(screen.getByText("icu")).toBeInTheDocument();
  await userEvent.type(screen.getByLabelText("values"), "{backspace}");
  expect(seen.at(-1)).toEqual(["icu"]);
});
