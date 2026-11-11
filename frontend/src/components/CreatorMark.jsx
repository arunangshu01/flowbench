import React from "react";

const GitHubIcon = (
  <svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true" width="15" height="15">
    <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27s1.36.09 2 .27c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8Z" />
  </svg>
);

const LinkedInIcon = (
  <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" width="14" height="14">
    <path d="M4.98 3.5C4.98 4.88 3.87 6 2.5 6S0 4.88 0 3.5 1.12 1 2.5 1s2.48 1.12 2.48 2.5zM.5 8h4v15h-4V8zm7.5 0h3.8v2.05h.05c.53-1 1.83-2.05 3.77-2.05 4.03 0 4.78 2.65 4.78 6.1V23h-4v-7.9c0-1.88-.04-4.3-2.62-4.3-2.62 0-3.02 2.05-3.02 4.17V23H8V8z" />
  </svg>
);

const MailIcon = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"
    strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" width="15" height="15">
    <rect x="3" y="5" width="18" height="14" rx="2" />
    <path d="m3 7 9 6 9-6" />
  </svg>
);

const LINKS = [
  { href: "https://github.com/arunangshu01", label: "GitHub", title: "GitHub profile", icon: GitHubIcon, external: true },
  { href: "https://www.linkedin.com/in/arunangshu-pramanik-1896168b", label: "LinkedIn", title: "LinkedIn profile", icon: LinkedInIcon, external: true },
  { href: "mailto:arunangshu01@gmail.com", label: "Email", title: "arunangshu01@gmail.com", icon: MailIcon },
];

/** Creator attribution, consistent with the other portfolio apps. */
export default function CreatorMark({ variant = "bar" }) {
  return (
    <div className={`creator-mark is-${variant}`}>
      <span className="creator-name">Created by <strong>Arunangshu Pramanik</strong></span>
      <nav aria-label="Creator contact" className="creator-links">
        {LINKS.map(({ href, label, title, icon, external }) => (
          <a key={href} href={href} aria-label={label} title={title}
            {...(external ? { target: "_blank", rel: "noreferrer" } : {})}>
            {icon}
          </a>
        ))}
      </nav>
    </div>
  );
}
