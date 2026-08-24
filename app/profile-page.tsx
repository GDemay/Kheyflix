"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Check, Pencil, Plus, X } from "lucide-react";
import { Route } from "./routing";
import { useDialogFocus } from "./lib/use-dialog-focus";

type ViewerProfile = {
  id: string;
  name: string;
  color: string;
  kid?: boolean;
};

const defaults: ViewerProfile[] = [
  { id: "main", name: "Kheyflix", color: "#b20710" },
  { id: "cinema", name: "Cinema", color: "#145a8d" },
  { id: "series", name: "Series", color: "#6b3d98" },
  { id: "kids", name: "Kids", color: "#23855d", kid: true },
];
const profilesKey = "kheyflix.profiles.v2";
const activeKey = "kheyflix.active-profile";

export const isProfileNameValid = (name: string) => name.trim().length > 0;

const parseProfiles = (raw: string | null) => {
  try {
    const value = JSON.parse(raw || "") as ViewerProfile[];
    return Array.isArray(value) && value.length ? value.slice(0, 6) : defaults;
  } catch {
    return defaults;
  }
};

export default function ProfilePage({
  navigate,
}: {
  navigate: (route: Route) => void;
}) {
  const [profiles, setProfiles] = useState(() =>
    parseProfiles(localStorage.getItem(profilesKey)),
  );
  const [managing, setManaging] = useState(false);
  const [editing, setEditing] = useState<ViewerProfile | null>(null);
  const persist = (next: ViewerProfile[]) => {
    setProfiles(next);
    localStorage.setItem(profilesKey, JSON.stringify(next));
  };
  const choose = (profile: ViewerProfile) => {
    if (managing) {
      setEditing(profile);
      return;
    }
    localStorage.setItem(activeKey, profile.id);
    window.dispatchEvent(new Event("kheyflix-profile-change"));
    navigate({ section: "home" });
  };
  const save = () => {
    if (!editing) return;
    const name = editing.name.trim();
    if (!isProfileNameValid(name)) return;
    persist(
      profiles.some((profile) => profile.id === editing.id)
        ? profiles.map((profile) =>
            profile.id === editing.id ? { ...editing, name } : profile,
          )
        : [...profiles, { ...editing, name }],
    );
    setEditing(null);
  };
  const editorOpen = Boolean(editing);
  useEffect(() => {
    if (!editorOpen) return;
    const background = document.querySelector<HTMLElement>(".app-background");
    if (!background) return;
    const previousInert = background.getAttribute("inert");
    const previousAriaHidden = background.getAttribute("aria-hidden");
    background.setAttribute("inert", "");
    background.setAttribute("aria-hidden", "true");
    return () => {
      if (previousInert === null) background.removeAttribute("inert");
      else background.setAttribute("inert", previousInert);
      if (previousAriaHidden === null) background.removeAttribute("aria-hidden");
      else background.setAttribute("aria-hidden", previousAriaHidden);
    };
  }, [editorOpen]);
  const editorDialog = useDialogFocus<HTMLElement>(() => setEditing(null), {
    active: editorOpen,
    initialFocus: "[data-dialog-initial-focus]",
    returnFocus: editing
      ? `[data-profile-id='${editing.id}']`
      : undefined,
  });

  return (
    <section className="profile-gate" aria-labelledby="profiles-title">
      <div
        className="profile-background"
        style={{ display: "contents" }}
        inert={Boolean(editing) || undefined}
        aria-hidden={editing ? "true" : undefined}
      >
        <button
          className="profile-gate-brand"
          onClick={() => navigate({ section: "home" })}
        >
          KHEYFLIX
        </button>
        <div className="profile-gate-content">
          <h1 id="profiles-title">
            {managing ? "Manage Profiles:" : "Who’s watching?"}
          </h1>
          <div className="profile-picker">
            {profiles.map((profile) => (
              <button
                className="profile-choice"
                data-profile-id={profile.id}
                key={profile.id}
                onClick={() => choose(profile)}
                aria-label={`${managing ? "Edit" : "Continue as"} ${profile.name}`}
              >
                <span
                  className="profile-art"
                  style={
                    { "--profile-color": profile.color } as React.CSSProperties
                  }
                >
                  <b>
                    {profile.kid
                      ? "KIDS"
                      : profile.name.slice(0, 1).toUpperCase()}
                  </b>
                  {managing && (
                    <i>
                      <Pencil />
                    </i>
                  )}
                </span>
                <span>{profile.name}</span>
              </button>
            ))}
            {managing && profiles.length < 6 && (
              <button
                className="profile-choice add-profile"
                onClick={() =>
                  setEditing({
                    id: `profile-${Date.now()}`,
                    name: "",
                    color: "#d97706",
                  })
                }
              >
                <span className="profile-art">
                  <Plus />
                </span>
                <span>Add Profile</span>
              </button>
            )}
          </div>
          <button
            className={managing ? "profiles-done" : "manage-profiles"}
            onClick={() => setManaging(!managing)}
          >
            {managing ? "Done" : "Manage Profiles"}
          </button>
        </div>
      </div>
      {editing &&
        typeof document !== "undefined" &&
        createPortal(
        <div className="profile-editor-backdrop">
          <section
            className="profile-editor"
            role="dialog"
            aria-modal="true"
            aria-labelledby="edit-profile-title"
            ref={editorDialog}
            tabIndex={-1}
          >
            <button
              className="editor-close"
              onClick={() => setEditing(null)}
              aria-label="Close editor"
            >
              <X />
            </button>
            <h2 id="edit-profile-title">
              {profiles.some((profile) => profile.id === editing.id)
                ? "Edit Profile"
                : "Add Profile"}
            </h2>
            <div className="editor-row">
              <span
                className="profile-art"
                style={
                  { "--profile-color": editing.color } as React.CSSProperties
                }
              >
                <b>{editing.name.slice(0, 1).toUpperCase() || "+"}</b>
              </span>
              <label>
                Profile name
                <input
                  autoFocus
                  data-dialog-initial-focus
                  maxLength={24}
                  value={editing.name}
                  aria-invalid={!isProfileNameValid(editing.name)}
                  aria-describedby={
                    !isProfileNameValid(editing.name)
                      ? "profile-name-help"
                      : undefined
                  }
                  onChange={(event) =>
                    setEditing({ ...editing, name: event.target.value })
                  }
                />
                {!isProfileNameValid(editing.name) && (
                  <span id="profile-name-help">
                    Enter a profile name to save.
                  </span>
                )}
              </label>
            </div>
            <label className="color-field">
              Profile color
              <input
                type="color"
                value={editing.color}
                onChange={(event) =>
                  setEditing({ ...editing, color: event.target.value })
                }
              />
            </label>
            <label className="kids-toggle">
              <input
                type="checkbox"
                checked={Boolean(editing.kid)}
                onChange={(event) =>
                  setEditing({ ...editing, kid: event.target.checked })
                }
              />
              Kids profile
            </label>
            <div className="editor-actions">
              <button
                className="editor-save"
                onClick={save}
                disabled={!isProfileNameValid(editing.name)}
              >
                <Check />
                Save
              </button>
              {profiles.length > 1 &&
                profiles.some((profile) => profile.id === editing.id) && (
                  <button
                    onClick={() => {
                      persist(
                        profiles.filter(
                          (profile) => profile.id !== editing.id,
                        ),
                      );
                      setEditing(null);
                    }}
                  >
                    Delete Profile
                  </button>
                )}
            </div>
          </section>
        </div>,
        document.body,
      )}
    </section>
  );
}
