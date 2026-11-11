import React from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import RecordTable from "../components/RecordTable";

test("renders union of keys, nulls, and a lineage column", async () => {
  const onRid = jest.fn();
  render(<RecordTable onRid={onRid} rows={[
    { _rid: 7, a: 1, b: "x" },
    { _rid: 8, a: 2, b: null, c: true },
  ]} />);
  for (const col of ["rid", "a", "b", "c"]) expect(screen.getByRole("columnheader", { name: new RegExp(`^${col}`) })).toBeInTheDocument();
  expect(screen.getAllByText("null")).toHaveLength(2);
  await userEvent.click(screen.getByRole("button", { name: "8" }));
  expect(onRid).toHaveBeenCalledWith(8);
});

test("flags values that do not match the declared schema type", () => {
  render(<RecordTable rows={[{ temperature_c: "hot" }, { temperature_c: 21.5 }]}
    schema={[{ name: "temperature_c", type: "float" }]} />);
  expect(screen.getByText("hot")).toHaveClass("cell-mismatch");
  expect(screen.getByText("21.5")).not.toHaveClass("cell-mismatch");
});

test("shows empty text for no rows", () => {
  render(<RecordTable rows={[]} emptyText="Nothing here" />);
  expect(screen.getByText("Nothing here")).toBeInTheDocument();
});
