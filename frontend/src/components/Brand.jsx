import React from "react";
import { ROUTES, linkTo } from "../lib/router";

/** The one logo + wordmark used in every header. */
export default function Brand({ tagline = true }) {
  return (
    <a className="brand" {...linkTo(ROUTES.landing)} title="Flowbench home" aria-label="Flowbench home">
      <img src="/logo.svg" width="30" height="30" alt="" />
      <span className="brand-text">
        <span className="brand-name">flowbench</span>
        {tagline && <span className="brand-tag hide-sm">data pipeline playground</span>}
      </span>
    </a>
  );
}
