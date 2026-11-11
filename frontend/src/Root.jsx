import React, { useEffect } from "react";
import App from "./App";
import Landing from "./landing/Landing";
import { ROUTES, usePath } from "./lib/router";
import "./styles.css";

export default function Root() {
  const path = usePath();
  // Old share links were "/#config=...": send them straight to the workbench.
  const legacyShare = path === ROUTES.landing && window.location.hash.startsWith("#config=");
  const inApp = path.startsWith(ROUTES.app) || legacyShare;

  useEffect(() => {
    if (legacyShare) window.history.replaceState(null, "", `${ROUTES.app}${window.location.hash}`);
  }, [legacyShare]);

  useEffect(() => {
    document.title = inApp ? "Workbench - Flowbench" : "Flowbench - data pipeline playground";
  }, [inApp]);

  return inApp ? <App /> : <Landing />;
}
