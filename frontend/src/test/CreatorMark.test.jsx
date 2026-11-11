import React from "react";
import { render, screen } from "@testing-library/react";
import CreatorMark from "../components/CreatorMark";

test("shows creator attribution with contact links", () => {
  render(<CreatorMark />);
  expect(screen.getByText("Arunangshu Pramanik")).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "GitHub" }))
    .toHaveAttribute("href", "https://github.com/arunangshu01");
  expect(screen.getByRole("link", { name: "Email" }))
    .toHaveAttribute("href", "mailto:arunangshu01@gmail.com");
  expect(screen.getByRole("link", { name: "LinkedIn" }))
    .toHaveAttribute("href", expect.stringContaining("linkedin.com/in/"));
});
